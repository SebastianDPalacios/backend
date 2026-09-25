ALTER TABLE sales_returns
  ADD COLUMN operation_type ENUM('return','exchange') NOT NULL DEFAULT 'return' AFTER order_id,
  ADD COLUMN customer_id BIGINT UNSIGNED NULL AFTER operation_type,
  ADD KEY idx_sales_returns_operation_type (operation_type, reported_at),
  ADD KEY idx_sales_returns_customer (customer_id, reported_at);

UPDATE sales_returns sales_return
INNER JOIN orders original_order ON original_order.id = sales_return.order_id
SET sales_return.customer_id = original_order.customer_id
WHERE sales_return.id > 0
  AND sales_return.customer_id IS NULL;

ALTER TABLE sales_returns
  MODIFY COLUMN customer_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_sales_returns_customer FOREIGN KEY (customer_id) REFERENCES customers (id);

ALTER TABLE sales_return_items
  ADD COLUMN replacement_quantity DECIMAL(14,3) NULL AFTER replacement_product_id;
