const { callProcedure } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const listInventoryBaseData = async ({ onlyActive, search, page, pageSize }) => {
  const [branchesOut, productsOut, rawMaterialsOut] = await Promise.all([
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
  ]);

  const branches = mapSpResult(branchesOut);
  const products = mapSpResult(productsOut);
  const rawMaterials = mapSpResult(rawMaterialsOut);

  if (branches.code !== 1) {
    return branches;
  }

  if (products.code !== 1) {
    return products;
  }

  if (rawMaterials.code !== 1) {
    return rawMaterials;
  }

  return {
    code: 1,
    message: "catalogos de inventario obtenidos",
    data: {
      branches: branches.data,
      products: products.data,
      raw_materials: rawMaterials.data,
    },
  };
};

const applyInventoryMovement = async (payload, actorUserId) => {
  const out = await callProcedure("sp_apply_inventory_movement", [
    payload.p_branch_id || null,
    payload.p_item_type || null,
    payload.p_item_id || null,
    payload.p_movement_type || null,
    payload.p_quantity || null,
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
