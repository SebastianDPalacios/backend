const PRODUCTION_RECORD_TYPES = Object.freeze({
  INFORMATIONAL_PLAN: "informational_plan",
  BAKER_REPORT: "baker_report",
  MACHINE_COUNT: "machine_count",
});

const PRODUCTION_RECORD_POLICIES = Object.freeze({
  [PRODUCTION_RECORD_TYPES.INFORMATIONAL_PLAN]: Object.freeze({
    creates_batch: false,
    consumes_raw_materials: false,
    changes_finished_inventory: false,
  }),
  [PRODUCTION_RECORD_TYPES.BAKER_REPORT]: Object.freeze({
    creates_batch: true,
    consumes_raw_materials: true,
    changes_finished_inventory: false,
  }),
  [PRODUCTION_RECORD_TYPES.MACHINE_COUNT]: Object.freeze({
    reveals_baker_quantity_before_close: false,
    compares_after_close: true,
    finished_inventory_source: "packed_quantity",
  }),
});

const INFORMATIONAL_PLAN_STATES = Object.freeze(["informed", "viewed", "cancelled"]);
const LEGACY_INFORMATIONAL_PLAN_STATE_ALIASES = Object.freeze({
  assigned: "informed",
  completed: "viewed",
});
const BAKER_REPORT_STATES = Object.freeze(["pending_packaging", "partially_packed", "packed", "cancelled"]);
const PROTECTED_BAKER_QUANTITY_FIELDS = Object.freeze([
  "produced_quantity",
  "expected_quantity",
  "counted_quantity",
  "packed_quantity",
  "damaged_quantity",
  "missing_quantity",
]);

const sanitizePackagingBatchForIndependentCount = (batch = {}) => ({
  ...batch,
  items: (Array.isArray(batch.items) ? batch.items : []).map((item) => {
    const safeItem = { ...item };
    PROTECTED_BAKER_QUANTITY_FIELDS.forEach((field) => delete safeItem[field]);
    return safeItem;
  }),
});

const normalizeInformationalPlanStatus = (status) => {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (INFORMATIONAL_PLAN_STATES.includes(normalizedStatus)) return normalizedStatus;
  return LEGACY_INFORMATIONAL_PLAN_STATE_ALIASES[normalizedStatus] || "informed";
};

const normalizeNonNegativeQuantity = (value, label) => {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`${label} debe ser una cantidad mayor o igual a cero`);
  }
  return quantity;
};

const calculateClosedCountComparison = ({ producedQuantity, packedQuantity, damagedQuantity, closed }) => {
  if (closed !== true) {
    throw new Error("La comparacion solo puede calcularse despues de cerrar el conteo");
  }

  const produced = normalizeNonNegativeQuantity(producedQuantity, "La produccion reportada");
  const packed = normalizeNonNegativeQuantity(packedQuantity, "La cantidad empacada");
  const damaged = normalizeNonNegativeQuantity(damagedQuantity, "La cantidad danada");
  const found = packed + damaged;
  const difference = produced - found;

  return {
    produced_quantity: produced,
    packed_quantity: packed,
    damaged_quantity: damaged,
    found_quantity: found,
    difference,
    shortage_quantity: Math.max(difference, 0),
    surplus_quantity: Math.max(-difference, 0),
    reconciliation_status: difference > 0 ? "shortage" : difference < 0 ? "surplus" : "matched",
  };
};

module.exports = {
  PRODUCTION_RECORD_TYPES,
  PRODUCTION_RECORD_POLICIES,
  INFORMATIONAL_PLAN_STATES,
  LEGACY_INFORMATIONAL_PLAN_STATE_ALIASES,
  BAKER_REPORT_STATES,
  PROTECTED_BAKER_QUANTITY_FIELDS,
  sanitizePackagingBatchForIndependentCount,
  normalizeInformationalPlanStatus,
  calculateClosedCountComparison,
};
