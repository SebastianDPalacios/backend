-- Permite vender antes del reporte diario de produccion y conciliar una sola vez.
-- La materia prima conserva su validacion estricta; solo producto terminado puede quedar negativo.

CREATE TABLE IF NOT EXISTS product_sale_inventory_commitments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  committed_quantity DECIMAL(14,3) NOT NULL,
  applied_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  status ENUM('pending','applied','cancelled') NOT NULL DEFAULT 'pending',
  applied_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_sale_commitment_item (order_item_id),
  KEY idx_product_sale_commitment_pending (branch_id, product_id, status, created_at),
  KEY idx_product_sale_commitment_order (order_id),
  CONSTRAINT fk_product_sale_commitment_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_product_sale_commitment_item
    FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_product_sale_commitment_branch
    FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_product_sale_commitment_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_product_sale_commitment_quantities CHECK (
    committed_quantity >= 0 AND applied_quantity >= 0 AND applied_quantity <= committed_quantity
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_inventory_daily_cutoffs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  branch_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  production_batch_id BIGINT UNSIGNED NULL,
  cutoff_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_inventory_cutoff (branch_id, product_id, business_date),
  CONSTRAINT fk_product_inventory_cutoff_branch
    FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_product_inventory_cutoff_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_product_inventory_cutoff_batch
    FOREIGN KEY (production_batch_id) REFERENCES production_batches (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_product_inventory_cutoff_user
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- El stock terminado puede ser negativo para representar ventas anteriores a la produccion.
SET @stock_products_check_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stock_products'
    AND CONSTRAINT_NAME = 'chk_stock_products_values'
);
SET @stock_products_check_sql = IF(
  @stock_products_check_exists > 0,
  'ALTER TABLE stock_products DROP CHECK chk_stock_products_values',
  'SELECT 1'
);
PREPARE stock_products_check_stmt FROM @stock_products_check_sql;
EXECUTE stock_products_check_stmt;
DEALLOCATE PREPARE stock_products_check_stmt;

SET @stock_products_minimum_check_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stock_products'
    AND CONSTRAINT_NAME = 'chk_stock_products_minimum'
);
SET @stock_products_minimum_check_sql = IF(
  @stock_products_minimum_check_exists = 0,
  'ALTER TABLE stock_products ADD CONSTRAINT chk_stock_products_minimum CHECK (min_stock >= 0)',
  'SELECT 1'
);
PREPARE stock_products_minimum_check_stmt FROM @stock_products_minimum_check_sql;
EXECUTE stock_products_minimum_check_stmt;
DEALLOCATE PREPARE stock_products_minimum_check_stmt;

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_dispatch_order $$
CREATE PROCEDURE sp_dispatch_order(
  IN p_order_id BIGINT UNSIGNED,
  IN p_actor_user_id BIGINT UNSIGNED,
  OUT o_code INT,
  OUT o_message VARCHAR(255),
  OUT o_data_json LONGTEXT
)
BEGIN
  DECLARE v_status VARCHAR(30);
  DECLARE v_branch_id BIGINT UNSIGNED;
  DECLARE v_items_count INT DEFAULT 0;
  DECLARE v_dispatched_rows INT DEFAULT 0;
  DECLARE v_pending_reservations INT DEFAULT 0;
  DECLARE v_item_id BIGINT UNSIGNED;
  DECLARE v_product_id BIGINT UNSIGNED;
  DECLARE v_qty DECIMAL(12,3);
  DECLARE v_direct_qty DECIMAL(14,3);
  DECLARE v_stock_dispatch_qty DECIMAL(14,3);
  DECLARE v_has_cutoff INT DEFAULT 0;
  DECLARE done INT DEFAULT 0;
  DECLARE v_signal_msg VARCHAR(255);
  DECLARE v_sqlstate CHAR(5) DEFAULT '00000';
  DECLARE v_errno INT DEFAULT 0;
  DECLARE v_errmsg TEXT;

  DECLARE cur_items CURSOR FOR
    SELECT id, product_id, quantity FROM order_items WHERE order_id = p_order_id;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1
      v_sqlstate = RETURNED_SQLSTATE, v_errno = MYSQL_ERRNO, v_errmsg = MESSAGE_TEXT;
    ROLLBACK;
    SET o_code = -1;
    SET o_message = CONCAT('ERROR_SQL ', v_errno, ' ', v_sqlstate, ': ', v_errmsg);
    SET o_data_json = NULL;
  END;

  START TRANSACTION;
  SELECT status, branch_id INTO v_status, v_branch_id FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_status IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pedido no encontrado'; END IF;
  IF v_status NOT IN ('confirmed', 'ready', 'in_production') THEN
    SET v_signal_msg = CONCAT('el pedido no se puede despachar desde el estado ', v_status);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_signal_msg;
  END IF;

  SELECT COUNT(*) INTO v_items_count FROM order_items WHERE order_id = p_order_id;
  IF v_items_count = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'el pedido no tiene items'; END IF;

  SELECT COUNT(*) INTO v_pending_reservations
  FROM production_sale_reservations psr
  INNER JOIN order_items oi ON oi.id = psr.order_item_id
  WHERE oi.order_id = p_order_id
    AND psr.status IN ('reserved','partially_delivered')
    AND psr.delivered_quantity < psr.quantity;
  IF v_pending_reservations > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'el pedido tiene reservas pendientes; confirma la entrega directa o libera la reserva';
  END IF;

  OPEN cur_items;
  read_loop: LOOP
    FETCH cur_items INTO v_item_id, v_product_id, v_qty;
    IF done = 1 THEN LEAVE read_loop; END IF;

    SELECT COALESCE(SUM(delivered_quantity), 0) INTO v_direct_qty
    FROM production_sale_reservations
    WHERE order_item_id = v_item_id AND status = 'delivered';
    SET v_stock_dispatch_qty = GREATEST(v_qty - v_direct_qty, 0);

    IF v_stock_dispatch_qty > 0 THEN
      SELECT COUNT(*) INTO v_has_cutoff
      FROM product_inventory_daily_cutoffs
      WHERE branch_id = v_branch_id AND product_id = v_product_id AND business_date = CURRENT_DATE;

      INSERT INTO product_sale_inventory_commitments (
        order_id, order_item_id, branch_id, product_id, committed_quantity,
        applied_quantity, status, applied_at
      ) VALUES (
        p_order_id, v_item_id, v_branch_id, v_product_id, v_stock_dispatch_qty,
        IF(v_has_cutoff > 0, v_stock_dispatch_qty, 0),
        IF(v_has_cutoff > 0, 'applied', 'pending'),
        IF(v_has_cutoff > 0, CURRENT_TIMESTAMP, NULL)
      ) ON DUPLICATE KEY UPDATE
        committed_quantity = VALUES(committed_quantity),
        applied_quantity = VALUES(applied_quantity),
        status = VALUES(status),
        applied_at = VALUES(applied_at),
        updated_at = CURRENT_TIMESTAMP;

      IF v_has_cutoff > 0 THEN
        INSERT INTO stock_products (branch_id, product_id, quantity_on_hand, min_stock)
        VALUES (v_branch_id, v_product_id, -v_stock_dispatch_qty, 0)
        ON DUPLICATE KEY UPDATE
          quantity_on_hand = quantity_on_hand - v_stock_dispatch_qty,
          updated_at = CURRENT_TIMESTAMP;
        INSERT INTO inventory_movements (
          branch_id, item_type, raw_material_id, product_id, movement_type,
          quantity, unit_cost, reference_type, reference_id, notes, created_by
        ) VALUES (
          v_branch_id, 'product', NULL, v_product_id, 'sale_out',
          v_stock_dispatch_qty, NULL, 'order', p_order_id,
          CONCAT('Venta posterior al reporte diario; item ', v_item_id), p_actor_user_id
        );
      END IF;
    END IF;
    SET v_dispatched_rows = v_dispatched_rows + 1;
  END LOOP;
  CLOSE cur_items;

  UPDATE orders SET status = 'dispatched', updated_at = CURRENT_TIMESTAMP WHERE id = p_order_id;
  INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
  VALUES (p_actor_user_id, 'order.dispatch', 'orders', CAST(p_order_id AS CHAR),
    JSON_OBJECT('dispatched_items', v_dispatched_rows, 'inventory_mode', 'deferred_until_daily_production'));
  COMMIT;
  SET o_code = 1;
  SET o_message = 'pedido despachado';
  SET o_data_json = JSON_OBJECT('order_id', p_order_id, 'dispatched_items', v_dispatched_rows);
END $$

DELIMITER ;
