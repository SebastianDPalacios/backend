const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateOrderLine, calculateSaleBonus, calculateSaleBonusOrder } = require("../domain/sales-rules");

const calculateCase = (paidValue) => {
  const sale = calculateOrderLine({
    unit: "unit",
    unitPrice: 3000,
    taxPercent: 0,
    lineType: "sale",
    captureMode: "amount",
    requestedAmount: paidValue,
    requireWholeUnitAmount: false,
    saleBonusPercent: 20,
  });
  const bonus = calculateSaleBonus({
    unit: "unit",
    unitPrice: 3000,
    paidValue,
    saleQuantity: sale.quantity,
    bonusPercent: 20,
    maxCompanyLoss: 1500,
  });
  return { saleQuantity: sale.quantity, bonusQuantity: bonus.bonusQuantity };
};

test("Venta + vendaje de $2.500 para producto de $3.000", () => {
  assert.deepEqual(calculateCase(2500), { saleQuantity: 1, bonusQuantity: 0 });
});

test("Venta + vendaje de $5.000 para producto de $3.000", () => {
  assert.deepEqual(calculateCase(5000), { saleQuantity: 1, bonusQuantity: 1 });
});

test("Venta + vendaje de $10.000 para producto de $3.000", () => {
  assert.deepEqual(calculateCase(10000), { saleQuantity: 3, bonusQuantity: 1 });
});

test("bloquea $3.000 porque con el 20% produce 1,2 unidades", () => {
  assert.throws(() => calculateCase(3000), /debe producir unidades completas/);
});

test("aplica el margen de redondeo una sola vez al conjunto del pedido", () => {
  const result = calculateSaleBonusOrder({
    lines: [
      { key: "a", unit: "unit", unitPrice: 3000, paidValue: 4000, saleQuantity: 1 },
      { key: "b", unit: "unit", unitPrice: 3000, paidValue: 4000, saleQuantity: 1 },
    ],
    bonusPercent: 20,
    maxCompanyLoss: 1500,
  });
  assert.deepEqual(result.allocations.map((line) => line.bonusQuantity), [1, 0]);
  assert.equal(result.marginUsed, 1200);
});

test("acepta exactamente el límite del margen para completar la unidad total", () => {
  const result = calculateSaleBonusOrder({
    lines: [{ unit: "unit", unitPrice: 3000, paidValue: 3750, saleQuantity: 1 }],
    bonusPercent: 20,
    maxCompanyLoss: 1500,
  });
  assert.equal(result.allocations[0].bonusQuantity, 1);
  assert.equal(result.marginUsed, 1500);
});

test("no redondea hacia arriba cuando la diferencia supera el margen", () => {
  const result = calculateSaleBonusOrder({
    lines: [{ unit: "unit", unitPrice: 3000, paidValue: 3749.99, saleQuantity: 1 }],
    bonusPercent: 20,
    maxCompanyLoss: 1500,
  });
  assert.equal(result.allocations[0].bonusQuantity, 0);
  assert.equal(result.marginUsed, 0);
});

test("valida la cantidad total sin exigir que el valor facturado sea múltiplo del precio", () => {
  const sale = calculateOrderLine({
    unit: "unit",
    unitPrice: 3000,
    lineType: "sale",
    captureMode: "amount",
    requestedAmount: 2500,
    saleBonusPercent: 20,
  });
  const result = calculateSaleBonusOrder({
    lines: [{ unit: "unit", unitPrice: 3000, paidValue: 2500, saleQuantity: sale.quantity }],
    bonusPercent: 20,
    maxCompanyLoss: 1500,
  });
  assert.equal(sale.quantity, 1);
  assert.equal(result.generatedBonusValue, 500);
  assert.equal(result.physicalBonusValue, 0);
  assert.equal(result.marginUsed, 0);
});
