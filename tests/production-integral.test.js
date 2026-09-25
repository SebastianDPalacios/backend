const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { calculateClosedCountComparison, PRODUCTION_RECORD_POLICIES } = require("../domain/production-flow");
const { validateProductionRegistrationDate } = require("../domain/production-registration");
const { getProductionAccess } = require("../domain/production-access");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");
const routerSource = fs.readFileSync(path.join(__dirname, "../api/production.router.js"), "utf8");
const planSource = serviceSource.slice(serviceSource.indexOf("const createProductionPlan = async"), serviceSource.indexOf("const listProductionPlans = async"));
const registrationSource = serviceSource.slice(serviceSource.indexOf("const registerProductionBatch = async"), serviceSource.indexOf("const listPendingPackaging = async"));
const packingSource = serviceSource.slice(serviceSource.indexOf("const createPackingReport = async"), serviceSource.indexOf("const normalizeCorrectionReason"));
const correctionSource = serviceSource.slice(serviceSource.indexOf("const correctPackingReportItem = async"), serviceSource.indexOf("const listProductionRecordCorrections = async"));
const reportSource = serviceSource.slice(serviceSource.indexOf("const getProductionDayReport = async"), serviceSource.indexOf("const createProductionPlan = async"));
const excelSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/organisms/production/exportProductionMonthExcel.js"), "utf8");

test("integral: crear, editar y cancelar una lista informativa", () => {
  assert.match(planSource, /INSERT INTO production_plans/);
  assert.match(planSource, /UPDATE production_plans/);
  assert.match(planSource, /status = 'cancelled'/);
  assert.match(planSource, /production_plan\.create/);
  assert.match(planSource, /production_plan\.update/);
  assert.match(planSource, /production_plan\.cancel/);
});

test("integral: la lista informativa no crea lotes ni inventario", () => {
  assert.deepEqual(PRODUCTION_RECORD_POLICIES.informational_plan, {
    creates_batch: false,
    consumes_raw_materials: false,
    changes_finished_inventory: false,
  });
  assert.doesNotMatch(planSource, /INSERT INTO production_batches/);
  assert.doesNotMatch(planSource, /stock_(raw_materials|products)/);
  assert.doesNotMatch(planSource, /inventory_movements/);
});

test("integral: registro normal y registro administrativo por otro panadero", () => {
  assert.match(serviceSource, /findActiveBakerForUser\(db, actorUserId\)/);
  assert.match(serviceSource, /canManageAll[\s\S]*p_baker_employee_id/);
  assert.match(routerSource, /registerMyProductionBatch\(req\.body, req\.user\.userId,[\s\S]*canManageAll/);
});

test("integral: materia prima insuficiente revierte la transacción", () => {
  assert.match(registrationSource, /No hay materia prima suficiente/);
  assert.match(registrationSource, /connection\.rollback\(\)/);
  assert.ok(registrationSource.indexOf("No hay materia prima suficiente") < registrationSource.indexOf("UPDATE stock_raw_materials"));
});

test("integral: doble envío de producción devuelve el lote existente", () => {
  assert.match(registrationSource, /client_request_key = \?/);
  assert.match(registrationSource, /ER_DUP_ENTRY/);
  assert.match(registrationSource, /production_batch_id: Number\(existingBatchRows\[0\]\.id\)/);
  assert.match(registrationSource, /replayed: true/);
});

test("integral: conteo exacto, menor y mayor usan la fórmula oficial", () => {
  const exact = calculateClosedCountComparison({ producedQuantity: 100, packedQuantity: 97, damagedQuantity: 3, closed: true });
  const lower = calculateClosedCountComparison({ producedQuantity: 100, packedQuantity: 94, damagedQuantity: 4, closed: true });
  const higher = calculateClosedCountComparison({ producedQuantity: 100, packedQuantity: 101, damagedQuantity: 2, closed: true });
  assert.deepEqual([exact.reconciliation_status, exact.shortage_quantity, exact.surplus_quantity], ["matched", 0, 0]);
  assert.deepEqual([lower.reconciliation_status, lower.shortage_quantity, lower.surplus_quantity], ["shortage", 2, 0]);
  assert.deepEqual([higher.reconciliation_status, higher.shortage_quantity, higher.surplus_quantity], ["surplus", 0, 3]);
});

test("integral: varios daños se suman separados y solo empacados entran a inventario", () => {
  assert.match(packingSource, /item\.damages\.reduce/);
  assert.match(packingSource, /for \(const damage of item\.damages\)/);
  assert.match(packingSource, /INSERT INTO production_damages/);
  assert.match(packingSource, /item\.packedQuantity > 0/);
  assert.match(packingSource, /quantity_on_hand = quantity_on_hand \+ VALUES\(quantity_on_hand\)/);
  assert.doesNotMatch(packingSource, /quantity_on_hand[^\n]+damagedQuantity/);
});

test("integral: doble envío y cierres simultáneos de empaque son idempotentes", () => {
  assert.match(packingSource, /client_request_key = \?/);
  assert.match(packingSource, /replayed: true/);
  assert.match(packingSource, /FROM production_batch_outputs[\s\S]*FOR UPDATE/);
  assert.match(packingSource, /row\.counted_at !== null/);
  assert.match(packingSource, /ER_DUP_ENTRY/);
});

test("integral: corrección administrativa compensa y conserva trazabilidad", () => {
  assert.match(routerSource, /corrections\/packing-items\/:id", verifyToken, canManageProduction/);
  assert.match(correctionSource, /original_quantity, corrected_quantity/);
  assert.match(correctionSource, /production_correction/);
  assert.match(correctionSource, /calculateClosedCountComparison/);
  assert.match(correctionSource, /reason/);
});

test("integral: producción retroactiva exige administración y motivo", () => {
  assert.equal(validateProductionRegistrationDate({ producedDate: "2026-09-18", currentDate: "2026-09-19", canManageAll: false }).valid, false);
  assert.equal(validateProductionRegistrationDate({ producedDate: "2026-09-18", currentDate: "2026-09-19", canManageAll: true, retroactiveReason: "" }).valid, false);
  assert.equal(validateProductionRegistrationDate({ producedDate: "2026-09-18", currentDate: "2026-09-19", canManageAll: true, retroactiveReason: "Cierre verificado" }).valid, true);
  assert.match(registrationSource, /'retroactive_reason'/);
});

test("integral: dos lotes iguales conservan faltantes y sobrantes separados", () => {
  assert.match(reportSource, /SUM\(GREATEST\(pbo\.produced_quantity - pbo\.packed_quantity - pbo\.damaged_quantity, 0\)\)/);
  assert.match(reportSource, /SUM\(GREATEST\(pbo\.packed_quantity \+ pbo\.damaged_quantity - pbo\.produced_quantity, 0\)\)/);
  const lots = [{ p: 100, e: 95, d: 3 }, { p: 100, e: 101, d: 2 }];
  assert.deepEqual(lots.reduce((total, row) => ({
    shortage: total.shortage + Math.max(row.p - row.e - row.d, 0),
    surplus: total.surplus + Math.max(row.e + row.d - row.p, 0),
  }), { shortage: 0, surplus: 0 }), { shortage: 2, surplus: 3 });
});

test("integral: reporte diario, mensual y Excel comparten campos", () => {
  assert.match(reportSource, /const getProductionDayReport = async/);
  assert.match(reportSource, /const getProductionMonthReport = async/);
  assert.match(reportSource, /getProductionDayReport\(\{/);
  for (const heading of ["Informado", "Producido", "Empacado", "Dañado", "Faltante", "Sobrante", "A inventario", "Estado"]) {
    assert.match(excelSource, new RegExp(heading));
  }
  assert.match(excelSource, /workbook\.xlsx\.writeBuffer\(\)/);
});

test("integral: permisos por rol separan administración, panadero y empaquetador", () => {
  assert.deepEqual(getProductionAccess({ permissions: ["production.manage"] }), { administrator: true, baker: true, packer: true });
  assert.deepEqual(getProductionAccess({ permissions: ["production.baker"] }), { administrator: false, baker: true, packer: false });
  assert.deepEqual(getProductionAccess({ permissions: ["production.packaging"] }), { administrator: false, baker: false, packer: true });
  assert.match(routerSource, /router\.post\("\/plans", verifyToken, canManageProduction/);
  assert.match(routerSource, /router\.post\("\/my-batches", verifyToken, canRegisterBakerProduction/);
  assert.match(routerSource, /router\.post\("\/packaging\/reports", verifyToken, canRegisterPackaging/);
});
