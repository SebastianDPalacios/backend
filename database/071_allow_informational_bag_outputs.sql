USE panaderia_db;

ALTER TABLE production_plan_outputs
  DROP CHECK chk_production_plan_outputs_qty;

ALTER TABLE production_plan_outputs
  ADD CONSTRAINT chk_production_plan_outputs_qty
  CHECK (expected_quantity >= 0);
