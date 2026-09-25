const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PRICE_SOURCES,
  PRICE_STATES,
  resolveWholesalePrice,
} = require("../domain/wholesale-pricing");
const { calculateOrderLine } = require("../domain/sales-rules");

const baseInput = {
  customerIsWholesale: true,
  regularPrice: 1800,
  effectiveDate: "2026-09-24",
  generalWholesalePrice: { id: 10, price: 1600, active: true },
  customerSpecialPrice: { id: 20, price: 1550, active: true },
};

test("el precio especial del cliente tiene prioridad sobre el mayorista general", () => {
  const result = resolveWholesalePrice(baseInput);

  assert.equal(result.appliedUnitPrice, 1550);
  assert.equal(result.priceSource, PRICE_SOURCES.CUSTOMER_SPECIAL);
  assert.equal(result.priceConfigurationId, 20);
});

test("usa el precio mayorista general cuando no existe uno especial vigente", () => {
  const result = resolveWholesalePrice({ ...baseInput, customerSpecialPrice: null });

  assert.equal(result.appliedUnitPrice, 1600);
  assert.equal(result.priceSource, PRICE_SOURCES.WHOLESALE_GENERAL);
  assert.equal(result.priceConfigurationId, 10);
});

test("usa el precio regular cuando no existe configuración mayorista", () => {
  const result = resolveWholesalePrice({
    ...baseInput,
    customerSpecialPrice: null,
    generalWholesalePrice: null,
  });

  assert.equal(result.appliedUnitPrice, 1800);
  assert.equal(result.priceSource, PRICE_SOURCES.REGULAR);
  assert.equal(result.priceConfigurationId, null);
});

test("un cliente normal siempre recibe el precio regular", () => {
  const result = resolveWholesalePrice({ ...baseInput, customerIsWholesale: false });

  assert.equal(result.appliedUnitPrice, 1800);
  assert.equal(result.priceSource, PRICE_SOURCES.REGULAR);
});

test("ignora precios inactivos, programados o vencidos respetando el fallback", () => {
  const inactive = resolveWholesalePrice({
    ...baseInput,
    customerSpecialPrice: { id: 20, price: 1550, active: false },
  });
  assert.equal(inactive.evaluations.customerSpecial.state, PRICE_STATES.INACTIVE);
  assert.equal(inactive.priceSource, PRICE_SOURCES.WHOLESALE_GENERAL);

  const scheduled = resolveWholesalePrice({
    ...baseInput,
    customerSpecialPrice: { id: 20, price: 1550, validFrom: "2026-10-01" },
  });
  assert.equal(scheduled.evaluations.customerSpecial.state, PRICE_STATES.SCHEDULED);
  assert.equal(scheduled.priceSource, PRICE_SOURCES.WHOLESALE_GENERAL);

  const expired = resolveWholesalePrice({
    ...baseInput,
    customerSpecialPrice: { id: 20, price: 1550, validTo: "2026-09-23" },
  });
  assert.equal(expired.evaluations.customerSpecial.state, PRICE_STATES.EXPIRED);
  assert.equal(expired.priceSource, PRICE_SOURCES.WHOLESALE_GENERAL);
});

test("la fotografía resuelta no cambia cuando luego cambia la configuración", () => {
  const customerPrice = { id: 20, price: 1550, active: true };
  const snapshot = resolveWholesalePrice({ ...baseInput, customerSpecialPrice: customerPrice });

  customerPrice.price = 1400;

  assert.equal(snapshot.appliedUnitPrice, 1550);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.evaluations), true);
});

test("rechaza precios vigentes no positivos y rangos inválidos", () => {
  assert.throws(
    () => resolveWholesalePrice({ ...baseInput, regularPrice: 0 }),
    /precio regular debe ser mayor que 0/
  );
  assert.throws(
    () => resolveWholesalePrice({ ...baseInput, customerSpecialPrice: { price: -1 } }),
    /precio configurado debe ser mayor que 0/
  );
  assert.throws(
    () => resolveWholesalePrice({
      ...baseInput,
      customerSpecialPrice: { price: 1500, validFrom: "2026-10-02", validTo: "2026-10-01" },
    }),
    /fecha inicial.*posterior/
  );
});

test("Venta más vendaje conserva la fórmula actual usando el precio recibido", () => {
  const price = resolveWholesalePrice({
    customerIsWholesale: true,
    regularPrice: 3200,
    generalWholesalePrice: { id: 10, price: 3000 },
    effectiveDate: "2026-09-24",
  });
  const line = calculateOrderLine({
    unit: "unit",
    unitPrice: price.appliedUnitPrice,
    taxPercent: 0,
    lineType: "sale",
    captureMode: "amount",
    requestedAmount: 2500,
    saleBonusPercent: 20,
  });

  assert.equal((2500 + 2500 * 0.20) / price.appliedUnitPrice, 1);
  assert.equal(line.quantity, 1);
  assert.equal(line.unitPrice, 3000);
});

test("rechaza precios mayoristas con decimales", () => {
  assert.throws(
    () => resolveWholesalePrice({ ...baseInput, customerSpecialPrice: { price: 1550.5 } }),
    /no puede tener decimales/
  );
  assert.throws(
    () => resolveWholesalePrice({ ...baseInput, regularPrice: 1800.25 }),
    /no puede tener decimales/
  );
});
