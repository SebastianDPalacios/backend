const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const migration = read("backend", "database", "095_raw_material_inventory_valuation.sql");
const catalogService = read("backend", "services", "catalog.service.js");
const productionService = read("backend", "services", "production.service.js");
const editDialog = read("frontend", "src", "components", "organisms", "catalog", "RawMaterialEditDialog.js");
const monthExcel = read("frontend", "src", "components", "organisms", "production", "exportProductionMonthExcel.js");

test("la valoración de materias primas es explícita y conserva compatibilidad", () => {
  assert.match(migration, /is_inventory_valued TINYINT\(1\) NOT NULL DEFAULT 1/);
  assert.match(catalogService, /saveRawMaterialInventoryValuation/);
  assert.match(catalogService, /p_is_inventory_valued \?\? payload\.is_inventory_valued/);
});

test("un insumo simbólico conserva cantidades pero aporta cero a costos e inventario", () => {
  assert.match(productionService, /material\.unit_cost = 0/);
  assert.match(productionService, /material\.total_cost = 0/);
  assert.match(productionService, /ELSE 0 END AS total_value/);
  assert.doesNotMatch(productionService, /is_inventory_valued[^\n]+quantity_on_hand\s*=\s*0/);
});

test("la administración y Excel muestran claramente los insumos no valorizados", () => {
  assert.match(editDialog, /Incluir esta materia prima en la valoración/);
  assert.match(editDialog, /seguirá en recetas, consumos y existencias/);
  assert.match(monthExcel, /"No valorizado"/);
  assert.match(monthExcel, /sumBy\(rows, "total_value"\)/);
});
