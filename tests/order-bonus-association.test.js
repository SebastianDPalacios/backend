const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateRuleBoundBonusTotal,
  calculateRuleBoundSaleFulfillmentTotal,
  calculateRuleBoundSaleTotal,
} = require("../domain/order-bonus-association");

const totals = (items) => ({
  sale: calculateRuleBoundSaleTotal(items),
  fulfillment: calculateRuleBoundSaleFulfillmentTotal(items),
  bonus: calculateRuleBoundBonusTotal(items),
});

test("separa venta normal, Venta + vendaje y Solo vendaje del mismo producto", () => {
  const items = [
    { productId: 10, lineGroupKey: "normal", lineType: "sale", lineTotal: 3000, quantity: 1, unitPrice: 3000 },
    { productId: 10, lineGroupKey: "combo", lineType: "sale", lineTotal: 5000, quantity: 2, unitPrice: 3000 },
    { productId: 10, lineGroupKey: "combo", lineType: "bonus", commercialValue: 1000, quantity: 1, unitPrice: 3000 },
    { productId: 10, lineGroupKey: "solo", lineType: "bonus", commercialValue: 500, quantity: 1, unitPrice: 3000 },
  ];

  assert.deepEqual(totals(items), { sale: 5000, fulfillment: 6000, bonus: 1000 });
});

test("mantiene independientes varias líneas del mismo producto", () => {
  const items = [
    { productId: 10, lineGroupKey: "combo-a", lineType: "sale", lineTotal: 5000, quantity: 2, unitPrice: 3000 },
    { productId: 10, lineGroupKey: "combo-a", lineType: "bonus", commercialValue: 1000 },
    { productId: 10, lineGroupKey: "combo-b", lineType: "sale", lineTotal: 10000, quantity: 3, unitPrice: 3000 },
    { productId: 10, lineGroupKey: "combo-b", lineType: "bonus", commercialValue: 2000 },
    { productId: 10, lineGroupKey: "normal", lineType: "sale", lineTotal: 3000, quantity: 1, unitPrice: 3000 },
  ];

  assert.deepEqual(totals(items), { sale: 15000, fulfillment: 15000, bonus: 3000 });
});

test("produce el mismo resultado con campos iniciales y campos recuperados de base de datos", () => {
  const initial = [
    { productId: 4, lineGroupKey: "group-4", lineType: "sale", lineTotal: 7500, quantity: 7, unitPrice: 1000, taxPercent: 0 },
    { productId: 4, lineGroupKey: "group-4", lineType: "bonus", commercialValue: 2000 },
  ];
  const persisted = [
    { product_id: 4, line_group_key: "group-4", line_type: "sale", line_total: 7500, quantity: 7, unit_price: 1000, tax_percent: 0 },
    { product_id: 4, line_group_key: "group-4", line_type: "bonus", commercial_value: 2000 },
  ];

  assert.deepEqual(totals(initial), totals(persisted));
});

test("conserva respaldo por producto únicamente para grupos históricos legacy", () => {
  const historical = [
    { product_id: 8, line_group_key: "legacy-101", line_type: "sale", line_total: 5000, quantity: 5, unit_price: 1000 },
    { product_id: 8, line_group_key: "legacy-102", line_type: "bonus", commercial_value: 1000 },
  ];

  assert.deepEqual(totals(historical), { sale: 5000, fulfillment: 5000, bonus: 1000 });
});
