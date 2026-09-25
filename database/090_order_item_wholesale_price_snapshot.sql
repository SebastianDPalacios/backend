ALTER TABLE order_items
  ADD COLUMN regular_price_reference DECIMAL(14,2) NULL AFTER unit_price,
  ADD COLUMN wholesale_price_found DECIMAL(14,2) NULL AFTER regular_price_reference,
  ADD COLUMN applied_price DECIMAL(14,2) NULL AFTER wholesale_price_found,
  ADD COLUMN price_origin VARCHAR(30) NULL AFTER applied_price,
  ADD COLUMN wholesale_price_configuration_id BIGINT UNSIGNED NULL AFTER price_origin,
  ADD COLUMN wholesale_price_list_id BIGINT UNSIGNED NULL AFTER wholesale_price_configuration_id,
  ADD COLUMN wholesale_price_list_name VARCHAR(150) NULL AFTER wholesale_price_list_id,
  ADD KEY idx_order_items_wholesale_configuration (wholesale_price_configuration_id),
  ADD KEY idx_order_items_wholesale_list (wholesale_price_list_id),
  ADD CONSTRAINT fk_order_items_wholesale_configuration
    FOREIGN KEY (wholesale_price_configuration_id) REFERENCES wholesale_product_prices (id),
  ADD CONSTRAINT fk_order_items_wholesale_list
    FOREIGN KEY (wholesale_price_list_id) REFERENCES wholesale_price_lists (id),
  ADD CONSTRAINT chk_order_items_price_origin
    CHECK (price_origin IS NULL OR price_origin IN ('regular','wholesale_general','customer_special')),
  ADD CONSTRAINT chk_order_items_price_snapshot
    CHECK (
      (regular_price_reference IS NULL OR regular_price_reference > 0)
      AND (wholesale_price_found IS NULL OR wholesale_price_found > 0)
      AND (applied_price IS NULL OR applied_price > 0)
    );

UPDATE order_items
SET regular_price_reference = unit_price,
    applied_price = unit_price,
    price_origin = 'regular'
WHERE id > 0
  AND regular_price_reference IS NULL;
