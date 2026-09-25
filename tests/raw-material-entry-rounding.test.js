const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeRawMaterialEntryQuantity } = require("../domain/raw-material-entry-rounding");

test("conserva cantidades cuya fraccion es menor o igual a 0.50", () => {
  assert.deepEqual(normalizeRawMaterialEntryQuantity(1.49), {
    originalQuantity: 1.49,
    normalizedQuantity: 1.49,
    wasRounded: false,
  });
  assert.equal(normalizeRawMaterialEntryQuantity(1.5).normalizedQuantity, 1.5);
  assert.equal(normalizeRawMaterialEntryQuantity(2.5).normalizedQuantity, 2.5);
});

test("sube al entero siguiente cuando la fraccion supera 0.50", () => {
  assert.equal(normalizeRawMaterialEntryQuantity(1.501).normalizedQuantity, 2);
  assert.equal(normalizeRawMaterialEntryQuantity(1.51).normalizedQuantity, 2);
  assert.equal(normalizeRawMaterialEntryQuantity(2.99).normalizedQuantity, 3);
});

test("conserva enteros y rechaza cantidades invalidas", () => {
  assert.equal(normalizeRawMaterialEntryQuantity(3).normalizedQuantity, 3);
  assert.throws(() => normalizeRawMaterialEntryQuantity(0), /mayor que cero/);
  assert.throws(() => normalizeRawMaterialEntryQuantity("no-numero"), /mayor que cero/);
});
