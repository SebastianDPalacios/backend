CREATE TABLE IF NOT EXISTS raw_material_stock_entry_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  raw_material_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  inventory_movement_id BIGINT UNSIGNED NOT NULL,
  source_type ENUM('manual_entry','purchase_order') NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  original_quantity DECIMAL(14,3) NOT NULL,
  normalized_quantity DECIMAL(14,3) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_raw_material_entry_audit_movement (inventory_movement_id),
  KEY idx_raw_material_entry_audit_material (raw_material_id, created_at),
  KEY idx_raw_material_entry_audit_branch (branch_id, created_at),
  CONSTRAINT fk_raw_material_entry_audit_material FOREIGN KEY (raw_material_id) REFERENCES raw_materials (id),
  CONSTRAINT fk_raw_material_entry_audit_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_raw_material_entry_audit_movement FOREIGN KEY (inventory_movement_id) REFERENCES inventory_movements (id),
  CONSTRAINT fk_raw_material_entry_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id),
  CONSTRAINT chk_raw_material_entry_audit_quantities CHECK (original_quantity > 0 AND normalized_quantity > 0)
) ENGINE=InnoDB;

-- Esta migracion no actualiza movimientos historicos. La auditoria se crea
-- unicamente para nuevas compras y nuevas entradas manuales de materia prima.
