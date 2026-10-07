const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const flowUtils = read("frontend", "src", "views", "modules", "flow-utils.js");
const recipeEdit = read("frontend", "src", "pages", "recipes", "[id]", "edit.js");
const recipeIngredients = read("frontend", "src", "components", "organisms", "recipes", "RecipeIngredientsTable.js");
const rawMaterials = read("frontend", "src", "pages", "catalogo", "materias-primas.js");
const productionPlanning = read("frontend", "src", "pages", "production", "planning.js");
const salesSettings = read("frontend", "src", "components", "organisms", "orders", "SalesSettingsForm.js");
const products = read("frontend", "src", "pages", "catalogo", "productos.js");

test("los valores DECIMAL del backend se limpian antes de mostrarse en formularios", () => {
  assert.match(flowUtils, /export const formatEditableNumber/);
  assert.match(flowUtils, /String\(number\)/);
  assert.match(recipeEdit, /quantity: formatEditableNumber\(item\.quantity\)/);
  assert.match(recipeEdit, /expectedQuantity: formatEditableNumber\(output\.expected_quantity\)/);
  assert.match(rawMaterials, /unit_cost: formatEditableNumber\(item\.unit_cost\)/);
  assert.match(rawMaterials, /min_stock: formatEditableNumber\(item\.min_stock\)/);
  assert.match(salesSettings, /bonus_percent: formatEditableNumber/);
  assert.match(products, /formatEditableNumber\(item\.rate_percent/);
});

test("los campos decimales conservan precisión real pero quitan ceros al perder foco", () => {
  assert.match(recipeIngredients, /onBlur=.*formatEditableNumber/);
  assert.doesNotMatch(productionPlanning, /minimumFractionDigits:\s*[1-9]/);
});
