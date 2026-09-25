const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { calculateOrderLine, calculateSaleBonus } = require("../domain/sales-rules");
const { resolveWholesalePrice } = require("../domain/wholesale-pricing");

const ordersServiceSource = fs.readFileSync(path.join(__dirname, "../services/orders.service.js"), "utf8");
const auditMigrationSource = fs.readFileSync(path.join(__dirname, "../database/091_order_item_sale_bonus_audit.sql"), "utf8");

const legacyFormula = ({ invoicedValue, bonusPercent, productPrice }) => (
  (invoicedValue + invoicedValue * (bonusPercent / 100)) / productPrice
);

const calculateProtectedCase = ({
  customerIsWholesale,
  regularPrice,
  generalWholesalePrice = null,
  customerSpecialPrice = null,
  invoicedValue,
  bonusPercent = 20,
}) => {
  const price = resolveWholesalePrice({
    customerIsWholesale,
    regularPrice,
    generalWholesalePrice,
    customerSpecialPrice,
    effectiveDate: "2026-09-24",
  });
  const sale = calculateOrderLine({
    unit: "unit",
    unitPrice: price.appliedUnitPrice,
    taxPercent: 0,
    lineType: "sale",
    captureMode: "amount",
    requestedAmount: invoicedValue,
    saleBonusPercent: bonusPercent,
  });
  const bonus = calculateSaleBonus({
    unit: "unit",
    unitPrice: price.appliedUnitPrice,
    taxPercent: 0,
    paidValue: sale.lineTotal,
    saleQuantity: sale.quantity,
    bonusPercent,
    maxCompanyLoss: 0,
    enabled: true,
  });
  return { price, sale, bonus };
};

test("el resultado protegido coincide exactamente con la fórmula anterior", () => {
  const current = calculateProtectedCase({
    customerIsWholesale: false,
    regularPrice: 3000,
    invoicedValue: 5000,
  });
  const previousResult = legacyFormula({ invoicedValue: 5000, bonusPercent: 20, productPrice: 3000 });

  assert.equal(current.bonus.formulaResultQuantity, previousResult);
  assert.equal(current.bonus.invoicedValue, 5000);
  assert.equal(current.bonus.bonusPercentApplied, 20);
  assert.equal(current.bonus.allowance, 1000);
  assert.equal(current.bonus.productPriceUsed, 3000);
});

test("cliente normal usa el precio regular aplicado", () => {
  const result = calculateProtectedCase({ customerIsWholesale: false, regularPrice: 3000, invoicedValue: 5000 });
  assert.equal(result.price.priceSource, "regular");
  assert.equal(result.bonus.productPriceUsed, 3000);
  assert.equal(result.bonus.formulaResultQuantity, 2);
});

test("mayorista general usa y congela el precio mayorista aplicado", () => {
  const result = calculateProtectedCase({
    customerIsWholesale: true,
    regularPrice: 3000,
    generalWholesalePrice: { id: 10, price: 2400 },
    invoicedValue: 4000,
  });
  assert.equal(result.price.priceSource, "wholesale_general");
  assert.equal(result.bonus.productPriceUsed, 2400);
  assert.equal(result.bonus.formulaResultQuantity, 2);
});

test("mayorista con precio especial usa el precio especial aplicado", () => {
  const result = calculateProtectedCase({
    customerIsWholesale: true,
    regularPrice: 3000,
    generalWholesalePrice: { id: 10, price: 2400 },
    customerSpecialPrice: { id: 11, price: 2000 },
    invoicedValue: 5000,
  });
  assert.equal(result.price.priceSource, "customer_special");
  assert.equal(result.bonus.productPriceUsed, 2000);
  assert.equal(result.bonus.formulaResultQuantity, 3);
});

test("producto sin precio mayorista vuelve al precio regular", () => {
  const result = calculateProtectedCase({ customerIsWholesale: true, regularPrice: 3000, invoicedValue: 2500 });
  assert.equal(result.price.priceSource, "regular");
  assert.equal(result.bonus.productPriceUsed, 3000);
  assert.equal(result.bonus.formulaResultQuantity, 1);
});

test("venta sin vendaje conserva el cálculo normal y no inventa componentes", () => {
  const price = resolveWholesalePrice({ customerIsWholesale: true, regularPrice: 3000, effectiveDate: "2026-09-24" });
  const sale = calculateOrderLine({
    unit: "unit",
    unitPrice: price.appliedUnitPrice,
    taxPercent: 0,
    lineType: "sale",
    captureMode: "quantity",
    quantity: 2,
  });
  assert.equal(sale.quantity, 2);
  assert.equal(sale.lineTotal, 6000);
  assert.equal(sale.saleBonusInvoicedValue, undefined);
});

test("la venta congela y consulta todos los componentes de auditoría", () => {
  for (const column of [
    "sale_bonus_invoiced_value",
    "sale_bonus_percent_applied",
    "sale_bonus_value_applied",
    "sale_bonus_product_price_used",
    "sale_bonus_result_quantity",
  ]) {
    assert.match(auditMigrationSource, new RegExp(column));
    assert.match(ordersServiceSource, new RegExp(column));
  }
  assert.doesNotMatch(auditMigrationSource, /UPDATE\s+order_items/i);
});
