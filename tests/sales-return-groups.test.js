const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReturnableCommercialGroups, allocateReturnQuantity } = require("../domain/sales-return-groups");

test("une venta y vendaje del mismo grupo comercial", () => {
  const groups = buildReturnableCommercialGroups([
    { order_item_id: 11, order_id: 1, product_id: 9, product_name: "PAN BOLA 3000", line_group_key: "line-a", line_type: "sale", commercial_mode: "sale_bonus", returnable_quantity: 3 },
    { order_item_id: 12, order_id: 1, product_id: 9, product_name: "PAN BOLA 3000", line_group_key: "line-a", line_type: "bonus", commercial_mode: "sale_bonus", returnable_quantity: 1 },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].commercial_label, "Venta + vendaje");
  assert.equal(groups[0].commercial_detail, "Venta: 3 + Vendaje: 1");
  assert.equal(groups[0].returnable_quantity, 4);
  assert.deepEqual(groups[0].source_items.map((item) => item.order_item_id), [11, 12]);
});

test("distribuye primero venta y luego vendaje sin exceder disponibles", () => {
  const result = allocateReturnQuantity([
    { order_item_id: 11, line_type: "sale", returnable_quantity: 3 },
    { order_item_id: 12, line_type: "bonus", returnable_quantity: 1 },
  ], 4);
  assert.deepEqual(result.allocations, [
    { order_item_id: 11, quantity: 3 },
    { order_item_id: 12, quantity: 1 },
  ]);
  assert.equal(result.pending, 0);
});

test("no une lineas independientes aunque tengan el mismo producto", () => {
  const groups = buildReturnableCommercialGroups([
    { order_item_id: 21, order_id: 1, product_id: 9, line_group_key: "line-b", line_type: "sale", commercial_mode: "sale", returnable_quantity: 2 },
    { order_item_id: 22, order_id: 1, product_id: 9, line_group_key: "line-c", line_type: "sale", commercial_mode: "sale", returnable_quantity: 1 },
  ]);
  assert.equal(groups.length, 2);
});
