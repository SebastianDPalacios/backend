-- Retiro lógico de categorías de producto. Los registros históricos se conservan.
-- Es idempotente: puede ejecutarse aunque la columna o el índice ya existan.
SET @catalog_deleted_column_exists := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'product_categories'
     AND COLUMN_NAME = 'deleted_at'
);
SET @catalog_deleted_column_sql := IF(
  @catalog_deleted_column_exists = 0,
  'ALTER TABLE product_categories ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at',
  'SELECT 1'
);
PREPARE catalog_deleted_column_stmt FROM @catalog_deleted_column_sql;
EXECUTE catalog_deleted_column_stmt;
DEALLOCATE PREPARE catalog_deleted_column_stmt;

SET @catalog_deleted_index_exists := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'product_categories'
     AND INDEX_NAME = 'idx_product_categories_deleted_at'
);
SET @catalog_deleted_index_sql := IF(
  @catalog_deleted_index_exists = 0,
  'ALTER TABLE product_categories ADD KEY idx_product_categories_deleted_at (deleted_at)',
  'SELECT 1'
);
PREPARE catalog_deleted_index_stmt FROM @catalog_deleted_index_sql;
EXECUTE catalog_deleted_index_stmt;
DEALLOCATE PREPARE catalog_deleted_index_stmt;

