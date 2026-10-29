const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const recipesService = read("backend", "services", "recipes.service.js");
const recipeCreate = read("frontend", "src", "pages", "recipes", "new.js");
const recipeEdit = read("frontend", "src", "pages", "recipes", "[id]", "edit.js");
const ingredientsTable = read("frontend", "src", "components", "organisms", "recipes", "RecipeIngredientsTable.js");

test("las recetas conservan el agua simbolica pero no la suman al costo", () => {
  assert.match(recipesService, /COALESCE\(is_inventory_valued, 1\) AS is_inventory_valued/);
  assert.match(recipeCreate, /is_inventory_valued \?\? 1/);
  assert.match(recipeEdit, /is_inventory_valued \?\? 1/);
  assert.match(ingredientsTable, /No valorizada/);
});

test("la edicion suma por producto sus ingredientes adicionales", () => {
  assert.match(recipeEdit, /const additionalCost = output\.items\.reduce/);
  assert.match(recipeEdit, /const totalCost = baseSummary\.cost \+ additionalCost/);
  assert.match(recipeEdit, /Adicionales/);
  assert.match(recipeEdit, /Costo total/);
});

test("cada ingrediente muestra su costo calculado para facilitar la validacion", () => {
  assert.match(ingredientsTable, /getRowCost/);
  assert.match(ingredientsTable, />Costo</);
  assert.match(ingredientsTable, /moneyFormatter\.format\(getRowCost/);
});
