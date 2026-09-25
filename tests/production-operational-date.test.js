const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  OPERATIONAL_TIME_ZONE,
  getOperationalDate,
  getOperationalMonth,
  validateOperationalDate,
} = require("../domain/operational-date");

const productionSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");
const inventorySource = fs.readFileSync(path.join(__dirname, "../services/inventory.service.js"), "utf8");
const dataAccessSource = fs.readFileSync(path.join(__dirname, "../data-access.js"), "utf8");
const unitSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/utils/production-measurement-units.js"), "utf8");

test("la fecha operativa usa America/Bogota incluso durante la noche UTC", () => {
  const nightUtc = new Date("2026-09-20T02:30:00.000Z");
  assert.equal(OPERATIONAL_TIME_ZONE, "America/Bogota");
  assert.equal(getOperationalDate(nightUtc), "2026-09-19");
  assert.equal(getOperationalMonth(nightUtc), "2026-09");
  assert.match(dataAccessSource, /timezone: "-05:00"/);
});

test("rechaza fechas futuras e inválidas e identifica fechas retroactivas", () => {
  assert.deepEqual(validateOperationalDate("2026-09-20", { currentDate: "2026-09-19" }), {
    valid: false,
    message: "La fecha operativa no puede estar en el futuro.",
  });
  assert.equal(validateOperationalDate("2026-02-30", { currentDate: "2026-09-19" }).valid, false);
  assert.deepEqual(validateOperationalDate("2026-09-18", { currentDate: "2026-09-19" }), {
    valid: true,
    operationalDate: "2026-09-18",
    retroactive: true,
  });
});

test("el lote y sus movimientos comparten la fecha operativa", () => {
  assert.match(productionSource, /const packedDate = packedDateValidation\.operationalDate/);
  assert.match(productionSource, /'operational_date', \?, 'retroactive_date', \?/);
  assert.match(inventorySource, /pb\.produced_date/);
  assert.match(inventorySource, /pom_batch\.produced_date/);
  assert.match(inventorySource, /correction_batch\.produced_date/);
  assert.match(inventorySource, /AS operational_date/);
});

test("presenta nombres completos para todas las unidades admitidas", () => {
  for (const name of ["Gramos", "Kilogramos", "Mililitros", "Litros", "Unidades", "Paquetes", "Rollos", "Bolsas", "Cajas"]) {
    assert.match(unitSource, new RegExp(`"${name}"`));
  }
});
