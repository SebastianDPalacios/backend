-- Auditoría de cobertura para la reconstrucción histórica de inventario.
-- Este archivo es exclusivamente de lectura y no modifica información.

SELECT
  COUNT(*) AS movimientos,
  MIN(moved_at) AS primer_movimiento,
  MAX(moved_at) AS ultimo_movimiento,
  SUM(quantity <= 0) AS cantidades_no_positivas,
  SUM(
    CASE
      WHEN item_type = 'raw_material' AND (raw_material_id IS NULL OR product_id IS NOT NULL) THEN 1
      WHEN item_type = 'product' AND (product_id IS NULL OR raw_material_id IS NOT NULL) THEN 1
      ELSE 0
    END
  ) AS referencias_invalidas,
  SUM(DATE(CONVERT_TZ(moved_at, '+00:00', '-05:00')) > CURRENT_DATE) AS movimientos_futuros
FROM inventory_movements;

SELECT
  item_type,
  movement_type,
  COUNT(*) AS movimientos,
  SUM(quantity) AS cantidad
FROM inventory_movements
GROUP BY item_type, movement_type
ORDER BY item_type, movement_type;

SELECT
  'materia_prima' AS tipo,
  COUNT(*) AS filas_stock,
  SUM(ABS(stock_actual - delta_movimientos) > 0.0005) AS filas_con_saldo_inicial_inferido,
  SUM(stock_actual) AS stock_actual,
  SUM(delta_movimientos) AS delta_movimientos,
  SUM(stock_actual - delta_movimientos) AS saldo_inicial_inferido
FROM (
  SELECT
    stock.branch_id,
    stock.raw_material_id AS item_id,
    stock.quantity_on_hand AS stock_actual,
    COALESCE(SUM(
      CASE
        WHEN movement.movement_type IN ('purchase_in', 'production_in', 'adjustment_in', 'return_in') THEN movement.quantity
        WHEN movement.movement_type IN ('production_out', 'sale_out', 'adjustment_out', 'waste_out') THEN -movement.quantity
        ELSE 0
      END
    ), 0) AS delta_movimientos
  FROM stock_raw_materials stock
  LEFT JOIN inventory_movements movement
    ON movement.branch_id = stock.branch_id
   AND movement.item_type = 'raw_material'
   AND movement.raw_material_id = stock.raw_material_id
  GROUP BY stock.branch_id, stock.raw_material_id, stock.quantity_on_hand
) auditoria
UNION ALL
SELECT
  'producto' AS tipo,
  COUNT(*) AS filas_stock,
  SUM(ABS(stock_actual - delta_movimientos) > 0.0005) AS filas_con_saldo_inicial_inferido,
  SUM(stock_actual) AS stock_actual,
  SUM(delta_movimientos) AS delta_movimientos,
  SUM(stock_actual - delta_movimientos) AS saldo_inicial_inferido
FROM (
  SELECT
    stock.branch_id,
    stock.product_id AS item_id,
    stock.quantity_on_hand AS stock_actual,
    COALESCE(SUM(
      CASE
        WHEN movement.movement_type IN ('purchase_in', 'production_in', 'adjustment_in', 'return_in') THEN movement.quantity
        WHEN movement.movement_type IN ('production_out', 'sale_out', 'adjustment_out', 'waste_out') THEN -movement.quantity
        ELSE 0
      END
    ), 0) AS delta_movimientos
  FROM stock_products stock
  LEFT JOIN inventory_movements movement
    ON movement.branch_id = stock.branch_id
   AND movement.item_type = 'product'
   AND movement.product_id = stock.product_id
  GROUP BY stock.branch_id, stock.product_id, stock.quantity_on_hand
) auditoria;

SELECT COUNT(*) AS movimientos_sin_fila_stock
FROM inventory_movements movement
LEFT JOIN stock_raw_materials raw_stock
  ON movement.item_type = 'raw_material'
 AND raw_stock.branch_id = movement.branch_id
 AND raw_stock.raw_material_id = movement.raw_material_id
LEFT JOIN stock_products product_stock
  ON movement.item_type = 'product'
 AND product_stock.branch_id = movement.branch_id
 AND product_stock.product_id = movement.product_id
WHERE (movement.item_type = 'raw_material' AND raw_stock.raw_material_id IS NULL)
   OR (movement.item_type = 'product' AND product_stock.product_id IS NULL);
