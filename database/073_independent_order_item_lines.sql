-- Permite repetir un producto y tipo dentro del pedido sin fusionar capturas distintas.
SET @line_group_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'line_group_key'
);

SET @add_line_group_column_sql = IF(
  @line_group_column_exists = 0,
  'ALTER TABLE order_items ADD COLUMN line_group_key VARCHAR(80) NULL AFTER product_id',
  'SELECT 1'
);
PREPARE add_line_group_column_stmt FROM @add_line_group_column_sql;
EXECUTE add_line_group_column_stmt;
DEALLOCATE PREPARE add_line_group_column_stmt;

UPDATE order_items
SET line_group_key = CONCAT('legacy-', id)
WHERE id > 0
  AND (line_group_key IS NULL OR line_group_key = '');

ALTER TABLE order_items MODIFY COLUMN line_group_key VARCHAR(80) NOT NULL;

-- La FK de order_id puede estar usando el índice único anterior. Se crea primero
-- un índice normal para conservar el soporte de la llave foránea al retirarlo.
SET @order_id_index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND INDEX_NAME = 'idx_order_items_order'
);
SET @add_order_id_index_sql = IF(
  @order_id_index_exists = 0,
  'ALTER TABLE order_items ADD KEY idx_order_items_order (order_id)',
  'SELECT 1'
);
PREPARE add_order_id_index_stmt FROM @add_order_id_index_sql;
EXECUTE add_order_id_index_stmt;
DEALLOCATE PREPARE add_order_id_index_stmt;

SET @old_order_item_unique_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND INDEX_NAME = 'uq_order_items_order_product_type'
);
SET @drop_old_order_item_unique_sql = IF(
  @old_order_item_unique_exists > 0,
  'ALTER TABLE order_items DROP INDEX uq_order_items_order_product_type',
  'SELECT 1'
);
PREPARE drop_old_order_item_unique_stmt FROM @drop_old_order_item_unique_sql;
EXECUTE drop_old_order_item_unique_stmt;
DEALLOCATE PREPARE drop_old_order_item_unique_stmt;

SET @line_group_unique_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND INDEX_NAME = 'uq_order_items_order_group_type'
);
SET @add_line_group_unique_sql = IF(
  @line_group_unique_exists = 0,
  'ALTER TABLE order_items ADD UNIQUE KEY uq_order_items_order_group_type (order_id, line_group_key, line_type)',
  'SELECT 1'
);
PREPARE add_line_group_unique_stmt FROM @add_line_group_unique_sql;
EXECUTE add_line_group_unique_stmt;
DEALLOCATE PREPARE add_line_group_unique_stmt;
