const { callProcedure, connect } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const getRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
};

const withRows = (payload, rows) => {
  if (Array.isArray(payload)) return rows;
  if (Array.isArray(payload?.items)) return { ...payload, items: rows };
  if (Array.isArray(payload?.rows)) return { ...payload, rows };
  return payload;
};

const normalizePurchasePackage = (payload) => {
  const name = String(payload.p_purchase_package_name || payload.purchase_package_name || "").trim();
  const quantity = Number(payload.p_purchase_package_quantity ?? payload.purchase_package_quantity ?? 0);

  return {
    name: name || null,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
  };
};

const saveRawMaterialPurchasePackage = async (rawMaterialId, payload) => {
  const packageData = normalizePurchasePackage(payload);
  const db = await connect();

  await db.query(
    "UPDATE raw_materials SET purchase_package_name = ?, purchase_package_quantity = ? WHERE id = ?",
    [packageData.name, packageData.quantity, rawMaterialId]
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
    `SELECT id, purchase_package_name, purchase_package_quantity FROM raw_materials WHERE id IN (${placeholders})`,
    ids
  );
  const packageById = new Map(packageRows.map((row) => [Number(row.id), row]));

  return withRows(
    payload,
    rows.map((row) => ({
      ...row,
      purchase_package_name: packageById.get(Number(row.id))?.purchase_package_name || null,
      purchase_package_quantity: packageById.get(Number(row.id))?.purchase_package_quantity || null,
    }))
  );
};

const listBranches = async ({ onlyActive }) => {
  const out = await callProcedure("sp_branch_list", [Number(onlyActive || 0)]);
  return mapSpResult(out);
};

const listCustomers = async ({ status, search, page, pageSize }) => {
  const out = await callProcedure("sp_customer_list", [
    status || null,
    search || null,
    Number(page || 1),
    Number(pageSize || 20),
  ]);
  return mapSpResult(out);
};

const listRoutes = async ({ onlyActive, refDate }) => {
  const out = await callProcedure("sp_route_list", [
    Number(onlyActive || 0),
    refDate || null,
  ]);
  return mapSpResult(out);
};

const listProducts = async ({ onlyActive, categoryId, search, page, pageSize }) => {
  const out = await callProcedure("sp_product_list", [
    Number(onlyActive || 0),
    categoryId ? Number(categoryId) : null,
    search || null,
    Number(page || 1),
    Number(pageSize || 20),
  ]);
  return mapSpResult(out);
};

const listRawMaterials = async ({ onlyActive, categoryId, search, page, pageSize }) => {
  const out = await callProcedure("sp_raw_material_list", [
    Number(onlyActive || 0),
    categoryId ? Number(categoryId) : null,
    search || null,
    Number(page || 1),
    Number(pageSize || 20),
  ]);
  const result = mapSpResult(out);

  if (result.code !== 1) {
    return result;
  }

  return {
    ...result,
    data: await enrichRawMaterialPackages(result.data),
  };
};

const listTaxRates = async ({ onlyActive }) => {
  const out = await callProcedure("sp_tax_rate_list", [Number(onlyActive || 0)]);
  return mapSpResult(out);
};

const listProductCategories = async ({ onlyActive }) => {
  const out = await callProcedure("sp_product_category_list", [Number(onlyActive || 0)]);
  return mapSpResult(out);
};

const listRawMaterialCategories = async ({ onlyActive }) => {
  const out = await callProcedure("sp_raw_material_category_list", [Number(onlyActive || 0)]);
  return mapSpResult(out);
};

const listSuppliers = async ({ status, search, page, pageSize }) => {
  const out = await callProcedure("sp_supplier_list", [
    status || null,
    search || null,
    Number(page || 1),
    Number(pageSize || 20),
  ]);
  return mapSpResult(out);
};

const createBranch = async (payload, actorUserId) => {
  const out = await callProcedure("sp_branch_create", [
    payload.p_code || null,
    payload.p_name || null,
    payload.p_address || null,
    payload.p_phone || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateBranch = async (payload, actorUserId) => {
  const out = await callProcedure("sp_branch_update", [
    payload.p_branch_id,
    payload.p_name || null,
    payload.p_address || null,
    payload.p_phone || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createTaxRate = async (payload, actorUserId) => {
  const out = await callProcedure("sp_tax_rate_create", [
    payload.p_code || null,
    payload.p_name || null,
    payload.p_rate_percent || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateTaxRate = async (payload, actorUserId) => {
  const out = await callProcedure("sp_tax_rate_update", [
    payload.p_tax_rate_id,
    payload.p_name || null,
    payload.p_rate_percent || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createProductCategory = async (payload, actorUserId) => {
  const out = await callProcedure("sp_product_category_create", [
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateProductCategory = async (payload, actorUserId) => {
  const out = await callProcedure("sp_product_category_update", [
    payload.p_category_id,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createRawMaterialCategory = async (payload, actorUserId) => {
  const out = await callProcedure("sp_raw_material_category_create", [
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateRawMaterialCategory = async (payload, actorUserId) => {
  const out = await callProcedure("sp_raw_material_category_update", [
    payload.p_category_id,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createSupplier = async (payload, actorUserId) => {
  const out = await callProcedure("sp_supplier_create", [
    payload.p_tax_id || null,
    payload.p_name || null,
    payload.p_email || null,
    payload.p_phone || null,
    payload.p_address || null,
    payload.p_contact_name || null,
    payload.p_status || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateSupplier = async (payload, actorUserId) => {
  const out = await callProcedure("sp_supplier_update", [
    payload.p_supplier_id,
    payload.p_tax_id || null,
    payload.p_name || null,
    payload.p_email || null,
    payload.p_phone || null,
    payload.p_address || null,
    payload.p_contact_name || null,
    payload.p_status || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createProduct = async (payload, actorUserId) => {
  const out = await callProcedure("sp_product_create", [
    payload.p_sku || null,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_category_id || null,
    payload.p_tax_rate_id || null,
    payload.p_unit || null,
    payload.p_base_price ?? null,
    payload.p_min_stock ?? null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateProduct = async (payload, actorUserId) => {
  const out = await callProcedure("sp_product_update", [
    payload.p_product_id,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_category_id || null,
    payload.p_tax_rate_id || null,
    payload.p_unit || null,
    payload.p_base_price ?? null,
    payload.p_min_stock ?? null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const setProductStatus = async (payload, actorUserId) => {
  const out = await callProcedure("sp_product_set_status", [
    payload.p_product_id,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createRawMaterial = async (payload, actorUserId) => {
  const shouldAutoGenerateSku = !payload.p_sku;
  const temporarySku = shouldAutoGenerateSku ? `RM-TMP-${Date.now()}-${Math.floor(Math.random() * 1000)}` : payload.p_sku;

  const out = await callProcedure("sp_raw_material_create", [
    temporarySku,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_category_id || null,
    payload.p_supplier_id || null,
    payload.p_unit || null,
    payload.p_unit_cost ?? null,
    payload.p_min_stock ?? null,
    payload.p_is_active ?? null,
    actorUserId || null,
  ]);
  const result = mapSpResult(out);

  if (!shouldAutoGenerateSku || result.code !== 1 || !result.data?.raw_material_id) {
    if (result.code === 1 && result.data?.raw_material_id) {
      await saveRawMaterialPurchasePackage(Number(result.data.raw_material_id), payload);
    }
    return result;
  }

  const rawMaterialId = Number(result.data.raw_material_id);
  const sku = `RM-${String(rawMaterialId).padStart(6, "0")}`;
  const db = await connect();
  await db.query("UPDATE raw_materials SET sku = ? WHERE id = ?", [sku, rawMaterialId]);
  await saveRawMaterialPurchasePackage(rawMaterialId, payload);

  return {
    ...result,
    data: {
      ...result.data,
      sku,
    },
  };
};

const updateRawMaterial = async (payload, actorUserId) => {
  const out = await callProcedure("sp_raw_material_update", [
    payload.p_raw_material_id,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_category_id || null,
    payload.p_supplier_id || null,
    payload.p_unit || null,
    payload.p_unit_cost ?? null,
    payload.p_min_stock ?? null,
    payload.p_is_active ?? null,
    actorUserId || null,
  ]);
  const result = mapSpResult(out);

  if (result.code === 1) {
    await saveRawMaterialPurchasePackage(Number(payload.p_raw_material_id), payload);
  }

  return result;
};

const setRawMaterialStatus = async (payload, actorUserId) => {
  const out = await callProcedure("sp_raw_material_set_status", [
    payload.p_raw_material_id,
    payload.p_is_active ?? null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

module.exports = {
  listBranches,
  listCustomers,
  listRoutes,
  listProducts,
  listRawMaterials,
  listTaxRates,
  listProductCategories,
  listRawMaterialCategories,
  listSuppliers,
  createBranch,
  updateBranch,
  createTaxRate,
  updateTaxRate,
  createProductCategory,
  updateProductCategory,
  createRawMaterialCategory,
  updateRawMaterialCategory,
  createSupplier,
  updateSupplier,
  createProduct,
  updateProduct,
  setProductStatus,
  createRawMaterial,
  updateRawMaterial,
  setRawMaterialStatus,
};
