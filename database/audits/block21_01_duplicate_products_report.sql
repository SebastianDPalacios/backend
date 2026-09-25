-- Solo lectura. No une productos ni modifica inventario.
SELECT p.id, p.name, p.sku, category.name AS category, p.base_price,
       p.physical_product_id,
       COALESCE((SELECT SUM(stock.quantity_on_hand) FROM stock_products stock WHERE stock.product_id = p.id), 0) AS stock_actual,
       (SELECT COUNT(*) FROM inventory_movements movement WHERE movement.product_id = p.id) AS movimientos,
       (SELECT COUNT(*) FROM order_items item WHERE item.product_id = p.id) AS ventas_relacionadas,
       (SELECT COUNT(*) FROM sales_return_items return_item
         WHERE return_item.returned_product_id = p.id OR return_item.replacement_product_id = p.id) AS cambios_devoluciones,
       (SELECT COUNT(*) FROM production_batch_outputs output WHERE output.product_id = p.id) AS producciones,
       (SELECT COUNT(*) FROM packing_report_items packing WHERE packing.product_id = p.id) AS conteos
  FROM products p
  INNER JOIN product_categories category ON category.id = p.category_id
 WHERE p.deleted_at IS NULL
   AND (LOWER(p.name) LIKE '%mayor%' OR LOWER(p.sku) LIKE '%mayor%' OR LOWER(category.name) LIKE '%mayor%')
 ORDER BY category.name, p.name;
