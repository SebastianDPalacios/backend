const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/orders.service.js"), "utf8");
const routerSource = fs.readFileSync(path.join(__dirname, "../api/orders.router.js"), "utf8");
const pageSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/orders/returns-report.js"), "utf8");
const excelSource = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/organisms/orders/exportSalesOperationsExcel.js"), "utf8");
const reportSource = serviceSource.slice(serviceSource.indexOf("const listSalesOperationsReport = async"), serviceSource.indexOf("const createSalesReturn = async"));

test("separa cambios, devoluciones y obsequios en el reporte", () => {
  assert.match(reportSource, /sr\.operation_type/);
  assert.match(reportSource, /'gift' AS operation_type/);
  assert.match(reportSource, /UNION ALL/);
  assert.match(reportSource, /received_product_name/);
  assert.match(reportSource, /delivered_product_name/);
});

test("acepta todos los filtros mediante parámetros seguros", () => {
  for (const field of ["operation_date", "sales_agent_user_id", "customer_id", "received_product_id", "delivered_product_id", "original_order_id", "operation_type"]) {
    assert.match(reportSource, new RegExp(field));
  }
  assert.match(reportSource, /filters\.push\(`\$\{column\} = \?`\)/);
  assert.match(reportSource, /values\.push/);
});

test("respeta permisos y devuelve paginación con total real", () => {
  assert.match(routerSource, /returns-report.*verifyToken, canManageOrders/);
  assert.match(reportSource, /if \(!canViewAll\)/);
  assert.match(reportSource, /report\.sales_agent_user_id = \?/);
  assert.match(reportSource, /COUNT\(\*\) AS total/);
  assert.match(reportSource, /pageSize: normalizedPageSize/);
  assert.match(reportSource, /totalPages: Math\.ceil/);
});

test("calcula totales completos por vendedor y producto", () => {
  assert.match(reportSource, /GROUP BY sales_agent_user_id, sales_agent_name/);
  assert.match(reportSource, /GROUP BY COALESCE\(delivered_physical_product_id, received_physical_product_id\)/);
  assert.match(reportSource, /totalsBySeller/);
  assert.match(reportSource, /totalsByProduct/);
});

test("integra precio mayorista congelado y producto físico sin modificar históricos", () => {
  assert.match(reportSource, /COALESCE\(oi\.applied_price, oi\.unit_price\) AS original_applied_unit_price/);
  assert.match(reportSource, /oi\.wholesale_price_list_id/);
  assert.match(reportSource, /customer_price_type/);
  assert.match(reportSource, /received_physical_product_id/);
  assert.match(reportSource, /delivered_physical_product_id/);
  assert.doesNotMatch(reportSource, /UPDATE\s+order_items/i);
});

test("expone filtros mayoristas y los incluye en Excel", () => {
  for (const field of ["customerPriceType", "priceListId", "physicalProductId", "commercialVariantId", "appliedPrice"]) {
    assert.match(routerSource, new RegExp(field));
    assert.match(pageSource, new RegExp(field));
  }
  assert.match(excelSource, /Tipo de venta/);
  assert.match(excelSource, /Lista de precios/);
  assert.match(excelSource, /Producto físico/);
  assert.match(excelSource, /Precio congelado pedido original/);
});

test("la vista permite día, mes, rango y exportación Excel completa", () => {
  assert.match(pageSource, /value="day"/);
  assert.match(pageSource, /value="month"/);
  assert.match(pageSource, /value="range"/);
  assert.match(pageSource, /Exportar Excel/);
  assert.match(pageSource, /for \(let current = 2; current <= pages/);
  assert.match(excelSource, /Totales por vendedor/);
  assert.match(excelSource, /Totales por producto/);
  assert.match(excelSource, /workbook\.xlsx\.writeBuffer/);
});
