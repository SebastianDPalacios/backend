const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { calculateClosedCountComparison } = require("../domain/production-flow");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");
const routerSource = fs.readFileSync(path.join(__dirname, "../api/production.router.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(__dirname, "../database/078_packing_reconciliation.sql"), "utf8");
const countSource = serviceSource.slice(
  serviceSource.indexOf("const createPackingReport = async"),
  serviceSource.indexOf("const listPackingHistory = async")
);

test("calcula coincidencia, faltante y sobrante con la formula oficial", () => {
  const matched = calculateClosedCountComparison({ producedQuantity: 100, packedQuantity: 97, damagedQuantity: 3, closed: true });
  const shortage = calculateClosedCountComparison({ producedQuantity: 100, packedQuantity: 94, damagedQuantity: 4, closed: true });
  const surplus = calculateClosedCountComparison({ producedQuantity: 100, packedQuantity: 101, damagedQuantity: 2, closed: true });

  assert.deepEqual(matched, {
    produced_quantity: 100, packed_quantity: 97, damaged_quantity: 3,
    found_quantity: 100, difference: 0, shortage_quantity: 0,
    surplus_quantity: 0, reconciliation_status: "matched",
  });
  assert.deepEqual([shortage.found_quantity, shortage.shortage_quantity, shortage.surplus_quantity, shortage.reconciliation_status], [98, 2, 0, "shortage"]);
  assert.deepEqual([surplus.found_quantity, surplus.shortage_quantity, surplus.surplus_quantity, surplus.reconciliation_status], [103, 0, 3, "surplus"]);
});

test("persiste separadamente todos los valores de conciliacion sin bloquear el conteo", () => {
  for (const field of ["produced_quantity", "found_quantity", "shortage_quantity", "surplus_quantity", "reconciliation_status"]) {
    assert.match(migrationSource, new RegExp(field));
    assert.match(countSource, new RegExp(`reconciliation\\.${field}`));
  }
  assert.ok(countSource.indexOf("INSERT INTO packing_reports") < countSource.indexOf("calculateClosedCountComparison"));
  assert.doesNotMatch(countSource, /return[^;]+(shortage|surplus)/i);
});

test("la respuesta del contador no expone la conciliacion y el historial solo la incluye para administradores", () => {
  assert.match(countSource, /data: \{ packing_report_id: reportId \}/);
  assert.doesNotMatch(countSource, /data: \{[^}]+reconciliation/);
  assert.match(routerSource, /includeReconciliation: isProductionAdministrator\(req\.user\)/);
  assert.match(serviceSource, /includeReconciliation[\s\S]*reconciliationFields/);
});
