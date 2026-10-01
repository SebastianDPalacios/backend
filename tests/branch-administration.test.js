const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.join(__dirname, "..");
const workspaceRoot = path.join(backendRoot, "..");
const routerSource = fs.readFileSync(path.join(backendRoot, "api", "catalog.router.js"), "utf8");
const serviceSource = fs.readFileSync(path.join(backendRoot, "services", "catalog.service.js"), "utf8");
const pageSource = fs.readFileSync(path.join(workspaceRoot, "frontend", "src", "pages", "configuracion", "sucursales.js"), "utf8");

test("crear y editar sucursales exige rol administrativo en backend", () => {
  assert.match(routerSource, /post\("\/branches", verifyToken, requireAdministrativeRole/);
  assert.match(routerSource, /put\("\/branches\/:id", verifyToken, requireAdministrativeRole/);
});

test("el backend valida identidad y datos de la sucursal", () => {
  assert.match(serviceSource, /\^\[A-Z0-9_-\]\{2,30\}\$/);
  assert.match(serviceSource, /name\.length < 2/);
  assert.match(serviceSource, /payload\.p_is_active \?\? null/);
});

test("la vista permite buscar, crear, editar y desactivar conservando historicos", () => {
  assert.match(pageSource, /Nueva sucursal/);
  assert.match(pageSource, /Editar sucursal/);
  assert.match(pageSource, /getBranches\(\{ onlyActive: 0 \}\)/);
  assert.match(pageSource, /reportes históricos se conservarán/);
});
