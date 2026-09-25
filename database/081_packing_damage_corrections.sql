ALTER TABLE production_damages
  ADD COLUMN packing_report_item_id BIGINT UNSIGNED NULL AFTER production_batch_output_id,
  ADD KEY idx_production_damages_packing_item (packing_report_item_id),
  ADD CONSTRAINT fk_production_damages_packing_item
    FOREIGN KEY (packing_report_item_id) REFERENCES packing_report_items (id);

UPDATE production_damages damage
INNER JOIN packing_report_items item
  ON item.production_batch_output_id = damage.production_batch_output_id
INNER JOIN packing_reports report
  ON report.id = item.packing_report_id
 AND report.packed_date = damage.damaged_date
SET damage.packing_report_item_id = item.id
WHERE damage.id > 0
  AND damage.packing_report_item_id IS NULL;

ALTER TABLE production_record_corrections
  ADD COLUMN original_damages_json JSON NULL AFTER corrected_batch_quantity,
  ADD COLUMN corrected_damages_json JSON NULL AFTER original_damages_json;
