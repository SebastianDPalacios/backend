USE panaderia_db;

ALTER TABLE production_plan_product_details
  DROP CHECK chk_plan_product_details_planned_arrobas,
  DROP CHECK chk_plan_product_details_estimated_units;

ALTER TABLE production_plan_product_details
  ADD CONSTRAINT chk_plan_product_details_planned_arrobas
    CHECK (
      (request_mode = 'bags' AND planned_arrobas = 0)
      OR (request_mode <> 'bags' AND planned_arrobas > 0)
    ),
  ADD CONSTRAINT chk_plan_product_details_estimated_units
    CHECK (
      (request_mode = 'bags' AND estimated_units = 0)
      OR (request_mode <> 'bags' AND estimated_units > 0)
    );
