const QUANTITY_SCALE = 1000;

const toInventoryPrecision = (value) => Math.round(Number(value) * QUANTITY_SCALE) / QUANTITY_SCALE;

const normalizeRawMaterialEntryQuantity = (value) => {
  const originalQuantity = toInventoryPrecision(value);
  if (!Number.isFinite(originalQuantity) || originalQuantity <= 0) {
    throw new TypeError("La cantidad de materia prima debe ser mayor que cero");
  }

  const whole = Math.trunc(originalQuantity);
  const decimalPart = toInventoryPrecision(originalQuantity - whole);
  const normalizedQuantity = decimalPart > 0.5 ? whole + 1 : originalQuantity;

  return {
    originalQuantity,
    normalizedQuantity: toInventoryPrecision(normalizedQuantity),
    wasRounded: normalizedQuantity !== originalQuantity,
  };
};

module.exports = { normalizeRawMaterialEntryQuantity };
