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
  requestedLabel: "Solicitado",
  unitLabel: "UND",
  showItemDetail: true,
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
  subtitleFontSize: 12,
  branchFontSize: 14,
  branchContactFontSize: 11,
  orderNumberFontSize: 18,
  orderDateFontSize: 12,
  deliveryDateFontSize: 12,
  sellerFontSize: 12,
  sectionTitleFontSize: 14,
  categoryFontSize: 12,
  typeFontSize: 10,
  productValueFontSize: 13,
  quantityLabelFontSize: 10,
  itemDetailFontSize: 11,
  summaryFontSize: 13,
  policyTitleFontSize: 11,
  policyTextFontSize: 10,
  footerFontSize: 11,
  showExtraLegend: false,
  extraLegendTitle: "LEYENDA ADICIONAL",
  extraLegendText: "",
  settlementPrint: {
    pageWidthMm: 80,
    pageMarginMm: 3,
    bodyWidthMm: 74,
    bodyFontSize: 10.5,
    titleFontSize: 20,
    metaFontSize: 12,
    customerFontSize: 11.5,
    mutedFontSize: 10,
    totalsFontSize: 11.5,
    deliverFontSize: 15,
    footerFontSize: 9,
    showGrossSale: true,
    showCreditApplied: true,
    showCollectedSale: true,
    showReturns: true,
    showCreditGenerated: true,
    showGifts: true,
    showCommission: true,
  },
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

  const settlementPrint = payload.settlementPrint || {};

  return {
    businessName: trimText(payload.businessName, 80, defaultOrderReceiptSettings.businessName),
    businessSubtitle: trimText(payload.businessSubtitle, 140),
    logoDataUrl: sanitizeLogo(payload.logoDataUrl),
    showLogo: toBoolean(payload.showLogo, defaultOrderReceiptSettings.showLogo),
    showBranchName: toBoolean(payload.showBranchName, defaultOrderReceiptSettings.showBranchName),
    showBranchContact: toBoolean(payload.showBranchContact, defaultOrderReceiptSettings.showBranchContact),
    showSeller: toBoolean(payload.showSeller, defaultOrderReceiptSettings.showSeller),
    showDeliveryDate: toBoolean(payload.showDeliveryDate, defaultOrderReceiptSettings.showDeliveryDate),
    showSaleTotal: toBoolean(payload.showSaleTotal, true),
    showBonusTotal: toBoolean(payload.showBonusTotal, true),
    showGiftTotal: toBoolean(payload.showGiftTotal, true),
    showExchangeTotal: toBoolean(payload.showExchangeTotal, true),
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
    requestedLabel: trimText(payload.requestedLabel, 40, defaultOrderReceiptSettings.requestedLabel),
    unitLabel: trimText(payload.unitLabel, 12, defaultOrderReceiptSettings.unitLabel),
    showItemDetail: toBoolean(payload.showItemDetail, defaultOrderReceiptSettings.showItemDetail),
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
    subtitleFontSize: numberBetween(payload.subtitleFontSize, defaultOrderReceiptSettings.subtitleFontSize, 8, 24),
    branchFontSize: numberBetween(payload.branchFontSize, defaultOrderReceiptSettings.branchFontSize, 9, 26),
    branchContactFontSize: numberBetween(payload.branchContactFontSize, defaultOrderReceiptSettings.branchContactFontSize, 8, 22),
    orderNumberFontSize: numberBetween(payload.orderNumberFontSize, defaultOrderReceiptSettings.orderNumberFontSize, 12, 32),
    orderDateFontSize: numberBetween(payload.orderDateFontSize, defaultOrderReceiptSettings.orderDateFontSize, 8, 22),
    deliveryDateFontSize: numberBetween(payload.deliveryDateFontSize, defaultOrderReceiptSettings.deliveryDateFontSize, 8, 22),
    sellerFontSize: numberBetween(payload.sellerFontSize, defaultOrderReceiptSettings.sellerFontSize, 8, 22),
    sectionTitleFontSize: numberBetween(payload.sectionTitleFontSize, defaultOrderReceiptSettings.sectionTitleFontSize, 9, 26),
    categoryFontSize: numberBetween(payload.categoryFontSize, defaultOrderReceiptSettings.categoryFontSize, 8, 22),
    typeFontSize: numberBetween(payload.typeFontSize, defaultOrderReceiptSettings.typeFontSize, 7, 18),
    productValueFontSize: numberBetween(payload.productValueFontSize, defaultOrderReceiptSettings.productValueFontSize, 9, 24),
    quantityLabelFontSize: numberBetween(payload.quantityLabelFontSize, defaultOrderReceiptSettings.quantityLabelFontSize, 7, 18),
    itemDetailFontSize: numberBetween(payload.itemDetailFontSize, defaultOrderReceiptSettings.itemDetailFontSize, 8, 20),
    summaryFontSize: numberBetween(payload.summaryFontSize, defaultOrderReceiptSettings.summaryFontSize, 9, 24),
    policyTitleFontSize: numberBetween(payload.policyTitleFontSize, defaultOrderReceiptSettings.policyTitleFontSize, 8, 22),
    policyTextFontSize: numberBetween(payload.policyTextFontSize, defaultOrderReceiptSettings.policyTextFontSize, 8, 20),
    footerFontSize: numberBetween(payload.footerFontSize, defaultOrderReceiptSettings.footerFontSize, 8, 22),
    showExtraLegend: toBoolean(payload.showExtraLegend, defaultOrderReceiptSettings.showExtraLegend),
    extraLegendTitle: trimText(payload.extraLegendTitle, 80, defaultOrderReceiptSettings.extraLegendTitle),
    extraLegendText: trimText(payload.extraLegendText, 900),
    settlementPrint: {
      pageWidthMm: numberBetween(settlementPrint.pageWidthMm, 80, 58, 120),
      pageMarginMm: numberBetween(settlementPrint.pageMarginMm, 3, 0, 10),
      bodyWidthMm: numberBetween(settlementPrint.bodyWidthMm, 74, 38, 110),
      bodyFontSize: numberBetween(settlementPrint.bodyFontSize, 10.5, 8, 18),
      titleFontSize: numberBetween(settlementPrint.titleFontSize, 20, 14, 32),
      metaFontSize: numberBetween(settlementPrint.metaFontSize, 12, 9, 20),
      customerFontSize: numberBetween(settlementPrint.customerFontSize, 11.5, 9, 22),
      mutedFontSize: numberBetween(settlementPrint.mutedFontSize, 10, 8, 16),
      totalsFontSize: numberBetween(settlementPrint.totalsFontSize, 11.5, 9, 20),
      deliverFontSize: numberBetween(settlementPrint.deliverFontSize, 15, 12, 28),
      footerFontSize: numberBetween(settlementPrint.footerFontSize, 9, 7, 14),
      showGrossSale: toBoolean(settlementPrint.showGrossSale, true),
      showCreditApplied: toBoolean(settlementPrint.showCreditApplied, true),
      showCollectedSale: toBoolean(settlementPrint.showCollectedSale, true),
      showReturns: toBoolean(settlementPrint.showReturns, true),
      showCreditGenerated: toBoolean(settlementPrint.showCreditGenerated, true),
      showGifts: toBoolean(settlementPrint.showGifts, true),
      showCommission: toBoolean(settlementPrint.showCommission, true),
    },
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

