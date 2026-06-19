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

const listRecipes = async ({ onlyActive, onlyCurrent = true, productId } = {}) => {
  const db = await connect();
  const filters = [];
  const params = [];

  if (onlyActive) {
    filters.push("r.is_active = 1");
  }

  if (onlyCurrent) {
    filters.push("COALESCE(r.is_current, r.is_active) = 1");
  }

  if (productId) {
    filters.push("COALESCE(ro.product_id, r.product_id) = ?");
    params.push(Number(productId));
  }

  const sql = `
    SELECT
      r.id,
      COALESCE(ro.product_id, r.product_id) AS product_id,
      r.product_id AS primary_product_id,
      r.recipe_family_id,
      r.version_no,
      COALESCE(ro.expected_quantity, r.output_quantity) AS output_quantity,
      r.notes,
      r.is_active,
      r.is_current,
      p.name AS product_name,
      p.sku AS product_sku
    FROM recipes r
    LEFT JOIN recipe_outputs ro ON ro.recipe_id = r.id
    LEFT JOIN products p ON p.id = COALESCE(ro.product_id, r.product_id)
    ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY COALESCE(p.name, r.notes), r.version_no DESC
  `;

  const [rows] = await db.query(sql, params);
  return {
    code: 1,
    message: "recetas obtenidas",
    data: rows,
  };
};

const parseRecipeNotes = (notes) => {
  const value = String(notes || "").trim();
  if (!value) {
    return { name: "", description: "" };
  }

  const parts = value.split(/\s+-\s+/);
  return {
    name: parts.shift() || "",
    description: parts.join(" - "),
  };
};

const getRecipeDetail = async ({ recipeId }) => {
  const db = await connect();

  const [recipeRows] = await db.query(
    `
      SELECT
        r.id,
        r.recipe_family_id,
        r.product_id AS primary_product_id,
        r.version_no,
        r.output_quantity,
        r.notes,
        r.is_active,
        r.is_current,
        r.created_at,
        r.updated_at
      FROM recipes r
      WHERE r.id = ?
      LIMIT 1
    `,
    [Number(recipeId)]
  );

  if (!recipeRows.length) {
    return {
      code: 0,
      message: "receta no encontrada",
      data: null,
    };
  }

  const recipe = recipeRows[0];
  const recipeParts = parseRecipeNotes(recipe.notes);

  const [baseItems] = await db.query(
    `
      SELECT
        ri.raw_material_id,
        ri.concept,
        ri.quantity,
        ri.wastage_percent,
        ri.sort_order,
        rm.name AS raw_material_name,
        rm.sku AS raw_material_sku,
        rm.unit,
        rm.unit_cost
      FROM recipe_items ri
      INNER JOIN raw_materials rm ON rm.id = ri.raw_material_id
      WHERE ri.recipe_id = ?
      ORDER BY ri.sort_order, ri.raw_material_id
    `,
    [Number(recipeId)]
  );

  const [outputs] = await db.query(
    `
      SELECT
        ro.id,
        ro.recipe_id,
        ro.product_id,
        p.name AS product_name,
        p.sku AS product_sku,
        ro.expected_quantity,
        ro.unit_weight_grams,
        ro.sale_price,
        ro.packing_note,
        ro.sort_order
      FROM recipe_outputs ro
      INNER JOIN products p ON p.id = ro.product_id
      WHERE ro.recipe_id = ?
      ORDER BY ro.sort_order, p.name
    `,
    [Number(recipeId)]
  );

  const [outputItems] = await db.query(
    `
      SELECT
        roi.recipe_output_id,
        roi.concept,
        roi.raw_material_id,
        roi.quantity,
        roi.wastage_percent,
        roi.sort_order,
        rm.name AS raw_material_name,
        rm.sku AS raw_material_sku
      FROM recipe_output_items roi
      INNER JOIN raw_materials rm ON rm.id = roi.raw_material_id
      INNER JOIN recipe_outputs ro ON ro.id = roi.recipe_output_id
      WHERE ro.recipe_id = ?
      ORDER BY roi.recipe_output_id, roi.sort_order, roi.id
    `,
    [Number(recipeId)]
  );

  const itemsByOutputId = outputItems.reduce((acc, item) => {
    const key = String(item.recipe_output_id);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {});

  return {
    code: 1,
    message: "detalle de receta obtenido",
    data: {
      ...recipe,
      recipe_name: recipeParts.name,
      recipe_description: recipeParts.description,
      base_items: baseItems,
      outputs: outputs.map((output) => ({
        ...output,
        items: itemsByOutputId[String(output.id)] || [],
      })),
    },
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
      bag_size_grams,
      purchase_package_name,
      purchase_package_quantity,
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

const createCostingRecipe = async (payload, actorUserId) => {
  const out = await callProcedure("sp_recipe_costing_create", [
    payload.p_primary_product_id || null,
    payload.p_recipe_name || null,
    payload.p_notes || null,
    JSON.stringify(payload.p_base_items || []),
    JSON.stringify(payload.p_outputs || []),
    actorUserId || null,
  ]);
  const result = mapSpResult(out);
  const recipeId = Number(result.data?.recipe_id || 0);

  if (result.code !== 1 || !recipeId) {
    return result;
  }

  const db = await connect();
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    await connection.query(
      `UPDATE recipes
          SET recipe_family_id = COALESCE(recipe_family_id, id),
              is_current = 1
        WHERE id = ?`,
      [recipeId]
    );

    const baseItems = Array.isArray(payload.p_base_items) ? payload.p_base_items : [];
    for (let index = 0; index < baseItems.length; index += 1) {
      const item = baseItems[index];
      await connection.query(
        `UPDATE recipe_items
            SET sort_order = ?
          WHERE recipe_id = ?
            AND raw_material_id = ?`,
        [index + 1, recipeId, Number(item.raw_material_id)]
      );
    }

    const outputs = Array.isArray(payload.p_outputs) ? payload.p_outputs : [];
    for (const output of outputs) {
      const [outputRows] = await connection.query(
        `SELECT id
           FROM recipe_outputs
          WHERE recipe_id = ?
            AND product_id = ?
          LIMIT 1`,
        [recipeId, Number(output.product_id)]
      );
      const recipeOutputId = Number(outputRows[0]?.id || 0);
      if (!recipeOutputId) {
        continue;
      }

      const items = Array.isArray(output.items) ? output.items : [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        await connection.query(
          `UPDATE recipe_output_items
              SET sort_order = ?
            WHERE recipe_output_id = ?
              AND raw_material_id = ?
              AND concept = ?`,
          [
            index + 1,
            recipeOutputId,
            Number(item.raw_material_id),
            String(item.concept || "RELLENO"),
          ]
        );
      }
    }

    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const createRecipeVersion = async (recipeId, payload, actorUserId) => {
  const current = await getRecipeDetail({ recipeId });
  if (current.code !== 1) {
    return current;
  }

  const familyId = Number(current.data.recipe_family_id || current.data.id);
  const db = await connect();
  const [versionRows] = await db.query(
    `SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version
       FROM recipes
      WHERE recipe_family_id = ?`,
    [familyId]
  );
  const nextVersion = Number(versionRows[0]?.next_version || Number(current.data.version_no || 0) + 1);

  const result = await createCostingRecipe(payload, actorUserId);
  if (result.code !== 1) {
    return result;
  }

  const newRecipeId = Number(result.data?.recipe_id || 0);
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    await connection.query(
      `UPDATE recipes
          SET is_active = 0,
              is_current = 0,
              updated_at = CURRENT_TIMESTAMP
        WHERE recipe_family_id = ?
           OR id = ?`,
      [familyId, Number(recipeId)]
    );
    await connection.query(
      `UPDATE recipes
          SET recipe_family_id = ?,
              version_no = ?,
              is_active = 1,
              is_current = 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [familyId, nextVersion, newRecipeId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    ...result,
    message: "nueva version de receta creada",
    data: {
      ...(result.data || {}),
      version_no: nextVersion,
      previous_recipe_id: Number(recipeId),
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

const addRecipeOutput = async (payload, actorUserId) => {
  const out = await callProcedure("sp_recipe_output_add", [
    payload.p_recipe_id,
    payload.p_product_id || null,
    payload.p_expected_quantity || null,
    payload.p_packing_note || null,
    payload.p_sort_order || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const removeRecipeOutput = async (payload, actorUserId) => {
  const out = await callProcedure("sp_recipe_output_remove", [
    payload.p_recipe_id,
    payload.p_product_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const listRecipeOutputs = async (payload) => {
  const out = await callProcedure("sp_recipe_outputs_list", [
    payload.p_recipe_id,
  ]);
  return mapSpResult(out);
};

module.exports = {
  createRecipe,
  listRecipes,
  getRecipeDetail,
  getRecipeBaseData,
  createCostingRecipe,
  createRecipeVersion,
  addRecipeItem,
  removeRecipeItem,
  publishRecipeVersion,
  addRecipeOutput,
  removeRecipeOutput,
  listRecipeOutputs,
};
