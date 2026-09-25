const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(__dirname, "../database/079_packing_report_idempotency.sql"), "utf8");
const frontendSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/production/packaging.js"), "utf8");
const countSource = serviceSource.slice(
  serviceSource.indexOf("const createPackingReport = async"),
  serviceSource.indexOf("const listPackingHistory = async")
);

test("una clave idempotente identifica el cierre y permite recuperar el reporte existente", () => {
  assert.match(migrationSource, /ADD COLUMN client_request_key VARCHAR\(100\)/);
  assert.match(migrationSource, /CREATE UNIQUE INDEX uq_packing_reports_client_request_key/);
  assert.match(countSource, /WHERE client_request_key = \?/);
  assert.match(countSource, /replayed: true/);
  assert.match(countSource, /ER_DUP_ENTRY/);
  assert.match(frontendSource, /packingRequestKeyRef/);
  assert.match(frontendSource, /p_client_request_key: packingRequestKeyRef\.current/);
});

test("dos cierres simultaneos bloquean y vuelven a validar el mismo producto antes de sumar inventario", () => {
  const outputLock = countSource.indexOf("FROM production_batch_outputs");
  const lockClause = countSource.indexOf("FOR UPDATE", outputLock);
  const processedCheck = countSource.indexOf("row.counted_at !== null", lockClause);
  const inventoryUpdate = countSource.indexOf("quantity_on_hand = quantity_on_hand + VALUES(quantity_on_hand)");

  assert.ok(outputLock >= 0);
  assert.ok(lockClause > outputLock);
  assert.ok(processedCheck > lockClause);
  assert.ok(inventoryUpdate > processedCheck);
  assert.match(countSource, /production_batch_output_id IN \(\?\)/);
  assert.match(countSource, /packing_report_id: Number\(existingRows\[0\]\.packing_report_id\)/);
  assert.match(countSource, /counted_at IS NULL/);
});

test("la proteccion es por duplicidad y no limita diferencias con lo producido", () => {
  assert.doesNotMatch(countSource, /packedQuantity\s*>\s*.*produced_quantity/);
  assert.doesNotMatch(countSource, /damagedQuantity\s*>\s*.*produced_quantity/);
  assert.match(countSource, /calculateClosedCountComparison/);
});
