const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");
const dayReportSource = serviceSource.slice(
  serviceSource.indexOf("const getProductionDayReport = async"),
  serviceSource.indexOf("const getProductionMonthReport = async")
);
const monthReportSource = serviceSource.slice(
  serviceSource.indexOf("const getProductionMonthReport = async"),
  serviceSource.indexOf("module.exports")
);
const productSummarySource = fs.readFileSync(
  path.join(__dirname, "../../frontend/src/components/organisms/production/ProductionProductSummary.js"),
  "utf8"
);
const excelSource = fs.readFileSync(
  path.join(__dirname, "../../frontend/src/components/organisms/production/exportProductionMonthExcel.js"),
  "utf8"
);

test("el reporte separa informado, producido, empacado, dañado, faltante, sobrante e inventario", () => {
  for (const field of [
    "informed_quantity",
    "produced_quantity",
    "packed_quantity",
    "damaged_quantity",
    "shortage_quantity",
    "surplus_quantity",
    "inventory_quantity",
  ]) {
    assert.match(dayReportSource, new RegExp(field));
  }

  for (const label of ["Informado", "Producido", "Empacado", "Dañado", "Faltante", "Sobrante", "A inventario"]) {
    assert.match(productSummarySource, new RegExp(label));
  }
});

test("suma faltantes y sobrantes por lote sin compensar lotes del mismo producto", () => {
  assert.match(
    dayReportSource,
    /SUM\(GREATEST\(pbo\.produced_quantity - pbo\.packed_quantity - pbo\.damaged_quantity, 0\)\)/
  );
  assert.match(
    dayReportSource,
    /SUM\(GREATEST\(pbo\.packed_quantity \+ pbo\.damaged_quantity - pbo\.produced_quantity, 0\)\)/
  );

  const lots = [
    { produced: 100, packed: 95, damaged: 3 },
    { produced: 100, packed: 101, damaged: 2 },
  ];
  const totals = lots.reduce((result, lot) => ({
    shortage: result.shortage + Math.max(lot.produced - lot.packed - lot.damaged, 0),
    surplus: result.surplus + Math.max(lot.packed + lot.damaged - lot.produced, 0),
  }), { shortage: 0, surplus: 0 });

  assert.deepEqual(totals, { shortage: 2, surplus: 3 });
});

test("diario y mensual comparten la misma agregacion y fecha operativa", () => {
  assert.match(monthReportSource, /getProductionDayReport\(\{/);
  assert.match(serviceSource, /COALESCE\(pb_base\.produced_date, pb_pom\.produced_date, im\.moved_at\)/);
  assert.match(serviceSource, /correction_batch\.produced_date/);
});

test("expone los cinco estados administrativos y los exporta a Excel", () => {
  for (const status of ["pending_count", "matched", "shortage", "surplus", "corrected"]) {
    assert.match(dayReportSource, new RegExp(`"${status}"`));
    assert.match(productSummarySource, new RegExp(`${status}:`));
  }

  for (const heading of ["Informado", "Producido", "Empacado", "Dañado", "Faltante", "Sobrante", "A inventario", "Estado"]) {
    assert.match(excelSource, new RegExp(heading));
  }
});

test("el reporte mensual ordena los días y conserva diferencias por lote", () => {
  assert.match(dayReportSource, /ORDER BY daily_batch\.produced_date ASC, daily_physical\.name ASC/);
  assert.match(dayReportSource, /SUM\(GREATEST\(daily_output\.produced_quantity - daily_output\.packed_quantity - daily_output\.damaged_quantity, 0\)\) AS shortage_quantity/);
  assert.match(dayReportSource, /SUM\(GREATEST\(daily_output\.packed_quantity \+ daily_output\.damaged_quantity - daily_output\.produced_quantity, 0\)\) AS surplus_quantity/);
  assert.match(excelSource, /Detalle diario del mes/);
  assert.match(excelSource, /\.sort\(\(a, b\) => String\(a\.produced_date\)\.localeCompare/);
});
