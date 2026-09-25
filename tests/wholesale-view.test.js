const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/configuracion/mayoristas.js"), "utf8");
const panelSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/organisms/wholesale/WholesaleConfigurationPanel.js"), "utf8");
const navigationSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/configs/navigation.js"), "utf8");
const layoutSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/layouts/UserLayout.js"), "utf8");
const serviceSource = fs.readFileSync(path.join(__dirname, "../services/wholesale.service.js"), "utf8");
const configurationServiceSource = serviceSource.slice(0, serviceSource.indexOf("const normalizeDuplicateName"));
const routerSource = fs.readFileSync(path.join(__dirname, "../api/wholesale.router.js"), "utf8");

test("la página y su navegación son exclusivamente administrativas", () => {
  assert.match(pageSource, /isAdministrativeUser/);
  assert.match(pageSource, /router\.replace\("\/dashboards\/analytics"\)/);
  assert.match(navigationSource, /\/configuracion\/mayoristas/);
  assert.match(navigationSource, /adminOnly: true/);
  assert.match(layoutSource, /activeRoute\.adminOnly/);
  assert.match(routerSource, /router\.use\(verifyToken, requireAdministrativeRole\)/);
});

test("la vista usa componentes atómicos y las tres secciones solicitadas", () => {
  assert.match(panelSource, /AppCard/);
  assert.match(panelSource, /AppButton/);
  assert.match(panelSource, /BalanceDatePicker/);
  assert.match(panelSource, /Clientes mayoristas/);
  assert.match(panelSource, /Precios mayoristas/);
  assert.match(panelSource, /Excepciones por cliente/);
});

test("permite buscar clientes y productos, consultar vigencia e historial", () => {
  assert.match(panelSource, /Buscar cliente/);
  assert.match(panelSource, /Buscar producto/);
  assert.match(panelSource, /Vigente desde/);
  assert.match(panelSource, /Vigente hasta \(opcional\)/);
  assert.match(panelSource, /getHistory/);
  assert.match(panelSource, /Última modificación/);
});

test("muestra claramente la prioridad y la referencia general", () => {
  assert.match(panelSource, /precio especial del cliente/);
  assert.match(panelSource, /precio mayorista general/);
  assert.match(panelSource, /precio regular/);
  assert.match(panelSource, /Precio mayorista general de referencia/);
});

test("quitar una excepción la desactiva y no la elimina", () => {
  assert.match(panelSource, /Quitar excepción/);
  assert.match(panelSource, /deactivatePrice/);
  assert.doesNotMatch(panelSource, /deletePrice/);
  assert.doesNotMatch(routerSource, /router\.delete/);
});

test("el backend entrega catálogos activos sin modificarlos", () => {
  assert.match(serviceSource, /availableCustomers/);
  assert.match(serviceSource, /availableProducts/);
  assert.match(serviceSource, /FROM customers/);
  assert.match(serviceSource, /FROM products/);
  assert.doesNotMatch(configurationServiceSource, /UPDATE\s+products/i);
  assert.doesNotMatch(configurationServiceSource, /inventory_movements/);
  assert.doesNotMatch(configurationServiceSource, /finished_product_inventory/);
});

test("los dialogos permiten guardar sin motivo", () => {
  assert.match(panelSource, /Motivo opcional/);
  assert.doesNotMatch(panelSource, /Motivo obligatorio/);
  assert.doesNotMatch(panelSource, /reason \|\| ""\)\.trim\(\)\.length < 5/);
});

test("la edicion de precios mayoristas muestra y acepta solo enteros", () => {
  assert.match(panelSource, /Number\(price\.wholesale_price\)/);
  assert.match(panelSource, /inputMode: "numeric"/);
  assert.match(panelSource, /Ingresa un valor entero, sin decimales/);
  assert.match(panelSource, /Number\.isInteger\(Number\(priceDialog\?\.wholesalePrice\)\)/);
});
