const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildOrderHistoryFilters,
  normalizeOrderHistoryPagination,
} = require("../domain/order-history-search");

test("limita al vendedor normal aunque intente filtrar otro vendedor", () => {
  const result = buildOrderHistoryFilters({ actorUserId: 17, salesAgentUserId: 99, canViewAll: false });
  assert.match(result.whereClause, /o\.sales_agent_user_id = \?/);
  assert.deepEqual(result.values, [17]);
});

test("permite al administrador filtrar un vendedor por id", () => {
  const result = buildOrderHistoryFilters({ salesAgentUserId: 23, canViewAll: true });
  assert.deepEqual(result.values, [23]);
});

test("construye búsqueda parametrizada para todos los campos solicitados", () => {
  const result = buildOrderHistoryFilters({ search: "Triana", canViewAll: true });
  assert.match(result.whereClause, /c\.tax_id LIKE \?/);
  assert.match(result.whereClause, /c\.phone LIKE \?/);
  assert.match(result.whereClause, /seller\.full_name LIKE \?/);
  assert.match(result.whereClause, /search_product\.sku LIKE \?/);
  assert.match(result.whereClause, /DATE_FORMAT\(o\.delivery_date/);
  assert.equal(result.values.length, 16);
  assert.ok(result.values.every((value) => value === "%Triana%"));
  assert.equal(result.whereClause.includes("Triana"), false);
});

test("combina estado y rango de fechas como parámetros independientes", () => {
  const result = buildOrderHistoryFilters({
    status: "delivered",
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
    canViewAll: true,
  });
  assert.deepEqual(result.values, ["delivered", "2026-09-01", "2026-09-30"]);
});

test("normaliza páginas y permite únicamente 25, 50 o 100 registros", () => {
  assert.deepEqual(normalizeOrderHistoryPagination({ page: 3, pageSize: 50, total: 126 }), {
    page: 3,
    pageSize: 50,
    total: 126,
    totalPages: 3,
    offset: 100,
  });
  assert.equal(normalizeOrderHistoryPagination({ pageSize: 500 }).pageSize, 25);
});

test("aplica cliente, producto y exclusión de cancelados mediante parámetros", () => {
  const result = buildOrderHistoryFilters({
    customerId: 41,
    productId: 72,
    includeCancelled: false,
    canViewAll: true,
  });
  assert.match(result.whereClause, /o\.status <> 'cancelled'/);
  assert.match(result.whereClause, /o\.customer_id = \?/);
  assert.match(result.whereClause, /filtered_item\.product_id = \?/);
  assert.deepEqual(result.values, [41, 72]);
});
