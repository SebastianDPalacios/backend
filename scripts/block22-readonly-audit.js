require("dotenv").config();
const { connect } = require("../data-access");

const scalar = async (db, sql) => {
  try {
    const [rows] = await db.query(sql);
    return Number(rows[0]?.value || 0);
  } catch (error) {
    return { unavailable: error.code || error.message };
  }
};

const run = async () => {
  const db = await connect();
  const result = {
    physicalProductColumn: await scalar(db, "SELECT COUNT(*) value FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'physical_product_id'"),
    orderSnapshotColumns: await scalar(db, "SELECT COUNT(*) value FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'order_items' AND column_name IN ('regular_price_reference','applied_price','price_origin','wholesale_price_list_id','inventory_product_id')"),
    reconciliationAuditTable: await scalar(db, "SELECT COUNT(*) value FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'physical_product_reconciliations'"),
    activeWholesaleCustomers: await scalar(db, "SELECT COUNT(*) value FROM customer_wholesale_profiles WHERE is_active = 1"),
    activeWholesalePrices: await scalar(db, "SELECT COUNT(*) value FROM wholesale_product_prices WHERE is_active = 1"),
    wholesaleOrders: await scalar(db, "SELECT COUNT(DISTINCT order_id) value FROM order_items WHERE price_origin IN ('wholesale_general','customer_special')"),
    commercialVariants: await scalar(db, "SELECT COUNT(*) value FROM products WHERE physical_product_id IS NOT NULL"),
    physicalStockBalance: await scalar(db, "SELECT COALESCE(SUM(stock.quantity_on_hand), 0) value FROM stock_products stock INNER JOIN products product ON product.id = stock.product_id WHERE product.physical_product_id IS NULL"),
    variantLegacyStockBalance: await scalar(db, "SELECT COALESCE(SUM(stock.quantity_on_hand), 0) value FROM stock_products stock INNER JOIN products product ON product.id = stock.product_id WHERE product.physical_product_id IS NOT NULL"),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

run().then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`${error.code || error.message}\n`);
  process.exit(1);
});
