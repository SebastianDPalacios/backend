const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRODUCTION_RECORD_TYPES,
  PRODUCTION_RECORD_POLICIES,
  INFORMATIONAL_PLAN_STATES,
  normalizeInformationalPlanStatus,
  sanitizePackagingBatchForIndependentCount,
  calculateClosedCountComparison,
} = require("../domain/production-flow");

test("formaliza los tres registros independientes de produccion", () => {
  assert.deepEqual(Object.values(PRODUCTION_RECORD_TYPES), ["informational_plan", "baker_report", "machine_count"]);
  assert.deepEqual(INFORMATIONAL_PLAN_STATES, ["informed", "viewed", "cancelled"]);
});

test("la lista publica unicamente los estados informada, vista y cancelada", () => {
  assert.equal(normalizeInformationalPlanStatus("assigned"), "informed");
  assert.equal(normalizeInformationalPlanStatus("informed"), "informed");
  assert.equal(normalizeInformationalPlanStatus("viewed"), "viewed");
  assert.equal(normalizeInformationalPlanStatus("completed"), "viewed");
  assert.equal(normalizeInformationalPlanStatus("cancelled"), "cancelled");
  assert.equal(normalizeInformationalPlanStatus("in_progress"), "informed");
});

test("la lista informativa no crea lotes, no consume materias primas y no modifica inventario", () => {
  assert.deepEqual(PRODUCTION_RECORD_POLICIES.informational_plan, {
    creates_batch: false,
    consumes_raw_materials: false,
    changes_finished_inventory: false,
  });
});

test("el reporte libre del panadero crea lote sin ingresar producto terminado", () => {
  assert.deepEqual(PRODUCTION_RECORD_POLICIES.baker_report, {
    creates_batch: true,
    consumes_raw_materials: true,
    changes_finished_inventory: false,
  });
});

test("el conteo usa empacados como fuente de inventario y compara solo al cerrar", () => {
  assert.deepEqual(PRODUCTION_RECORD_POLICIES.machine_count, {
    reveals_baker_quantity_before_close: false,
    compares_after_close: true,
    finished_inventory_source: "packed_quantity",
  });
});

test("oculta las cantidades del panadero antes del conteo independiente", () => {
  const batch = sanitizePackagingBatchForIndependentCount({
    production_batch_id: 51,
    items: [{
      production_batch_output_id: 90,
      product_name: "Mojicon",
      product_sku: "MOJ-1",
      produced_quantity: 216,
      expected_quantity: 200,
      counted_quantity: 0,
      packed_quantity: 0,
      damaged_quantity: 0,
      missing_quantity: 0,
    }],
  });

  assert.equal(batch.items[0].product_name, "Mojicon");
  assert.equal(batch.items[0].product_sku, "MOJ-1");
  assert.equal("produced_quantity" in batch.items[0], false);
  assert.equal("expected_quantity" in batch.items[0], false);
  assert.equal("counted_quantity" in batch.items[0], false);
});

test("impide comparar los reportes antes de cerrar el conteo", () => {
  assert.throws(() => calculateClosedCountComparison({
    producedQuantity: 100,
    packedQuantity: 95,
    damagedQuantity: 3,
    closed: false,
  }), /despues de cerrar/);
});

test("clasifica coincidencia, faltante y sobrante sin bloquearlos", () => {
  const matched = calculateClosedCountComparison({ producedQuantity: 100, packedQuantity: 97, damagedQuantity: 3, closed: true });
  const shortage = calculateClosedCountComparison({ producedQuantity: 100, packedQuantity: 95, damagedQuantity: 3, closed: true });
  const surplus = calculateClosedCountComparison({ producedQuantity: 100, packedQuantity: 101, damagedQuantity: 2, closed: true });

  assert.deepEqual([matched.reconciliation_status, matched.shortage_quantity, matched.surplus_quantity], ["matched", 0, 0]);
  assert.deepEqual([shortage.reconciliation_status, shortage.found_quantity, shortage.shortage_quantity], ["shortage", 98, 2]);
  assert.deepEqual([surplus.reconciliation_status, surplus.found_quantity, surplus.surplus_quantity], ["surplus", 103, 3]);
});
