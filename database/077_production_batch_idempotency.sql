SET @has_client_request_key := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'production_batches'
    AND COLUMN_NAME = 'client_request_key'
);
SET @add_client_request_key_sql := IF(
  @has_client_request_key = 0,
  'ALTER TABLE production_batches ADD COLUMN client_request_key VARCHAR(100) NULL AFTER created_by',
  'SELECT 1'
);
PREPARE add_client_request_key_stmt FROM @add_client_request_key_sql;
EXECUTE add_client_request_key_stmt;
DEALLOCATE PREPARE add_client_request_key_stmt;

SET @has_client_request_key_index := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'production_batches'
    AND INDEX_NAME = 'uq_production_batches_client_request_key'
);
SET @add_client_request_key_index_sql := IF(
  @has_client_request_key_index = 0,
  'CREATE UNIQUE INDEX uq_production_batches_client_request_key ON production_batches (client_request_key)',
  'SELECT 1'
);
PREPARE add_client_request_key_index_stmt FROM @add_client_request_key_index_sql;
EXECUTE add_client_request_key_index_stmt;
DEALLOCATE PREPARE add_client_request_key_index_stmt;

