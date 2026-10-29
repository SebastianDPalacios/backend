const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const productionService = read("backend", "services", "production.service.js");
const monthPage = read("frontend", "src", "pages", "production", "month.js");
const monthExcel = read("frontend", "src", "components", "organisms", "production", "exportProductionMonthExcel.js");

test("el reporte mensual agrupa las devoluciones por motivo", () => {
  assert.match(productionService, /COUNT\(\*\) AS return_records/);
  assert.match(productionService, /GROUP BY sri\.reason/);
  assert.match(productionService, /returns_by_reason: returnReasonRows/);
  assert.match(monthPage, /returns_by_reason/);
});

test("la hoja de devoluciones muestra el cuadro de totales por motivo", () => {
  assert.match(monthExcel, /"TOTALES POR MOTIVO"/);
  assert.match(monthExcel, /\["Motivo", "Cantidad", "Registros"\]/);
  ["Vencido", "Moho", "Mal moldeado", "Otro"].forEach((label) => {
    assert.match(monthExcel, new RegExp(label));
  });
  assert.match(monthExcel, /Mojado \(histórico\)/);
  assert.match(monthExcel, /item\.returned_quantity/);
  assert.match(monthExcel, /item\.return_records/);
});
