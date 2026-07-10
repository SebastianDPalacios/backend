const { connect } = require("../data-access");

const toMonthRange = (month) => {
  const selectedMonth = /^\d{4}-\d{2}$/.test(String(month || ""))
    ? String(month)
    : new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = selectedMonth.split("-").map((value) => Number(value));
  const lastDay = new Date(year, monthNumber, 0).getDate();

  return {
    month: selectedMonth,
    dateFrom: `${selectedMonth}-01`,
    dateTo: `${selectedMonth}-${String(lastDay).padStart(2, "0")}`,
  };
};

const getMonthlyDashboard = async ({ month } = {}) => {
  const db = await connect();
  const range = toMonthRange(month);

  const [topSellers] = await db.query(
    `
      SELECT
        COALESCE(NULLIF(seller.full_name, ''), seller.username, 'Sin vendedor') AS name,
        COUNT(o.id) AS orders_count,
        COALESCE(SUM(o.grand_total), 0) AS total_sales
      FROM orders o
      LEFT JOIN users seller ON seller.id = o.sales_agent_user_id
      WHERE o.order_date >= ?
        AND o.order_date <= ?
        AND o.status <> 'cancelled'
      GROUP BY COALESCE(NULLIF(seller.full_name, ''), seller.username, 'Sin vendedor')
      ORDER BY total_sales DESC, orders_count DESC
      LIMIT 5
    `,
    [range.dateFrom, range.dateTo]
  );

  const [topProducts] = await db.query(
    `
      SELECT
        p.name,
        COALESCE(SUM(oi.quantity), 0) AS quantity,
        COALESCE(SUM(oi.line_total), 0) AS total_sales
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      INNER JOIN products p ON p.id = oi.product_id
      WHERE o.order_date >= ?
        AND o.order_date <= ?
        AND o.status <> 'cancelled'
      GROUP BY p.id, p.name
      ORDER BY quantity DESC, total_sales DESC
      LIMIT 5
    `,
    [range.dateFrom, range.dateTo]
  );

  const [topRecipes] = await db.query(
    `
      SELECT
        COALESCE(NULLIF(SUBSTRING_INDEX(r.notes, ' - ', 1), ''), p.name, CONCAT('Receta #', r.id)) AS name,
        COUNT(pb.id) AS batches_count,
        COALESCE(SUM(pb.batch_quantity), 0) AS batch_quantity
      FROM production_batches pb
      INNER JOIN recipes r ON r.id = pb.recipe_id
      LEFT JOIN products p ON p.id = r.product_id
      WHERE pb.produced_date >= ?
        AND pb.produced_date <= ?
        AND pb.status <> 'cancelled'
      GROUP BY r.id, r.notes, p.name
      ORDER BY batch_quantity DESC, batches_count DESC
      LIMIT 5
    `,
    [range.dateFrom, range.dateTo]
  );

  return {
    code: 1,
    message: "dashboard mensual generado",
    data: {
      ...range,
      top_sellers: topSellers,
      top_products: topProducts,
      top_recipes: topRecipes,
    },
  };
};

module.exports = {
  getMonthlyDashboard,
};
