const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/orders.service.js"), "utf8");
const routerSource = fs.readFileSync(path.join(__dirname, "../api/orders.router.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(__dirname, "../database/082_sales_return_operation_types.sql"), "utf8");
const createReturnSource = serviceSource.slice(
  serviceSource.indexOf("const createSalesReturn = async"),
  serviceSource.indexOf("const authorizeSalesReturn = async")
);
const authorizeReturnSource = serviceSource.slice(
  serviceSource.indexOf("const authorizeSalesReturn = async"),
  serviceSource.indexOf("const rejectSalesReturn = async")
);

test("cambio y devolucion tienen tipo propio y los historicos quedan como devolucion", () => {
  assert.match(migrationSource, /ENUM\('return','exchange'\).*DEFAULT 'return'/);
  assert.match(migrationSource, /customer_id/);
  assert.doesNotMatch(migrationSource, /gift/);
});

test("el registro exige cliente, pedido original y valida su asociacion", () => {
  assert.match(createReturnSource, /!customerId \|\| !orderId/);
  assert.match(createReturnSource, /Number\(orders\[0\]\.customer_id\) !== customerId/);
  assert.match(createReturnSource, /el pedido original no corresponde al cliente seleccionado/);
  assert.match(createReturnSource, /customers WHERE id = \? AND status = 'active' AND deleted_at IS NULL/);
});

test("un cambio guarda el producto de reemplazo separado del recibido", () => {
  assert.match(createReturnSource, /replacement_product_id/);
  assert.match(createReturnSource, /replacement_quantity/);
  assert.match(createReturnSource, /el producto de reemplazo no existe/);
  assert.match(createReturnSource, /INSERT INTO sales_return_items/);
});

test("el producto recibido es informativo y no vuelve al inventario", () => {
  assert.doesNotMatch(authorizeReturnSource, /return_in/);
  assert.match(authorizeReturnSource, /replacement_product_id/);
});

test("vendedores y administradores pueden registrar sin confundir obsequios", () => {
  assert.match(routerSource, /router\.post\("\/returns", verifyToken, canManageOrders/);
  assert.doesNotMatch(routerSource, /router\.post\("\/returns", verifyToken, canManageOrders, requireBodyOrderAccess/);
  assert.match(routerSource, /router\.post\("\/gifts", verifyToken, canManageOrders/);
});
