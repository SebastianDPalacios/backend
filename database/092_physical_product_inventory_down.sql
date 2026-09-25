-- El procedimiento de 092 depende de inventory_product_id. Tras este rollback debe
-- reaplicarse la definicion anterior de sp_dispatch_order de la migracion 066.
DROP PROCEDURE IF EXISTS sp_dispatch_order;

ALTER TABLE order_items
  DROP FOREIGN KEY fk_order_items_inventory_product,
  DROP INDEX idx_order_items_inventory_product,
  DROP COLUMN inventory_product_id;

ALTER TABLE products
  DROP FOREIGN KEY fk_products_physical_product,
  DROP INDEX idx_products_physical_product,
  DROP COLUMN physical_product_id;
