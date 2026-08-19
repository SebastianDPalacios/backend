const LINE_TYPES = Object.freeze(["sale", "bonus", "gift", "exchange"]);
const CAPTURE_MODES = Object.freeze(["quantity", "amount"]);
const EDITABLE_ORDER_STATUSES = Object.freeze(["draft", "confirmed", "ready", "dispatched", "delivered"]);

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const roundQuantity = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;

const normalizeLineType = (value) => {
  const normalized = String(value || "sale").trim().toLowerCase();
  return LINE_TYPES.includes(normalized) ? normalized : null;
};

const normalizeCaptureMode = (value) => {
  const normalized = String(value || "quantity").trim().toLowerCase();
  return CAPTURE_MODES.includes(normalized) ? normalized : null;
};

const calculateOrderLine = ({
  unit,
  unitPrice,
  taxPercent,
  lineType,
  captureMode,
  requestedAmount,
  quantity,
}) => {
  const price = Number(unitPrice || 0);
  const taxRate = Number(taxPercent || 0);
  const type = normalizeLineType(lineType);
  const mode = normalizeCaptureMode(captureMode);

  if (!type) {
    throw new Error("selecciona un tipo valido: venta, vendaje, obsequio o cambio");
  }
  if (!mode) {
    throw new Error("selecciona captura por valor o por cantidad");
  }
  if (price <= 0) {
    throw new Error("el producto debe tener un precio mayor que 0");
  }

  let calculatedQuantity;
  let normalizedRequestedAmount = null;

  if (mode === "amount") {
    normalizedRequestedAmount = roundMoney(requestedAmount);
    if (normalizedRequestedAmount <= 0) {
      throw new Error("el valor solicitado debe ser mayor que 0");
    }

    const rawQuantity = normalizedRequestedAmount / price;
    calculatedQuantity = unit === "unit"
      ? Math.floor(rawQuantity)
      : Math.floor(rawQuantity * 1000) / 1000;

    if (calculatedQuantity <= 0) {
      throw new Error(`el valor solicitado no alcanza para una unidad de este producto`);
    }
  } else {
    calculatedQuantity = roundQuantity(quantity);
    if (calculatedQuantity <= 0) {
      throw new Error("la cantidad debe ser mayor que 0");
    }
    if (unit === "unit" && !Number.isInteger(calculatedQuantity)) {
      throw new Error("los productos por unidad no permiten cantidades fraccionadas");
    }
  }

  const lineSubtotalReference = roundMoney(calculatedQuantity * price);
  const lineTaxReference = roundMoney(lineSubtotalReference * (taxRate / 100));
  const calculatedCommercialValue = roundMoney(lineSubtotalReference + lineTaxReference);
  const usesRequestedValue = mode === "amount" && ["sale", "exchange"].includes(type);
  const commercialValue = usesRequestedValue ? normalizedRequestedAmount : calculatedCommercialValue;
  const isCharged = type === "sale";
  const chargedSubtotal = usesRequestedValue && isCharged
    ? roundMoney(commercialValue / (1 + taxRate / 100))
    : lineSubtotalReference;
  const chargedTax = usesRequestedValue && isCharged
    ? roundMoney(commercialValue - chargedSubtotal)
    : lineTaxReference;

  return {
    lineType: type,
    captureMode: mode,
    requestedAmount: normalizedRequestedAmount,
    quantity: calculatedQuantity,
    unitPrice: roundMoney(price),
    taxPercent: roundMoney(taxRate),
    lineSubtotal: isCharged ? chargedSubtotal : 0,
    lineTax: isCharged ? chargedTax : 0,
    lineTotal: isCharged ? commercialValue : 0,
    commercialValue,
  };
};

const calculateOrderTotals = (items) => {
  return items.reduce(
    (totals, item) => {
      const type = normalizeLineType(item.line_type) || "sale";
      const commercialValue = Number(item.commercial_value || item.line_total || 0);

      totals.subtotal += Number(item.line_subtotal || 0);
      totals.taxTotal += Number(item.line_tax || 0);
      totals.grandTotal += Number(item.line_total || 0);

      if (type === "bonus") totals.bonusTotal += commercialValue;
      if (type === "gift") totals.giftTotal += commercialValue;
      if (type === "exchange") totals.exchangeTotal += commercialValue;

      return totals;
    },
    {
      subtotal: 0,
      taxTotal: 0,
      grandTotal: 0,
      bonusTotal: 0,
      giftTotal: 0,
      exchangeTotal: 0,
    }
  );
};

const validateBonusAllowance = ({
  grandTotal,
  bonusTotal,
  bonusPercent,
  bonusMinimumAmount,
  bonusMaxCompanyLossAmount = 0,
  bonusLineCount = 0,
}) => {
  const chargedTotal = roundMoney(grandTotal);
  const appliedBonus = roundMoney(bonusTotal);
  const minimum = roundMoney(bonusMinimumAmount);
  const allowedBonus = chargedTotal >= minimum
    ? roundMoney(chargedTotal * (Number(bonusPercent || 0) / 100)
        + Number(bonusMaxCompanyLossAmount || 0) * Number(bonusLineCount || 0))
    : 0;

  if (appliedBonus > allowedBonus) {
    if (chargedTotal < minimum) {
      throw new Error(`el vendaje aplica desde compras de $${minimum.toLocaleString("es-CO")}`);
    }
    throw new Error(
      `el vendaje supera el maximo permitido de $${allowedBonus.toLocaleString("es-CO")}`
    );
  }

  return { allowedBonus };
};

const calculateDeliveredCommission = ({
  deliveredSalesTotal,
  returnedSalesTotal = 0,
  commissionPercent,
}) => {
  const delivered = roundMoney(deliveredSalesTotal);
  const returned = roundMoney(returnedSalesTotal);
  const percent = roundMoney(commissionPercent);

  if (delivered < 0 || returned < 0) {
    throw new Error("los valores entregados y devueltos no pueden ser negativos");
  }
  if (returned > delivered) {
    throw new Error("las devoluciones no pueden superar las ventas entregadas");
  }
  if (percent < 0 || percent > 100) {
    throw new Error("el porcentaje de comision debe estar entre 0 y 100");
  }

  const commissionBase = roundMoney(delivered - returned);
  return {
    deliveredSalesTotal: delivered,
    returnedSalesTotal: returned,
    commissionBase,
    commissionAmount: roundMoney(commissionBase * (percent / 100)),
  };
};

module.exports = {
  CAPTURE_MODES,
  EDITABLE_ORDER_STATUSES,
  LINE_TYPES,
  calculateDeliveredCommission,
  calculateOrderLine,
  calculateOrderTotals,
  normalizeCaptureMode,
  normalizeLineType,
  roundMoney,
  validateBonusAllowance,
};
