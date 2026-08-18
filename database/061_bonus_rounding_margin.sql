-- Margen configurable por linea para completar una unidad entera de vendaje.

SET @sales_margin_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sales_settings'
    AND COLUMN_NAME = 'bonus_max_company_loss_amount'
);

SET @sales_margin_sql = IF(
  @sales_margin_exists = 0,
  'ALTER TABLE sales_settings ADD COLUMN bonus_max_company_loss_amount DECIMAL(12,2) NOT NULL DEFAULT 1500.00 AFTER bonus_minimum_amount',
  'SELECT 1'
);

PREPARE sales_margin_stmt FROM @sales_margin_sql;
EXECUTE sales_margin_stmt;
DEALLOCATE PREPARE sales_margin_stmt;

SET @orders_margin_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'bonus_max_company_loss_amount'
);

SET @orders_margin_sql = IF(
  @orders_margin_exists = 0,
  'ALTER TABLE orders ADD COLUMN bonus_max_company_loss_amount DECIMAL(12,2) NOT NULL DEFAULT 1500.00 AFTER bonus_minimum_amount',
  'SELECT 1'
);

PREPARE orders_margin_stmt FROM @orders_margin_sql;
EXECUTE orders_margin_stmt;
DEALLOCATE PREPARE orders_margin_stmt;
