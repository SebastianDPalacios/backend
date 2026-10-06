const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routerSource = fs.readFileSync(path.join(__dirname, "../api/recipes.router.js"), "utf8");

test("production managers can list recipes used by production reports", () => {
  assert.match(
    routerSource,
    /const canListRecipes = requirePermission\("recipes\.manage", "production\.manage"\);/
  );
  assert.match(
    routerSource,
    /router\.get\("\/", verifyToken, canListRecipes,/
  );
});

test("recipe mutations remain restricted to recipe managers", () => {
  assert.match(routerSource, /router\.post\("\/", verifyToken, canManageRecipes,/);
  assert.match(routerSource, /router\.delete\("\/:id", verifyToken, canManageRecipes,/);
});
