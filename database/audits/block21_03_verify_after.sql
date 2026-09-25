SELECT reconciliation.id, commercial.name AS variante_comercial,
       physical.name AS producto_fisico, branch.name AS sucursal,
       reconciliation.commercial_stock_before,
       reconciliation.physical_stock_before,
       reconciliation.confirmed_physical_stock,
       reconciliation.inventory_delta,
       reconciliation.created_at, actor.full_name AS aprobado_por
  FROM physical_product_reconciliations reconciliation
  INNER JOIN products commercial ON commercial.id = reconciliation.commercial_product_id
  INNER JOIN products physical ON physical.id = reconciliation.physical_product_id
  INNER JOIN branches branch ON branch.id = reconciliation.branch_id
  INNER JOIN users actor ON actor.id = reconciliation.approved_by
 ORDER BY reconciliation.id DESC;
