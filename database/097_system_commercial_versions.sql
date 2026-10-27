CREATE TABLE IF NOT EXISTS system_commercial_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version VARCHAR(30) NOT NULL,
  title VARCHAR(120) NOT NULL,
  release_notes TEXT NULL,
  released_at DATETIME NOT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_system_commercial_versions_version (version),
  KEY idx_system_commercial_versions_current (is_current, released_at),
  CONSTRAINT fk_system_commercial_versions_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

INSERT INTO system_commercial_versions (
  version,
  title,
  release_notes,
  released_at,
  is_current,
  created_by
)
SELECT
  '1.0.0',
  'Versión inicial',
  'Primera versión comercial registrada del sistema.',
  CURRENT_TIMESTAMP,
  1,
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM system_commercial_versions
);
