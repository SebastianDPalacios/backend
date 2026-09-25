ALTER TABLE wholesale_price_lists
  DROP CHECK chk_wholesale_price_lists_reason,
  MODIFY COLUMN change_reason VARCHAR(500) NULL;

ALTER TABLE customer_wholesale_profiles
  DROP CHECK chk_customer_wholesale_profiles_reason,
  MODIFY COLUMN change_reason VARCHAR(500) NULL;

ALTER TABLE wholesale_product_prices
  DROP CHECK chk_wholesale_product_prices_reason,
  MODIFY COLUMN change_reason VARCHAR(500) NULL;

ALTER TABLE wholesale_configuration_history
  DROP CHECK chk_wholesale_configuration_history_reason,
  MODIFY COLUMN reason VARCHAR(500) NULL;
