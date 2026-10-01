const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const returnsSource = fs.readFileSync(path.join(root, "frontend", "src", "pages", "orders", "returns.js"), "utf8");
const reportService = fs.readFileSync(path.join(__dirname, "..", "services", "orders.service.js"), "utf8");
const excelSource = fs.readFileSync(path.join(root, "frontend", "src", "components", "organisms", "orders", "exportSalesOperationsExcel.js"), "utf8");

test("Mojado no se ofrece en nuevas devoluciones pero sus historicos siguen siendo legibles", () => {
  const reasonOptions = returnsSource.slice(returnsSource.indexOf("const reasonOptions"), returnsSource.indexOf("const statusConfig"));
  assert.doesNotMatch(reasonOptions, /Mojado|value:\s*"wet"/);
  assert.match(excelSource, /wet:\s*"Producto mojado"/);
});

test("el reporte devuelve y exporta totales por motivo", () => {
  assert.match(reportService, /GROUP BY reason, operation_type/);
  assert.match(reportService, /totalsByReason: reasonTotals/);
  assert.match(excelSource, /addWorksheet\("Totales por motivo"\)/);
});
