-- Product-based planning metadata and baker execution report.
-- Additive migration: legacy plans remain valid without a detail row.
-- Run after 061_bonus_rounding_margin.sql.

USE panaderia_db;

CREATE TABLE IF NOT EXISTS production_plan_product_details (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  production_plan_output_id BIGINT UNSIGNED NOT NULL,
  request_mode ENUM('units', 'arrobas') NOT NULL,
  requested_quantity DECIMAL(14,3) NOT NULL,
  planned_arrobas DECIMAL(14,3) NOT NULL,
  estimated_units DECIMAL(14,3) NOT NULL,
  units_per_tray DECIMAL(14,3) NULL,
  tray_count DECIMAL(14,3) NULL,
  loose_units DECIMAL(14,3) NULL,
  product_status ENUM('pending', 'in_progress', 'completed', 'skipped', 'cancelled')
    NOT NULL DEFAULT 'pending',
  actual_arrobas DECIMAL(14,3) NULL,
  produced_quantity DECIMAL(14,3) NULL,
  actual_units_per_tray DECIMAL(14,3) NULL,
  actual_tray_count DECIMAL(14,3) NULL,
  actual_loose_units DECIMAL(14,3) NULL,
  baker_notes VARCHAR(500) NULL,
  reported_by BIGINT UNSIGNED NULL,
  reported_at TIMESTAMP NULL,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_product_details_output (production_plan_output_id),
  KEY idx_plan_product_details_status (product_status),
  KEY idx_plan_product_details_reported_by (reported_by, reported_at),
  CONSTRAINT fk_plan_product_details_output
    FOREIGN KEY (production_plan_output_id) REFERENCES production_plan_outputs (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_plan_product_details_reported_by
    FOREIGN KEY (reported_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_plan_product_details_requested
    CHECK (requested_quantity > 0),
  CONSTRAINT chk_plan_product_details_planned_arrobas
    CHECK (planned_arrobas > 0),
  CONSTRAINT chk_plan_product_details_estimated_units
    CHECK (estimated_units > 0),
  CONSTRAINT chk_plan_product_details_optional_trays
    CHECK (
      (units_per_tray IS NULL OR units_per_tray > 0)
      AND (tray_count IS NULL OR tray_count >= 0)
      AND (loose_units IS NULL OR loose_units >= 0)
    ),
  CONSTRAINT chk_plan_product_details_actual_values
    CHECK (
      (actual_arrobas IS NULL OR actual_arrobas > 0)
      AND (produced_quantity IS NULL OR produced_quantity >= 0)
      AND (actual_units_per_tray IS NULL OR actual_units_per_tray > 0)
      AND (actual_tray_count IS NULL OR actual_tray_count >= 0)
      AND (actual_loose_units IS NULL OR actual_loose_units >= 0)
    ),
  CONSTRAINT chk_plan_product_details_completion
    CHECK (
      product_status NOT IN ('completed', 'skipped')
      OR (reported_at IS NOT NULL AND completed_at IS NOT NULL)
    ),
  CONSTRAINT chk_plan_product_details_completed_quantity
    CHECK (
      product_status <> 'completed'
      OR (actual_arrobas IS NOT NULL AND produced_quantity IS NOT NULL)
    ),
  CONSTRAINT chk_plan_product_details_skipped_notes
    CHECK (
      product_status <> 'skipped'
      OR (baker_notes IS NOT NULL AND CHAR_LENGTH(TRIM(baker_notes)) > 0)
    )
) ENGINE=InnoDB;
