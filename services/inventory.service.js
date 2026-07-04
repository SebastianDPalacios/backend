const { callProcedure, connect } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const getRows = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload?.rows)) {
    return payload.rows;
  }
  return [];
};

const withItems = (payload, items) => {
  if (Array.isArray(payload)) {
    return items;
  }
  return {
    ...payload,
    items,
  };
};

const enrichStock = (payload, stockRows, itemKey) => {
  const stockByItem = new Map(stockRows.map((row) => [Number(row[itemKey]), row]));

  return withItems(
    payload,
    getRows(payload).map((item) => {
      const stock = stockByItem.get(Number(item.id));
      return {
        ...item,
        quantity_on_hand: Number(stock?.quantity_on_hand || 0),
        min_stock: Number(stock?.min_stock || item.min_stock || 0),
        stock_updated_at: stock?.updated_at || null,
      };
    })
  );
};

const enrichRawMaterialPackages = async (payload) => {
  const rows = getRows(payload);
  const ids = rows.map((row) => Number(row.id || 0)).filter((id) => id > 0);

  if (!ids.length) {
    return payload;
  }

  const placeholders = ids.map(() => "?").join(",");
  const db = await connect();
  const [packageRows] = await db.query(
    `SELECT id, purchase_package_name, purchase_package_quantity, inventory_usage_type
       FROM raw_materials
      WHERE id IN (${placeholders})`,
    ids
  );
  const packageById = new Map(packageRows.map((row) => [Number(row.id), row]));

  return withItems(
    payload,
    rows.map((row) => ({
      ...row,
      purchase_package_name: packageById.get(Number(row.id))?.purchase_package_name || null,
      purchase_package_quantity: packageById.get(Number(row.id))?.purchase_package_quantity || null,
      inventory_usage_type: packageById.get(Number(row.id))?.inventory_usage_type || "production",
    }))
  );
};

const MAX_INVENTORY_QUANTITY = 99999999999.999;

const listInventoryBaseData = async ({ onlyActive, search, page, pageSize, branchId }) => {
  const [branchesOut, productsOut, rawMaterialsOut, suppliersOut] = await Promise.all([
    callProcedure("sp_branch_list", [Number(onlyActive || 0)]),
    callProcedure("sp_product_list", [
      Number(onlyActive || 0),
      null,
      search || null,
      Number(page || 1),
      Number(pageSize || 20),
    ]),
    callProcedure("sp_raw_material_list", [
      Number(onlyActive || 0),
      null,
      search || null,
      Number(page || 1),
      Number(pageSize || 20),
    ]),
    callProcedure("sp_supplier_list", [
      "active",
      null,
      1,
      100,
    ]),
  ]);

  const branches = mapSpResult(branchesOut);
  const products = mapSpResult(productsOut);
  const rawMaterials = mapSpResult(rawMaterialsOut);
  const suppliers = mapSpResult(suppliersOut);

  if (branches.code !== 1) {
    return branches;
  }

  if (products.code !== 1) {
    return products;
  }

  if (rawMaterials.code !== 1) {
    return rawMaterials;
  }

  if (suppliers.code !== 1) {
    return suppliers;
  }

  const branchRows = getRows(branches.data);
  const selectedBranchId = Number(branchId || branchRows[0]?.id || 0);
  let productsData = products.data;
  let rawMaterialsData = await enrichRawMaterialPackages(rawMaterials.data);

  if (selectedBranchId > 0) {
    const db = await connect();
    const [productStockRows, rawMaterialStockRows] = await Promise.all([
      db.query(
        "SELECT product_id, quantity_on_hand, min_stock, updated_at FROM stock_products WHERE branch_id = ?",
        [selectedBranchId]
      ),
      db.query(
        "SELECT raw_material_id, quantity_on_hand, min_stock, updated_at FROM stock_raw_materials WHERE branch_id = ?",
        [selectedBranchId]
      ),
    ]);

    productsData = enrichStock(products.data, productStockRows[0], "product_id");
    rawMaterialsData = enrichStock(rawMaterialsData, rawMaterialStockRows[0], "raw_material_id");
  }

  return {
    code: 1,
    message: "catalogos de inventario obtenidos",
    data: {
      branches: branches.data,
      selected_branch_id: selectedBranchId || null,
      products: productsData,
      raw_materials: rawMaterialsData,
      suppliers: suppliers.data,
    },
  };
};

const applyInventoryMovement = async (payload, actorUserId) => {
  const quantity = Number(payload.p_quantity || 0);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      code: -1,
      message: "La cantidad debe ser mayor que 0",
      data: null,
    };
  }

  if (quantity > MAX_INVENTORY_QUANTITY) {
    return {
      code: -1,
      message: `La cantidad maxima permitida por movimiento es ${MAX_INVENTORY_QUANTITY}`,
      data: null,
    };
  }

  const out = await callProcedure("sp_apply_inventory_movement", [
    payload.p_branch_id || null,
    payload.p_item_type || null,
    payload.p_item_id || null,
    payload.p_movement_type || null,
    quantity,
    payload.p_unit_cost || null,
    payload.p_reference_type || null,
    payload.p_reference_id || null,
    payload.p_notes || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const listInventoryMovements = async ({ branchId, itemType, movementType, search, dateFrom, dateTo, page, pageSize } = {}) => {
  const db = await connect();
  const filters = [];
  const params = [];
  const limit = Math.min(Math.max(Number(pageSize || 12), 1), 100);
  const currentPage = Math.max(Number(page || 1), 1);
  const offset = (currentPage - 1) * limit;

  if (branchId) {
    filters.push("im.branch_id = ?");
    params.push(Number(branchId));
  }

  if (itemType && itemType !== "all") {
    filters.push("im.item_type = ?");
    params.push(itemType);
  }

  if (movementType && movementType !== "all") {
    filters.push("im.movement_type = ?");
    params.push(movementType);
  }

  if (dateFrom) {
    filters.push("DATE(im.moved_at) >= ?");
    params.push(String(dateFrom).slice(0, 10));
  }

  if (dateTo) {
    filters.push("DATE(im.moved_at) <= ?");
    params.push(String(dateTo).slice(0, 10));
  }

  if (search) {
    filters.push(
      `(rm.name LIKE ?
        OR p.name LIKE ?
        OR b.name LIKE ?
        OR im.notes LIKE ?
        OR po.invoice_number LIKE ?
        OR s.name LIKE ?
        OR CAST(im.reference_id AS CHAR) LIKE ?)`
    );
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const [rows] = await db.query(
    `
      SELECT
        im.id,
        im.branch_id,
        b.name AS branch_name,
        im.item_type,
        im.raw_material_id,
        im.product_id,
        COALESCE(rm.name, p.name) AS item_name,
        COALESCE(rm.unit, p.unit, 'unit') AS item_unit,
        im.movement_type,
        im.quantity,
        im.unit_cost,
        im.reference_type,
        im.reference_id,
        im.notes,
        im.moved_at,
        im.created_by,
        u.full_name AS created_by_name,
        po.invoice_number,
        po.order_date AS purchase_order_date,
        s.name AS supplier_name,
        pb.produced_date,
        rb.name AS production_recipe_name,
        pom.concept AS output_material_concept,
        pp.name AS output_product_name
      FROM inventory_movements im
      INNER JOIN branches b ON b.id = im.branch_id
      LEFT JOIN raw_materials rm ON rm.id = im.raw_material_id
      LEFT JOIN products p ON p.id = im.product_id
      LEFT JOIN users u ON u.id = im.created_by
      LEFT JOIN purchase_orders po
        ON im.reference_type = 'purchase_order'
       AND po.id = im.reference_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN production_batches pb
        ON im.reference_type = 'production_batch'
       AND pb.id = im.reference_id
      LEFT JOIN recipes r ON r.id = pb.recipe_id
      LEFT JOIN products rb ON rb.id = r.product_id
      LEFT JOIN production_output_materials pom
        ON im.reference_type = 'production_output_material'
       AND pom.id = im.reference_id
      LEFT JOIN products pp ON pp.id = pom.product_id
      ${where}
      ORDER BY im.moved_at DESC, im.id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );

  const [countRows] = await db.query(
    `
      SELECT COUNT(*) AS total
      FROM inventory_movements im
      INNER JOIN branches b ON b.id = im.branch_id
      LEFT JOIN raw_materials rm ON rm.id = im.raw_material_id
      LEFT JOIN products p ON p.id = im.product_id
      LEFT JOIN purchase_orders po
        ON im.reference_type = 'purchase_order'
       AND po.id = im.reference_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      ${where}
    `,
    params
  );

  return {
    code: 1,
    message: "movimientos de inventario listados",
    data: {
      items: rows,
      page: currentPage,
      pageSize: limit,
      total: Number(countRows[0]?.total || 0),
    },
  };
};

module.exports = {
  listInventoryBaseData,
  applyInventoryMovement,
  listInventoryMovements,
};
