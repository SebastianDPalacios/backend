SET @has_commercial_mode := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'commercial_mode'
);
SET @add_commercial_mode_sql := IF(
  @has_commercial_mode = 0,
  'ALTER TABLE order_items ADD COLUMN commercial_mode VARCHAR(20) NULL AFTER line_type',
  'SELECT 1'
);
PREPARE add_commercial_mode_stmt FROM @add_commercial_mode_sql;
EXECUTE add_commercial_mode_stmt;
DEALLOCATE PREPARE add_commercial_mode_stmt;

UPDATE order_items item
LEFT JOIN order_items paired
  ON paired.order_id = item.order_id
 AND paired.line_group_key = item.line_group_key
 AND paired.line_type = IF(item.line_type = 'sale', 'bonus', 'sale')
SET item.commercial_mode = CASE
  WHEN item.line_type IN ('sale', 'bonus') AND paired.id IS NOT NULL THEN 'sale_bonus'
  ELSE item.line_type
END
WHERE item.id > 0
  AND (item.commercial_mode IS NULL OR item.commercial_mode = '');
