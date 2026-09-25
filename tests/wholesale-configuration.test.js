const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { requireAdministrativeRole } = require("../middlewares/auth.handler");

const migrationSource = fs.readFileSync(
  path.join(__dirname, "../database/087_wholesale_pricing_configuration.sql"),
  "utf8"
);
const rollbackSource = fs.readFileSync(
  path.join(__dirname, "../database/087_wholesale_pricing_configuration_down.sql"),
  "utf8"
);
const serviceSource = fs.readFileSync(path.join(__dirname, "../services/wholesale.service.js"), "utf8");
const configurationServiceSource = serviceSource.slice(0, serviceSource.indexOf("const normalizeDuplicateName"));
const optionalReasonsMigrationSource = fs.readFileSync(
  path.join(__dirname, "../database/088_optional_wholesale_reasons.sql"),
  "utf8"
);
const wholePricesMigrationSource = fs.readFileSync(
  path.join(__dirname, "../database/089_wholesale_prices_whole_values.sql"),
  "utf8"
);
const routerSource = fs.readFileSync(path.join(__dirname, "../api/wholesale.router.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");

test("la estructura almacena listas, clientes, precios generales o especiales e historial", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS wholesale_price_lists/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS customer_wholesale_profiles/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS wholesale_product_prices/);
  assert.match(migrationSource, /customer_id BIGINT UNSIGNED NULL/);
  assert.match(migrationSource, /regular_price_reference DECIMAL\(14,2\) NOT NULL/);
  assert.match(migrationSource, /wholesale_price DECIMAL\(14,2\) NOT NULL/);
  assert.match(migrationSource, /valid_from DATE NOT NULL/);
  assert.match(migrationSource, /valid_to DATE NULL/);
  assert.match(migrationSource, /created_by BIGINT UNSIGNED NOT NULL/);
  assert.match(migrationSource, /updated_by BIGINT UNSIGNED NOT NULL/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS wholesale_configuration_history/);
  assert.match(migrationSource, /previous_values_json JSON NULL/);
  assert.match(migrationSource, /new_values_json JSON NULL/);
});

test("base de datos y servicio rechazan precios no positivos", () => {
  assert.match(migrationSource, /regular_price_reference > 0 AND wholesale_price > 0/);
  assert.match(serviceSource, /wholesalePrice <= 0/);
  assert.match(serviceSource, /precio mayorista debe ser mayor que 0/);
});

test("solo administradores pueden acceder a toda la API mayorista", () => {
  assert.match(routerSource, /router\.use\(verifyToken, requireAdministrativeRole\)/);
  assert.match(indexSource, /app\.use\("\/api\/wholesale", require\("\.\/api\/wholesale\.router"\)\)/);

  let adminError = "not-called";
  requireAdministrativeRole({ user: { roles: [{ code: "ADMIN" }] } }, {}, (error) => { adminError = error; });
  assert.equal(adminError, undefined);

  let sellerError;
  requireAdministrativeRole({ user: { roles: [{ code: "VENDEDOR" }] } }, {}, (error) => { sellerError = error; });
  assert.equal(sellerError.output.statusCode, 403);
});

test("la desactivación conserva el registro y escribe historial", () => {
  const deactivateSource = serviceSource.slice(
    serviceSource.indexOf("const deactivateWholesalePrice"),
    serviceSource.indexOf("module.exports")
  );
  assert.match(deactivateSource, /SET is_active = 0/);
  assert.match(deactivateSource, /actionType: "deactivated"/);
  assert.match(deactivateSource, /insertHistory/);
  assert.doesNotMatch(deactivateSource, /DELETE FROM wholesale_product_prices/);
});

test("evita periodos activos incompatibles bajo bloqueo transaccional", () => {
  const saveSource = serviceSource.slice(
    serviceSource.indexOf("const saveWholesalePrice"),
    serviceSource.indexOf("const deactivateWholesalePrice")
  );
  assert.match(saveSource, /beginTransaction/);
  assert.match(saveSource, /customer_scope_id = \?/);
  assert.match(saveSource, /valid_from <= COALESCE\(\?, '9999-12-31'\)/);
  assert.match(saveSource, /COALESCE\(valid_to, '9999-12-31'\) >= \?/);
  assert.match(saveSource, /FOR UPDATE/);
  assert.match(saveSource, /ya existe un precio activo/);
});

test("el precio regular se toma como referencia sin modificar el producto", () => {
  assert.match(serviceSource, /SELECT id, base_price, is_active FROM products/);
  assert.match(serviceSource, /regularPriceReference = Number\(productRows\[0\]\.base_price\)/);
  assert.doesNotMatch(configurationServiceSource, /UPDATE products/);
});

test("la configuración no escribe inventario ni pedidos históricos", () => {
  assert.doesNotMatch(configurationServiceSource, /inventory_movements/);
  assert.doesNotMatch(configurationServiceSource, /finished_product_inventory/);
  assert.doesNotMatch(configurationServiceSource, /UPDATE\s+orders/i);
  assert.doesNotMatch(configurationServiceSource, /UPDATE\s+order_items/i);
  assert.doesNotMatch(configurationServiceSource, /INSERT INTO\s+orders/i);
  assert.doesNotMatch(configurationServiceSource, /INSERT INTO\s+order_items/i);
});

test("la migración tiene reversión explícita en orden seguro", () => {
  const historyPosition = rollbackSource.indexOf("DROP TABLE IF EXISTS wholesale_configuration_history");
  const pricePosition = rollbackSource.indexOf("DROP TABLE IF EXISTS wholesale_product_prices");
  const profilePosition = rollbackSource.indexOf("DROP TABLE IF EXISTS customer_wholesale_profiles");
  const listPosition = rollbackSource.indexOf("DROP TABLE IF EXISTS wholesale_price_lists");
  assert.ok(historyPosition >= 0 && historyPosition < pricePosition);
  assert.ok(pricePosition < profilePosition);
  assert.ok(profilePosition < listPosition);
});

test("el motivo de la configuracion mayorista es opcional", () => {
  assert.match(serviceSource, /return reason \|\| null/);
  assert.doesNotMatch(serviceSource, /reason\.length < 5/);
  assert.match(optionalReasonsMigrationSource, /MODIFY COLUMN change_reason VARCHAR\(500\) NULL/g);
  assert.match(optionalReasonsMigrationSource, /MODIFY COLUMN reason VARCHAR\(500\) NULL/);
  assert.doesNotMatch(optionalReasonsMigrationSource, /CHAR_LENGTH\(TRIM/);
});

test("base de datos y servicio aceptan solo precios mayoristas enteros", () => {
  assert.match(serviceSource, /Number\.isInteger\(wholesalePrice\)/);
  assert.match(serviceSource, /no puede tener decimales/);
  assert.match(wholePricesMigrationSource, /wholesale_price = FLOOR\(wholesale_price\)/);
});
