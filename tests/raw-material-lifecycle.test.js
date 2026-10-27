const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const readBackend = (relativePath) => fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
const readFrontend = (relativePath) => fs.readFileSync(path.join(__dirname, "../../frontend", relativePath), "utf8");

const serviceSource = readBackend("services/catalog.service.js");
const recipesSource = readBackend("services/recipes.service.js");
const routerSource = readBackend("api/catalog.router.js");
const migrationSource = readBackend("database/096_raw_material_soft_deletion.sql");
const pageSource = readFrontend("src/pages/catalogo/materias-primas.js");
const recipeEditSource = readFrontend("src/pages/recipes/[id]/edit.js");
const ingredientsSource = readFrontend("src/components/organisms/recipes/RecipeIngredientsTable.js");

test("bloquea nombres y SKU duplicados al crear y nombres duplicados al editar", () => {
  assert.match(serviceSource, /LOWER\(TRIM\(name\)\) = LOWER\(TRIM\(\?\)\)/);
  assert.match(serviceSource, /LOWER\(TRIM\(sku\)\) = LOWER\(TRIM\(\?\)\)/);
  assert.match(serviceSource, /duplicate_raw_material_id/);
});

test("elimina materias primas logicamente y conserva sus historicos", () => {
  assert.match(migrationSource, /ADD COLUMN deleted_at TIMESTAMP NULL/);
  assert.match(serviceSource, /SET is_active = 0, deleted_at = CURRENT_TIMESTAMP/);
  assert.match(serviceSource, /'raw_material\.delete'/);
  assert.doesNotMatch(serviceSource, /DELETE FROM raw_materials/);
  assert.match(routerSource, /router\.delete\("\/raw-materials\/:id", verifyToken, canManageMaterials/);
  assert.match(pageSource, /Justificaci.n \(opcional\)/);
});

test("impide eliminar una materia prima que conserva stock", () => {
  assert.match(serviceSource, /SUM\(ABS\(quantity_on_hand\)\)/);
  assert.match(serviceSource, /mientras tenga existencias/);
});

test("una receta existente conserva ingredientes inactivos o eliminados al editar", () => {
  assert.match(recipeEditSource, /getBaseData\(\{ onlyActive: 0 \}\)/);
  assert.match(recipeEditSource, /referencedRawMaterials/);
  assert.match(ingredientsSource, /\(Eliminada\)/);
  assert.match(ingredientsSource, /\(Inactiva\)/);
  assert.match(recipesSource, /raw_material_is_active/);
  assert.match(recipesSource, /raw_material_deleted_at/);
});
