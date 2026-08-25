-- Auditoría inmutable y optimizada para filtros históricos.
-- Los registros se conservan indefinidamente y no pueden editarse ni eliminarse.

DROP TRIGGER IF EXISTS trg_audit_logs_prevent_update;
DROP TRIGGER IF EXISTS trg_audit_logs_prevent_delete;

DELIMITER $$
CREATE TRIGGER trg_audit_logs_prevent_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los registros de auditoría son inmutables';
END$$

CREATE TRIGGER trg_audit_logs_prevent_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los registros de auditoría no pueden eliminarse';
END$$
DELIMITER ;

SET @audit_date_index = (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_logs_created_at'
);
PREPARE audit_stmt FROM @audit_date_index;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

SET @audit_entity_index = (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX idx_audit_logs_entity_date ON audit_logs (entity_name, created_at)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_logs_entity_date'
);
PREPARE audit_stmt FROM @audit_entity_index;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;
