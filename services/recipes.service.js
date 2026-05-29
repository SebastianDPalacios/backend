const { callProcedure, connect } = require("../data-access");
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

const listRecipes = async ({ onlyActive, productId } = {}) => {
  const db = await connect();
  const filters = [];
  const params = [];

  if (onlyActive) {
    filters.push("r.is_active = 1");
  }

  if (productId) {
    filters.push("r.product_id = ?");
    params.push(Number(productId));
  }

  const sql = `
    SELECT
      r.id,
      r.product_id,
      r.version_no,
      r.output_quantity,
      r.notes,
      r.is_active,
      p.name AS product_name,
      p.sku AS product_sku
    FROM recipes r
    JOIN products p ON p.id = r.product_id
    ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY p.name, r.version_no DESC
  `;

  const [rows] = await db.query(sql, params);
  return {
    code: 1,
    message: "recetas obtenidas",
    data: rows,
  };
};

const getRecipeBaseData = async ({ onlyActive } = {}) => {
  const db = await connect();
  const activeFilter = onlyActive ? "WHERE is_active = 1" : "";

  const [products] = await db.query(`
    SELECT
      id,
      sku,
      name,
      description,
      unit,
      base_price,
      is_active
    FROM products
    ${activeFilter}
    ORDER BY name
  `);

  const [rawMaterials] = await db.query(`
    SELECT
      id,
      sku,
      name,
      description,
      unit,
      unit_cost,
      is_active
    FROM raw_materials
    ${activeFilter}
    ORDER BY name
  `);

  return {
    code: 1,
    message: "catalogos de recetas obtenidos",
    data: {
      products,
      raw_materials: rawMaterials,
    },
  };
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
  listRecipes,
  getRecipeBaseData,
  addRecipeItem,
  removeRecipeItem,
  publishRecipeVersion,
};
