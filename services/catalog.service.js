const { callProcedure } = require("../data-access");
const { mapSpResult } = require("./sp-response");

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
  return mapSpResult(out);
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
    payload.p_base_price || null,
    payload.p_min_stock || null,
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
    payload.p_base_price || null,
    payload.p_min_stock || null,
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
  const out = await callProcedure("sp_raw_material_create", [
    payload.p_sku || null,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_category_id || null,
    payload.p_supplier_id || null,
    payload.p_unit || null,
    payload.p_unit_cost || null,
    payload.p_min_stock || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateRawMaterial = async (payload, actorUserId) => {
  const out = await callProcedure("sp_raw_material_update", [
    payload.p_raw_material_id,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_category_id || null,
    payload.p_supplier_id || null,
    payload.p_unit || null,
    payload.p_unit_cost || null,
    payload.p_min_stock || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const setRawMaterialStatus = async (payload, actorUserId) => {
  const out = await callProcedure("sp_raw_material_set_status", [
    payload.p_raw_material_id,
    payload.p_is_active || null,
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
