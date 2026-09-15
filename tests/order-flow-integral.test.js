const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateDeliveredCommission,
  calculateOrderLine,
  calculateOrderTotals,
  calculateSaleBonus,
  calculateSaleBonusOrder,
  validateBonusAllowance,
} = require("../domain/sales-rules");
const {
  buildRuleBoundAssociation,
  calculateRuleBoundBonusTotal,
  calculateRuleBoundSaleTotal,
} = require("../domain/order-bonus-association");

const product = { unit: "unit", unitPrice: 3000, taxPercent: 0 };

test("venta normal por cantidad cobra todas las unidades sin vendaje", () => {
  const line = calculateOrderLine({
    ...product,
    lineType: "sale",
    captureMode: "quantity",
    quantity: 3,
  });

  assert.equal(line.quantity, 3);
  assert.equal(line.lineTotal, 9000);
  assert.equal(line.commercialValue, 9000);
});

test("venta y solo vendaje por valor exigen unidades completas de forma independiente", () => {
  for (const lineType of ["sale", "bonus"]) {
    assert.throws(() => calculateOrderLine({
      ...product,
      lineType,
      captureMode: "amount",
      requestedAmount: 1500,
      requireWholeUnitAmount: true,
    }), /debe ser multiplo/);

    const completeUnit = calculateOrderLine({
      ...product,
      lineType,
      captureMode: "amount",
      requestedAmount: 3000,
      requireWholeUnitAmount: true,
    });
    assert.equal(completeUnit.quantity, 1);
  }
});

test("venta + vendaje conserva los resultados oficiales de 2.500, 5.000 y 10.000", () => {
  const cases = [
    { paidValue: 2500, expectedSale: 1, expectedBonus: 0, margin: 0 },
    { paidValue: 5000, expectedSale: 1, expectedBonus: 1, margin: 0 },
    { paidValue: 10000, expectedSale: 3, expectedBonus: 1, margin: 0 },
  ];

  for (const current of cases) {
    const sale = calculateOrderLine({
      ...product,
      lineType: "sale",
      captureMode: "amount",
      requestedAmount: current.paidValue,
      saleBonusPercent: 20,
    });
    const bonus = calculateSaleBonus({
      ...product,
      paidValue: current.paidValue,
      saleQuantity: sale.quantity,
      bonusPercent: 20,
      maxCompanyLoss: current.margin,
      enabled: true,
    });

    assert.equal(sale.quantity, current.expectedSale);
    assert.equal(bonus.bonusQuantity, current.expectedBonus);
  }
});

test("venta + vendaje bloquea $3.000 cuando la formula produce 1,2 unidades", () => {
  assert.throws(() => calculateOrderLine({
    ...product,
    lineType: "sale",
    captureMode: "amount",
    requestedAmount: 3000,
    saleBonusPercent: 20,
  }), /debe producir unidades completas/);
});

test("el margen se usa solo para completar la unidad y una vez en el pedido", () => {
  const result = calculateSaleBonusOrder({
    lines: [
      { ...product, paidValue: 4000, saleQuantity: 1 },
      { ...product, paidValue: 4000, saleQuantity: 1 },
    ],
    bonusPercent: 20,
    maxCompanyLoss: 1500,
    enabled: true,
  });

  assert.equal(result.marginUsed, 1200);
  assert.equal(result.allocations[0].bonusQuantity, 1);
  assert.equal(result.allocations[1].bonusQuantity, 0);
});

test("solo vendaje, obsequio y cambio no incrementan el total a cobrar", () => {
  const lines = ["bonus", "gift", "exchange"].map((lineType) => calculateOrderLine({
    ...product,
    lineType,
    captureMode: "quantity",
    quantity: 1,
  }));
  const totals = calculateOrderTotals(lines.map((line) => ({
    line_type: line.lineType,
    line_subtotal: line.lineSubtotal,
    line_tax: line.lineTax,
    line_total: line.lineTotal,
    commercial_value: line.commercialValue,
  })));

  assert.equal(totals.grandTotal, 0);
  assert.equal(totals.bonusTotal, 3000);
  assert.equal(totals.giftTotal, 3000);
  assert.equal(totals.exchangeTotal, 3000);
});

test("dos lineas del mismo producto mantienen independientes venta + vendaje y solo vendaje", () => {
  const saleBonusSale = {
    product_id: 15,
    line_type: "sale",
    line_group_key: "grupo-a",
    line_total: 5000,
    quantity: 1,
    unit_price: 3000,
  };
  const pairedBonus = {
    product_id: 15,
    line_type: "bonus",
    line_group_key: "grupo-a",
    commercial_value: 3000,
  };
  const standaloneBonus = {
    product_id: 15,
    line_type: "bonus",
    line_group_key: "grupo-b",
    commercial_value: 3000,
  };
  const normalSale = {
    product_id: 15,
    line_type: "sale",
    line_group_key: "grupo-c",
    line_total: 3000,
  };
  const items = [saleBonusSale, pairedBonus, standaloneBonus, normalSale];
  const association = buildRuleBoundAssociation(items);

  assert.equal(association.associatedSales.size, 1);
  assert.equal(association.associatedBonuses.size, 1);
  assert.equal(calculateRuleBoundSaleTotal(items), 5000);
  assert.equal(calculateRuleBoundBonusTotal(items), 3000);
});

test("la validacion posterior acepta exactamente el vendaje asociado y rechaza exceso", () => {
  assert.deepEqual(validateBonusAllowance({
    grandTotal: 5000,
    bonusBaseTotal: 5000,
    saleFulfillmentTotal: 3000,
    bonusTotal: 3000,
    bonusPercent: 20,
    bonusMinimumAmount: 2000,
    bonusMaxCompanyLossAmount: 0,
  }), { allowedBonus: 3000 });

  assert.throws(() => validateBonusAllowance({
    grandTotal: 5000,
    bonusBaseTotal: 5000,
    saleFulfillmentTotal: 3000,
    bonusTotal: 3000.01,
    bonusPercent: 20,
    bonusMinimumAmount: 2000,
    bonusMaxCompanyLossAmount: 0,
  }), /supera el maximo permitido/);
});

test("una devolucion reduce la base y la comision entregada", () => {
  assert.deepEqual(calculateDeliveredCommission({
    deliveredSalesTotal: 10000,
    returnedSalesTotal: 3000,
    commissionPercent: 15,
  }), {
    deliveredSalesTotal: 10000,
    returnedSalesTotal: 3000,
    commissionBase: 7000,
    commissionAmount: 1050,
  });
});
