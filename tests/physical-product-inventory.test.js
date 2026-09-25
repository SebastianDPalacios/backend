const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { resolvePhysicalProduct } = require("../domain/physical-product");

const migration = fs.readFileSync(path.join(__dirname, "../database/092_physical_product_inventory.sql"), "utf8");
const ordersService = fs.readFileSync(path.join(__dirname, "../services/orders.service.js"), "utf8");
const productionService = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");

const fakeConnection = (row) => ({
  queries: [],
  async query(sql, values) {
    this.queries.push({ sql, values });
    return [[row]];
  },
});

test("dos variantes comerciales resuelven el mismo producto físico bajo bloqueo", async () => {
  const connectionA = fakeConnection({
    commercial_product_id: 20, physical_product_id: 10, physical_product_name: "Pan físico",
    physical_product_unit: "unit", physical_product_active: 1, physical_product_deleted_at: null,
  });
  const connectionB = fakeConnection({
    commercial_product_id: 21, physical_product_id: 10, physical_product_name: "Pan físico",
    physical_product_unit: "unit", physical_product_active: 1, physical_product_deleted_at: null,
  });

  const [first, second] = await Promise.all([
    resolvePhysicalProduct(connectionA, 20, { lock: true }),
    resolvePhysicalProduct(connectionB, 21, { lock: true }),
  ]);
  assert.equal(first.physicalProductId, 10);
  assert.equal(second.physicalProductId, 10);
  assert.match(connectionA.queries[0].sql, /FOR UPDATE/);
  assert.match(connectionB.queries[0].sql, /FOR UPDATE/);
});

test("la migración crea la relación sin sumar inventarios antiguos", () => {
  assert.match(migration, /physical_product_id/);
  assert.match(migration, /inventory_product_id/);
  assert.doesNotMatch(migration, /chk_products_not_own_variant/);
  assert.doesNotMatch(migration, /UPDATE\s+stock_products|INSERT\s+INTO\s+stock_products\s*\([^)]*\)\s*SELECT/i);
});

test("ventas, vendajes, cambios y anulaciones usan el inventario físico", () => {
  assert.match(migration, /COALESCE\(inventory_product_id, product_id\)/);
  assert.match(ordersService, /inventoryProductId/);
  assert.match(ordersService, /resolvePhysicalProduct\(connection, replacementProductId/);
  assert.match(ordersService, /resolvePhysicalProduct\(connection, productId/);
  assert.match(ordersService, /inventory_product_id = VALUES\(inventory_product_id\)/);
});

test("producción registra y reporta por producto físico", () => {
  assert.match(productionService, /COALESCE\(p\.physical_product_id, p\.id\) AS physical_product_id/);
  assert.match(productionService, /Number\(output\.physical_product_id\)/);
  assert.match(productionService, /GROUP BY physical\.id/);
  assert.match(productionService, /GROUP BY daily_batch\.produced_date, daily_physical\.id/);
});

test("la identidad y el precio comercial permanecen en la venta", () => {
  assert.match(ordersService, /order_id, product_id, inventory_product_id/);
  assert.match(ordersService, /regular_price_reference/);
  assert.match(ordersService, /applied_price/);
  assert.match(ordersService, /price_origin/);
});
