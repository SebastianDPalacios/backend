const normalizeText = (value, maxLength = 160) => String(value || "").trim().slice(0, maxLength);

const normalizeOrderHistoryPagination = ({ page, pageSize, total = 0 } = {}) => {
  const normalizedPage = Math.max(Number(page || 1), 1);
  const requestedPageSize = Number(pageSize || 25);
  const normalizedPageSize = [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 25;
  const normalizedTotal = Math.max(Number(total || 0), 0);

  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total: normalizedTotal,
    totalPages: Math.ceil(normalizedTotal / normalizedPageSize),
    offset: (normalizedPage - 1) * normalizedPageSize,
  };
};

const buildOrderHistoryFilters = ({
  status,
  search,
  dateFrom,
  dateTo,
  salesAgentUserId,
  customerId,
  productId,
  includeCancelled = true,
  actorUserId,
  canViewAll = false,
} = {}) => {
  const filters = [];
  const values = [];

  if (!canViewAll) {
    filters.push("o.sales_agent_user_id = ?");
    values.push(Number(actorUserId || 0));
  } else if (Number(salesAgentUserId || 0) > 0) {
    filters.push("o.sales_agent_user_id = ?");
    values.push(Number(salesAgentUserId));
  }

  const normalizedStatus = normalizeText(status, 30);
  if (normalizedStatus) {
    filters.push("o.status = ?");
    values.push(normalizedStatus);
  }

  if (!includeCancelled) {
    filters.push("o.status <> 'cancelled'");
  }

  if (Number(customerId || 0) > 0) {
    filters.push("o.customer_id = ?");
    values.push(Number(customerId));
  }

  if (Number(productId || 0) > 0) {
    filters.push(`EXISTS (
      SELECT 1
      FROM order_items filtered_item
      WHERE filtered_item.order_id = o.id
        AND filtered_item.product_id = ?
    )`);
    values.push(Number(productId));
  }

  const normalizedSearch = normalizeText(search);
  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    filters.push(`(
      CAST(o.id AS CHAR) LIKE ?
      OR c.name LIKE ?
      OR c.tax_id LIKE ?
      OR c.phone LIKE ?
      OR c.address LIKE ?
      OR c.neighborhood LIKE ?
      OR seller.full_name LIKE ?
      OR seller.username LIKE ?
      OR o.status LIKE ?
      OR CASE o.status
           WHEN 'draft' THEN 'borrador'
           WHEN 'confirmed' THEN 'confirmado'
           WHEN 'in_production' THEN 'produccion'
           WHEN 'planned' THEN 'planificada'
           WHEN 'completed' THEN 'completada'
           WHEN 'ready' THEN 'listo'
           WHEN 'dispatched' THEN 'despachado'
           WHEN 'delivered' THEN 'entregado'
           WHEN 'cancelled' THEN 'cancelado'
           ELSE o.status
         END LIKE ?
      OR DATE_FORMAT(o.order_date, '%Y-%m-%d') LIKE ?
      OR DATE_FORMAT(o.order_date, '%d/%m/%Y') LIKE ?
      OR DATE_FORMAT(o.delivery_date, '%Y-%m-%d') LIKE ?
      OR DATE_FORMAT(o.delivery_date, '%d/%m/%Y') LIKE ?
      OR EXISTS (
        SELECT 1
        FROM order_items search_item
        INNER JOIN products search_product ON search_product.id = search_item.product_id
        WHERE search_item.order_id = o.id
          AND (search_product.name LIKE ? OR search_product.sku LIKE ?)
      )
    )`);
    values.push(...Array(16).fill(like));
  }

  const normalizedDateFrom = normalizeText(dateFrom, 10);
  if (normalizedDateFrom) {
    filters.push("o.order_date >= ?");
    values.push(normalizedDateFrom);
  }

  const normalizedDateTo = normalizeText(dateTo, 10);
  if (normalizedDateTo) {
    filters.push("o.order_date <= ?");
    values.push(normalizedDateTo);
  }

  return {
    whereClause: filters.length ? `WHERE ${filters.join(" AND ")}` : "",
    values,
  };
};

module.exports = { buildOrderHistoryFilters, normalizeOrderHistoryPagination };
