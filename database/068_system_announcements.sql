CREATE TABLE IF NOT EXISTS system_announcements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message VARCHAR(500) NOT NULL,
  display_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  force_logout_at DATETIME NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  enforced_at DATETIME NULL,
  ended_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  ended_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_system_announcements_active (is_active, display_from, force_logout_at),
  CONSTRAINT fk_system_announcements_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_system_announcements_ended_by FOREIGN KEY (ended_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;
