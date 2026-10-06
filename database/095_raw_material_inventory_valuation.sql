ALTER TABLE raw_materials
  ADD COLUMN is_inventory_valued TINYINT(1) NOT NULL DEFAULT 1
  AFTER inventory_usage_type;

