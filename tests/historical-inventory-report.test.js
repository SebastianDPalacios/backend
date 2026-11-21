const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const productionService = read("backend", "services", "production.service.js");
const monthPage = read("frontend", "src", "pages", "production", "month.js");
const monthExcel = read("frontend", "src", "components", "organisms", "production", "exportProductionMonthExcel.js");
const auditSql = read("backend", "database", "audits", "inventory_historical_coverage.sql");

const signedMovement = (movement) => (
  ["purchase_in", "production_in", "adjustment_in", "return_in"].includes(movement.type)
    ? movement.quantity
    : -movement.quantity
);

const balanceAtCutoff = (currentStock, laterMovements) => (
  currentStock - laterMovements.reduce((total, movement) => total + signedMovement(movement), 0)
);

test("reconstruye el saldo histórico reversando movimientos posteriores", () => {
  const currentStock = 100;
  const laterMovements = [
    { type: "purchase_in", quantity: 50 },
    { type: "production_out", quantity: 10 },
    { type: "return_in", quantity: 2 },
  ];

  assert.equal(balanceAtCutoff(currentStock, laterMovements), 58);
  assert.match(productionService, /current_stock_minus_later_movements/);
  assert.match(productionService, /movement_after_cutoff\.net_change/);
});

test("usa fecha operativa y conserva filtros de sucursal", () => {
  assert.match(productionService, /pb_base\.produced_date/);
  assert.match(productionService, /pb_pom\.produced_date/);
  assert.match(productionService, /correction_batch\.produced_date/);
  assert.match(productionService, /CONVERT_TZ\(im\.moved_at, '\+00:00', '-05:00'\)/);
  assert.match(productionService, /\(\? IS NULL OR im\.branch_id = \?\)/);
});

test("el Excel identifica claramente la fecha de corte del inventario", () => {
  assert.match(monthPage, /cutoff_date/);
  assert.match(monthExcel, /Existencias con corte al/);
  assert.match(monthExcel, /inventorySnapshot\.cutoff_date/);
});

test("la auditoría es de solo lectura y cubre integridad y saldos iniciales", () => {
  assert.doesNotMatch(auditSql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  assert.match(auditSql, /referencias_invalidas/);
  assert.match(auditSql, /saldo_inicial_inferido/);
  assert.match(auditSql, /movimientos_sin_fila_stock/);
});
