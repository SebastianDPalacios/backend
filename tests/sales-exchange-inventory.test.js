const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/orders.service.js"), "utf8");
const routerSource = fs.readFileSync(path.join(__dirname, "../api/orders.router.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(__dirname, "../database/083_sales_exchange_inventory.sql"), "utf8");
const createSource = serviceSource.slice(serviceSource.indexOf("const createSalesReturn = async"), serviceSource.indexOf("const authorizeSalesReturn = async"));
const authorizeSource = serviceSource.slice(serviceSource.indexOf("const authorizeSalesReturn = async"), serviceSource.indexOf("const annulSalesExchange = async"));
const annulSource = serviceSource.slice(serviceSource.indexOf("const annulSalesExchange = async"), serviceSource.indexOf("const rejectSalesReturn = async"));

test("congela el precio actual del producto entregado", () => {
  assert.match(createSource, /p\.base_price/);
  assert.match(createSource, /replacementUnitPrice/);
  assert.match(createSource, /replacement_unit_price/);
  assert.match(createSource, /replacementCommercialValue/);
  assert.match(migrationSource, /replacement_unit_price DECIMAL\(14,2\)/);
});

test("descuenta únicamente el reemplazo y crea el movimiento en la transacción", () => {
  assert.match(authorizeSource, /operation_type === "exchange"/);
  assert.match(authorizeSource, /quantity_on_hand = quantity_on_hand - \?/);
  assert.match(authorizeSource, /replacement_product_id/);
  assert.match(authorizeSource, /'sale_out'/);
  assert.match(authorizeSource, /INSERT INTO inventory_movements/);
  assert.doesNotMatch(authorizeSource, /returned_product_id[\s\S]*quantity_on_hand = quantity_on_hand \+/);
});

test("la solicitud y la autorización son idempotentes", () => {
  assert.match(migrationSource, /UNIQUE KEY uq_sales_returns_request_key/);
  assert.match(createSource, /request_key = \?/);
  assert.match(createSource, /ER_DUP_ENTRY/);
  assert.match(authorizeSource, /FOR UPDATE/);
  assert.match(authorizeSource, /status === "completed"/);
  assert.match(authorizeSource, /idempotent: true/);
});

test("la anulación administrativa compensa inventario una sola vez", () => {
  assert.match(routerSource, /returns\/:id\/annul.*requireAdministrativeRole/);
  assert.match(annulSource, /status === "annulled"/);
  assert.match(annulSource, /'adjustment_in'/);
  assert.match(annulSource, /quantity_on_hand = quantity_on_hand \+ VALUES\(quantity_on_hand\)/);
  assert.match(annulSource, /annulment_reason/);
});

test("no toca la fórmula de venta más vendaje", () => {
  assert.doesNotMatch(createSource, /calculateSaleBonusAllocation/);
  assert.doesNotMatch(authorizeSource, /calculateSaleBonusAllocation/);
  assert.doesNotMatch(annulSource, /calculateSaleBonusAllocation/);
});
