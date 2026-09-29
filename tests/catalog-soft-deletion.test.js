const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
const serviceSource = read("services/catalog.service.js");
const routerSource = read("api/catalog.router.js");
const migrationSource = read("database/094_catalog_soft_deletion.sql");
const productsPageSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/catalogo/productos.js"), "utf8");
const categoriesPageSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/catalogo/categorias-producto.js"), "utf8");

test("productos y categorias se retiran logicamente sin borrar historicos", () => {
  assert.match(serviceSource, /SET is_active = 0, deleted_at = CURRENT_TIMESTAMP/);
  assert.match(serviceSource, /'product\.delete'/);
  assert.match(serviceSource, /'product_category\.delete'/);
  assert.match(migrationSource, /ADD COLUMN deleted_at TIMESTAMP NULL/);
  assert.match(migrationSource, /information_schema\.COLUMNS/);
  assert.match(migrationSource, /information_schema\.STATISTICS/);
  assert.doesNotMatch(serviceSource, /DELETE FROM products/);
  assert.doesNotMatch(serviceSource, /DELETE FROM product_categories/);
});

test("la justificacion de ambas eliminaciones es opcional y queda auditada", () => {
  assert.match(serviceSource, /String\(payload\.p_reason \|\| ""\)\.trim\(\) \|\| null/g);
  assert.match(productsPageSource, /Justificaci.n \(opcional\)/);
  assert.match(categoriesPageSource, /Justificaci.n \(opcional\)/);
  assert.match(productsPageSource, /reason\.trim\(\) \|\| null/);
  assert.match(categoriesPageSource, /reason\.trim\(\) \|\| null/);
});

test("el backend protege permisos, variantes y categorias con productos", () => {
  assert.match(routerSource, /router\.delete\("\/products\/:id", verifyToken, canManageProducts/);
  assert.match(routerSource, /router\.delete\("\/product-categories\/:id", verifyToken, canManageProducts/);
  assert.match(serviceSource, /physical_product_id = \? AND deleted_at IS NULL/);
  assert.match(serviceSource, /category_id = \? AND deleted_at IS NULL/);
  assert.match(serviceSource, /validateActiveProductCategory/);
});
