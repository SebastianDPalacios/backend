-- Auditable corrections for product-based production plans.
-- Run after 062_product_based_production_plans.sql.

USE panaderia_db;

CREATE TABLE IF NOT EXISTS production_plan_product_corrections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  production_plan_product_detail_id BIGINT UNSIGNED NOT NULL,
  production_batch_id BIGINT UNSIGNED NOT NULL,
  correction_scope ENUM('pre_packaging', 'post_packaging') NOT NULL,
  previous_actual_arrobas DECIMAL(14,3) NOT NULL,
  corrected_actual_arrobas DECIMAL(14,3) NOT NULL,
  previous_produced_quantity DECIMAL(14,3) NOT NULL,
  corrected_produced_quantity DECIMAL(14,3) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  corrected_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_product_corrections_detail (production_plan_product_detail_id, created_at),
  KEY idx_product_corrections_batch (production_batch_id),
  KEY idx_product_corrections_actor (corrected_by, created_at),
  CONSTRAINT fk_product_corrections_detail
    FOREIGN KEY (production_plan_product_detail_id) REFERENCES production_plan_product_details (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_product_corrections_batch
    FOREIGN KEY (production_batch_id) REFERENCES production_batches (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_product_corrections_actor
    FOREIGN KEY (corrected_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_product_corrections_arrobas
    CHECK (previous_actual_arrobas > 0 AND corrected_actual_arrobas > 0),
  CONSTRAINT chk_product_corrections_quantity
    CHECK (previous_produced_quantity > 0 AND corrected_produced_quantity > 0),
  CONSTRAINT chk_product_corrections_reason
    CHECK (CHAR_LENGTH(TRIM(reason)) > 0)
) ENGINE=InnoDB;
