USE panaderia_db;

ALTER TABLE production_plan_items
  DROP CHECK chk_production_plan_items_arrobas;

ALTER TABLE production_plan_items
  ADD CONSTRAINT chk_production_plan_items_arrobas
  CHECK (arrobas >= 0);
