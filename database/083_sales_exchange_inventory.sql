ALTER TABLE sales_returns
  ADD COLUMN request_key VARCHAR(100) NULL AFTER customer_id,
  ADD COLUMN annulled_by BIGINT UNSIGNED NULL AFTER rejected_at,
  ADD COLUMN annulled_at TIMESTAMP NULL AFTER annulled_by,
  ADD COLUMN annulment_reason VARCHAR(500) NULL AFTER annulled_at,
  ADD UNIQUE KEY uq_sales_returns_request_key (request_key),
  MODIFY COLUMN status ENUM('pending_authorization','completed','rejected','annulled') NOT NULL DEFAULT 'pending_authorization',
  ADD CONSTRAINT fk_sales_returns_annulled_by FOREIGN KEY (annulled_by) REFERENCES users (id);

ALTER TABLE sales_return_items
  ADD COLUMN replacement_unit_price DECIMAL(14,2) NULL AFTER replacement_quantity;

UPDATE sales_returns
SET request_key = CONCAT('legacy-', id)
WHERE id > 0
  AND request_key IS NULL;

ALTER TABLE sales_returns
  MODIFY COLUMN request_key VARCHAR(100) NOT NULL;
