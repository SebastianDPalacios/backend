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
  let rawMaterialsData = rawMaterials.data;

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
    rawMaterialsData = enrichStock(rawMaterials.data, rawMaterialStockRows[0], "raw_material_id");
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

module.exports = {
  listInventoryBaseData,
  applyInventoryMovement,
};
