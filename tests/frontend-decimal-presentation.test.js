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
const materialUsage = read("frontend", "src", "pages", "production", "material-usage.js");

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

test("el reporte público de materias primas usadas presenta cantidades enteras", () => {
  assert.match(materialUsage, /maximumFractionDigits:\s*0/);
  assert.doesNotMatch(materialUsage, /maximumFractionDigits:\s*[1-9]/);
});

test("ninguna vista fuerza decimales en los formateadores públicos", () => {
  const frontendRoot = path.join(root, "frontend", "src");
  const pending = [];
  const inspect = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return inspect(fullPath);
      if (!entry.name.endsWith(".js")) return;
      const source = fs.readFileSync(fullPath, "utf8");
      if (/m(?:inimum|aximum)FractionDigits:\s*[1-9]/.test(source)) {
        pending.push(path.relative(frontendRoot, fullPath));
      }
    });
  };

  inspect(frontendRoot);
  assert.deepEqual(pending, []);
});
