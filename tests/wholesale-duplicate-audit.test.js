const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = fs.readFileSync(path.join(__dirname, "../services/wholesale.service.js"), "utf8");
const migration = fs.readFileSync(path.join(__dirname, "../database/093_physical_product_reconciliation_audit.sql"), "utf8");
const page = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/organisms/wholesale/WholesaleDuplicateAuditPanel.js"), "utf8");
const approveSource = service.slice(service.indexOf("const approveWholesaleProductEquivalence"), service.indexOf("module.exports"));

test("la auditoría informa relaciones sin unir ni sumar inventarios", () => {
  assert.match(service, /possible_physical_product/);
  assert.match(service, /stock_actual/);
  assert.match(service, /movement_count/);
  assert.doesNotMatch(service.slice(service.indexOf("const listWholesaleDuplicateProducts"), service.indexOf("const approveWholesaleProductEquivalence")), /UPDATE products|UPDATE stock_products/);
});

test("la aprobación es manual, transaccional y conserva respaldo", () => {
  assert.match(approveSource, /beginTransaction/);
  assert.match(approveSource, /FOR UPDATE/);
  assert.match(approveSource, /physical_product_reconciliations/);
  assert.match(approveSource, /confirmedPhysicalStock/);
  assert.match(approveSource, /inventory_delta/);
  assert.match(approveSource, /inventory_movements/);
  assert.match(migration, /backup_before_json JSON NOT NULL/);
  assert.match(migration, /result_after_json JSON NOT NULL/);
});

test("la interfaz advierte que no suma existencias automáticamente", () => {
  assert.match(page, /Ningún producto ni stock se une automáticamente/);
  assert.match(page, /El stock no se sumará/);
  assert.match(page, /Stock físico correcto/);
});
