const OPERATIONAL_TIME_ZONE = "America/Bogota";

const getDateParts = (date = new Date()) => Object.fromEntries(
  new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATIONAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
);

const getOperationalDate = (date = new Date()) => {
  const parts = getDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const getOperationalMonth = (date = new Date()) => getOperationalDate(date).slice(0, 7);

const normalizeOperationalDate = (value) => {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? text : null;
};

const validateOperationalDate = (value, { allowFuture = false, currentDate = getOperationalDate() } = {}) => {
  const operationalDate = normalizeOperationalDate(value || currentDate);
  if (!operationalDate) {
    return { valid: false, message: "La fecha operativa no es válida." };
  }
  if (!allowFuture && operationalDate > currentDate) {
    return { valid: false, message: "La fecha operativa no puede estar en el futuro." };
  }
  return { valid: true, operationalDate, retroactive: operationalDate < currentDate };
};

module.exports = {
  OPERATIONAL_TIME_ZONE,
  getOperationalDate,
  getOperationalMonth,
  normalizeOperationalDate,
  validateOperationalDate,
};
