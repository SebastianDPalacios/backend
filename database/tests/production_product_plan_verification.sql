-- Read-only acceptance checks for product-based production planning.
-- Requires migrations 062, 063 and 064. It does not create or modify data.

USE panaderia_db;

-- 1. Coverage by request mode and compatibility with legacy plans.
SELECT
  planning_format,
  request_mode,
  COUNT(*) AS products
FROM vw_production_plan_product_history
GROUP BY planning_format, request_mode
ORDER BY planning_format, request_mode;

-- 2. Two or more independently planned products sharing one recipe and plan.
SELECT production_plan_id, recipe_id, COUNT(DISTINCT product_id) AS products
FROM vw_production_plan_product_history
GROUP BY production_plan_id, recipe_id
HAVING COUNT(DISTINCT product_id) >= 2;

-- 3. A plan using only one output of a recipe that has several possible outputs.
SELECT history.production_plan_id, history.recipe_id, COUNT(DISTINCT history.product_id) AS planned_products,
       recipe_totals.available_products
FROM vw_production_plan_product_history history
INNER JOIN (
  SELECT recipe_id, COUNT(DISTINCT product_id) AS available_products
  FROM recipe_outputs
  GROUP BY recipe_id
) recipe_totals ON recipe_totals.recipe_id = history.recipe_id
GROUP BY history.production_plan_id, history.recipe_id, recipe_totals.available_products
HAVING COUNT(DISTINCT history.product_id) = 1 AND recipe_totals.available_products > 1;

-- 4. Optional tray detail: records with and without tray information.
SELECT
  CASE WHEN units_per_tray IS NULL AND tray_count IS NULL AND loose_units IS NULL
       THEN 'without_trays' ELSE 'with_trays' END AS tray_detail,
  COUNT(*) AS products
FROM vw_production_plan_product_history
WHERE planning_format = 'product'
GROUP BY tray_detail;

-- 5. Production below, equal to and above the estimate.
SELECT production_plan_id, product_name, estimated_units, batch_produced_quantity,
  CASE
    WHEN batch_produced_quantity < estimated_units THEN 'below'
    WHEN batch_produced_quantity > estimated_units THEN 'above'
    ELSE 'equal'
  END AS result
FROM vw_production_plan_product_history
WHERE product_status = 'completed';

-- 6. Products explicitly not elaborated.
SELECT production_plan_id, product_name, baker_notes, reported_at
FROM vw_production_plan_product_history
WHERE product_status = 'skipped';

-- 7. Raw-material output and compensating correction movements.
SELECT reference_type, movement_type, COUNT(*) AS movements, SUM(quantity) AS quantity
FROM inventory_movements
WHERE item_type = 'raw_material'
  AND reference_type IN ('production_batch', 'production_correction')
GROUP BY reference_type, movement_type;

-- 8. Finished-product inventory only enters through packing or direct delivery.
SELECT reference_type, movement_type, COUNT(*) AS movements, SUM(quantity) AS quantity
FROM inventory_movements
WHERE item_type = 'product'
  AND movement_type = 'production_in'
GROUP BY reference_type, movement_type;

-- 9. No output has more than one product detail or more than one linked batch output.
SELECT production_plan_output_id, COUNT(*) AS duplicates
FROM production_plan_product_details
GROUP BY production_plan_output_id
HAVING COUNT(*) > 1;

SELECT production_batch_id, product_id, COUNT(*) AS duplicates
FROM production_batch_outputs
GROUP BY production_batch_id, product_id
HAVING COUNT(*) > 1;

-- 10. Completed product records retain batch, reporting and audit traceability.
SELECT history.production_plan_output_id, history.product_name,
       history.production_batch_id, history.reported_by, history.reported_at,
       COUNT(audit.id) AS finish_audits
FROM vw_production_plan_product_history history
LEFT JOIN audit_logs audit
  ON audit.entity_name = 'production_plan_outputs'
 AND audit.entity_id = CAST(history.production_plan_output_id AS CHAR)
 AND audit.action = 'production_plan.product.finish'
WHERE history.product_status = 'completed'
GROUP BY history.production_plan_output_id, history.product_name,
         history.production_batch_id, history.reported_by, history.reported_at;
