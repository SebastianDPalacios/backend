-- Configura productos cuya venta incluye vendaje automaticamente.

SET @includes_bonus_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'includes_bonus'
);

SET @includes_bonus_sql = IF(
  @includes_bonus_exists = 0,
  'ALTER TABLE products ADD COLUMN includes_bonus TINYINT(1) NOT NULL DEFAULT 0 AFTER units_per_bag',
  'SELECT 1'
);

PREPARE includes_bonus_stmt FROM @includes_bonus_sql;
EXECUTE includes_bonus_stmt;
DEALLOCATE PREPARE includes_bonus_stmt;
