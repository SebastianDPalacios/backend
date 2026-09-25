const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getProductionAccess, isProductionAdministrator } = require("../domain/production-access");

const routerSource = fs.readFileSync(path.join(__dirname, "../api/production.router.js"), "utf8");
const serviceSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");
const packagingSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/production/packaging.js"), "utf8");
const historySource = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/organisms/production/PackagingHistoryPanel.js"), "utf8");

test("centraliza los perfiles administrativos, panadero y empaquetador", () => {
  assert.deepEqual(getProductionAccess({ roles: ["ADMIN"] }), { administrator: true, baker: true, packer: true });
  assert.deepEqual(getProductionAccess({ permissions: ["production.manage"] }), { administrator: true, baker: true, packer: true });
  assert.deepEqual(getProductionAccess({ permissions: ["production.baker"] }), { administrator: false, baker: true, packer: false });
  assert.deepEqual(getProductionAccess({ permissions: ["production.packaging"] }), { administrator: false, baker: false, packer: true });
  assert.equal(isProductionAdministrator({ roles: [{ code: "SUPER_ADMIN" }] }), true);
});

test("las operaciones administrativas permanecen protegidas en el backend", () => {
  assert.match(routerSource, /router\.post\("\/plans", verifyToken, canManageProduction/);
  assert.match(routerSource, /router\.put\("\/plans\/:id", verifyToken, canManageProduction/);
  assert.match(routerSource, /router\.post\("\/plans\/:id\/cancel", verifyToken, canManageProduction/);
  assert.match(routerSource, /corrections\/packing-items\/:id", verifyToken, canManageProduction/);
  assert.match(routerSource, /corrections\/production-outputs\/:id", verifyToken, canManageProduction/);
  assert.match(routerSource, /router\.get\("\/corrections", verifyToken, canManageProduction/);
});

test("el panadero no puede registrar producción por otro panadero", () => {
  const registrationSource = serviceSource.slice(
    serviceSource.indexOf("const registerMyProductionBatch = async"),
    serviceSource.indexOf("const registerProductionResult = async")
  );
  assert.match(registrationSource, /findActiveBakerForUser\(db, actorUserId\)/);
  assert.match(registrationSource, /p_baker_employee_id: Number\(baker\.id\)/);
  assert.match(routerSource, /getRawMaterialUsageByProductReport\([\s\S]*actorUserId: req\.user\.userId[\s\S]*canManageAll: isProductionAdministrator/);
  assert.match(serviceSource, /access_baker\.user_id = \?/);
});

test("el empaquetador queda ligado a su empleado y solo consulta su historial", () => {
  const packingSource = serviceSource.slice(
    serviceSource.indexOf("const createPackingReport = async"),
    serviceSource.indexOf("const normalizeCorrectionReason")
  );
  const historyServiceSource = serviceSource.slice(
    serviceSource.indexOf("const listPackingHistory = async"),
    serviceSource.indexOf("const registerProductionDamage")
  );
  assert.match(packingSource, /findActivePackerForUser\(db, actorUserId\)/);
  assert.match(packingSource, /canManageAll \? requestedPackerEmployeeId : Number\(assignedPacker\?\.id/);
  assert.match(packingSource, /Este producto ya fue contado por otro usuario/);
  assert.match(historyServiceSource, /if \(!canManageAll\)[\s\S]*packer\.user_id = \?/);
  assert.match(routerSource, /includeReconciliation: isProductionAdministrator\(req\.user\)/);
});

test("el frontend solo permite escoger otro empaquetador y corregir al administrador", () => {
  assert.match(packagingSource, /canSelectPacker=\{isAdministrator\}/);
  assert.match(historySource, /isAdministrator && item\.reconciliation_status/);
  assert.match(historySource, /if \(!isAdministrator \|\| !normalizeRows/);
});
