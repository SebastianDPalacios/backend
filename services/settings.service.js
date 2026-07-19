const boom = require("@hapi/boom");
const { connect } = require("../data-access");

const ORDER_RECEIPT_KEY = "order_receipt";

const defaultOrderReceiptSettings = {
  businessName: "PANADERIA",
  businessSubtitle: "",
  logoDataUrl: "",
  showLogo: false,
  showBranchName: true,
  showBranchContact: true,
  showSeller: true,
  showDeliveryDate: true,
  customerTitle: "CLIENTE",
  showCustomerName: true,
  showCustomerIdentification: true,
  showCustomerAddress: true,
  showCustomerNeighborhood: true,
  showCustomerPhone: true,
  customerIdentificationLabel: "Identificacion",
  customerAddressLabel: "Direccion",
  customerNeighborhoodLabel: "Barrio/Zona",
  customerPhoneLabel: "Tel",
  detailTitle: "DETALLE SOLICITADO",
  policyTitle: "POLITICA DE CAMBIOS",
  policyText:
    "Se realizan cambios por producto vencido, con moho, mojado o mal moldeado. La vigencia es de 15 dias desde la entrega. El inconveniente debe reportarse como maximo dentro de los 2 dias siguientes al vencimiento y requiere autorizacion del vendedor.",
  footerText: "Gracias por su compra",
  fontScale: "normal",
  bodyFontSize: 12,
  headerFontSize: 24,
  customerFontSize: 20,
  customerContactFontSize: 16,
  customerIdentificationFontSize: 13,
  customerAddressFontSize: 16,
  customerNeighborhoodFontSize: 15,
  customerPhoneFontSize: 16,
  productFontSize: 13,
  quantityFontSize: 20,
  totalFontSize: 17,
  showExtraLegend: false,
  extraLegendTitle: "LEYENDA ADICIONAL",
  extraLegendText: "",
};

const parseSettings = (value) => {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
};

const trimText = (value, maxLength, fallback = "") => {
  const text = String(value ?? "").trim();
  return text.slice(0, maxLength) || fallback;
};

const toBoolean = (value, fallback) => {
  if (value === true || value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (value === false || value === 0 || value === "0" || value === "false") {
    return false;
  }
  return fallback;
};

const numberBetween = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
};

const sanitizeLogo = (value) => {
  const logo = String(value ?? "").trim();
  if (!logo) {
    return "";
  }

  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(logo)) {
    throw boom.badRequest("el logo debe ser una imagen png, jpg o webp");
  }

  if (logo.length > 1500000) {
    throw boom.badRequest("el logo no puede superar 1.5 MB");
  }

  return logo;
};

const sanitizeOrderReceiptSettings = (payload = {}) => {
  const fontScale = ["normal", "large", "extra_large"].includes(payload.fontScale)
    ? payload.fontScale
    : defaultOrderReceiptSettings.fontScale;

  return {
    businessName: trimText(payload.businessName, 80, defaultOrderReceiptSettings.businessName),
    businessSubtitle: trimText(payload.businessSubtitle, 140),
    logoDataUrl: sanitizeLogo(payload.logoDataUrl),
    showLogo: toBoolean(payload.showLogo, defaultOrderReceiptSettings.showLogo),
    showBranchName: toBoolean(payload.showBranchName, defaultOrderReceiptSettings.showBranchName),
    showBranchContact: toBoolean(payload.showBranchContact, defaultOrderReceiptSettings.showBranchContact),
    showSeller: toBoolean(payload.showSeller, defaultOrderReceiptSettings.showSeller),
    showDeliveryDate: toBoolean(payload.showDeliveryDate, defaultOrderReceiptSettings.showDeliveryDate),
    customerTitle: trimText(payload.customerTitle, 60, defaultOrderReceiptSettings.customerTitle),
    showCustomerName: toBoolean(payload.showCustomerName, defaultOrderReceiptSettings.showCustomerName),
    showCustomerIdentification: toBoolean(payload.showCustomerIdentification, defaultOrderReceiptSettings.showCustomerIdentification),
    showCustomerAddress: toBoolean(payload.showCustomerAddress, defaultOrderReceiptSettings.showCustomerAddress),
    showCustomerNeighborhood: toBoolean(payload.showCustomerNeighborhood, defaultOrderReceiptSettings.showCustomerNeighborhood),
    showCustomerPhone: toBoolean(payload.showCustomerPhone, defaultOrderReceiptSettings.showCustomerPhone),
    customerIdentificationLabel: trimText(payload.customerIdentificationLabel, 40, defaultOrderReceiptSettings.customerIdentificationLabel),
    customerAddressLabel: trimText(payload.customerAddressLabel, 40, defaultOrderReceiptSettings.customerAddressLabel),
    customerNeighborhoodLabel: trimText(payload.customerNeighborhoodLabel, 40, defaultOrderReceiptSettings.customerNeighborhoodLabel),
    customerPhoneLabel: trimText(payload.customerPhoneLabel, 40, defaultOrderReceiptSettings.customerPhoneLabel),
    detailTitle: trimText(payload.detailTitle, 80, defaultOrderReceiptSettings.detailTitle),
    policyTitle: trimText(payload.policyTitle, 80, defaultOrderReceiptSettings.policyTitle),
    policyText: trimText(payload.policyText, 900, defaultOrderReceiptSettings.policyText),
    footerText: trimText(payload.footerText, 160, defaultOrderReceiptSettings.footerText),
    fontScale,
    bodyFontSize: numberBetween(payload.bodyFontSize, defaultOrderReceiptSettings.bodyFontSize, 10, 18),
    headerFontSize: numberBetween(payload.headerFontSize, defaultOrderReceiptSettings.headerFontSize, 18, 34),
    customerFontSize: numberBetween(payload.customerFontSize, defaultOrderReceiptSettings.customerFontSize, 16, 30),
    customerContactFontSize: numberBetween(payload.customerContactFontSize, defaultOrderReceiptSettings.customerContactFontSize, 12, 24),
    customerIdentificationFontSize: numberBetween(payload.customerIdentificationFontSize, defaultOrderReceiptSettings.customerIdentificationFontSize, 10, 24),
    customerAddressFontSize: numberBetween(payload.customerAddressFontSize, defaultOrderReceiptSettings.customerAddressFontSize, 12, 28),
    customerNeighborhoodFontSize: numberBetween(payload.customerNeighborhoodFontSize, defaultOrderReceiptSettings.customerNeighborhoodFontSize, 12, 26),
    customerPhoneFontSize: numberBetween(payload.customerPhoneFontSize, defaultOrderReceiptSettings.customerPhoneFontSize, 12, 28),
    productFontSize: numberBetween(payload.productFontSize, defaultOrderReceiptSettings.productFontSize, 11, 22),
    quantityFontSize: numberBetween(payload.quantityFontSize, defaultOrderReceiptSettings.quantityFontSize, 16, 34),
    totalFontSize: numberBetween(payload.totalFontSize, defaultOrderReceiptSettings.totalFontSize, 15, 30),
    showExtraLegend: toBoolean(payload.showExtraLegend, defaultOrderReceiptSettings.showExtraLegend),
    extraLegendTitle: trimText(payload.extraLegendTitle, 80, defaultOrderReceiptSettings.extraLegendTitle),
    extraLegendText: trimText(payload.extraLegendText, 900),
  };
};

const getPosTicketSettings = async () => {
  const db = await connect();
  const [rows] = await db.query(
    `SELECT setting_value_json
       FROM pos_ticket_settings
      WHERE setting_key = ?
      LIMIT 1`,
    [ORDER_RECEIPT_KEY]
  );

  const settings = rows.length ? parseSettings(rows[0].setting_value_json) : {};
  return {
    code: 1,
    message: "configuracion de ticket POS",
    data: {
      ...defaultOrderReceiptSettings,
      ...settings,
    },
  };
};

const updatePosTicketSettings = async (payload, actorUserId) => {
  const db = await connect();
  const settings = sanitizeOrderReceiptSettings(payload);

  await db.query(
    `INSERT INTO pos_ticket_settings (setting_key, setting_value_json, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       setting_value_json = VALUES(setting_value_json),
       updated_by = VALUES(updated_by),
       updated_at = CURRENT_TIMESTAMP`,
    [ORDER_RECEIPT_KEY, JSON.stringify(settings), actorUserId || null]
  );

  return {
    code: 1,
    message: "ticket POS actualizado",
    data: settings,
  };
};

module.exports = {
  defaultOrderReceiptSettings,
  getPosTicketSettings,
  updatePosTicketSettings,
};

