const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/orders.service.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(__dirname, "../database/084_sales_return_commission_adjustments.sql"), "utf8");
const frontendSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/orders/returns.js"), "utf8");
const authorizeSource = serviceSource.slice(serviceSource.indexOf("const authorizeSalesReturn = async"), serviceSource.indexOf("const annulSalesExchange = async"));
const annulSource = serviceSource.slice(serviceSource.indexOf("const annulSalesExchange = async"), serviceSource.indexOf("const rejectSalesReturn = async"));

test("un cambio conserva la comisión original y no genera una segunda", () => {
  assert.match(authorizeSource, /let commissionTreatment = "no_effect"/);
  assert.match(authorizeSource, /if \(salesReturn\.operation_type === "return"\)/);
  assert.doesNotMatch(authorizeSource, /INSERT INTO sales_commissions/);
  assert.match(authorizeSource, /adjustedCommissionBase = originalCommissionBase/);
  assert.match(authorizeSource, /adjustedCommissionAmount = originalCommissionAmount/);
});

test("una devolución reduce la base y la comisión", () => {
  assert.match(authorizeSource, /commissionTreatment = "reduce"/);
  assert.match(authorizeSource, /returned_sales_total = \?/);
  assert.match(authorizeSource, /commission_base = \?/);
  assert.match(authorizeSource, /commission_amount = \?/);
});

test("conserva trazabilidad antes, después y delta por operación", () => {
  for (const field of [
    "original_commission_base",
    "original_commission_amount",
    "adjusted_commission_base",
    "adjusted_commission_amount",
    "base_delta",
    "commission_delta",
  ]) assert.match(migrationSource, new RegExp(field));
  assert.match(migrationSource, /UNIQUE KEY uq_return_commission_adjustment/);
  assert.match(authorizeSource, /INSERT INTO sales_return_commission_adjustments/);
});

test("anular un cambio revierte únicamente su ajuste cero", () => {
  assert.match(annulSource, /UPDATE sales_return_commission_adjustments/);
  assert.match(annulSource, /reversed_at = CURRENT_TIMESTAMP/);
  assert.doesNotMatch(annulSource, /UPDATE sales_commissions/);
});

test("no recalcula comisiones históricas y muestra la regla claramente", () => {
  assert.doesNotMatch(migrationSource, /UPDATE sales_commissions/);
  assert.match(frontendSource, /No afecta comisión/);
  assert.match(frontendSource, /Reduce comisión/);
  assert.match(frontendSource, /Reemplaza la base comercial/);
});
