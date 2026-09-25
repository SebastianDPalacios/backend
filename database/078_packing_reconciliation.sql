-- Conciliacion posterior e independiente entre produccion y conteo.
ALTER TABLE packing_report_items
  ADD COLUMN produced_quantity DECIMAL(14,3) NOT NULL DEFAULT 0 AFTER notes,
  ADD COLUMN found_quantity DECIMAL(14,3) NOT NULL DEFAULT 0 AFTER produced_quantity,
  ADD COLUMN shortage_quantity DECIMAL(14,3) NOT NULL DEFAULT 0 AFTER found_quantity,
  ADD COLUMN surplus_quantity DECIMAL(14,3) NOT NULL DEFAULT 0 AFTER shortage_quantity,
  ADD COLUMN reconciliation_status ENUM('matched','shortage','surplus') NULL AFTER surplus_quantity;

CREATE INDEX idx_packing_report_items_reconciliation
  ON packing_report_items (reconciliation_status);
