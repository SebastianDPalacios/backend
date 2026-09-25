const FINISHED_PRODUCT_UNIT = "unit";

const validateFinishedProductUnit = (value) => {
  const normalized = value === undefined || value === null || value === ""
    ? FINISHED_PRODUCT_UNIT
    : String(value).trim().toLowerCase();

  return {
    valid: normalized === FINISHED_PRODUCT_UNIT,
    unit: FINISHED_PRODUCT_UNIT,
  };
};

const isWholeFinishedProductQuantity = (value, { allowZero = false } = {}) => {
  const quantity = Number(value);
  return Number.isInteger(quantity) && (allowZero ? quantity >= 0 : quantity > 0);
};

module.exports = {
  FINISHED_PRODUCT_UNIT,
  validateFinishedProductUnit,
  isWholeFinishedProductQuantity,
};
