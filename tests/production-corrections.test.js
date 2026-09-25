const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");
const routerSource = fs.readFileSync(path.join(__dirname, "../api/production.router.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(__dirname, "../database/080_production_record_corrections.sql"), "utf8");
const damageCorrectionMigration = fs.readFileSync(path.join(__dirname, "../database/081_packing_damage_corrections.sql"), "utf8");
const packingCorrection = serviceSource.slice(
  serviceSource.indexOf("const correctPackingReportItem = async"),
  serviceSource.indexOf("const correctProductionBatchOutput = async")
);
const productionCorrection = serviceSource.slice(
  serviceSource.indexOf("const correctProductionBatchOutput = async"),
  serviceSource.indexOf("const listProductionRecordCorrections = async")
);

test("solo administracion expone correcciones de registros cerrados", () => {
  assert.match(routerSource, /corrections\/packing-items\/:id", verifyToken, canManageProduction/);
  assert.match(routerSource, /corrections\/production-outputs\/:id", verifyToken, canManageProduction/);
  assert.match(routerSource, /router\.get\("\/corrections", verifyToken, canManageProduction/);
  assert.match(packingCorrection, /counted_at === null/);
  assert.match(productionCorrection, /baker_reported_at IS NOT NULL/);
});

test("conserva valor original, corregido, motivo, administrador y fecha", () => {
  for (const field of ["original_quantity", "corrected_quantity", "reason", "corrected_by", "created_at"]) {
    assert.match(migrationSource, new RegExp(field));
  }
  assert.match(migrationSource, /CHAR_LENGTH\(TRIM\(reason\)\) >= 5/);
  assert.match(serviceSource, /Historial de correcciones obtenido/);
});

test("corregir empacado compensa inventario y recalcula conciliacion", () => {
  assert.match(packingCorrection, /FOR UPDATE/);
  assert.match(packingCorrection, /adjustment_in/);
  assert.match(packingCorrection, /adjustment_out/);
  assert.match(packingCorrection, /production_correction/);
  assert.match(packingCorrection, /calculateClosedCountComparison/);
  assert.match(packingCorrection, /shortage_quantity/);
  assert.match(packingCorrection, /surplus_quantity/);
});

test("corregir conteo incluye daños individuales y conserva antes y después", () => {
  assert.match(damageCorrectionMigration, /packing_report_item_id/);
  assert.match(damageCorrectionMigration, /original_damages_json/);
  assert.match(damageCorrectionMigration, /corrected_damages_json/);
  assert.match(packingCorrection, /correctedDamages/);
  assert.match(packingCorrection, /DELETE FROM production_damages WHERE packing_report_item_id/);
  assert.match(packingCorrection, /INSERT INTO production_damages/);
  assert.match(packingCorrection, /damageDelta/);
});

test("corregir producido recalcula conciliacion y solo ajusta materias primas al cambiar el lote", () => {
  assert.match(productionCorrection, /batchDelta !== 0/);
  assert.match(productionCorrection, /stock_raw_materials/);
  assert.match(productionCorrection, /production_out/);
  assert.match(productionCorrection, /adjustment_in/);
  assert.match(productionCorrection, /calculateClosedCountComparison/);
  assert.match(productionCorrection, /raw_materials_adjusted/);
});
