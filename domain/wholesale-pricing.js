const PRICE_SOURCES = Object.freeze({
  CUSTOMER_SPECIAL: "customer_special",
  WHOLESALE_GENERAL: "wholesale_general",
  REGULAR: "regular",
});

const PRICE_STATES = Object.freeze({
  ACTIVE: "active",
  EXPIRED: "expired",
  INACTIVE: "inactive",
  MISSING: "missing",
  SCHEDULED: "scheduled",
});

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const normalizeDate = (value, fieldName) => {
  const normalized = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldName} debe usar el formato YYYY-MM-DD`);
  }
  return normalized;
};

const normalizeRequiredPrice = (value, fieldName) => {
  const normalized = roundMoney(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} debe ser mayor que 0 y no puede tener decimales`);
  }
  return normalized;
};

const evaluatePriceConfiguration = (configuration, effectiveDate) => {
  if (!configuration) {
    return Object.freeze({ state: PRICE_STATES.MISSING, eligible: false });
  }

  const enabled = configuration.active !== false && Number(configuration.active ?? 1) !== 0;
  if (!enabled) {
    return Object.freeze({
      id: configuration.id ?? null,
      state: PRICE_STATES.INACTIVE,
      eligible: false,
    });
  }

  const validFrom = configuration.validFrom
    ? normalizeDate(configuration.validFrom, "validFrom")
    : null;
  const validTo = configuration.validTo
    ? normalizeDate(configuration.validTo, "validTo")
    : null;

  if (validFrom && validTo && validFrom > validTo) {
    throw new Error("la fecha inicial del precio no puede ser posterior a la fecha final");
  }
  if (validFrom && effectiveDate < validFrom) {
    return Object.freeze({
      id: configuration.id ?? null,
      state: PRICE_STATES.SCHEDULED,
      eligible: false,
      validFrom,
      validTo,
    });
  }
  if (validTo && effectiveDate > validTo) {
    return Object.freeze({
      id: configuration.id ?? null,
      state: PRICE_STATES.EXPIRED,
      eligible: false,
      validFrom,
      validTo,
    });
  }

  return Object.freeze({
    id: configuration.id ?? null,
    state: PRICE_STATES.ACTIVE,
    eligible: true,
    price: normalizeRequiredPrice(configuration.price, "el precio configurado"),
    validFrom,
    validTo,
  });
};

const resolveWholesalePrice = ({
  customerIsWholesale = false,
  regularPrice,
  customerSpecialPrice = null,
  generalWholesalePrice = null,
  effectiveDate,
}) => {
  const resolvedDate = normalizeDate(effectiveDate, "effectiveDate");
  const normalizedRegularPrice = normalizeRequiredPrice(regularPrice, "el precio regular");
  const specialEvaluation = evaluatePriceConfiguration(customerSpecialPrice, resolvedDate);
  const generalEvaluation = evaluatePriceConfiguration(generalWholesalePrice, resolvedDate);

  let appliedUnitPrice = normalizedRegularPrice;
  let priceSource = PRICE_SOURCES.REGULAR;
  let priceConfigurationId = null;

  if (customerIsWholesale && specialEvaluation.eligible) {
    appliedUnitPrice = specialEvaluation.price;
    priceSource = PRICE_SOURCES.CUSTOMER_SPECIAL;
    priceConfigurationId = specialEvaluation.id;
  } else if (customerIsWholesale && generalEvaluation.eligible) {
    appliedUnitPrice = generalEvaluation.price;
    priceSource = PRICE_SOURCES.WHOLESALE_GENERAL;
    priceConfigurationId = generalEvaluation.id;
  }

  return Object.freeze({
    customerIsWholesale: Boolean(customerIsWholesale),
    regularUnitPrice: normalizedRegularPrice,
    appliedUnitPrice,
    priceSource,
    priceConfigurationId,
    effectiveDate: resolvedDate,
    evaluations: Object.freeze({
      customerSpecial: specialEvaluation,
      wholesaleGeneral: generalEvaluation,
    }),
  });
};

module.exports = {
  PRICE_SOURCES,
  PRICE_STATES,
  evaluatePriceConfiguration,
  resolveWholesalePrice,
};
