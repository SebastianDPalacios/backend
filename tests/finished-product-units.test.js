const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  FINISHED_PRODUCT_UNIT,
  validateFinishedProductUnit,
  isWholeFinishedProductQuantity,
} = require("../domain/finished-product-rules");

test("los productos terminados usan exclusivamente la unidad canonica", () => {
  assert.equal(FINISHED_PRODUCT_UNIT, "unit");
  assert.deepEqual(validateFinishedProductUnit("unit"), { valid: true, unit: "unit" });
  assert.equal(validateFinishedProductUnit(undefined).valid, true);
  for (const unit of ["g", "kg", "ml", "l", "lb", "tray", "box"]) {
    assert.equal(validateFinishedProductUnit(unit).valid, false, unit);
  }
});

test("cantidades operativas de productos terminados deben ser enteras", () => {
  assert.equal(isWholeFinishedProductQuantity(1), true);
  assert.equal(isWholeFinishedProductQuantity("25"), true);
  assert.equal(isWholeFinishedProductQuantity(0, { allowZero: true }), true);
  assert.equal(isWholeFinishedProductQuantity(1.5), false);
  assert.equal(isWholeFinishedProductQuantity(0), false);
});

test("catalogo, conteo e inventario aplican las defensas del bloque", () => {
  const root = path.resolve(__dirname, "..");
  const catalog = fs.readFileSync(path.join(root, "services", "catalog.service.js"), "utf8");
  const inventory = fs.readFileSync(path.join(root, "services", "inventory.service.js"), "utf8");
  const production = fs.readFileSync(path.join(root, "services", "production.service.js"), "utf8");
  const migration = fs.readFileSync(path.join(root, "database", "085_finished_products_whole_units.sql"), "utf8");

  assert.match(catalog, /validateFinishedProductUnit\(payload\.p_unit\)/);
  assert.match(inventory, /p_item_type === "product" && !Number\.isInteger\(quantity\)/);
  assert.match(production, /!Number\.isInteger\(item\.packedQuantity\)/);
  assert.match(migration, /MODIFY COLUMN unit ENUM\('unit'\)/);
  assert.doesNotMatch(migration, /UPDATE raw_materials|ALTER TABLE raw_materials|UPDATE recipes|ALTER TABLE recipes/i);
});
