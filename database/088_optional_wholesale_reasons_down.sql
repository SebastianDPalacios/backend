UPDATE wholesale_price_lists
SET change_reason = 'Sin motivo informado'
WHERE change_reason IS NULL OR TRIM(change_reason) = '';

UPDATE customer_wholesale_profiles
SET change_reason = 'Sin motivo informado'
WHERE change_reason IS NULL OR TRIM(change_reason) = '';

UPDATE wholesale_product_prices
SET change_reason = 'Sin motivo informado'
WHERE change_reason IS NULL OR TRIM(change_reason) = '';

UPDATE wholesale_configuration_history
SET reason = 'Sin motivo informado'
WHERE reason IS NULL OR TRIM(reason) = '';

ALTER TABLE wholesale_price_lists
  MODIFY COLUMN change_reason VARCHAR(500) NOT NULL,
  ADD CONSTRAINT chk_wholesale_price_lists_reason CHECK (CHAR_LENGTH(TRIM(change_reason)) >= 5);

ALTER TABLE customer_wholesale_profiles
  MODIFY COLUMN change_reason VARCHAR(500) NOT NULL,
  ADD CONSTRAINT chk_customer_wholesale_profiles_reason CHECK (CHAR_LENGTH(TRIM(change_reason)) >= 5);

ALTER TABLE wholesale_product_prices
  MODIFY COLUMN change_reason VARCHAR(500) NOT NULL,
  ADD CONSTRAINT chk_wholesale_product_prices_reason CHECK (CHAR_LENGTH(TRIM(change_reason)) >= 5);

ALTER TABLE wholesale_configuration_history
  MODIFY COLUMN reason VARCHAR(500) NOT NULL,
  ADD CONSTRAINT chk_wholesale_configuration_history_reason CHECK (CHAR_LENGTH(TRIM(reason)) >= 5);
