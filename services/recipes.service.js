const { callProcedure } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const createRecipe = async (payload, actorUserId) => {
  const out = await callProcedure("sp_recipe_create", [
    payload.p_product_id || null,
    payload.p_output_quantity || null,
    payload.p_notes || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const addRecipeItem = async (payload, actorUserId) => {
  const out = await callProcedure("sp_recipe_add_item", [
    payload.p_recipe_id,
    payload.p_raw_material_id || null,
    payload.p_quantity || null,
    payload.p_wastage_percent || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const removeRecipeItem = async (payload, actorUserId) => {
  const out = await callProcedure("sp_recipe_remove_item", [
    payload.p_recipe_id,
    payload.p_raw_material_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const publishRecipeVersion = async (payload, actorUserId) => {
  const out = await callProcedure("sp_recipe_publish_version", [
    payload.p_recipe_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

module.exports = {
  createRecipe,
  addRecipeItem,
  removeRecipeItem,
  publishRecipeVersion,
};
