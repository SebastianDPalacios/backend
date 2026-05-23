const { callProcedure } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const listProductionBaseData = async ({ onlyActive, search, page, pageSize }) => {
  const [productsOut, rawMaterialsOut] = await Promise.all([
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
  ]);

  const products = mapSpResult(productsOut);
  const rawMaterials = mapSpResult(rawMaterialsOut);

  if (products.code !== 1) {
    return products;
  }

  if (rawMaterials.code !== 1) {
    return rawMaterials;
  }

  return {
    code: 1,
    message: "catalogos de produccion obtenidos",
    data: {
      products: products.data,
      raw_materials: rawMaterials.data,
    },
  };
};

const registerProductionResult = async (payload, actorUserId) => {
  const out = await callProcedure("sp_register_production_result", [
    payload.p_branch_id || null,
    payload.p_product_id || null,
    payload.p_recipe_id || null,
    payload.p_produced_qty || null,
    actorUserId || null,
    payload.p_reference_type || null,
    payload.p_reference_id || null,
    payload.p_notes || null,
  ]);
  return mapSpResult(out);
};

const closeProductionOrder = async (payload, actorUserId) => {
  const out = await callProcedure("sp_close_production_order", [
    payload.p_production_order_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

module.exports = {
  listProductionBaseData,
  registerProductionResult,
  closeProductionOrder,
};
