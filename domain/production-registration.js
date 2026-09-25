const CLIENT_REQUEST_KEY_PATTERN = /^[A-Za-z0-9:_-]{16,100}$/;
const { normalizeOperationalDate } = require("./operational-date");

const normalizeIsoDate = (value) => {
  return normalizeOperationalDate(value);
};

const validateProductionRegistrationDate = ({
  producedDate,
  currentDate,
  canManageAll = false,
  retroactiveReason,
}) => {
  const produced = normalizeIsoDate(producedDate);
  const current = normalizeIsoDate(currentDate);
  if (!produced || !current) {
    return { valid: false, message: "La fecha de produccion no es valida." };
  }
  if (produced > current) {
    return { valid: false, message: "No se puede registrar produccion con fecha futura." };
  }
  if (produced < current && !canManageAll) {
    return { valid: false, message: "Solo un administrador puede registrar produccion retroactiva." };
  }
  const reason = String(retroactiveReason || "").trim();
  if (produced < current && reason.length < 5) {
    return { valid: false, message: "Indica el motivo del registro retroactivo." };
  }
  return { valid: true, producedDate: produced, retroactiveReason: produced < current ? reason : null };
};

const validateProductionRequestKey = (value) => {
  const requestKey = String(value || "").trim();
  return CLIENT_REQUEST_KEY_PATTERN.test(requestKey)
    ? { valid: true, requestKey }
    : { valid: false, message: "La solicitud de produccion no tiene un identificador valido." };
};

module.exports = {
  validateProductionRegistrationDate,
  validateProductionRequestKey,
};
