ALTER TABLE order_items
  DROP FOREIGN KEY fk_order_items_wholesale_configuration,
  DROP FOREIGN KEY fk_order_items_wholesale_list,
  DROP CHECK chk_order_items_price_origin,
  DROP CHECK chk_order_items_price_snapshot,
  DROP INDEX idx_order_items_wholesale_configuration,
  DROP INDEX idx_order_items_wholesale_list,
  DROP COLUMN wholesale_price_list_name,
  DROP COLUMN wholesale_price_list_id,
  DROP COLUMN wholesale_price_configuration_id,
  DROP COLUMN price_origin,
  DROP COLUMN applied_price,
  DROP COLUMN wholesale_price_found,
  DROP COLUMN regular_price_reference;
