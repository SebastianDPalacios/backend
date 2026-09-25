const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { resolveOrderProductPrice } = require("../services/orders.service");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/orders.service.js"), "utf8");
const routerSource = fs.readFileSync(path.join(__dirname, "../api/orders.router.js"), "utf8");
const migrationSource = fs.readFileSync(
  path.join(__dirname, "../database/090_order_item_wholesale_price_snapshot.sql"),
  "utf8"
);
const formSource = fs.readFileSync(
  path.join(__dirname, "../../frontend/src/components/organisms/orders/AtomicOrderForm.js"),
  "utf8"
);
const posSource = fs.readFileSync(
  path.join(__dirname, "../../frontend/src/components/organisms/orders/SellerPosOrderForm.js"),
  "utf8"
);

const connectionWith = ({ profile = null, prices = [] } = {}) => ({
  async query(sql) {
    if (sql.includes("FROM customer_wholesale_profiles")) return [profile ? [profile] : []];
    if (sql.includes("FROM wholesale_product_prices")) return [prices];
    throw new Error(`consulta inesperada: ${sql}`);
  },
});

test("resuelve especial, general y regular en la prioridad oficial", async () => {
  const profile = { id: 3, price_list_id: 7, price_list_name: "MAYORISTAS" };
  const special = { id: 21, price_list_id: 7, product_id: 4, customer_id: 9, wholesale_price: 900 };
  const general = { id: 20, price_list_id: 7, product_id: 4, customer_id: null, wholesale_price: 1000 };

  const specialResult = await resolveOrderProductPrice({
    connection: connectionWith({ profile, prices: [special, general] }),
    customerId: 9,
    productId: 4,
    effectiveDate: "2026-09-24",
    regularPrice: 1500,
  });
  assert.equal(specialResult.appliedPrice, 900);
  assert.equal(specialResult.priceOrigin, "customer_special");
  assert.equal(specialResult.priceConfigurationId, 21);
  assert.equal(specialResult.priceListName, "MAYORISTAS");

  const generalResult = await resolveOrderProductPrice({
    connection: connectionWith({ profile, prices: [general] }),
    customerId: 9,
    productId: 4,
    effectiveDate: "2026-09-24",
    regularPrice: 1500,
  });
  assert.equal(generalResult.appliedPrice, 1000);
  assert.equal(generalResult.priceOrigin, "wholesale_general");

  const regularResult = await resolveOrderProductPrice({
    connection: connectionWith(),
    customerId: 9,
    productId: 4,
    effectiveDate: "2026-09-24",
    regularPrice: 1500,
  });
  assert.equal(regularResult.appliedPrice, 1500);
  assert.equal(regularResult.priceOrigin, "regular");
  assert.equal(regularResult.priceConfigurationId, null);
});

test("el backend resuelve otra vez al guardar y congela el resultado", () => {
  const createSource = serviceSource.slice(
    serviceSource.indexOf("const createOrder"),
    serviceSource.indexOf("const retryOrderOperations")
  );
  assert.match(createSource, /resolveOrderProductPrice/);
  assert.match(createSource, /unitPrice: priceResolution\.appliedPrice/);
  assert.match(createSource, /regular_price_reference, wholesale_price_found/);
  assert.match(createSource, /price_origin, wholesale_price_configuration_id, wholesale_price_list_id/);
  assert.match(createSource, /client_request_key/);
  assert.doesNotMatch(createSource, /item\.(unit_price|applied_price|price_origin)/);
});

test("el snapshot conserva todos los datos y no crea efectos de inventario", () => {
  assert.match(migrationSource, /regular_price_reference/);
  assert.match(migrationSource, /wholesale_price_found/);
  assert.match(migrationSource, /applied_price/);
  assert.match(migrationSource, /price_origin/);
  assert.match(migrationSource, /wholesale_price_configuration_id/);
  assert.match(migrationSource, /wholesale_price_list_id/);
  assert.match(migrationSource, /wholesale_price_list_name/);
  assert.doesNotMatch(migrationSource, /inventory|stock/i);
});

test("la vista previa respeta acceso y la venta muestra solo el precio final", () => {
  assert.match(routerSource, /router\.get\("\/price-preview", verifyToken, canManageOrders/);
  assert.match(formSource, /applied_price/);
  assert.match(posSource, /applied_price/);
  for (const label of ["Regular $", "Aplicado $", "Diferencia $", "Lista:"]) {
    assert.doesNotMatch(formSource, new RegExp(label.replace("$", "\\$")));
    assert.doesNotMatch(posSource, new RegExp(label.replace("$", "\\$")));
  }
  assert.doesNotMatch(formSource, /priceOriginLabel/);
  assert.doesNotMatch(posSource, /priceOriginLabel/);
});
