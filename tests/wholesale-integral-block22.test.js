const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { resolveWholesalePrice, PRICE_STATES } = require("../domain/wholesale-pricing");
const { resolvePhysicalProduct } = require("../domain/physical-product");
const { calculateSaleBonus } = require("../domain/sales-rules");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, relativePath), "utf8");
const ordersService = read("../services/orders.service.js");
const ordersRouter = read("../api/orders.router.js");
const wholesaleRouter = read("../api/wholesale.router.js");
const orderIdempotencyMigration = read("../database/075_order_creation_idempotency.sql");
const orderSnapshotMigration = read("../database/090_order_item_wholesale_price_snapshot.sql");
const saleBonusMigration = read("../database/091_order_item_sale_bonus_audit.sql");
const physicalProductMigration = read("../database/092_physical_product_inventory.sql");
const operationsExcel = read("../../frontend/src/components/organisms/orders/exportSalesOperationsExcel.js");
const operationsReport = read("../../frontend/src/pages/orders/returns-report.js");

const effectiveDate = "2026-09-24";

const resolve = (overrides = {}) => resolveWholesalePrice({
  customerIsWholesale: false,
  regularPrice: 3000,
  effectiveDate,
  customerSpecialPrice: null,
  generalWholesalePrice: null,
  ...overrides,
});

test("Bloque 22: precio regular, general, especial y producto sin precio", () => {
  const normal = resolve();
  const general = resolve({
    customerIsWholesale: true,
    generalWholesalePrice: { id: 10, price: 2400, active: true },
  });
  const special = resolve({
    customerIsWholesale: true,
    generalWholesalePrice: { id: 10, price: 2400, active: true },
    customerSpecialPrice: { id: 11, price: 2000, active: true },
  });
  const noWholesalePrice = resolve({ customerIsWholesale: true });

  assert.deepEqual(
    [normal.priceSource, normal.appliedUnitPrice],
    ["regular", 3000]
  );
  assert.deepEqual(
    [general.priceSource, general.appliedUnitPrice],
    ["wholesale_general", 2400]
  );
  assert.deepEqual(
    [special.priceSource, special.appliedUnitPrice],
    ["customer_special", 2000]
  );
  assert.deepEqual(
    [noWholesalePrice.priceSource, noWholesalePrice.appliedUnitPrice],
    ["regular", 3000]
  );
});

test("Bloque 22: precio vencido o desactivado vuelve al precio regular", () => {
  const expired = resolve({
    customerIsWholesale: true,
    generalWholesalePrice: { id: 10, price: 2400, active: true, validTo: "2026-09-23" },
  });
  const inactive = resolve({
    customerIsWholesale: true,
    generalWholesalePrice: { id: 10, price: 2400, active: false },
  });

  assert.equal(expired.evaluations.wholesaleGeneral.state, PRICE_STATES.EXPIRED);
  assert.equal(expired.priceSource, "regular");
  assert.equal(expired.appliedUnitPrice, 3000);
  assert.equal(inactive.evaluations.wholesaleGeneral.state, PRICE_STATES.INACTIVE);
  assert.equal(inactive.priceSource, "regular");
  assert.equal(inactive.appliedUnitPrice, 3000);
});

test("Bloque 22: el pedido conserva el precio aunque luego cambie la configuracion", () => {
  const configuration = { id: 10, price: 2400, active: true };
  const resolvedAtOrderCreation = resolve({
    customerIsWholesale: true,
    generalWholesalePrice: configuration,
  });
  const orderSnapshot = Object.freeze({
    regularPriceReference: resolvedAtOrderCreation.regularUnitPrice,
    wholesalePriceFound: resolvedAtOrderCreation.appliedUnitPrice,
    appliedPrice: resolvedAtOrderCreation.appliedUnitPrice,
    priceOrigin: resolvedAtOrderCreation.priceSource,
    configurationId: resolvedAtOrderCreation.priceConfigurationId,
  });

  configuration.price = 2100;
  const currentResolution = resolve({
    customerIsWholesale: true,
    generalWholesalePrice: configuration,
  });

  assert.equal(orderSnapshot.appliedPrice, 2400);
  assert.equal(currentResolution.appliedUnitPrice, 2100);
  for (const column of [
    "regular_price_reference",
    "wholesale_price_found",
    "applied_price",
    "price_origin",
    "wholesale_price_configuration_id",
  ]) assert.match(orderSnapshotMigration, new RegExp(column));
  assert.match(
    orderSnapshotMigration,
    /UPDATE order_items\s+SET regular_price_reference = unit_price,\s+applied_price = unit_price,\s+price_origin = 'regular'\s+WHERE id > 0\s+AND regular_price_reference IS NULL;/
  );
});

test("Bloque 22: venta regular y mayorista descuentan el mismo inventario fisico", async () => {
  const connectionFor = (commercialProductId) => ({
    async query() {
      return [[{
        commercial_product_id: commercialProductId,
        physical_product_id: 10,
        physical_product_name: "Pan fisico",
        physical_product_unit: "unit",
        physical_product_active: 1,
        physical_product_deleted_at: null,
      }]];
    },
  });
  const [regularVariant, wholesaleVariant] = await Promise.all([
    resolvePhysicalProduct(connectionFor(20), 20, { lock: true }),
    resolvePhysicalProduct(connectionFor(21), 21, { lock: true }),
  ]);
  const ledger = new Map([[10, 100]]);
  const discount = (physicalProductId, quantity) => {
    ledger.set(physicalProductId, ledger.get(physicalProductId) - quantity);
  };

  discount(regularVariant.physicalProductId, 10);
  const afterRegular = ledger.get(10);
  discount(wholesaleVariant.physicalProductId, 15);
  const afterWholesale = ledger.get(10);

  assert.equal(regularVariant.physicalProductId, wholesaleVariant.physicalProductId);
  assert.deepEqual({ before: 100, afterRegular, afterWholesale }, {
    before: 100,
    afterRegular: 90,
    afterWholesale: 75,
  });
  assert.match(ordersService, /FOR UPDATE/);
  assert.match(ordersService, /COALESCE\(p\.physical_product_id, p\.id\) AS inventory_product_id/);
  assert.doesNotMatch(physicalProductMigration, /UPDATE\s+stock_products|INSERT\s+INTO\s+stock_products\s*\([^)]*\)\s*SELECT/i);
});

test("Bloque 22: doble envio y concurrencia estan protegidos", () => {
  assert.match(orderIdempotencyMigration, /CREATE UNIQUE INDEX uq_orders_client_request_key/);
  assert.match(ordersService, /WHERE o\.client_request_key = \?/);
  assert.match(ordersService, /FOR UPDATE/);
  assert.match(ordersService, /connection\.beginTransaction\(\)/);
  assert.match(ordersService, /connection\.commit\(\)/);
  assert.match(ordersService, /connection\.rollback\(\)/);
});

test("Bloque 22: Venta mas vendaje conserva exactamente la formula con el precio aplicado", () => {
  const cases = [
    { name: "normal", invoiced: 5000, percent: 20, price: 3000, expected: 2 },
    { name: "mayorista general", invoiced: 4000, percent: 20, price: 2400, expected: 2 },
    { name: "mayorista especial", invoiced: 5000, percent: 20, price: 2000, expected: 3 },
    { name: "sin vendaje", invoiced: 6000, percent: 0, price: 3000, expected: 2 },
  ];

  for (const scenario of cases) {
    const expectedByOfficialFormula = (
      scenario.invoiced + scenario.invoiced * scenario.percent / 100
    ) / scenario.price;
    const current = calculateSaleBonus({
      unit: "unit",
      unitPrice: scenario.price,
      taxPercent: 0,
      paidValue: scenario.invoiced,
      saleQuantity: Math.floor(scenario.invoiced / scenario.price),
      bonusPercent: scenario.percent,
      maxCompanyLoss: 0,
      enabled: scenario.percent > 0,
    });
    assert.equal(current.formulaResultQuantity, expectedByOfficialFormula, scenario.name);
    assert.equal(current.formulaResultQuantity, scenario.expected, scenario.name);
    assert.equal(current.productPriceUsed, scenario.price, scenario.name);
  }

  for (const column of [
    "sale_bonus_invoiced_value",
    "sale_bonus_percent_applied",
    "sale_bonus_value_applied",
    "sale_bonus_product_price_used",
    "sale_bonus_result_quantity",
  ]) assert.match(saleBonusMigration, new RegExp(column));
});

test("Bloque 22: cambios, devoluciones, obsequios y comision conservan sus reglas", () => {
  const authorizeReturn = ordersService.slice(
    ordersService.indexOf("const authorizeSalesReturn = async"),
    ordersService.indexOf("const annulSalesExchange = async")
  );
  assert.match(ordersService, /resolvePhysicalProduct\(connection, replacementProductId/);
  assert.match(ordersService, /received_physical_product_id/);
  assert.match(ordersService, /'gift' AS operation_type/);
  assert.match(authorizeReturn, /let commissionTreatment = "no_effect"/);
  assert.match(authorizeReturn, /adjustedCommissionBase = originalCommissionBase/);
  assert.match(authorizeReturn, /adjustedCommissionAmount = originalCommissionAmount/);
  assert.doesNotMatch(authorizeReturn, /INSERT INTO sales_commissions/);
});

test("Bloque 22: reportes separan lo comercial y consolidan por producto fisico", () => {
  for (const token of [
    "customer_price_type",
    "wholesale_price_list_id",
    "received_physical_product_id",
    "delivered_physical_product_id",
    "applied_price",
  ]) assert.match(ordersService, new RegExp(token));
  assert.match(operationsReport, /commercialVariantId/);
  assert.match(ordersService, /GROUP BY COALESCE\(delivered_physical_product_id, received_physical_product_id\)/);
  assert.match(operationsReport, /Venta mayorista/);
  assert.match(operationsReport, /Venta regular/);
  assert.match(operationsExcel, /Tipo de venta/);
  assert.match(operationsExcel, /Producto f.sico/);
  assert.match(operationsExcel, /workbook\.xlsx\.writeBuffer/);
});

test("Bloque 22: permisos e historicos quedan protegidos", () => {
  assert.match(wholesaleRouter, /router\.use\(verifyToken, requireAdministrativeRole\)/);
  assert.match(ordersRouter, /router\.post\("\/", verifyToken, canManageOrders/);
  assert.match(ordersRouter, /router\.get\("\/returns-report", verifyToken, canManageOrders/);
  assert.match(ordersService, /if \(!canViewAll\)/);
  assert.doesNotMatch(orderSnapshotMigration, /UPDATE\s+orders/i);
  assert.match(orderSnapshotMigration, /regular_price_reference IS NULL/);
  assert.doesNotMatch(physicalProductMigration, /DELETE\s+FROM\s+products/i);
});
