const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeSqlDateValue } = require("../services/orders.service");

const historySource = fs.readFileSync(
  path.join(__dirname, "../../frontend/src/pages/orders/history.js"),
  "utf8"
);
const ordersServiceSource = fs.readFileSync(
  path.join(__dirname, "../services/orders.service.js"),
  "utf8"
);

test("editar un pedido normaliza fechas DATE devueltas como objetos de JavaScript", () => {
  const databaseDate = new Date("2026-09-25T05:00:00.000Z");
  assert.equal(normalizeSqlDateValue(databaseDate, "fecha del pedido"), "2026-09-25");
  assert.equal(normalizeSqlDateValue("2026-09-25", "fecha del pedido"), "2026-09-25");
  assert.equal(normalizeSqlDateValue("2026-09-25T00:00:00.000Z", "fecha del pedido"), "2026-09-25");
  assert.throws(() => normalizeSqlDateValue("fecha incorrecta", "fecha del pedido"), /fecha del pedido invalida/);
  assert.match(ordersServiceSource, /effectiveDate: normalizeSqlDateValue\(orders\[0\]\.order_date/);
  assert.doesNotMatch(ordersServiceSource, /effectiveDate: String\(orders\[0\]\.order_date\)\.slice/);
});

test("el motivo para eliminar un pedido es opcional", () => {
  assert.match(historySource, /Motivo de eliminaci.n \(opcional\)/);
  assert.match(historySource, /onConfirm\(normalizedReason \|\| null\)/);
  assert.match(historySource, /Puedes dejar este campo vac.o/);
  assert.doesNotMatch(historySource, /Para cancelar indica un motivo/);
  assert.doesNotMatch(historySource, /Minimo 5 caracteres/);
});

test("la conciliacion operativa conserva el producto fisico fuera del bloque de alta", () => {
  assert.match(
    ordersServiceSource,
    /let inventoryProductId = Number\(previousItem\?\.inventory_product_id \|\| productId\)/
  );
  assert.match(
    ordersServiceSource,
    /inventoryProductId = Number\(products\[0\]\.inventory_product_id\)/
  );
  assert.doesNotMatch(
    ordersServiceSource,
    /const inventoryProductId = Number\(products\[0\]\.inventory_product_id\)/
  );
});
