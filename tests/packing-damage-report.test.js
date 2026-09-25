const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");
const routerSource = fs.readFileSync(path.join(__dirname, "../api/production.router.js"), "utf8");
const pageSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/production/damages.js"), "utf8");
const excelSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/organisms/production/exportPackingDamageExcel.js"), "utf8");
const monthPageSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/production/month.js"), "utf8");
const monthExcelSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/organisms/production/exportProductionMonthExcel.js"), "utf8");

test("el reporte usa exclusivamente daños vinculados al conteo y empaque", () => {
  assert.match(serviceSource, /damage\.packing_report_item_id IS NOT NULL/);
  assert.match(serviceSource, /INNER JOIN packing_report_items item ON item\.id = damage\.packing_report_item_id/);
  assert.match(serviceSource, /INNER JOIN packing_reports report ON report\.id = item\.packing_report_id/);
});

test("expone filtros administrativos, totales y paginacion", () => {
  ["dateFrom", "dateTo", "branchId", "productId", "damageReason", "packerEmployeeId", "page", "pageSize"]
    .forEach((field) => assert.match(routerSource, new RegExp(field)));
  assert.match(serviceSource, /totals_by_product/);
  assert.match(serviceSource, /totals_by_reason/);
  assert.match(pageSource, /Consultar por/);
  assert.match(pageSource, /BalanceMonthPicker/);
});

test("incluye correcciones auditadas y exportacion Excel", () => {
  assert.match(serviceSource, /original_damages_json/);
  assert.match(serviceSource, /corrected_damages_json/);
  assert.match(serviceSource, /was_corrected/);
  assert.match(excelSource, /Auditoría de corrección/);
  assert.match(excelSource, /writeBuffer/);
});

test("el Excel mensual incorpora la misma hoja detallada de daños", () => {
  assert.match(monthPageSource, /getPackingDamageReport/);
  assert.match(monthPageSource, /recipeId: filters\.recipeId/);
  assert.match(monthExcelSource, /addPackingDamageWorksheet/);
  assert.match(excelSource, /Daños de conteo/);
});
