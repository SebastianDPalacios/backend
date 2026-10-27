-- Eliminación lógica de materias primas. Conserva recetas, movimientos e históricos.
-- Idempotente para instalaciones donde la columna haya sido creada manualmente.
SET @raw_material_deleted_column_exists := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'raw_materials'
     AND COLUMN_NAME = 'deleted_at'
);
SET @raw_material_deleted_column_sql := IF(
  @raw_material_deleted_column_exists = 0,
  'ALTER TABLE raw_materials ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at',
  'SELECT 1'
);
PREPARE raw_material_deleted_column_stmt FROM @raw_material_deleted_column_sql;
EXECUTE raw_material_deleted_column_stmt;
DEALLOCATE PREPARE raw_material_deleted_column_stmt;

SET @raw_material_deleted_index_exists := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'raw_materials'
     AND INDEX_NAME = 'idx_raw_materials_deleted_at'
);
SET @raw_material_deleted_index_sql := IF(
  @raw_material_deleted_index_exists = 0,
  'ALTER TABLE raw_materials ADD KEY idx_raw_materials_deleted_at (deleted_at)',
  'SELECT 1'
);
PREPARE raw_material_deleted_index_stmt FROM @raw_material_deleted_index_sql;
EXECUTE raw_material_deleted_index_stmt;
DEALLOCATE PREPARE raw_material_deleted_index_stmt;
