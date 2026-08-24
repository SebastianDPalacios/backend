-- Compatible reporting layer for legacy recipe plans and product-based plans.
-- Run after 062_product_based_production_plans.sql.

USE panaderia_db;

CREATE OR REPLACE VIEW vw_production_plan_product_history AS
SELECT
  pp.id AS production_plan_id,
  pp.branch_id,
  pp.planned_date,
  pp.baker_employee_id,
  pp.status AS plan_status,
  ppi.id AS production_plan_item_id,
  ppi.recipe_id,
  ppi.production_batch_id,
  ppo.id AS production_plan_output_id,
  ppo.product_id,
  p.name AS product_name,
  p.sku AS product_sku,
  CASE WHEN ppd.id IS NULL THEN 'legacy' ELSE 'product' END AS planning_format,
  COALESCE(ppd.request_mode, 'arrobas') AS request_mode,
  COALESCE(ppd.requested_quantity, ppi.arrobas) AS requested_quantity,
  COALESCE(ppd.planned_arrobas, ppi.arrobas) AS planned_arrobas,
  COALESCE(ppd.estimated_units, ppo.expected_quantity) AS estimated_units,
  ppd.units_per_tray,
  ppd.tray_count,
  ppd.loose_units,
  COALESCE(ppd.product_status,
    CASE
      WHEN ppi.finished_at IS NOT NULL THEN 'completed'
      WHEN ppi.started_at IS NOT NULL THEN 'in_progress'
      ELSE 'pending'
    END
  ) AS product_status,
  ppd.actual_arrobas,
  ppd.produced_quantity,
  ppd.actual_units_per_tray,
  ppd.actual_tray_count,
  ppd.actual_loose_units,
  ppd.baker_notes,
  ppd.reported_by,
  ppd.reported_at,
  ppd.started_at,
  ppd.completed_at,
  pbo.id AS production_batch_output_id,
  COALESCE(pbo.produced_quantity, ppd.produced_quantity, 0) AS batch_produced_quantity,
  COALESCE(pbo.counted_quantity, 0) AS counted_quantity,
  COALESCE(pbo.packed_quantity, 0) AS packed_quantity,
  COALESCE(pbo.damaged_quantity, 0) AS damaged_quantity,
  COALESCE(pbo.missing_quantity, 0) AS missing_quantity,
  COALESCE(pbo.direct_delivered_quantity, 0) AS direct_delivered_quantity
FROM production_plans pp
INNER JOIN production_plan_items ppi ON ppi.production_plan_id = pp.id
INNER JOIN production_plan_outputs ppo ON ppo.production_plan_item_id = ppi.id
INNER JOIN products p ON p.id = ppo.product_id
LEFT JOIN production_plan_product_details ppd ON ppd.production_plan_output_id = ppo.id
LEFT JOIN production_batch_outputs pbo
  ON pbo.production_batch_id = ppi.production_batch_id
 AND pbo.product_id = ppo.product_id;
