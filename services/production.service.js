const { callProcedure, connect } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const listProductionOrders = async ({ status, search, page, pageSize }) => {
  const db = await connect();
  const currentPage = Math.max(Number(page || 1), 1);
  const currentPageSize = Math.min(Math.max(Number(pageSize || 20), 1), 100);
  const offset = (currentPage - 1) * currentPageSize;
  const filters = [];
  const values = [];

  if (status) {
    filters.push("po.status = ?");
    values.push(status);
  }

  if (search) {
    filters.push("(CAST(po.id AS CHAR) LIKE ? OR b.name LIKE ? OR po.notes LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const [rows] = await db.query(
    `
      SELECT
        po.id,
        po.source_order_id,
        po.branch_id,
        b.name AS branch_name,
        po.planned_date,
        po.status,
        po.notes,
        po.created_by,
        u.full_name AS created_by_name,
        po.created_at,
        po.updated_at,
        COUNT(poi.id) AS items_count,
        COALESCE(SUM(poi.planned_qty), 0) AS planned_qty,
        COALESCE(SUM(poi.produced_qty), 0) AS produced_qty,
        SUM(
          CASE
            WHEN poi.status = 'cancelled' THEN 0
            WHEN poi.status <> 'done' OR poi.produced_qty < poi.planned_qty THEN 1
            ELSE 0
          END
        ) AS pending_items
      FROM production_orders po
      INNER JOIN branches b ON b.id = po.branch_id
      LEFT JOIN users u ON u.id = po.created_by
      LEFT JOIN production_order_items poi ON poi.production_order_id = po.id
      ${whereClause}
      GROUP BY
        po.id,
        po.source_order_id,
        po.branch_id,
        b.name,
        po.planned_date,
        po.status,
        po.notes,
        po.created_by,
        u.full_name,
        po.created_at,
        po.updated_at
      ORDER BY po.created_at DESC, po.id DESC
      LIMIT ? OFFSET ?
    `,
    [...values, currentPageSize, offset]
  );

  return {
    code: 1,
    message: "ordenes de produccion listadas",
    data: {
      items: rows,
      page: currentPage,
      pageSize: currentPageSize,
    },
  };
};

const createProductionOrder = async (payload, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const branchId = Number(payload.p_branch_id || 0);
    if (!branchId) {
      await connection.rollback();
      return { code: 0, message: "selecciona una sucursal", data: null };
    }

    if (!payload.p_planned_date) {
      await connection.rollback();
      return { code: 0, message: "la fecha planificada es obligatoria", data: null };
    }

    const [branches] = await connection.query(
      "SELECT id FROM branches WHERE id = ? AND is_active = 1",
      [branchId]
    );

    if (!branches.length) {
      await connection.rollback();
      return { code: 0, message: "sucursal no encontrada o inactiva", data: null };
    }

    const [result] = await connection.query(
      `
        INSERT INTO production_orders (
          branch_id,
          planned_date,
          status,
          notes,
          created_by
        )
        VALUES (?, ?, 'draft', ?, ?)
      `,
      [
        branchId,
        payload.p_planned_date,
        payload.p_notes || null,
        actorUserId || null,
      ]
    );

    const productionOrderId = result.insertId;

    await connection.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
        VALUES (?, 'production_order.create', 'production_orders', ?, JSON_OBJECT('branch_id', ?, 'planned_date', ?))
      `,
      [
        actorUserId || null,
        String(productionOrderId),
        branchId,
        payload.p_planned_date,
      ]
    );

    await connection.commit();

    return {
      code: 1,
      message: "orden de produccion creada",
      data: {
        production_order_id: productionOrderId,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const listProductionOrderItems = async ({ productionOrderId }) => {
  const db = await connect();
  const [rows] = await db.query(
    `
      SELECT
        poi.id,
        poi.production_order_id,
        poi.product_id,
        p.sku AS product_sku,
        p.name AS product_name,
        poi.recipe_id,
        r.version_no AS recipe_version_no,
        r.output_quantity AS recipe_output_quantity,
        poi.planned_qty,
        poi.produced_qty,
        poi.status,
        poi.created_at,
        poi.updated_at
      FROM production_order_items poi
      INNER JOIN products p ON p.id = poi.product_id
      LEFT JOIN recipes r ON r.id = poi.recipe_id
      WHERE poi.production_order_id = ?
      ORDER BY p.name
    `,
    [productionOrderId]
  );

  return {
    code: 1,
    message: "items de orden de produccion listados",
    data: {
      items: rows,
    },
  };
};

const upsertProductionOrderItem = async (payload, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const productionOrderId = Number(payload.p_production_order_id || 0);
    const productId = Number(payload.p_product_id || 0);
    const recipeId = payload.p_recipe_id ? Number(payload.p_recipe_id) : null;
    const plannedQty = Number(payload.p_planned_qty || 0);

    if (!productionOrderId) {
      await connection.rollback();
      return { code: 0, message: "selecciona una orden de produccion", data: null };
    }

    if (!productId) {
      await connection.rollback();
      return { code: 0, message: "selecciona un producto", data: null };
    }

    if (!plannedQty || plannedQty <= 0) {
      await connection.rollback();
      return { code: 0, message: "la cantidad planificada debe ser mayor a 0", data: null };
    }

    const [orders] = await connection.query(
      "SELECT id, status FROM production_orders WHERE id = ? FOR UPDATE",
      [productionOrderId]
    );

    if (!orders.length) {
      await connection.rollback();
      return { code: 0, message: "orden de produccion no encontrada", data: null };
    }

    if (["completed", "cancelled"].includes(orders[0].status)) {
      await connection.rollback();
      return { code: 0, message: `la orden no permite cambios desde estado ${orders[0].status}`, data: null };
    }

    const [products] = await connection.query(
      "SELECT id FROM products WHERE id = ? AND is_active = 1 AND deleted_at IS NULL",
      [productId]
    );

    if (!products.length) {
      await connection.rollback();
      return { code: 0, message: "producto no encontrado o inactivo", data: null };
    }

    if (recipeId) {
      const [recipes] = await connection.query(
        `
          SELECT r.id
          FROM recipes r
          LEFT JOIN recipe_outputs ro ON ro.recipe_id = r.id
          WHERE r.id = ?
            AND r.is_active = 1
            AND COALESCE(ro.product_id, r.product_id) = ?
          LIMIT 1
        `,
        [recipeId, productId]
      );

      if (!recipes.length) {
        await connection.rollback();
        return { code: 0, message: "receta no encontrada, inactiva o no asociada al producto", data: null };
      }
    }

    const [result] = await connection.query(
      `
        INSERT INTO production_order_items (
          production_order_id,
          product_id,
          recipe_id,
          planned_qty,
          produced_qty,
          status
        )
        VALUES (?, ?, ?, ?, 0, 'pending')
      `,
      [productionOrderId, productId, recipeId, plannedQty]
    );

    await connection.query(
      "UPDATE production_orders SET status = 'planned', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'draft'",
      [productionOrderId]
    );

    await connection.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
        VALUES (?, 'production_order.item.create', 'production_orders', ?, JSON_OBJECT('product_id', ?, 'recipe_id', ?, 'planned_qty', ?))
      `,
      [
        actorUserId || null,
        String(productionOrderId),
        productId,
        recipeId,
        plannedQty,
      ]
    );

    await connection.commit();

    return {
      code: 1,
      message: "item de orden de produccion agregado",
      data: {
        production_order_item_id: result.insertId,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const registerProductionOrderItemResultLegacy = async (payload, actorUserId) => {
  const db = await connect();
  const productionOrderId = Number(payload.p_production_order_id || 0);
  const itemId = Number(payload.p_production_order_item_id || 0);
  const producedQty = Number(payload.p_produced_qty || 0);

  if (!productionOrderId) {
    return { code: 0, message: "selecciona una orden de produccion", data: null };
  }

  if (!itemId) {
    return { code: 0, message: "selecciona un item de produccion", data: null };
  }

  if (!producedQty || producedQty <= 0) {
    return { code: 0, message: "la cantidad producida debe ser mayor a 0", data: null };
  }

  const [items] = await db.query(
    `
      SELECT
        poi.id,
        poi.production_order_id,
        poi.product_id,
        poi.recipe_id,
        poi.planned_qty,
        poi.produced_qty,
        poi.status,
        po.branch_id,
        po.status AS order_status
      FROM production_order_items poi
      INNER JOIN production_orders po ON po.id = poi.production_order_id
      WHERE poi.id = ?
        AND poi.production_order_id = ?
    `,
    [itemId, productionOrderId]
  );

  if (!items.length) {
    return { code: 0, message: "item de orden de produccion no encontrado", data: null };
  }

  const item = items[0];
  if (["completed", "cancelled"].includes(item.order_status)) {
    return { code: 0, message: `la orden no permite registro desde estado ${item.order_status}`, data: null };
  }

  if (["done", "cancelled"].includes(item.status)) {
    return { code: 0, message: `el item no permite registro desde estado ${item.status}`, data: null };
  }

  if (!item.recipe_id) {
    return { code: 0, message: "el item no tiene receta asociada", data: null };
  }

  const newProducedQty = Number(item.produced_qty || 0) + producedQty;
  if (newProducedQty > Number(item.planned_qty || 0)) {
    return { code: 0, message: "la cantidad producida supera la cantidad planificada", data: null };
  }

  const [recipeRows] = await db.query(
    `
      SELECT COALESCE(ro.expected_quantity, r.output_quantity) AS output_quantity
      FROM recipes r
      LEFT JOIN recipe_outputs ro
        ON ro.recipe_id = r.id
       AND ro.product_id = ?
      WHERE r.id = ?
        AND r.is_active = 1
        AND COALESCE(ro.product_id, r.product_id) = ?
      LIMIT 1
    `,
    [item.product_id, item.recipe_id, item.product_id]
  );

  if (!recipeRows.length || Number(recipeRows[0].output_quantity || 0) <= 0) {
    return { code: 0, message: "receta no encontrada o sin cantidad de salida valida", data: null };
  }

  const factor = producedQty / Number(recipeRows[0].output_quantity);
  const [requirementRows] = await db.query(
    `
      SELECT
        ri.raw_material_id,
        rm.name AS raw_material_name,
        rm.unit AS raw_material_unit,
        ROUND((ri.quantity * ?) * (1 + (ri.wastage_percent / 100)), 3) AS required_qty,
        COALESCE(srm.quantity_on_hand, 0) AS available_qty
      FROM recipe_items ri
      INNER JOIN raw_materials rm ON rm.id = ri.raw_material_id
      LEFT JOIN stock_raw_materials srm
        ON srm.raw_material_id = ri.raw_material_id
       AND srm.branch_id = ?
      WHERE ri.recipe_id = ?
    `,
    [factor, item.branch_id, item.recipe_id]
  );

  const shortages = requirementRows.filter((row) => Number(row.available_qty || 0) < Number(row.required_qty || 0));
  if (shortages.length > 0) {
    const detail = shortages
      .map((row) => {
        const unit = row.raw_material_unit || "unidad";
        return `${row.raw_material_name}: necesitas ${Number(row.required_qty).toLocaleString("es-CO")} ${unit} y hay ${Number(row.available_qty).toLocaleString("es-CO")} ${unit}`;
      })
      .join("; ");

    return {
      code: 0,
      message: `No hay materia prima suficiente en la sucursal de la orden. ${detail}. Carga una entrada de ajuste en Inventario > Movimientos para esa misma sucursal.`,
      data: {
        shortages,
      },
    };
  }

  const spOut = await callProcedure("sp_register_production_result", [
    item.branch_id,
    item.product_id,
    item.recipe_id,
    producedQty,
    actorUserId || null,
    "production_order",
    productionOrderId,
    payload.p_notes || null,
  ]);
  const spResult = mapSpResult(spOut);

  if (spResult.code !== 1) {
    return spResult;
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const nextStatus = newProducedQty >= Number(item.planned_qty || 0) ? "done" : "in_progress";

    await connection.query(
      `
        UPDATE production_order_items
        SET produced_qty = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND production_order_id = ?
      `,
      [newProducedQty, nextStatus, itemId, productionOrderId]
    );

    await connection.query(
      `
        UPDATE production_orders
        SET status = CASE WHEN status IN ('draft', 'planned') THEN 'in_progress' ELSE status END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [productionOrderId]
    );

    await connection.commit();

    return {
      code: 1,
      message: "resultado de item de produccion registrado",
      data: {
        production_order_id: productionOrderId,
        production_order_item_id: itemId,
        produced_qty: newProducedQty,
        status: nextStatus,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const registerProductionOrderItemResult = async () => ({
  code: 0,
  message: "Este registro directo fue reemplazado. EnvÃƒÂ­a la producciÃƒÂ³n al panadero, finaliza el lote y registra el empaque; solo lo empacado entra al inventario de venta.",
  data: null,
});

void registerProductionOrderItemResultLegacy;

const updateProductionOrderItemPlan = async (payload, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const productionOrderId = Number(payload.p_production_order_id || 0);
    const itemId = Number(payload.p_production_order_item_id || 0);
    const plannedQty = Number(payload.p_planned_qty || 0);

    if (!productionOrderId) {
      await connection.rollback();
      return { code: 0, message: "selecciona una orden de produccion", data: null };
    }

    if (!itemId) {
      await connection.rollback();
      return { code: 0, message: "selecciona un item de produccion", data: null };
    }

    if (!plannedQty || plannedQty <= 0) {
      await connection.rollback();
      return { code: 0, message: "la cantidad planificada debe ser mayor a 0", data: null };
    }

    const [items] = await connection.query(
      `
        SELECT
          poi.id,
          poi.planned_qty,
          poi.produced_qty,
          poi.status,
          po.status AS order_status
        FROM production_order_items poi
        INNER JOIN production_orders po ON po.id = poi.production_order_id
        WHERE poi.id = ?
          AND poi.production_order_id = ?
        FOR UPDATE
      `,
      [itemId, productionOrderId]
    );

    if (!items.length) {
      await connection.rollback();
      return { code: 0, message: "item de orden de produccion no encontrado", data: null };
    }

    const item = items[0];
    if (["completed", "cancelled"].includes(item.order_status)) {
      await connection.rollback();
      return { code: 0, message: `la orden no permite ajustes desde estado ${item.order_status}`, data: null };
    }

    if (item.status === "cancelled") {
      await connection.rollback();
      return { code: 0, message: "el item ya esta cancelado", data: null };
    }

    if (plannedQty < Number(item.produced_qty || 0)) {
      await connection.rollback();
      return {
        code: 0,
        message: "la cantidad planificada no puede ser menor a lo ya producido",
        data: {
          produced_qty: Number(item.produced_qty || 0),
        },
      };
    }

    const nextStatus = Number(item.produced_qty || 0) >= plannedQty ? "done" : Number(item.produced_qty || 0) > 0 ? "in_progress" : "pending";

    await connection.query(
      `
        UPDATE production_order_items
        SET planned_qty = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND production_order_id = ?
      `,
      [plannedQty, nextStatus, itemId, productionOrderId]
    );

    await connection.query(
      `
        UPDATE production_orders
        SET status = CASE
              WHEN status = 'draft' THEN 'planned'
              ELSE status
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [productionOrderId]
    );

    await connection.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
        VALUES (?, 'production_order.item.plan_update', 'production_order_items', ?, JSON_OBJECT('production_order_id', ?, 'previous_planned_qty', ?, 'planned_qty', ?))
      `,
      [
        actorUserId || null,
        String(itemId),
        productionOrderId,
        Number(item.planned_qty || 0),
        plannedQty,
      ]
    );

    await connection.commit();

    return {
      code: 1,
      message: "cantidad planificada ajustada",
      data: {
        production_order_id: productionOrderId,
        production_order_item_id: itemId,
        planned_qty: plannedQty,
        status: nextStatus,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const cancelProductionOrderItem = async (payload, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const productionOrderId = Number(payload.p_production_order_id || 0);
    const itemId = Number(payload.p_production_order_item_id || 0);
    const reason = payload.p_reason || null;

    const [items] = await connection.query(
      `
        SELECT poi.id, poi.produced_qty, poi.status, po.status AS order_status
        FROM production_order_items poi
        INNER JOIN production_orders po ON po.id = poi.production_order_id
        WHERE poi.id = ?
          AND poi.production_order_id = ?
        FOR UPDATE
      `,
      [itemId, productionOrderId]
    );

    if (!items.length) {
      await connection.rollback();
      return { code: 0, message: "item de orden de produccion no encontrado", data: null };
    }

    const item = items[0];
    if (["completed", "cancelled"].includes(item.order_status)) {
      await connection.rollback();
      return { code: 0, message: `la orden no permite cancelar items desde estado ${item.order_status}`, data: null };
    }

    if (Number(item.produced_qty || 0) > 0) {
      await connection.rollback();
      return { code: 0, message: "no se puede cancelar un item que ya tiene produccion registrada; ajusta la cantidad planificada al producido", data: null };
    }

    await connection.query(
      "UPDATE production_order_items SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND production_order_id = ?",
      [itemId, productionOrderId]
    );

    await connection.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
        VALUES (?, 'production_order.item.cancel', 'production_order_items', ?, JSON_OBJECT('production_order_id', ?, 'reason', ?))
      `,
      [actorUserId || null, String(itemId), productionOrderId, reason]
    );

    await connection.commit();

    return {
      code: 1,
      message: "item planificado cancelado",
      data: {
        production_order_id: productionOrderId,
        production_order_item_id: itemId,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

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

const findActiveBakerForUser = async (dbOrConnection, userId) => {
  if (!userId) return null;

  const [rows] = await dbOrConnection.query(
    `
      SELECT
        e.id,
        COALESCE(u.full_name, e.employee_code, CONCAT('Panadero #', e.id)) AS name
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      WHERE e.user_id = ?
        AND e.job_type = 'baker'
        AND e.status = 'active'
        AND e.deleted_at IS NULL
      LIMIT 1
    `,
    [Number(userId)]
  );

  return rows[0] || null;
};

const listMyProductionBaseData = async ({ userId } = {}) => {
  const db = await connect();
  const baker = await findActiveBakerForUser(db, userId);

  const [branches] = await db.query(
    `
      SELECT id, name
      FROM branches
      WHERE is_active = 1
      ORDER BY name
    `
  );

  const [recipes] = await db.query(
    `
      SELECT
        r.id,
        r.product_id,
        r.version_no,
        r.output_quantity,
        r.notes,
        COALESCE(NULLIF(SUBSTRING_INDEX(r.notes, ' - ', 1), ''), p.name, CONCAT('Receta #', r.id)) AS recipe_name,
        p.name AS product_name
      FROM recipes r
      LEFT JOIN products p ON p.id = r.product_id
      WHERE r.is_active = 1
        AND r.is_current = 1
      ORDER BY recipe_name, r.version_no DESC, r.id DESC
    `
  );

  let outputRows = [];
  if (recipes.length) {
    const recipeIds = recipes.map((recipe) => Number(recipe.id));
    const placeholders = recipeIds.map(() => '?').join(', ');
    const [rows] = await db.query(
      `
        SELECT
          ro.recipe_id,
          ro.product_id,
          p.name AS product_name,
          p.sku AS product_sku,
          ro.expected_quantity,
          ro.packing_note
        FROM recipe_outputs ro
        INNER JOIN products p ON p.id = ro.product_id
        WHERE ro.recipe_id IN (${placeholders})
        ORDER BY ro.recipe_id, p.name
      `,
      recipeIds
    );
    outputRows = rows;
  }

  const outputsByRecipe = outputRows.reduce((acc, output) => {
    const key = String(output.recipe_id);
    if (!acc[key]) acc[key] = [];
    acc[key].push(output);
    return acc;
  }, {});

  return {
    code: 1,
    message: 'datos de produccion del panadero obtenidos',
    data: {
      baker,
      branches,
      recipes: recipes.map((recipe) => ({
        ...recipe,
        outputs: outputsByRecipe[String(recipe.id)] || [],
      })),
    },
  };
};

const registerMyProductionBatch = async (payload, actorUserId) => {
  const db = await connect();
  const baker = await findActiveBakerForUser(db, actorUserId);

  if (!baker) {
    return {
      code: 0,
      message: 'Tu usuario no tiene un empleado panadero activo asociado.',
      data: null,
    };
  }

  return registerProductionBatch(
    {
      ...payload,
      p_baker_employee_id: Number(baker.id),
    },
    actorUserId
  );
};
const registerProductionResult = async (payload, actorUserId) => {
  return {
    code: 0,
    message: "El registro manual fue reemplazado. Crea una asignaciÃƒÂ³n, finaliza la producciÃƒÂ³n y registra el empaque; solo las unidades empacadas quedan disponibles para vender.",
    data: null,
  };
};

const registerProductionBatch = async (payload, actorUserId, options = {}) => {
  const db = await connect();
  const connection = options.connection || await db.getConnection();
  const ownsTransaction = !options.connection;
  const branchId = Number(payload.p_branch_id || 0);
  const requestedRecipeId = Number(payload.p_recipe_id || 0);
  const bakerEmployeeId = Number(payload.p_baker_employee_id || 0);
  const batchQuantity = Number(payload.p_batch_quantity || 1);
  const selectedOutputs = Array.isArray(payload.p_outputs) ? payload.p_outputs : payload.p_outputs_json || [];
  const requestedOutputMap = new Map();
  selectedOutputs.forEach((item) => {
    const productId = Number(item.product_id);
    if (Number.isInteger(productId) && productId > 0) {
      requestedOutputMap.set(productId, item);
    }
  });
  const requestedProductIds = Array.from(requestedOutputMap.keys());

  if (!branchId || !requestedRecipeId || !bakerEmployeeId || batchQuantity <= 0) {
    if (ownsTransaction) connection.release();
    return {
      code: 0,
      message: "Completa sucursal, receta vigente, panadero y una cantidad de arrobas mayor a cero.",
      data: null,
    };
  }

  try {
    if (ownsTransaction) await connection.beginTransaction();

    const [recipeRows] = await connection.query(
      `SELECT current_recipe.id,
              current_recipe.recipe_family_id,
              current_recipe.version_no,
              current_recipe.notes
         FROM recipes requested
         INNER JOIN recipes current_recipe
           ON current_recipe.recipe_family_id = COALESCE(requested.recipe_family_id, requested.id)
          AND current_recipe.is_current = 1
          AND current_recipe.is_active = 1
        WHERE requested.id = ?
        ORDER BY current_recipe.version_no DESC
        LIMIT 1
        FOR UPDATE`,
      [requestedRecipeId]
    );

    if (!recipeRows.length) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "La receta no existe o no tiene una versiÃƒÂ³n vigente.", data: null };
    }

    const recipeId = Number(recipeRows[0].id);
    const [branchRows] = await connection.query(
      "SELECT id, name FROM branches WHERE id = ? AND is_active = 1 LIMIT 1",
      [branchId]
    );
    if (!branchRows.length) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "La sucursal no existe o estÃƒÂ¡ inactiva.", data: null };
    }

    const [bakerRows] = await connection.query(
      `SELECT e.id, e.user_id, u.full_name
         FROM employees e
         INNER JOIN users u ON u.id = e.user_id
        WHERE e.id = ?
          AND e.job_type = 'baker'
          AND e.status = 'active'
          AND e.deleted_at IS NULL
        LIMIT 1`,
      [bakerEmployeeId]
    );
    if (!bakerRows.length) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "El panadero no existe o estÃƒÂ¡ inactivo.", data: null };
    }

    const [availableOutputs] = await connection.query(
      `SELECT ro.id, ro.product_id, ro.expected_quantity, ro.packing_note, p.name AS product_name
         FROM recipe_outputs ro
         INNER JOIN products p ON p.id = ro.product_id
        WHERE ro.recipe_id = ?
        ORDER BY ro.sort_order, ro.id`,
      [recipeId]
    );
    const selectedProductIds = requestedProductIds.length
      ? requestedProductIds
      : availableOutputs.map((output) => Number(output.product_id));
    const outputRows = availableOutputs.filter((output) => selectedProductIds.includes(Number(output.product_id)));

    if (!outputRows.length || outputRows.length !== new Set(selectedProductIds).size) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "Selecciona productos finales que pertenezcan a la versiÃƒÂ³n vigente de la receta.", data: null };
    }

    const outputPlaceholders = selectedProductIds.map(() => "?").join(",");
    const [materialRows] = await connection.query(
      `
        SELECT
          usage_rows.raw_material_id,
          rm.name AS raw_material_name,
          rm.unit AS raw_material_unit,
          rm.unit_cost,
          ROUND(SUM(usage_rows.required_qty), 3) AS required_qty
        FROM (
          SELECT
            ri.raw_material_id,
            (ri.quantity * ?) * (1 + (ri.wastage_percent / 100)) AS required_qty
          FROM recipe_items ri
          WHERE ri.recipe_id = ?

          UNION ALL

          SELECT
            roi.raw_material_id,
            (roi.quantity * ?) * (1 + (roi.wastage_percent / 100)) AS required_qty
          FROM recipe_output_items roi
          INNER JOIN recipe_outputs ro ON ro.id = roi.recipe_output_id
          WHERE ro.recipe_id = ?
            AND ro.product_id IN (${outputPlaceholders})
        ) usage_rows
        INNER JOIN raw_materials rm ON rm.id = usage_rows.raw_material_id
        GROUP BY usage_rows.raw_material_id, rm.name, rm.unit, rm.unit_cost
        ORDER BY rm.name
      `,
      [batchQuantity, recipeId, batchQuantity, recipeId, ...selectedProductIds]
    );

    for (const material of materialRows) {
      await connection.query(
        `INSERT IGNORE INTO stock_raw_materials (branch_id, raw_material_id, quantity_on_hand, min_stock)
         VALUES (?, ?, 0, 0)`,
        [branchId, Number(material.raw_material_id)]
      );
    }

    const materialIds = materialRows.map((material) => Number(material.raw_material_id));
    const stockByMaterial = new Map();
    if (materialIds.length) {
      const stockPlaceholders = materialIds.map(() => "?").join(",");
      const [stockRows] = await connection.query(
        `SELECT raw_material_id, quantity_on_hand
           FROM stock_raw_materials
          WHERE branch_id = ?
            AND raw_material_id IN (${stockPlaceholders})
          FOR UPDATE`,
        [branchId, ...materialIds]
      );
      stockRows.forEach((row) => stockByMaterial.set(Number(row.raw_material_id), Number(row.quantity_on_hand || 0)));
    }

    const shortages = materialRows
      .filter((material) => (stockByMaterial.get(Number(material.raw_material_id)) || 0) < Number(material.required_qty || 0))
      .map((material) => ({
        raw_material_id: Number(material.raw_material_id),
        raw_material_name: material.raw_material_name,
        required_qty: Number(material.required_qty || 0),
        available_qty: stockByMaterial.get(Number(material.raw_material_id)) || 0,
        unit: material.raw_material_unit === "ml" ? "ml" : "g",
      }));

    if (shortages.length) {
      if (ownsTransaction) await connection.rollback();
      const details = shortages
        .map((item) => `${item.raw_material_name}: necesitas ${item.required_qty.toLocaleString("es-CO")} ${item.unit} y hay ${item.available_qty.toLocaleString("es-CO")} ${item.unit}`)
        .join("; ");
      return {
        code: 0,
        message: `No hay materia prima suficiente en ${branchRows[0].name}. ${details}. Registra una entrada de inventario y vuelve a intentarlo.`,
        data: { shortages },
      };
    }

    const [batchInsert] = await connection.query(
      `INSERT INTO production_batches (
         branch_id, recipe_id, baker_employee_id, produced_date, batch_quantity,
         status, notes, created_by
       ) VALUES (?, ?, ?, COALESCE(?, CURRENT_DATE), ?, 'pending_packaging', ?, ?)`,
      [
        branchId,
        recipeId,
        bakerEmployeeId,
        payload.p_produced_date || null,
        batchQuantity,
        payload.p_notes || null,
        actorUserId || null,
      ]
    );
    const productionBatchId = Number(batchInsert.insertId);

    for (const material of materialRows) {
      const quantity = Number(material.required_qty || 0);
      await connection.query(
        `UPDATE stock_raw_materials
            SET quantity_on_hand = quantity_on_hand - ?
          WHERE branch_id = ?
            AND raw_material_id = ?`,
        [quantity, branchId, Number(material.raw_material_id)]
      );
      await connection.query(
        `INSERT INTO inventory_movements (
           branch_id, item_type, raw_material_id, product_id, movement_type,
           quantity, unit_cost, reference_type, reference_id, notes, created_by
         ) VALUES (?, 'raw_material', ?, NULL, 'production_out', ?, ?, 'production_batch', ?, ?, ?)`,
        [
          branchId,
          Number(material.raw_material_id),
          quantity,
          material.unit_cost ?? null,
          productionBatchId,
          `Consumo automÃƒÂ¡tico de receta V${recipeRows[0].version_no}`,
          actorUserId || null,
        ]
      );
    }

    for (const output of outputRows) {
      const requestedOutput = requestedOutputMap.get(Number(output.product_id));
      const requestedProducedQuantity = requestedOutput && requestedOutput.produced_quantity !== undefined
        ? Number(requestedOutput.produced_quantity)
        : null;
      const producedQuantity = requestedProducedQuantity !== null
        ? Math.round(requestedProducedQuantity * 1000) / 1000
        : Math.round(Number(output.expected_quantity) * batchQuantity);

      if (!Number.isFinite(producedQuantity) || producedQuantity <= 0 || !Number.isInteger(producedQuantity)) {
        if (ownsTransaction) await connection.rollback();
        return { code: 0, message: `La cantidad realizada de ${output.product_name || 'producto'} debe ser un numero entero mayor a cero.`, data: null };
      }

      await connection.query(
        `INSERT INTO production_batch_outputs (
           production_batch_id, product_id, expected_quantity, produced_quantity,
           baker_reported_by, baker_reported_at, packing_note
         ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [
          productionBatchId,
          Number(output.product_id),
          Number(output.expected_quantity),
          producedQuantity,
          actorUserId || null,
          output.packing_note || null,
        ]
      );
    }

    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'production_batch.register_current_recipe', 'production_batches', ?,
         JSON_OBJECT('recipe_id', ?, 'version_no', ?, 'baker_employee_id', ?, 'arrobas', ?, 'outputs', ?))`,
      [
        actorUserId || null,
        String(productionBatchId),
        recipeId,
        Number(recipeRows[0].version_no),
        bakerEmployeeId,
        batchQuantity,
        outputRows.length,
      ]
    );

    if (ownsTransaction) await connection.commit();
    return {
      code: 1,
      message: "Produccion registrada. Las materias primas fueron descontadas correctamente.",
      data: {
        production_batch_id: productionBatchId,
        recipe_id: recipeId,
        recipe_version: Number(recipeRows[0].version_no),
      },
    };
  } catch (error) {
    if (ownsTransaction) await connection.rollback();
    throw error;
  } finally {
    if (ownsTransaction) connection.release();
  }
};

const listPendingPackaging = async ({ branchId, search } = {}) => {
  const out = await callProcedure("sp_packing_pending_list", [
    branchId || null,
    search || null,
  ]);
  return mapSpResult(out);
};

const createPackingReport = async (payload, actorUserId) => {
  const items = Array.isArray(payload.p_items) ? payload.p_items : payload.p_items_json || [];
  const outputIds = items.map((item) => Number(item.production_batch_output_id));
  const validOutputIds = outputIds.filter((id) => Number.isInteger(id) && id > 0);
  const validMissingReasons = new Set([
    "count_difference",
    "handling_loss",
    "suspected_theft",
    "other",
  ]);

  if (!items.length) {
    return { code: 0, message: "Agrega al menos un producto contado.", data: null };
  }

  if (validOutputIds.length !== items.length) {
    return { code: 0, message: "Hay un producto de produccion invalido en el reporte.", data: null };
  }

  if (new Set(validOutputIds).size !== validOutputIds.length) {
    return {
      code: 0,
      message: "Cada producto debe aparecer una sola vez en el reporte de conteo.",
      data: null,
    };
  }

  const hasInvalidQuantity = items.some((item) => {
    const counted = Number(item.counted_quantity || 0);
    const packed = Number(item.packed_quantity || 0);
    const damaged = Number(item.damaged_quantity || 0);
    const missing = Number(item.missing_quantity || 0);

    return [counted, packed, damaged, missing].some((value) => !Number.isFinite(value) || value < 0)
      || counted <= 0
      || packed + damaged > counted;
  });

  if (hasInvalidQuantity) {
    return {
      code: 0,
      message: "Revisa las cantidades: el conteo debe ser mayor a cero y empacados/danados no pueden superar lo contado.",
      data: null,
    };
  }

  const unjustifiedMissing = items.some((item) => {
    const missing = Number(item.missing_quantity || 0);
    return missing > 0
      && (!validMissingReasons.has(item.missing_reason) || !String(item.notes || "").trim());
  });

  if (unjustifiedMissing) {
    return {
      code: 0,
      message: "Todo faltante debe incluir un motivo y una explicacion.",
      data: null,
    };
  }

  const out = await callProcedure("sp_packing_report_create", [
    payload.p_production_batch_id || null,
    payload.p_packer_employee_id || null,
    payload.p_packed_date || null,
    JSON.stringify(items),
    payload.p_notes || null,
    actorUserId || null,
  ]);
  const result = mapSpResult(out);

  if (result.code === 1 && validOutputIds.length) {
    const db = await connect();
    await db.query(
      `UPDATE production_batch_outputs
          SET counted_by = ?,
              counted_at = CURRENT_TIMESTAMP
        WHERE id IN (?)
          AND counted_quantity > 0`,
      [actorUserId || null, validOutputIds]
    );
  }

  return result;
};
const listJustifiedShortages = async ({
  branchId,
  productId,
  missingReason,
  search,
  dateFrom,
  dateTo,
  page,
  pageSize,
} = {}) => {
  const db = await connect();
  const filters = ["pri.missing_quantity > 0"];
  const params = [];
  const limit = Math.min(Math.max(Number(pageSize || 10), 1), 100);
  const currentPage = Math.max(Number(page || 1), 1);
  const offset = (currentPage - 1) * limit;

  if (branchId) {
    filters.push("pb.branch_id = ?");
    params.push(Number(branchId));
  }

  if (productId) {
    filters.push("pri.product_id = ?");
    params.push(Number(productId));
  }

  if (missingReason && missingReason !== "all") {
    filters.push("pri.missing_reason = ?");
    params.push(missingReason);
  }

  if (dateFrom) {
    filters.push("pr.packed_date >= ?");
    params.push(String(dateFrom).slice(0, 10));
  }

  if (dateTo) {
    filters.push("pr.packed_date <= ?");
    params.push(String(dateTo).slice(0, 10));
  }

  if (search) {
    const like = `%${search}%`;
    filters.push(
      `(p.name LIKE ?
        OR b.name LIKE ?
        OR u.full_name LIKE ?
        OR pri.notes LIKE ?
        OR CAST(pb.id AS CHAR) LIKE ?)`
    );
    params.push(like, like, like, like, like);
  }

  const where = `WHERE ${filters.join(" AND ")}`;
  const joins = `
    FROM packing_report_items pri
    INNER JOIN packing_reports pr ON pr.id = pri.packing_report_id
    INNER JOIN production_batches pb ON pb.id = pr.production_batch_id
    INNER JOIN branches b ON b.id = pb.branch_id
    INNER JOIN products p ON p.id = pri.product_id
    INNER JOIN employees e ON e.id = pr.packer_employee_id
    INNER JOIN users u ON u.id = e.user_id
  `;

  const [rows] = await db.query(
    `
      SELECT
        pri.id,
        pri.packing_report_id,
        pri.production_batch_output_id,
        pb.id AS production_batch_id,
        pb.branch_id,
        b.name AS branch_name,
        pri.product_id,
        p.name AS product_name,
        pri.missing_quantity,
        pri.missing_reason,
        pri.notes,
        pr.packer_employee_id,
        u.full_name AS reported_by_name,
        pr.packed_date,
        pri.created_at
      ${joins}
      ${where}
      ORDER BY pr.packed_date DESC, pri.created_at DESC, pri.id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );

  const [summaryRows] = await db.query(
    `
      SELECT
        COUNT(*) AS cases_count,
        COALESCE(SUM(pri.missing_quantity), 0) AS missing_quantity,
        COUNT(DISTINCT pri.product_id) AS affected_products,
        COALESCE(SUM(CASE WHEN pri.missing_reason = 'suspected_theft' THEN 1 ELSE 0 END), 0) AS suspected_theft_cases
      ${joins}
      ${where}
    `,
    params
  );

  const [topProductRows] = await db.query(
    `
      SELECT
        pri.product_id,
        p.name AS product_name,
        COALESCE(SUM(pri.missing_quantity), 0) AS missing_quantity,
        COUNT(*) AS cases_count
      ${joins}
      ${where}
      GROUP BY pri.product_id, p.name
      ORDER BY missing_quantity DESC, cases_count DESC, p.name
      LIMIT 1
    `,
    params
  );

  return {
    code: 1,
    message: "faltantes justificados listados",
    data: {
      items: rows,
      page: currentPage,
      pageSize: limit,
      total: Number(summaryRows[0]?.cases_count || 0),
      summary: {
        cases_count: Number(summaryRows[0]?.cases_count || 0),
        missing_quantity: Number(summaryRows[0]?.missing_quantity || 0),
        affected_products: Number(summaryRows[0]?.affected_products || 0),
        suspected_theft_cases: Number(summaryRows[0]?.suspected_theft_cases || 0),
        top_product: topProductRows[0] || null,
      },
    },
  };
};

const registerProductionDamage = async (payload, actorUserId) => {
  const out = await callProcedure("sp_production_damage_register", [
    payload.p_production_batch_id || null,
    payload.p_production_batch_output_id || null,
    payload.p_product_id || null,
    payload.p_responsible_employee_id || null,
    payload.p_damage_stage || null,
    payload.p_quantity || null,
    payload.p_damaged_date || null,
    payload.p_notes || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const getRawMaterialUsageReport = async ({ dateFrom, dateTo, branchId } = {}) => {
  const out = await callProcedure("sp_raw_material_usage_report", [
    dateFrom || null,
    dateTo || null,
    branchId || null,
  ]);
  return mapSpResult(out);
};

const getRawMaterialUsageByProductReport = async ({
  dateFrom,
  dateTo,
  branchId,
  recipeId,
  productId,
  rawMaterialId,
} = {}) => {
  const db = await connect();
  const today = new Date().toISOString().slice(0, 10);
  const reportDateFrom = dateFrom || dateTo || today;
  const reportDateTo = dateTo || dateFrom || today;

  const baseFilters = ["pb.produced_date >= ?", "pb.produced_date <= ?", "pb.status <> 'cancelled'"];
  const baseValues = [reportDateFrom, reportDateTo];
  const directFilters = ["pb.produced_date >= ?", "pb.produced_date <= ?", "pb.status <> 'cancelled'"];
  const directValues = [reportDateFrom, reportDateTo];

  if (branchId) {
    baseFilters.push("pb.branch_id = ?");
    baseValues.push(Number(branchId));
    directFilters.push("pb.branch_id = ?");
    directValues.push(Number(branchId));
  }

  if (recipeId) {
    baseFilters.push("pb.recipe_id = ?");
    baseValues.push(Number(recipeId));
    directFilters.push("pb.recipe_id = ?");
    directValues.push(Number(recipeId));
  }

  if (productId) {
    baseFilters.push("pbo.product_id = ?");
    baseValues.push(Number(productId));
    directFilters.push("pom.product_id = ?");
    directValues.push(Number(productId));
  }

  if (rawMaterialId) {
    baseFilters.push("ri.raw_material_id = ?");
    baseValues.push(Number(rawMaterialId));
    directFilters.push("pom.raw_material_id = ?");
    directValues.push(Number(rawMaterialId));
  }

  const [rows] = await db.query(
    `
      SELECT
        usage_rows.usage_date,
        usage_rows.branch_id,
        usage_rows.branch_name,
        usage_rows.recipe_id,
        usage_rows.recipe_name,
        usage_rows.recipe_version,
        usage_rows.product_id,
        usage_rows.product_name,
        usage_rows.product_sku,
        usage_rows.raw_material_id,
        usage_rows.raw_material_name,
        usage_rows.raw_material_unit,
        usage_rows.raw_material_category,
        COALESCE(SUM(usage_rows.base_quantity), 0) AS base_quantity,
        COALESCE(SUM(usage_rows.direct_quantity), 0) AS direct_quantity,
        COALESCE(SUM(usage_rows.base_quantity + usage_rows.direct_quantity), 0) AS total_quantity,
        COALESCE(MAX(usage_rows.produced_quantity), 0) AS produced_quantity,
        COUNT(DISTINCT usage_rows.production_batch_id) AS batches_count
      FROM (
        SELECT
          pb.produced_date AS usage_date,
          pb.id AS production_batch_id,
          pb.branch_id,
          b.name AS branch_name,
          pb.recipe_id,
          COALESCE(NULLIF(SUBSTRING_INDEX(r.notes, ' - ', 1), ''), recipe_product.name, CONCAT('Receta #', r.id)) AS recipe_name,
          r.version_no AS recipe_version,
          pbo.product_id,
          p.name AS product_name,
          p.sku AS product_sku,
          ri.raw_material_id,
          rm.name AS raw_material_name,
          rm.unit AS raw_material_unit,
          rmc.name AS raw_material_category,
          COALESCE(SUM(
            (ri.quantity * (1 + COALESCE(ri.wastage_percent, 0) / 100) * pb.batch_quantity)
            * CASE
                WHEN COALESCE(output_totals.total_produced, 0) > 0
                  THEN COALESCE(pbo.produced_quantity, 0) / output_totals.total_produced
                ELSE 0
              END
          ), 0) AS base_quantity,
          0 AS direct_quantity,
          COALESCE(SUM(pbo.produced_quantity), 0) AS produced_quantity
        FROM production_batches pb
        INNER JOIN branches b ON b.id = pb.branch_id
        INNER JOIN recipes r ON r.id = pb.recipe_id
        LEFT JOIN products recipe_product ON recipe_product.id = r.product_id
        INNER JOIN recipe_items ri ON ri.recipe_id = r.id
        INNER JOIN raw_materials rm ON rm.id = ri.raw_material_id
        LEFT JOIN raw_material_categories rmc ON rmc.id = rm.category_id
        INNER JOIN production_batch_outputs pbo ON pbo.production_batch_id = pb.id
        INNER JOIN products p ON p.id = pbo.product_id
        LEFT JOIN (
          SELECT production_batch_id, COALESCE(SUM(produced_quantity), 0) AS total_produced
          FROM production_batch_outputs
          GROUP BY production_batch_id
        ) output_totals ON output_totals.production_batch_id = pb.id
        WHERE ${baseFilters.join(" AND ")}
        GROUP BY
          pb.produced_date,
          pb.id,
          pb.branch_id,
          b.name,
          pb.recipe_id,
          r.notes,
          recipe_product.name,
          r.id,
          r.version_no,
          pbo.product_id,
          p.name,
          p.sku,
          ri.raw_material_id,
          rm.name,
          rm.unit,
          rmc.name

        UNION ALL

        SELECT
          pb.produced_date AS usage_date,
          pb.id AS production_batch_id,
          pb.branch_id,
          b.name AS branch_name,
          pb.recipe_id,
          COALESCE(NULLIF(SUBSTRING_INDEX(r.notes, ' - ', 1), ''), recipe_product.name, CONCAT('Receta #', r.id)) AS recipe_name,
          r.version_no AS recipe_version,
          pom.product_id,
          p.name AS product_name,
          p.sku AS product_sku,
          pom.raw_material_id,
          rm.name AS raw_material_name,
          rm.unit AS raw_material_unit,
          rmc.name AS raw_material_category,
          0 AS base_quantity,
          COALESCE(SUM(pom.quantity), 0) AS direct_quantity,
          COALESCE(MAX(pbo.produced_quantity), 0) AS produced_quantity
        FROM production_output_materials pom
        INNER JOIN production_batches pb ON pb.id = pom.production_batch_id
        INNER JOIN branches b ON b.id = pb.branch_id
        INNER JOIN recipes r ON r.id = pb.recipe_id
        LEFT JOIN products recipe_product ON recipe_product.id = r.product_id
        INNER JOIN products p ON p.id = pom.product_id
        INNER JOIN raw_materials rm ON rm.id = pom.raw_material_id
        LEFT JOIN raw_material_categories rmc ON rmc.id = rm.category_id
        LEFT JOIN production_batch_outputs pbo ON pbo.id = pom.production_batch_output_id
        WHERE ${directFilters.join(" AND ")}
        GROUP BY
          pb.produced_date,
          pb.id,
          pb.branch_id,
          b.name,
          pb.recipe_id,
          r.notes,
          recipe_product.name,
          r.id,
          r.version_no,
          pom.product_id,
          p.name,
          p.sku,
          pom.raw_material_id,
          rm.name,
          rm.unit,
          rmc.name
      ) usage_rows
      GROUP BY
        usage_rows.usage_date,
        usage_rows.branch_id,
        usage_rows.branch_name,
        usage_rows.recipe_id,
        usage_rows.recipe_name,
        usage_rows.recipe_version,
        usage_rows.product_id,
        usage_rows.product_name,
        usage_rows.product_sku,
        usage_rows.raw_material_id,
        usage_rows.raw_material_name,
        usage_rows.raw_material_unit,
        usage_rows.raw_material_category
      ORDER BY usage_rows.usage_date DESC, usage_rows.recipe_name, usage_rows.product_name, usage_rows.raw_material_name
    `,
    [...baseValues, ...directValues]
  );

  const normalizedRows = rows.map((row) => ({
    ...row,
    base_quantity: Number(row.base_quantity || 0),
    direct_quantity: Number(row.direct_quantity || 0),
    total_quantity: Number(row.total_quantity || 0),
    produced_quantity: Number(row.produced_quantity || 0),
    batches_count: Number(row.batches_count || 0),
  }));

  const summary = normalizedRows.reduce(
    (acc, row) => {
      acc.base_quantity += row.base_quantity;
      acc.direct_quantity += row.direct_quantity;
      acc.total_quantity += row.total_quantity;
      acc.products.add(Number(row.product_id));
      acc.recipes.add(Number(row.recipe_id));
      acc.days.add(String(row.usage_date));
      return acc;
    },
    { base_quantity: 0, direct_quantity: 0, total_quantity: 0, products: new Set(), recipes: new Set(), days: new Set() }
  );

  return {
    code: 1,
    message: "materias primas usadas por producto listadas",
    data: {
      date_from: reportDateFrom,
      date_to: reportDateTo,
      summary: {
        base_quantity: summary.base_quantity,
        direct_quantity: summary.direct_quantity,
        total_quantity: summary.total_quantity,
        products_count: summary.products.size,
        recipes_count: summary.recipes.size,
        days_count: summary.days.size,
      },
      rows: normalizedRows,
    },
  };
};
const getPackingSummaryReport = async ({ dateFrom, dateTo, branchId } = {}) => {
  const out = await callProcedure("sp_packing_summary_report", [
    dateFrom || null,
    dateTo || null,
    branchId || null,
  ]);
  return mapSpResult(out);
};

const getProductionDayReport = async ({ date, dateFrom, dateTo, branchId, recipeId } = {}) => {
  const db = await connect();
  const reportDate = date || new Date().toISOString().slice(0, 10);
  const reportDateFrom = dateFrom || reportDate;
  const reportDateTo = dateTo || dateFrom || reportDate;
  const filters = ["pb.produced_date >= ?", "pb.produced_date <= ?"];
  const values = [reportDateFrom, reportDateTo];

  if (branchId) {
    filters.push("pb.branch_id = ?");
    values.push(Number(branchId));
  }

  if (recipeId) {
    filters.push("pb.recipe_id = ?");
    values.push(Number(recipeId));
  }

  const whereClause = `WHERE ${filters.join(" AND ")}`;

  const [summaryRows] = await db.query(
    `
      SELECT
        COALESCE(b.batches_count, 0) AS batches_count,
        COALESCE(b.batch_quantity, 0) AS batch_quantity,
        COALESCE(o.produced_quantity, 0) AS produced_quantity,
        COALESCE(o.counted_quantity, 0) AS counted_quantity,
        COALESCE(o.packed_quantity, 0) AS packed_quantity,
        COALESCE(o.damaged_quantity, 0) AS damaged_quantity,
        COALESCE(o.missing_quantity, 0) AS missing_quantity,
        COALESCE(o.direct_delivered_quantity, 0) AS direct_delivered_quantity,
        COALESCE(o.pending_quantity, 0) AS pending_quantity,
        COALESCE(b.packed_batches, 0) AS packed_batches,
        COALESCE(b.pending_batches, 0) AS pending_batches
      FROM (
        SELECT
          COUNT(*) AS batches_count,
          COALESCE(SUM(pb.batch_quantity), 0) AS batch_quantity,
          SUM(CASE WHEN pb.status = 'packed' THEN 1 ELSE 0 END) AS packed_batches,
          SUM(CASE WHEN pb.status IN ('pending_packaging', 'partially_packed') THEN 1 ELSE 0 END) AS pending_batches
        FROM production_batches pb
        ${whereClause}
      ) b
      CROSS JOIN (
        SELECT
          COALESCE(SUM(pbo.produced_quantity), 0) AS produced_quantity,
          COALESCE(SUM(pbo.counted_quantity), 0) AS counted_quantity,
          COALESCE(SUM(pbo.packed_quantity), 0) AS packed_quantity,
          COALESCE(SUM(pbo.damaged_quantity), 0) AS damaged_quantity,
          COALESCE(SUM(pbo.missing_quantity), 0) AS missing_quantity,
          COALESCE(SUM(pbo.direct_delivered_quantity), 0) AS direct_delivered_quantity,
          COALESCE(SUM(GREATEST(
            pbo.produced_quantity - pbo.packed_quantity - pbo.damaged_quantity
            - pbo.missing_quantity - pbo.direct_delivered_quantity,
            0
          )), 0) AS pending_quantity
        FROM production_batches pb
        INNER JOIN production_batch_outputs pbo ON pbo.production_batch_id = pb.id
        ${whereClause}
      ) o
    `,
    [...values, ...values]
  );

  const [batchRows] = await db.query(
    `
      SELECT
        pb.id AS production_batch_id,
        pb.branch_id,
        b.name AS branch_name,
        pb.recipe_id,
        COALESCE(NULLIF(SUBSTRING_INDEX(r.notes, ' - ', 1), ''), p.name, CONCAT('Receta #', r.id)) AS recipe_name,
        pb.baker_employee_id,
        u.full_name AS baker_name,
        pb.produced_date,
        pb.batch_quantity,
        pb.status,
        COUNT(pbo.id) AS products_count,
        COALESCE(SUM(pbo.produced_quantity), 0) AS produced_quantity,
          COALESCE(SUM(pbo.counted_quantity), 0) AS counted_quantity,
          COALESCE(SUM(pbo.packed_quantity), 0) AS packed_quantity,
        COALESCE(SUM(pbo.damaged_quantity), 0) AS damaged_quantity,
        COALESCE(SUM(pbo.missing_quantity), 0) AS missing_quantity,
        COALESCE(SUM(pbo.direct_delivered_quantity), 0) AS direct_delivered_quantity,
        COALESCE(SUM(GREATEST(
          pbo.produced_quantity - pbo.packed_quantity - pbo.damaged_quantity
          - pbo.missing_quantity - pbo.direct_delivered_quantity,
          0
        )), 0) AS pending_quantity
      FROM production_batches pb
      INNER JOIN branches b ON b.id = pb.branch_id
      INNER JOIN recipes r ON r.id = pb.recipe_id
      LEFT JOIN products p ON p.id = r.product_id
      INNER JOIN employees e ON e.id = pb.baker_employee_id
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN production_batch_outputs pbo ON pbo.production_batch_id = pb.id
      ${whereClause}
      GROUP BY
        pb.id,
        pb.branch_id,
        b.name,
        pb.recipe_id,
        r.notes,
        p.name,
        pb.baker_employee_id,
        u.full_name,
        pb.produced_date,
        pb.batch_quantity,
        pb.status
      ORDER BY pb.id DESC
    `,
    values
  );

  const [productRows] = await db.query(
    `
      SELECT
        pbo.product_id,
        p.name AS product_name,
        p.sku AS product_sku,
        p.units_per_bag,
        CASE
          WHEN p.units_per_bag IS NULL OR p.units_per_bag <= 0 THEN NULL
          ELSE COALESCE(SUM(pbo.produced_quantity), 0) / p.units_per_bag
        END AS bags_count,
        COUNT(DISTINCT pb.id) AS batches_count,
        COALESCE(SUM(pbo.produced_quantity), 0) AS produced_quantity,
          COALESCE(SUM(pbo.counted_quantity), 0) AS counted_quantity,
          COALESCE(SUM(pbo.packed_quantity), 0) AS packed_quantity,
        COALESCE(SUM(pbo.damaged_quantity), 0) AS damaged_quantity,
        COALESCE(SUM(pbo.missing_quantity), 0) AS missing_quantity,
        COALESCE(SUM(pbo.direct_delivered_quantity), 0) AS direct_delivered_quantity,
        COALESCE(SUM(GREATEST(
          pbo.produced_quantity - pbo.packed_quantity - pbo.damaged_quantity
          - pbo.missing_quantity - pbo.direct_delivered_quantity,
          0
        )), 0) AS pending_quantity
      FROM production_batches pb
      INNER JOIN production_batch_outputs pbo ON pbo.production_batch_id = pb.id
      INNER JOIN products p ON p.id = pbo.product_id
      ${whereClause}
      GROUP BY pbo.product_id, p.name, p.sku, p.units_per_bag
      ORDER BY p.name
    `,
    values
  );

  let [rawMaterialRows] = await db.query(
    `
      SELECT
        im.raw_material_id,
        rm.name AS raw_material_name,
        rm.unit AS raw_material_unit,
        rm.purchase_package_name,
        rm.purchase_package_quantity,
        COALESCE(rm.unit_cost, 0) AS unit_cost,
        COALESCE(SUM(CASE WHEN im.reference_type = 'production_batch' THEN im.quantity ELSE 0 END), 0) AS base_quantity,
        COALESCE(SUM(CASE WHEN im.reference_type = 'production_output_material' THEN im.quantity ELSE 0 END), 0) AS posterior_quantity,
        COALESCE(SUM(im.quantity), 0) AS total_quantity,
        COALESCE(SUM(CASE WHEN im.reference_type = 'production_batch' THEN im.quantity * COALESCE(im.unit_cost, rm.unit_cost, 0) ELSE 0 END), 0) AS base_cost,
        COALESCE(SUM(CASE WHEN im.reference_type = 'production_output_material' THEN im.quantity * COALESCE(im.unit_cost, rm.unit_cost, 0) ELSE 0 END), 0) AS posterior_cost,
        COALESCE(SUM(im.quantity * COALESCE(im.unit_cost, rm.unit_cost, 0)), 0) AS total_cost
      FROM inventory_movements im
      INNER JOIN raw_materials rm ON rm.id = im.raw_material_id
      LEFT JOIN production_batches pb_base
        ON im.reference_type = 'production_batch'
       AND pb_base.id = im.reference_id
      LEFT JOIN production_output_materials pom_ref
        ON im.reference_type = 'production_output_material'
       AND pom_ref.id = im.reference_id
      LEFT JOIN production_batches pb_pom ON pb_pom.id = pom_ref.production_batch_id
      WHERE im.item_type = 'raw_material'
        AND im.movement_type = 'production_out'
        AND im.reference_type IN ('production_batch', 'production_output_material')
        AND DATE(im.moved_at) >= ?
        AND DATE(im.moved_at) <= ?
        AND (? IS NULL OR im.branch_id = ?)
        AND (? IS NULL OR COALESCE(pb_base.recipe_id, pb_pom.recipe_id) = ?)
      GROUP BY im.raw_material_id, rm.name, rm.unit, rm.purchase_package_name, rm.purchase_package_quantity, rm.unit_cost
      ORDER BY rm.name
    `,
    [reportDateFrom, reportDateTo, branchId || null, branchId || null, recipeId || null, recipeId || null]
  );

  const [correctionMaterialRows] = await db.query(
    `SELECT
       im.raw_material_id,
       rm.name AS raw_material_name,
       rm.unit AS raw_material_unit,
       rm.purchase_package_name,
       rm.purchase_package_quantity,
       COALESCE(rm.unit_cost, 0) AS unit_cost,
       COALESCE(SUM(CASE WHEN im.movement_type = 'production_out' THEN im.quantity ELSE -im.quantity END), 0) AS correction_quantity,
       COALESCE(SUM(CASE WHEN im.movement_type = 'production_out' THEN im.quantity ELSE -im.quantity END
         * COALESCE(im.unit_cost, rm.unit_cost, 0)), 0) AS correction_cost
     FROM inventory_movements im
     INNER JOIN raw_materials rm ON rm.id = im.raw_material_id
     INNER JOIN production_plan_product_corrections correction ON correction.id = im.reference_id
     INNER JOIN production_plan_product_details detail ON detail.id = correction.production_plan_product_detail_id
     INNER JOIN production_plan_outputs plan_output ON plan_output.id = detail.production_plan_output_id
     INNER JOIN production_plan_items plan_item ON plan_item.id = plan_output.production_plan_item_id
     WHERE im.item_type = 'raw_material'
       AND im.reference_type = 'production_correction'
       AND im.movement_type IN ('production_out', 'adjustment_in')
       AND DATE(im.moved_at) >= ? AND DATE(im.moved_at) <= ?
       AND (? IS NULL OR im.branch_id = ?)
       AND (? IS NULL OR plan_item.recipe_id = ?)
     GROUP BY im.raw_material_id, rm.name, rm.unit, rm.purchase_package_name, rm.purchase_package_quantity, rm.unit_cost`,
    [reportDateFrom, reportDateTo, branchId || null, branchId || null, recipeId || null, recipeId || null]
  );
  const rawMaterialMap = new Map(rawMaterialRows.map((row) => [Number(row.raw_material_id), { ...row }]));
  correctionMaterialRows.forEach((correction) => {
    const id = Number(correction.raw_material_id);
    const current = rawMaterialMap.get(id) || {
      ...correction,
      base_quantity: 0,
      posterior_quantity: 0,
      total_quantity: 0,
      base_cost: 0,
      posterior_cost: 0,
      total_cost: 0,
    };
    current.base_quantity = Number(current.base_quantity || 0) + Number(correction.correction_quantity || 0);
    current.total_quantity = Number(current.total_quantity || 0) + Number(correction.correction_quantity || 0);
    current.base_cost = Number(current.base_cost || 0) + Number(correction.correction_cost || 0);
    current.total_cost = Number(current.total_cost || 0) + Number(correction.correction_cost || 0);
    rawMaterialMap.set(id, current);
  });
  rawMaterialRows = Array.from(rawMaterialMap.values()).sort((a, b) => String(a.raw_material_name).localeCompare(String(b.raw_material_name)));

  const [posteriorRows] = await db.query(
    `
      SELECT
        pom.raw_material_id,
        rm.name AS raw_material_name,
        rm.unit AS raw_material_unit,
        pom.concept,
        p.id AS product_id,
        p.name AS product_name,
        COALESCE(SUM(pom.quantity), 0) AS quantity,
        COUNT(*) AS entries_count
      FROM production_output_materials pom
      INNER JOIN production_batches pb ON pb.id = pom.production_batch_id
      INNER JOIN raw_materials rm ON rm.id = pom.raw_material_id
      INNER JOIN products p ON p.id = pom.product_id
      ${whereClause}
      GROUP BY pom.raw_material_id, rm.name, rm.unit, pom.concept, p.id, p.name
      ORDER BY rm.name, p.name
    `,
    values
  );

  const [packerRows] = await db.query(
    `
      SELECT
        pr.packer_employee_id,
        u.full_name AS packer_name,
        COUNT(DISTINCT pr.id) AS reports_count,
        COALESCE(SUM(pri.counted_quantity), 0) AS counted_quantity,
        COALESCE(SUM(pri.packed_quantity), 0) AS packed_quantity,
        COALESCE(SUM(pri.damaged_quantity), 0) AS damaged_quantity,
        COALESCE(SUM(pri.missing_quantity), 0) AS missing_quantity
      FROM production_batches pb
      INNER JOIN packing_reports pr ON pr.production_batch_id = pb.id
      INNER JOIN employees e ON e.id = pr.packer_employee_id
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN packing_report_items pri ON pri.packing_report_id = pr.id
      ${whereClause}
      GROUP BY pr.packer_employee_id, u.full_name
      ORDER BY u.full_name
    `,
    values
  );

  const planProductFilters = ["history.planned_date >= ?", "history.planned_date <= ?"];
  const planProductValues = [reportDateFrom, reportDateTo];
  if (branchId) {
    planProductFilters.push("history.branch_id = ?");
    planProductValues.push(Number(branchId));
  }
  if (recipeId) {
    planProductFilters.push("history.recipe_id = ?");
    planProductValues.push(Number(recipeId));
  }
  const [planProductRows] = await db.query(
    `SELECT
       history.*,
       baker.full_name AS baker_name,
       reporter.full_name AS reported_by_name,
       GREATEST(
         history.batch_produced_quantity - history.packed_quantity - history.damaged_quantity
         - history.missing_quantity - history.direct_delivered_quantity,
         0
       ) AS pending_quantity
     FROM vw_production_plan_product_history history
     INNER JOIN employees baker_employee ON baker_employee.id = history.baker_employee_id
     INNER JOIN users baker ON baker.id = baker_employee.user_id
     LEFT JOIN users reporter ON reporter.id = history.reported_by
     WHERE ${planProductFilters.join(" AND ")}
     ORDER BY history.planned_date DESC, baker.full_name, history.recipe_id, history.product_name`,
    planProductValues
  );

  return {
    code: 1,
      message: "reporte diario de produccion generado",
    data: {
      date: reportDate,
      date_from: reportDateFrom,
      date_to: reportDateTo,
      summary: summaryRows[0] || {},
      batches: batchRows,
      products: productRows,
      raw_materials_usage: rawMaterialRows,
      posterior_materials: posteriorRows,
      packers: packerRows,
      plan_products: planProductRows,
    },
  };
};

const getProductionMonthReport = async ({ month, dateFrom, dateTo, branchId, recipeId } = {}) => {
  const db = await connect();
  const selectedMonth = month || new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = selectedMonth.split("-").map((value) => Number(value));
  const lastDay = year && monthNumber ? new Date(year, monthNumber, 0).getDate() : 1;
  const reportDateFrom = dateFrom || `${selectedMonth}-01`;
  const reportDateTo = dateTo || `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
  const dayReport = await getProductionDayReport({
    dateFrom: reportDateFrom,
    dateTo: reportDateTo,
    branchId,
    recipeId,
  });

  const rawMaterialsUsage = dayReport.data?.raw_materials_usage || [];
  const estimatedCost = rawMaterialsUsage.reduce((total, material) => {
    return total + Number(material.total_cost || 0);
  }, 0);
  let [recipeMaterialRows] = await db.query(
    `
      SELECT
        r.id AS recipe_id,
        COALESCE(NULLIF(SUBSTRING_INDEX(r.notes, ' - ', 1), ''), p.name, CONCAT('Receta #', r.id)) AS recipe_name,
        im.raw_material_id,
        rm.name AS raw_material_name,
        rm.unit AS raw_material_unit,
        rm.purchase_package_name,
        rm.purchase_package_quantity,
        COALESCE(SUM(im.quantity), 0) AS total_quantity,
        COALESCE(SUM(im.quantity * COALESCE(im.unit_cost, rm.unit_cost, 0)), 0) AS total_cost
      FROM inventory_movements im
      INNER JOIN raw_materials rm ON rm.id = im.raw_material_id
      LEFT JOIN production_batches pb_base
        ON im.reference_type = 'production_batch'
       AND pb_base.id = im.reference_id
      LEFT JOIN production_output_materials pom_ref
        ON im.reference_type = 'production_output_material'
       AND pom_ref.id = im.reference_id
      LEFT JOIN production_batches pb_pom ON pb_pom.id = pom_ref.production_batch_id
      INNER JOIN recipes r ON r.id = COALESCE(pb_base.recipe_id, pb_pom.recipe_id)
      LEFT JOIN products p ON p.id = r.product_id
      WHERE im.item_type = 'raw_material'
        AND im.movement_type = 'production_out'
        AND im.reference_type IN ('production_batch', 'production_output_material')
        AND DATE(im.moved_at) >= ?
        AND DATE(im.moved_at) <= ?
        AND (? IS NULL OR im.branch_id = ?)
        AND (? IS NULL OR r.id = ?)
      GROUP BY r.id, r.notes, p.name, im.raw_material_id, rm.name, rm.unit, rm.purchase_package_name, rm.purchase_package_quantity
      ORDER BY recipe_name, rm.name
    `,
    [reportDateFrom, reportDateTo, branchId || null, branchId || null, recipeId || null, recipeId || null]
  );

  const [recipeCorrectionRows] = await db.query(
    `SELECT
       recipe.id AS recipe_id,
       COALESCE(NULLIF(SUBSTRING_INDEX(recipe.notes, ' - ', 1), ''), recipe_product.name, CONCAT('Receta #', recipe.id)) AS recipe_name,
       im.raw_material_id,
       rm.name AS raw_material_name,
       rm.unit AS raw_material_unit,
       rm.purchase_package_name,
       rm.purchase_package_quantity,
       COALESCE(SUM(CASE WHEN im.movement_type = 'production_out' THEN im.quantity ELSE -im.quantity END), 0) AS total_quantity,
       COALESCE(SUM(CASE WHEN im.movement_type = 'production_out' THEN im.quantity ELSE -im.quantity END
         * COALESCE(im.unit_cost, rm.unit_cost, 0)), 0) AS total_cost
     FROM inventory_movements im
     INNER JOIN raw_materials rm ON rm.id = im.raw_material_id
     INNER JOIN production_plan_product_corrections correction ON correction.id = im.reference_id
     INNER JOIN production_plan_product_details detail ON detail.id = correction.production_plan_product_detail_id
     INNER JOIN production_plan_outputs plan_output ON plan_output.id = detail.production_plan_output_id
     INNER JOIN production_plan_items plan_item ON plan_item.id = plan_output.production_plan_item_id
     INNER JOIN recipes recipe ON recipe.id = plan_item.recipe_id
     LEFT JOIN products recipe_product ON recipe_product.id = recipe.product_id
     WHERE im.item_type = 'raw_material'
       AND im.reference_type = 'production_correction'
       AND im.movement_type IN ('production_out', 'adjustment_in')
       AND DATE(im.moved_at) >= ? AND DATE(im.moved_at) <= ?
       AND (? IS NULL OR im.branch_id = ?)
       AND (? IS NULL OR recipe.id = ?)
     GROUP BY recipe.id, recipe.notes, recipe_product.name, im.raw_material_id,
              rm.name, rm.unit, rm.purchase_package_name, rm.purchase_package_quantity`,
    [reportDateFrom, reportDateTo, branchId || null, branchId || null, recipeId || null, recipeId || null]
  );
  const recipeMaterialMap = new Map(recipeMaterialRows.map((row) => [`${row.recipe_id}-${row.raw_material_id}`, { ...row }]));
  recipeCorrectionRows.forEach((correction) => {
    const key = `${correction.recipe_id}-${correction.raw_material_id}`;
    const current = recipeMaterialMap.get(key) || { ...correction, total_quantity: 0, total_cost: 0 };
    current.total_quantity = Number(current.total_quantity || 0) + Number(correction.total_quantity || 0);
    current.total_cost = Number(current.total_cost || 0) + Number(correction.total_cost || 0);
    recipeMaterialMap.set(key, current);
  });
  recipeMaterialRows = Array.from(recipeMaterialMap.values()).sort((a, b) =>
    `${a.recipe_name}-${a.raw_material_name}`.localeCompare(`${b.recipe_name}-${b.raw_material_name}`)
  );

  let [flourDailyRows] = await db.query(
    `
      SELECT
        x.usage_date,
        x.raw_material_id,
        x.raw_material_name,
        x.raw_material_unit,
        x.category_id,
        x.category_name,
        x.purchase_package_name,
        x.purchase_package_quantity,
        x.total_quantity,
        x.total_grams,
        x.total_grams / 1000 AS total_kilos,
        CASE
          WHEN x.purchase_package_quantity IS NULL OR x.purchase_package_quantity <= 0 THEN NULL
          ELSE x.total_quantity / x.purchase_package_quantity
        END AS bags_used
      FROM (
        SELECT
          DATE(COALESCE(pb_base.produced_date, pb_pom.produced_date, im.moved_at)) AS usage_date,
          im.raw_material_id,
          rm.name AS raw_material_name,
          rm.unit AS raw_material_unit,
          rm.category_id,
          rmc.name AS category_name,
          rm.purchase_package_name,
          rm.purchase_package_quantity,
          COALESCE(SUM(im.quantity), 0) AS total_quantity,
          COALESCE(SUM(
            CASE rm.unit
              WHEN 'kg' THEN im.quantity * 1000
              WHEN 'lb' THEN im.quantity * 453.59237
              ELSE im.quantity
            END
          ), 0) AS total_grams
        FROM inventory_movements im
        INNER JOIN raw_materials rm ON rm.id = im.raw_material_id
        LEFT JOIN raw_material_categories rmc ON rmc.id = rm.category_id
        LEFT JOIN production_batches pb_base
          ON im.reference_type = 'production_batch'
         AND pb_base.id = im.reference_id
        LEFT JOIN production_output_materials pom_ref
          ON im.reference_type = 'production_output_material'
         AND pom_ref.id = im.reference_id
        LEFT JOIN production_batches pb_pom ON pb_pom.id = pom_ref.production_batch_id
        WHERE im.item_type = 'raw_material'
          AND im.movement_type = 'production_out'
          AND im.reference_type IN ('production_batch', 'production_output_material')
          AND DATE(im.moved_at) >= ?
          AND DATE(im.moved_at) <= ?
          AND (? IS NULL OR im.branch_id = ?)
          AND (? IS NULL OR COALESCE(pb_base.recipe_id, pb_pom.recipe_id) = ?)
          AND (
            LOWER(rm.name) LIKE '%harina%'
            OR LOWER(COALESCE(rmc.name, '')) LIKE '%harina%'
          )
        GROUP BY
          usage_date,
          im.raw_material_id,
          rm.name,
          rm.unit,
          rm.category_id,
          rmc.name,
          rm.purchase_package_name,
          rm.purchase_package_quantity
      ) x
      ORDER BY x.usage_date, x.raw_material_name
    `,
    [reportDateFrom, reportDateTo, branchId || null, branchId || null, recipeId || null, recipeId || null]
  );

  const [flourCorrectionRows] = await db.query(
    `SELECT
       DATE(im.moved_at) AS usage_date,
       im.raw_material_id,
       rm.name AS raw_material_name,
       rm.unit AS raw_material_unit,
       rm.category_id,
       category.name AS category_name,
       rm.purchase_package_name,
       rm.purchase_package_quantity,
       SUM(CASE WHEN im.movement_type = 'production_out' THEN im.quantity ELSE -im.quantity END) AS total_quantity,
       SUM((CASE WHEN im.movement_type = 'production_out' THEN im.quantity ELSE -im.quantity END)
         * CASE rm.unit WHEN 'kg' THEN 1000 WHEN 'lb' THEN 453.59237 ELSE 1 END) AS total_grams
     FROM inventory_movements im
     INNER JOIN raw_materials rm ON rm.id = im.raw_material_id
     LEFT JOIN raw_material_categories category ON category.id = rm.category_id
     INNER JOIN production_plan_product_corrections correction ON correction.id = im.reference_id
     INNER JOIN production_plan_product_details detail ON detail.id = correction.production_plan_product_detail_id
     INNER JOIN production_plan_outputs plan_output ON plan_output.id = detail.production_plan_output_id
     INNER JOIN production_plan_items plan_item ON plan_item.id = plan_output.production_plan_item_id
     WHERE im.reference_type = 'production_correction'
       AND im.item_type = 'raw_material'
       AND im.movement_type IN ('production_out', 'adjustment_in')
       AND DATE(im.moved_at) >= ? AND DATE(im.moved_at) <= ?
       AND (? IS NULL OR im.branch_id = ?)
       AND (? IS NULL OR plan_item.recipe_id = ?)
       AND (LOWER(rm.name) LIKE '%harina%' OR LOWER(COALESCE(category.name, '')) LIKE '%harina%')
     GROUP BY DATE(im.moved_at), im.raw_material_id, rm.name, rm.unit, rm.category_id,
              category.name, rm.purchase_package_name, rm.purchase_package_quantity`,
    [reportDateFrom, reportDateTo, branchId || null, branchId || null, recipeId || null, recipeId || null]
  );
  const flourMap = new Map(flourDailyRows.map((row) => [`${String(row.usage_date).slice(0, 10)}-${row.raw_material_id}`, { ...row }]));
  flourCorrectionRows.forEach((correction) => {
    const key = `${String(correction.usage_date).slice(0, 10)}-${correction.raw_material_id}`;
    const current = flourMap.get(key) || { ...correction, total_quantity: 0, total_grams: 0 };
    current.total_quantity = Number(current.total_quantity || 0) + Number(correction.total_quantity || 0);
    current.total_grams = Number(current.total_grams || 0) + Number(correction.total_grams || 0);
    current.total_kilos = current.total_grams / 1000;
    current.bags_used = Number(current.purchase_package_quantity || 0) > 0
      ? current.total_quantity / Number(current.purchase_package_quantity)
      : null;
    flourMap.set(key, current);
  });
  flourDailyRows = Array.from(flourMap.values()).sort((a, b) =>
    `${String(a.usage_date).slice(0, 10)}-${a.raw_material_name}`.localeCompare(`${String(b.usage_date).slice(0, 10)}-${b.raw_material_name}`)
  );

  const [returnRows] = await db.query(
    `
      SELECT
        sri.returned_product_id AS product_id,
        returned.name AS product_name,
        returned.sku AS product_sku,
        sr.sales_agent_user_id,
        seller.full_name AS sales_agent_name,
        COALESCE(SUM(sri.quantity), 0) AS returned_quantity,
        COALESCE(SUM(sri.returned_sale_value), 0) AS returned_value
      FROM sales_returns sr
      INNER JOIN sales_return_items sri ON sri.sales_return_id = sr.id
      INNER JOIN products returned ON returned.id = sri.returned_product_id
      INNER JOIN orders o ON o.id = sr.order_id
      INNER JOIN users seller ON seller.id = sr.sales_agent_user_id
      WHERE sr.status = 'completed'
        AND DATE(sr.authorized_at) >= ?
        AND DATE(sr.authorized_at) <= ?
        AND (? IS NULL OR o.branch_id = ?)
      GROUP BY
        sri.returned_product_id,
        returned.name,
        returned.sku,
        sr.sales_agent_user_id,
        seller.full_name
      ORDER BY returned.name, seller.full_name
    `,
    [reportDateFrom, reportDateTo, branchId || null, branchId || null]
  );

  const [salesUsers] = await db.query(
    `SELECT DISTINCT
       u.id AS sales_agent_user_id,
       u.full_name AS sales_agent_name
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE r.code = 'VENTAS'
       AND u.status = 'active'
       AND u.deleted_at IS NULL
     ORDER BY u.full_name, u.id`
  );

  const [rawInventoryRows] = await db.query(
    `
      SELECT
        rm.id,
        rm.name AS item_name,
        rm.sku,
        rmc.name AS category_name,
        rm.unit,
        COALESCE(rm.unit_cost, 0) AS unit_cost,
        COALESCE(SUM(srm.quantity_on_hand), 0) AS quantity_on_hand,
        COALESCE(SUM(srm.quantity_on_hand * COALESCE(rm.unit_cost, 0)), 0) AS total_value
      FROM raw_materials rm
      INNER JOIN raw_material_categories rmc ON rmc.id = rm.category_id
      LEFT JOIN stock_raw_materials srm
        ON srm.raw_material_id = rm.id
       AND (? IS NULL OR srm.branch_id = ?)
      WHERE rm.deleted_at IS NULL
        AND COALESCE(rm.inventory_usage_type, 'production') = 'production'
        AND rmc.name NOT IN ('Rollos', 'Bolsas')
      GROUP BY rm.id, rm.name, rm.sku, rmc.name, rm.unit, rm.unit_cost
      ORDER BY rmc.name, rm.name
    `,
    [branchId || null, branchId || null]
  );

  const [productInventoryRows] = await db.query(
    `
      SELECT
        p.id,
        p.name AS item_name,
        p.sku,
        pc.name AS category_name,
        p.unit,
        COALESCE(p.base_price, 0) AS unit_cost,
        COALESCE(SUM(sp.quantity_on_hand), 0) AS quantity_on_hand,
        COALESCE(SUM(sp.quantity_on_hand * COALESCE(p.base_price, 0)), 0) AS total_value
      FROM products p
      INNER JOIN product_categories pc ON pc.id = p.category_id
      LEFT JOIN stock_products sp
        ON sp.product_id = p.id
       AND (? IS NULL OR sp.branch_id = ?)
      WHERE p.deleted_at IS NULL
      GROUP BY p.id, p.name, p.sku, pc.name, p.unit, p.base_price
      ORDER BY pc.name, p.name
    `,
    [branchId || null, branchId || null]
  );

  const [packagingInventoryRows] = await db.query(
    `
      SELECT
        rm.id,
        rm.name AS item_name,
        rm.sku,
        rmc.name AS category_name,
        rm.unit,
        COALESCE(rm.unit_cost, 0) AS unit_cost,
        COALESCE(SUM(srm.quantity_on_hand), 0) AS quantity_on_hand,
        COALESCE(SUM(srm.quantity_on_hand * COALESCE(rm.unit_cost, 0)), 0) AS total_value
      FROM raw_materials rm
      INNER JOIN raw_material_categories rmc ON rmc.id = rm.category_id
      LEFT JOIN stock_raw_materials srm
        ON srm.raw_material_id = rm.id
       AND (? IS NULL OR srm.branch_id = ?)
      WHERE rm.deleted_at IS NULL
        AND (
          COALESCE(rm.inventory_usage_type, 'production') = 'packaging'
          OR rmc.name IN ('Rollos', 'Bolsas')
        )
      GROUP BY rm.id, rm.name, rm.sku, rmc.name, rm.unit, rm.unit_cost
      ORDER BY rmc.name, rm.name
    `,
    [branchId || null, branchId || null]
  );

  return {
    code: 1,
    message: "reporte mensual de produccion generado",
    data: {
      month: selectedMonth,
      date_from: reportDateFrom,
      date_to: reportDateTo,
      estimated_cost: estimatedCost,
      summary: dayReport.data?.summary || {},
      batches: dayReport.data?.batches || [],
      products: dayReport.data?.products || [],
      packers: dayReport.data?.packers || [],
      plan_products: dayReport.data?.plan_products || [],
      raw_materials_usage: rawMaterialsUsage,
      recipe_materials_usage: recipeMaterialRows,
      flour_daily_usage: flourDailyRows,
      returns_summary: returnRows,
      sales_users: salesUsers,
      inventory_snapshot: {
        raw_materials: rawInventoryRows,
        finished_products: productInventoryRows,
        packaging: packagingInventoryRows,
      },
    },
  };
};

const roundProductionQuantity = (value) => Math.round(Number(value || 0) * 1000) / 1000;

const normalizeOptionalProductionQuantity = (value, { allowZero = true } = {}) => {
  if (value === undefined || value === null || value === "") return { value: null };
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || (allowZero ? numericValue < 0 : numericValue <= 0)) {
    return { error: true };
  }
  return { value: roundProductionQuantity(numericValue) };
};

const normalizeRequestMode = (value) => {
  const mode = String(value || "").trim().toLowerCase();
  if (["units", "unit", "unidades", "unidad"].includes(mode)) return "units";
  if (["arrobas", "arroba"].includes(mode)) return "arrobas";
  return null;
};

const resolveCurrentRecipeForProduct = async (connection, { productId, requestedRecipeId }) => {
  const params = [];
  const requestedRecipeJoin = requestedRecipeId
    ? `INNER JOIN recipes requested
         ON requested.id = ?
        AND current_recipe.recipe_family_id = COALESCE(requested.recipe_family_id, requested.id)`
    : "";
  if (requestedRecipeId) params.push(requestedRecipeId);
  params.push(productId);

  const [rows] = await connection.query(
    `SELECT
       current_recipe.id,
       current_recipe.version_no,
       current_recipe.notes,
       ro.product_id,
       ro.expected_quantity,
       p.name AS product_name
     FROM recipes current_recipe
     ${requestedRecipeJoin}
     INNER JOIN recipe_outputs ro ON ro.recipe_id = current_recipe.id
     INNER JOIN products p ON p.id = ro.product_id
     WHERE current_recipe.is_current = 1
       AND current_recipe.is_active = 1
       AND ro.product_id = ?
       AND p.is_active = 1
     ORDER BY current_recipe.version_no DESC, current_recipe.id DESC`,
    params
  );

  return rows;
};

const normalizeProductionPlanItems = async (connection, items) => {
  const normalizedItems = [];
  const selectedProductIds = new Set();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const isProductBased = item.product_id !== undefined
      || item.request_mode !== undefined
      || item.requested_quantity !== undefined;

    if (isProductBased) {
      const productId = Number(item.product_id || 0);
      const requestMode = normalizeRequestMode(item.request_mode);
      const requestedQuantity = Number(item.requested_quantity || 0);
      if (!Number.isInteger(productId) || productId <= 0 || !requestMode
        || !Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
        return { error: `Revisa el producto ${index + 1}, su modalidad y la cantidad solicitada.` };
      }
      if (requestMode === "units" && !Number.isInteger(requestedQuantity)) {
        return { error: `La cantidad solicitada de ${index + 1} debe ser un numero entero de unidades.` };
      }
      if (selectedProductIds.has(productId)) {
        return { error: `El producto ${index + 1} esta repetido en el plan.` };
      }

      const recipeRows = await resolveCurrentRecipeForProduct(connection, {
        productId,
        requestedRecipeId: Number(item.recipe_id || 0) || null,
      });
      if (!recipeRows.length) {
        return { error: `El producto ${index + 1} no tiene una receta vigente asociada.` };
      }
      if (recipeRows.length > 1 && !item.recipe_id) {
        return { error: `${recipeRows[0].product_name} pertenece a mas de una receta vigente. Indica la receta que debe utilizarse.` };
      }

      const recipe = recipeRows[0];
      const yieldPerArroba = Number(recipe.expected_quantity || 0);
      if (!Number.isFinite(yieldPerArroba) || yieldPerArroba <= 0) {
        return { error: `${recipe.product_name} no tiene un rendimiento valido en su receta vigente.` };
      }

      const plannedArrobas = roundProductionQuantity(
        requestMode === "arrobas" ? requestedQuantity : requestedQuantity / yieldPerArroba
      );
      const estimatedUnits = roundProductionQuantity(
        requestMode === "units" ? requestedQuantity : requestedQuantity * yieldPerArroba
      );
      if (plannedArrobas <= 0 || estimatedUnits <= 0) {
        return { error: `La cantidad del producto ${index + 1} es demasiado pequena para planificarla.` };
      }

      const unitsPerTray = normalizeOptionalProductionQuantity(item.units_per_tray, { allowZero: false });
      const trayCount = normalizeOptionalProductionQuantity(item.tray_count);
      const looseUnits = normalizeOptionalProductionQuantity(item.loose_units);
      if (unitsPerTray.error || trayCount.error || looseUnits.error) {
        return { error: `Revisa el detalle opcional de latas del producto ${index + 1}.` };
      }

      selectedProductIds.add(productId);
      normalizedItems.push({
        recipeId: Number(recipe.id),
        recipeVersion: Number(recipe.version_no),
        recipeName: String(recipe.notes || `Receta #${recipe.id}`).split(/\s+-\s+/)[0],
        arrobas: plannedArrobas,
        outputs: [{
          product_id: productId,
          product_name: recipe.product_name,
          expected_quantity: estimatedUnits,
          detail: {
            requestMode,
            requestedQuantity: roundProductionQuantity(requestedQuantity),
            plannedArrobas,
            estimatedUnits,
            unitsPerTray: unitsPerTray.value,
            trayCount: trayCount.value,
            looseUnits: looseUnits.value,
          },
        }],
      });
      continue;
    }

    const requestedRecipeId = Number(item.recipe_id || 0);
    const arrobas = Number(item.arrobas || 0);
    if (!requestedRecipeId || !Number.isFinite(arrobas) || arrobas <= 0) {
      return { error: `Revisa la receta ${index + 1} y su cantidad de arrobas.` };
    }

    const [recipeRows] = await connection.query(
      `SELECT current_recipe.id, current_recipe.version_no, current_recipe.notes
       FROM recipes requested
       INNER JOIN recipes current_recipe
         ON current_recipe.recipe_family_id = COALESCE(requested.recipe_family_id, requested.id)
        AND current_recipe.is_current = 1
        AND current_recipe.is_active = 1
       WHERE requested.id = ?
       ORDER BY current_recipe.version_no DESC
       LIMIT 1`,
      [requestedRecipeId]
    );
    if (!recipeRows.length) {
      return { error: `La receta ${index + 1} no tiene una version vigente.` };
    }

    const recipeId = Number(recipeRows[0].id);
    const requestedProductIds = (Array.isArray(item.product_ids) ? item.product_ids : [])
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0);
    const [outputRows] = await connection.query(
      `SELECT ro.product_id, ro.expected_quantity, p.name AS product_name
       FROM recipe_outputs ro
       INNER JOIN products p ON p.id = ro.product_id
       WHERE ro.recipe_id = ?
       ORDER BY ro.sort_order, ro.id`,
      [recipeId]
    );
    const selectedOutputs = requestedProductIds.length
      ? outputRows.filter((output) => requestedProductIds.includes(Number(output.product_id)))
      : outputRows;
    if (!selectedOutputs.length
      || (requestedProductIds.length && selectedOutputs.length !== new Set(requestedProductIds).size)) {
      return { error: `Selecciona productos validos para la receta ${index + 1}.` };
    }
    for (const output of selectedOutputs) {
      const productId = Number(output.product_id);
      if (selectedProductIds.has(productId)) {
        return { error: `${output.product_name || `El producto #${productId}`} esta repetido en el plan.` };
      }
      selectedProductIds.add(productId);
    }

    normalizedItems.push({
      recipeId,
      recipeVersion: Number(recipeRows[0].version_no),
      recipeName: String(recipeRows[0].notes || `Receta #${recipeId}`).split(/\s+-\s+/)[0],
      arrobas: roundProductionQuantity(arrobas),
      outputs: selectedOutputs.map((output) => ({
        ...output,
        expected_quantity: roundProductionQuantity(Number(output.expected_quantity) * arrobas),
        detail: null,
      })),
    });
  }

  return { normalizedItems };
};

const insertNormalizedProductionPlanItems = async (connection, productionPlanId, normalizedItems) => {
  for (let index = 0; index < normalizedItems.length; index += 1) {
    const item = normalizedItems[index];
    const [itemInsert] = await connection.query(
      `INSERT INTO production_plan_items (production_plan_id, recipe_id, arrobas, sort_order)
       VALUES (?, ?, ?, ?)`,
      [productionPlanId, item.recipeId, item.arrobas, index + 1]
    );
    const planItemId = Number(itemInsert.insertId);

    for (const output of item.outputs) {
      const [outputInsert] = await connection.query(
        `INSERT INTO production_plan_outputs (production_plan_item_id, product_id, expected_quantity)
         VALUES (?, ?, ?)`,
        [planItemId, Number(output.product_id), Number(output.expected_quantity)]
      );
      if (output.detail) {
        const detail = output.detail;
        await connection.query(
          `INSERT INTO production_plan_product_details (
             production_plan_output_id, request_mode, requested_quantity,
             planned_arrobas, estimated_units, units_per_tray, tray_count, loose_units
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            Number(outputInsert.insertId),
            detail.requestMode,
            detail.requestedQuantity,
            detail.plannedArrobas,
            detail.estimatedUnits,
            detail.unitsPerTray,
            detail.trayCount,
            detail.looseUnits,
          ]
        );
      }
    }
  }
};

const createProductionPlan = async (payload, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();
  const branchId = Number(payload.p_branch_id || 0);
  const bakerEmployeeId = Number(payload.p_baker_employee_id || 0);
  const plannedDate = payload.p_planned_date || null;
  const items = Array.isArray(payload.p_items) ? payload.p_items : [];

  if (!branchId || !bakerEmployeeId || !plannedDate || !items.length) {
    connection.release();
    return {
      code: 0,
      message: "Selecciona sucursal, fecha, panadero y al menos un producto.",
      data: null,
    };
  }

  try {
    await connection.beginTransaction();

    const [branchRows] = await connection.query(
      "SELECT id, name FROM branches WHERE id = ? AND is_active = 1 LIMIT 1",
      [branchId]
    );
    const [bakerRows] = await connection.query(
      `SELECT e.id, e.user_id, u.full_name
         FROM employees e
         INNER JOIN users u ON u.id = e.user_id
        WHERE e.id = ?
          AND e.job_type = 'baker'
          AND e.status = 'active'
          AND e.deleted_at IS NULL
        LIMIT 1`,
      [bakerEmployeeId]
    );

    if (!branchRows.length || !bakerRows.length) {
      await connection.rollback();
      return { code: 0, message: "La sucursal o el panadero no estÃƒÂ¡n disponibles.", data: null };
    }

    const normalization = await normalizeProductionPlanItems(connection, items);
    if (normalization.error) {
      await connection.rollback();
      return { code: 0, message: normalization.error, data: null };
    }
    const { normalizedItems } = normalization;

    const [planInsert] = await connection.query(
      `INSERT INTO production_plans (
         branch_id, planned_date, baker_employee_id, status, notes, created_by
       ) VALUES (?, ?, ?, 'assigned', ?, ?)`,
      [branchId, plannedDate, bakerEmployeeId, payload.p_notes || null, actorUserId || null]
    );
    const productionPlanId = Number(planInsert.insertId);

    await insertNormalizedProductionPlanItems(connection, productionPlanId, normalizedItems);

    const totalArrobas = normalizedItems.reduce((sum, item) => sum + item.arrobas, 0);
    const productCount = normalizedItems.reduce((sum, item) => sum + item.outputs.length, 0);
    const recipeCount = new Set(normalizedItems.map((item) => item.recipeId)).size;
    await connection.query(
      `INSERT INTO user_notifications (
         user_id, notification_type, title, message, reference_type, reference_id
       ) VALUES (?, 'production_plan', ?, ?, 'production_plan', ?)`,
      [
        Number(bakerRows[0].user_id),
        `ProducciÃƒÂ³n asignada para ${plannedDate}`,
        `${productCount} producto(s), ${recipeCount} receta(s) y ${totalArrobas.toLocaleString("es-CO")} arroba(s) en ${branchRows[0].name}.`,
        productionPlanId,
      ]
    );

    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'production_plan.create', 'production_plans', ?,
         JSON_OBJECT('planned_date', ?, 'baker_employee_id', ?, 'recipes', ?, 'products', ?, 'arrobas', ?))`,
      [
        actorUserId || null,
        String(productionPlanId),
        plannedDate,
        bakerEmployeeId,
        recipeCount,
        productCount,
        totalArrobas,
      ]
    );

    await connection.commit();
    return {
      code: 1,
      message: "Plan enviado al panadero correctamente.",
      data: { production_plan_id: productionPlanId },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const updateProductionPlan = async (productionPlanId, payload, actorUser = {}) => {
  const db = await connect();
  const connection = await db.getConnection();
  const ownsTransaction = true;
  const planId = Number(productionPlanId || 0);
  const actorUserId = Number(actorUser.userId || 0);
  const branchId = Number(payload.p_branch_id || 0);
  const bakerEmployeeId = Number(payload.p_baker_employee_id || 0);
  const plannedDate = payload.p_planned_date || null;
  const items = Array.isArray(payload.p_items) ? payload.p_items : [];
  const roleCodes = (Array.isArray(actorUser.roles) ? actorUser.roles : [])
    .map((role) => String(typeof role === "string" ? role : role?.code || role?.name || "").toUpperCase());
  const isAdministrator = roleCodes.includes("ADMIN") || roleCodes.includes("SUPER_ADMIN");

  if (!planId || !branchId || !bakerEmployeeId || !plannedDate || !items.length) {
    connection.release();
    return { code: 0, message: "Selecciona sucursal, fecha, panadero y al menos un producto.", data: null };
  }

  try {
    if (ownsTransaction) await connection.beginTransaction();
    const [planRows] = await connection.query(
      `SELECT pp.id, pp.created_by, pp.status, e.user_id AS baker_user_id
         FROM production_plans pp
         INNER JOIN employees e ON e.id = pp.baker_employee_id
        WHERE pp.id = ?
        FOR UPDATE`,
      [planId]
    );
    if (!planRows.length) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "El plan de produccion no existe.", data: null };
    }

    const plan = planRows[0];
    const canEdit = isAdministrator
      || Number(plan.created_by) === actorUserId
      || Number(plan.baker_user_id) === actorUserId;
    if (!canEdit) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "No tienes permiso para editar este plan.", data: null };
    }

    const [progressRows] = await connection.query(
      `SELECT
         COUNT(CASE WHEN ppi.started_at IS NOT NULL OR ppi.production_batch_id IS NOT NULL THEN 1 END) AS started_items,
         COUNT(psr.id) AS reservations
       FROM production_plan_items ppi
       LEFT JOIN production_plan_outputs ppo ON ppo.production_plan_item_id = ppi.id
       LEFT JOIN production_sale_reservations psr ON psr.production_plan_output_id = ppo.id
       WHERE ppi.production_plan_id = ?`,
      [planId]
    );
    if (plan.status === "completed" || plan.status === "cancelled"
      || Number(progressRows[0]?.started_items || 0) > 0
      || Number(progressRows[0]?.reservations || 0) > 0) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "El plan ya tiene produccion iniciada o reservas asociadas y no puede modificarse.", data: null };
    }

    const [branchRows] = await connection.query(
      "SELECT id, name FROM branches WHERE id = ? AND is_active = 1 LIMIT 1",
      [branchId]
    );
    const [bakerRows] = await connection.query(
      `SELECT e.id, e.user_id, u.full_name
         FROM employees e
         INNER JOIN users u ON u.id = e.user_id
        WHERE e.id = ? AND e.job_type = 'baker' AND e.status = 'active' AND e.deleted_at IS NULL
        LIMIT 1`,
      [bakerEmployeeId]
    );
    if (!branchRows.length || !bakerRows.length) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "La sucursal o el panadero no estan disponibles.", data: null };
    }

    const normalization = await normalizeProductionPlanItems(connection, items);
    if (normalization.error) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: normalization.error, data: null };
    }
    const { normalizedItems } = normalization;

    await connection.query(
      `UPDATE production_plans
          SET branch_id = ?, planned_date = ?, baker_employee_id = ?, notes = ?, status = 'assigned', viewed_at = NULL
        WHERE id = ?`,
      [branchId, plannedDate, bakerEmployeeId, payload.p_notes || null, planId]
    );
    await connection.query(
      `DELETE ppo FROM production_plan_outputs ppo
       INNER JOIN production_plan_items ppi ON ppi.id = ppo.production_plan_item_id
       WHERE ppi.production_plan_id = ?`,
      [planId]
    );
    await connection.query("DELETE FROM production_plan_items WHERE production_plan_id = ?", [planId]);

    await insertNormalizedProductionPlanItems(connection, planId, normalizedItems);

    const totalBultos = normalizedItems.reduce((sum, item) => sum + item.arrobas, 0);
    const productCount = normalizedItems.reduce((sum, item) => sum + item.outputs.length, 0);
    const recipeCount = new Set(normalizedItems.map((item) => item.recipeId)).size;
    await connection.query(
      `INSERT INTO user_notifications
         (user_id, notification_type, title, message, reference_type, reference_id)
       VALUES (?, 'production_plan', ?, ?, 'production_plan', ?)`,
      [Number(bakerRows[0].user_id), `Plan actualizado para ${plannedDate}`,
        `${productCount} producto(s), ${recipeCount} receta(s) y ${totalBultos.toLocaleString("es-CO")} arroba(s) estimada(s) en ${branchRows[0].name}.`, planId]
    );
    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'production_plan.update', 'production_plans', ?,
         JSON_OBJECT('planned_date', ?, 'baker_employee_id', ?, 'recipes', ?, 'products', ?, 'arrobas', ?))`,
      [actorUserId || null, String(planId), plannedDate, bakerEmployeeId, recipeCount, productCount, totalBultos]
    );
    await connection.commit();
    return { code: 1, message: "Plan actualizado correctamente.", data: { production_plan_id: planId } };
  } catch (error) {
        if (ownsTransaction) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const listProductionPlans = async ({ userId, plannedDate, dateFrom, dateTo, bakerEmployeeId } = {}) => {
  const db = await connect();
  const filters = [];
  const params = [];

  if (userId) {
    filters.push("e.user_id = ?");
    params.push(Number(userId));
  }
  if (plannedDate) {
    filters.push("pp.planned_date = ?");
    params.push(plannedDate);
  } else {
    if (dateFrom) {
      filters.push("pp.planned_date >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      filters.push("pp.planned_date <= ?");
      params.push(dateTo);
    }
  }
  if (bakerEmployeeId) {
    filters.push("pp.baker_employee_id = ?");
    params.push(Number(bakerEmployeeId));
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const [plans] = await db.query(
    `SELECT
       pp.id,
       pp.branch_id,
       b.name AS branch_name,
       pp.planned_date,
       pp.baker_employee_id,
       u.full_name AS baker_name,
       pp.status,
       pp.notes,
       pp.created_by,
       e.user_id AS baker_user_id,
       pp.viewed_at,
       pp.created_at
     FROM production_plans pp
     INNER JOIN branches b ON b.id = pp.branch_id
     INNER JOIN employees e ON e.id = pp.baker_employee_id
     INNER JOIN users u ON u.id = e.user_id
     ${whereClause}
     ORDER BY pp.planned_date DESC, pp.id DESC`,
    params
  );

  if (!plans.length) {
    return { code: 1, message: "planes de producciÃƒÂ³n listados", data: [] };
  }

  const planIds = plans.map((plan) => Number(plan.id));
  const placeholders = planIds.map(() => "?").join(",");
  const [items] = await db.query(
    `SELECT
       ppi.id,
       ppi.production_plan_id,
       ppi.recipe_id,
       ppi.production_batch_id,
       ppi.started_at,
       ppi.finished_at,
       pb.status AS production_batch_status,
       r.version_no AS recipe_version,
       COALESCE(NULLIF(SUBSTRING_INDEX(r.notes, ' - ', 1), ''), CONCAT('Receta #', r.id)) AS recipe_name,
       ppi.arrobas,
       ppi.sort_order
     FROM production_plan_items ppi
     INNER JOIN recipes r ON r.id = ppi.recipe_id
     LEFT JOIN production_batches pb ON pb.id = ppi.production_batch_id
     WHERE ppi.production_plan_id IN (${placeholders})
     ORDER BY ppi.production_plan_id, ppi.sort_order`,
    planIds
  );
  const itemIds = items.map((item) => Number(item.id));
  let outputs = [];
  if (itemIds.length) {
    const outputPlaceholders = itemIds.map(() => "?").join(",");
    const [rows] = await db.query(
      `SELECT
         ppo.id AS production_plan_output_id,
         ppo.production_plan_item_id,
         ppo.product_id,
         p.name AS product_name,
         ppo.expected_quantity,
         CASE WHEN ppd.id IS NULL THEN 'legacy' ELSE 'product' END AS planning_format,
         COALESCE(ppd.request_mode, 'arrobas') AS request_mode,
         COALESCE(ppd.requested_quantity, output_item.arrobas) AS requested_quantity,
         COALESCE(ppd.planned_arrobas, output_item.arrobas) AS planned_arrobas,
         COALESCE(ppd.estimated_units, ppo.expected_quantity) AS estimated_units,
         ppd.units_per_tray,
         ppd.tray_count,
         ppd.loose_units,
         COALESCE(
           ppd.product_status,
           CASE
             WHEN output_item.production_batch_id IS NOT NULL THEN 'completed'
             WHEN output_item.started_at IS NOT NULL THEN 'in_progress'
             ELSE 'pending'
           END
         ) AS product_status,
         ppd.actual_arrobas,
         COALESCE(ppd.produced_quantity, pbo.produced_quantity) AS produced_quantity,
         ppd.actual_units_per_tray,
         ppd.actual_tray_count,
         ppd.actual_loose_units,
         ppd.baker_notes,
         ppd.reported_by,
         ppd.reported_at,
         ppd.started_at AS product_started_at,
         ppd.completed_at AS product_completed_at,
         COALESCE(reserved.reserved_quantity, 0) AS reserved_quantity,
         COALESCE(reserved.delivered_quantity, 0) AS direct_delivered_quantity
       FROM production_plan_outputs ppo
       INNER JOIN products p ON p.id = ppo.product_id
       INNER JOIN production_plan_items output_item ON output_item.id = ppo.production_plan_item_id
       LEFT JOIN production_plan_product_details ppd
         ON ppd.production_plan_output_id = ppo.id
       LEFT JOIN production_batch_outputs pbo
         ON pbo.production_batch_id = output_item.production_batch_id
        AND pbo.product_id = ppo.product_id
       LEFT JOIN (
         SELECT
           production_plan_output_id,
           SUM(CASE
             WHEN status IN ('reserved','partially_delivered')
             THEN quantity - delivered_quantity
             ELSE 0
           END) AS reserved_quantity,
           SUM(CASE WHEN status = 'delivered' THEN delivered_quantity ELSE 0 END) AS delivered_quantity
         FROM production_sale_reservations
         GROUP BY production_plan_output_id
       ) reserved ON reserved.production_plan_output_id = ppo.id
       WHERE ppo.production_plan_item_id IN (${outputPlaceholders})
       ORDER BY p.name`,
      itemIds
    );
    outputs = rows;
  }

  const outputsByItem = outputs.reduce((acc, output) => {
    const key = String(output.production_plan_item_id);
    acc[key] = [...(acc[key] || []), output];
    return acc;
  }, {});
  const itemsByPlan = items.reduce((acc, item) => {
    const key = String(item.production_plan_id);
    acc[key] = [...(acc[key] || []), { ...item, outputs: outputsByItem[String(item.id)] || [] }];
    return acc;
  }, {});

  const buildCompatiblePlanData = (plan) => {
    const planItems = itemsByPlan[String(plan.id)] || [];
    const productAssignments = planItems.flatMap((item) => item.outputs.map((output) => ({
      ...output,
      production_plan_item_id: Number(item.id),
      recipe_id: Number(item.recipe_id),
      recipe_version: Number(item.recipe_version),
      recipe_name: item.recipe_name,
      sort_order: Number(item.sort_order),
    })));
    const groupsByRecipe = new Map();
    planItems.forEach((item) => {
      const key = String(item.recipe_id);
      const group = groupsByRecipe.get(key) || {
        recipe_id: Number(item.recipe_id),
        recipe_version: Number(item.recipe_version),
        recipe_name: item.recipe_name,
        planned_arrobas: 0,
        items: [],
        products: [],
      };
      group.planned_arrobas = roundProductionQuantity(
        Number(group.planned_arrobas) + Number(item.arrobas || 0)
      );
      group.items.push(item);
      group.products.push(...item.outputs.map((output) => ({
        ...output,
        production_plan_item_id: Number(item.id),
      })));
      groupsByRecipe.set(key, group);
    });

    return {
      ...plan,
      items: planItems,
      product_assignments: productAssignments,
      recipe_groups: Array.from(groupsByRecipe.values()),
      planning_format: productAssignments.some((output) => output.planning_format === "product")
        ? "product"
        : "legacy",
    };
  };

  return {
    code: 1,
    message: "planes de producciÃƒÂ³n listados",
    data: plans.map(buildCompatiblePlanData),
  };
};

const startProductionPlanItem = async ({ productionPlanItemId, userId }) => {
  const db = await connect();
  const [rows] = await db.query(
    `SELECT ppi.id, ppi.started_at, ppi.production_batch_id, pp.status
       FROM production_plan_items ppi
       INNER JOIN production_plans pp ON pp.id = ppi.production_plan_id
       INNER JOIN employees e ON e.id = pp.baker_employee_id
      WHERE ppi.id = ?
        AND e.user_id = ?
      LIMIT 1`,
    [Number(productionPlanItemId), Number(userId)]
  );

  if (!rows.length) {
    return { code: 0, message: "Esta producciÃƒÂ³n no estÃƒÂ¡ asignada a tu usuario.", data: null };
  }
  if (rows[0].status === "cancelled") {
    return { code: 0, message: "Esta asignaciÃƒÂ³n fue cancelada.", data: null };
  }

  await db.query(
    `UPDATE production_plan_items
        SET started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
      WHERE id = ?`,
    [Number(productionPlanItemId)]
  );
  await db.query(
    `UPDATE production_plans pp
       INNER JOIN production_plan_items ppi ON ppi.production_plan_id = pp.id
        SET pp.status = IF(pp.status = 'assigned', 'viewed', pp.status),
            pp.viewed_at = COALESCE(pp.viewed_at, CURRENT_TIMESTAMP)
      WHERE ppi.id = ?`,
    [Number(productionPlanItemId)]
  );

  return {
    code: 1,
    message: rows[0].production_batch_id ? "La producciÃƒÂ³n ya estÃƒÂ¡ finalizada." : "ProducciÃƒÂ³n iniciada.",
    data: {
      production_plan_item_id: Number(productionPlanItemId),
      production_batch_id: rows[0].production_batch_id ? Number(rows[0].production_batch_id) : null,
    },
  };
};

const finishProductionPlanItem = async ({ productionPlanItemId, userId, outputs = [], batchQuantity }) => {
  const db = await connect();
  const lockConnection = await db.getConnection();
  const lockName = `production_plan_item_${Number(productionPlanItemId)}`;
  let lockAcquired = false;

  try {
    const [lockRows] = await lockConnection.query("SELECT GET_LOCK(?, 5) AS acquired", [lockName]);
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) {
      return { code: 0, message: "La producciÃƒÂ³n se estÃƒÂ¡ iniciando. Espera un momento.", data: null };
    }

    const [itemRows] = await lockConnection.query(
      `SELECT
         ppi.id,
         ppi.recipe_id,
         ppi.production_batch_id,
         ppi.started_at,
         ppi.arrobas,
         pp.id AS production_plan_id,
         pp.branch_id,
         pp.planned_date,
         pp.baker_employee_id,
         pp.notes,
         pp.status
       FROM production_plan_items ppi
       INNER JOIN production_plans pp ON pp.id = ppi.production_plan_id
       INNER JOIN employees e ON e.id = pp.baker_employee_id
       WHERE ppi.id = ?
         AND e.user_id = ?
       LIMIT 1`,
      [Number(productionPlanItemId), Number(userId)]
    );

    if (!itemRows.length) {
      return { code: 0, message: "Esta producciÃƒÂ³n no estÃƒÂ¡ asignada a tu usuario.", data: null };
    }

    const item = itemRows[0];
    if (item.production_batch_id) {
      return {
        code: 1,
        message: "Esta produccion ya fue finalizada.",
        data: { production_batch_id: Number(item.production_batch_id) },
      };
    }

    if (item.status === "cancelled") {
      return { code: 0, message: "Esta asignaciÃƒÂ³n fue cancelada.", data: null };
    }
    if (!item.started_at) {
      return { code: 0, message: "Primero debes iniciar la producciÃƒÂ³n.", data: null };
    }

    const [outputRows] = await lockConnection.query(
      `SELECT ppo.product_id, p.name AS product_name, ppo.expected_quantity
       FROM production_plan_outputs ppo
       INNER JOIN products p ON p.id = ppo.product_id
       WHERE ppo.production_plan_item_id = ?
       ORDER BY ppo.id`,
      [Number(productionPlanItemId)]
    );

    const outputMap = new Map(outputRows.map((output) => [Number(output.product_id), output]));
    const requestedOutputs = Array.isArray(outputs) ? outputs : [];
    const normalizedOutputs = (requestedOutputs.length ? requestedOutputs : outputRows).map((output) => {
      const productId = Number(output.product_id);
      const source = outputMap.get(productId);
      const producedQuantity = output.produced_quantity !== undefined
        ? Number(output.produced_quantity)
        : Math.round(Number(source?.expected_quantity || 0) * Number(item.arrobas || 1) * 1000) / 1000;

      return { product_id: productId, produced_quantity: producedQuantity };
    });

    if (!normalizedOutputs.length || normalizedOutputs.some((output) => !outputMap.has(Number(output.product_id)))) {
      return { code: 0, message: "Selecciona productos validos de la asignacion.", data: null };
    }

    if (normalizedOutputs.some((output) => !Number.isFinite(Number(output.produced_quantity)) || Number(output.produced_quantity) <= 0)) {
      return { code: 0, message: "Todas las cantidades realizadas deben ser mayores a cero.", data: null };
    }

    const batchResult = await registerProductionBatch(
      {
        p_branch_id: Number(item.branch_id),
        p_recipe_id: Number(item.recipe_id),
        p_baker_employee_id: Number(item.baker_employee_id),
        p_produced_date: item.planned_date,
        p_batch_quantity: Number(batchQuantity || item.arrobas),
        p_outputs: normalizedOutputs,
        p_notes: item.notes || `Plan de produccion #${item.production_plan_id}`,
      },
      Number(userId)
    );

    if (batchResult?.code !== 1) {
      return batchResult;
    }

    const productionBatchId = Number(batchResult.data?.production_batch_id);
    await lockConnection.query(
      `UPDATE production_plan_items
       SET production_batch_id = ?,
           finished_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND production_batch_id IS NULL`,
      [productionBatchId, Number(productionPlanItemId)]
    );

    await lockConnection.query(
      `UPDATE production_sale_reservations psr
       INNER JOIN production_plan_outputs ppo
         ON ppo.id = psr.production_plan_output_id
       INNER JOIN production_batch_outputs pbo
         ON pbo.production_batch_id = ?
        AND pbo.product_id = ppo.product_id
       SET psr.production_batch_output_id = pbo.id
       WHERE ppo.production_plan_item_id = ?
         AND psr.production_batch_output_id IS NULL
         AND psr.status IN ('reserved','partially_delivered')`,
      [productionBatchId, Number(productionPlanItemId)]
    );

    const [pendingRows] = await lockConnection.query(
      `SELECT COUNT(*) AS pending_items
       FROM production_plan_items
       WHERE production_plan_id = ?
         AND production_batch_id IS NULL`,
      [Number(item.production_plan_id)]
    );

    if (Number(pendingRows[0]?.pending_items || 0) === 0) {
      await lockConnection.query(
        `UPDATE production_plans
         SET status = 'completed'
         WHERE id = ?
           AND status <> 'cancelled'`,
        [Number(item.production_plan_id)]
      );
    }

    return {
      code: 1,
      message: "Produccion finalizada. El lote quedo pendiente de conteo y empaque.",
      data: { production_batch_id: productionBatchId },
    };
  } finally {
    if (lockAcquired) {
      await lockConnection.query("SELECT RELEASE_LOCK(?)", [lockName]);
    }
    lockConnection.release();
  }
};

const getOwnedProductionPlanProduct = async (connection, productionPlanOutputId, userId, { forUpdate = false } = {}) => {
  const [rows] = await connection.query(
    `SELECT
       ppo.id,
       ppo.production_plan_item_id,
       ppo.product_id,
       ppo.expected_quantity,
       ppi.recipe_id,
       ppi.production_batch_id,
       ppi.started_at AS item_started_at,
       p.name AS product_name,
       ppd.product_status,
       ppd.planned_arrobas,
       ppd.estimated_units,
       pp.id AS production_plan_id,
       pp.branch_id,
       pp.planned_date,
       pp.baker_employee_id,
       pp.notes AS plan_notes,
       pp.status AS plan_status
     FROM production_plan_outputs ppo
     INNER JOIN production_plan_product_details ppd ON ppd.production_plan_output_id = ppo.id
     INNER JOIN production_plan_items ppi ON ppi.id = ppo.production_plan_item_id
     INNER JOIN production_plans pp ON pp.id = ppi.production_plan_id
     INNER JOIN employees e ON e.id = pp.baker_employee_id
     INNER JOIN products p ON p.id = ppo.product_id
     WHERE ppo.id = ? AND e.user_id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [Number(productionPlanOutputId), Number(userId)]
  );
  return rows[0] || null;
};

const refreshProductionPlanStatus = async (connection, productionPlanId) => {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS pending_products
     FROM production_plan_outputs ppo
     INNER JOIN production_plan_items ppi ON ppi.id = ppo.production_plan_item_id
     LEFT JOIN production_plan_product_details ppd ON ppd.production_plan_output_id = ppo.id
     WHERE ppi.production_plan_id = ?
       AND (
         (ppd.id IS NOT NULL AND ppd.product_status NOT IN ('completed','skipped','cancelled'))
         OR (ppd.id IS NULL AND ppi.production_batch_id IS NULL)
       )`,
    [Number(productionPlanId)]
  );
  if (Number(rows[0]?.pending_products || 0) === 0) {
    await connection.query(
      "UPDATE production_plans SET status = 'completed' WHERE id = ? AND status <> 'cancelled'",
      [Number(productionPlanId)]
    );
  }
};

const normalizeProductProgress = (payload = {}) => {
  const fields = [
    ["actual_arrobas", payload.p_actual_arrobas, false],
    ["produced_quantity", payload.p_produced_quantity, true],
    ["actual_units_per_tray", payload.p_actual_units_per_tray, false],
    ["actual_tray_count", payload.p_actual_tray_count, true],
    ["actual_loose_units", payload.p_actual_loose_units, true],
  ];
  const values = {};
  for (const [name, rawValue, allowZero] of fields) {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      values[name] = null;
      continue;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) return null;
    if (name === "produced_quantity" && !Number.isInteger(value)) return null;
    values[name] = roundProductionQuantity(value);
  }
  values.baker_notes = String(payload.p_baker_notes || "").trim().slice(0, 500) || null;
  return values;
};

const startProductionPlanProduct = async ({ productionPlanOutputId, userId }) => {
  const db = await connect();
  const product = await getOwnedProductionPlanProduct(db, productionPlanOutputId, userId);
  if (!product) return { code: 0, message: "Este producto no esta asignado a tu usuario.", data: null };
  if (["completed", "skipped", "cancelled"].includes(product.product_status) || product.plan_status === "cancelled") {
    return { code: 0, message: "Este producto ya no se puede iniciar.", data: null };
  }
  await db.query(
    `UPDATE production_plan_product_details
     SET product_status = 'in_progress', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
     WHERE production_plan_output_id = ?`,
    [Number(productionPlanOutputId)]
  );
  await db.query(
    `UPDATE production_plan_items ppi
     INNER JOIN production_plan_outputs ppo ON ppo.production_plan_item_id = ppi.id
     INNER JOIN production_plans pp ON pp.id = ppi.production_plan_id
     SET ppi.started_at = COALESCE(ppi.started_at, CURRENT_TIMESTAMP),
         pp.status = IF(pp.status = 'assigned', 'viewed', pp.status),
         pp.viewed_at = COALESCE(pp.viewed_at, CURRENT_TIMESTAMP)
     WHERE ppo.id = ?`,
    [Number(productionPlanOutputId)]
  );
  return { code: 1, message: "Producto iniciado.", data: { production_plan_output_id: Number(productionPlanOutputId) } };
};

const saveProductionPlanProductProgress = async ({ productionPlanOutputId, userId, payload }) => {
  const db = await connect();
  const product = await getOwnedProductionPlanProduct(db, productionPlanOutputId, userId);
  if (!product) return { code: 0, message: "Este producto no esta asignado a tu usuario.", data: null };
  if (product.product_status !== "in_progress") {
    return { code: 0, message: "Inicia el producto antes de guardar avances.", data: null };
  }
  const progress = normalizeProductProgress(payload);
  if (!progress) return { code: 0, message: "Revisa las cantidades registradas.", data: null };
  await db.query(
    `UPDATE production_plan_product_details
     SET actual_arrobas = ?, produced_quantity = ?, actual_units_per_tray = ?,
         actual_tray_count = ?, actual_loose_units = ?, baker_notes = ?,
         reported_by = ?, reported_at = CURRENT_TIMESTAMP
     WHERE production_plan_output_id = ?`,
    [progress.actual_arrobas, progress.produced_quantity, progress.actual_units_per_tray,
      progress.actual_tray_count, progress.actual_loose_units, progress.baker_notes,
      Number(userId), Number(productionPlanOutputId)]
  );
  return { code: 1, message: "Avance guardado.", data: { production_plan_output_id: Number(productionPlanOutputId) } };
};

const skipProductionPlanProduct = async ({ productionPlanOutputId, userId, justification }) => {
  const db = await connect();
  const product = await getOwnedProductionPlanProduct(db, productionPlanOutputId, userId);
  const notes = String(justification || "").trim();
  if (!product) return { code: 0, message: "Este producto no esta asignado a tu usuario.", data: null };
  if (!notes) return { code: 0, message: "Escribe por que el producto no fue elaborado.", data: null };
  if (["completed", "skipped", "cancelled"].includes(product.product_status)) {
    return { code: 0, message: "Este producto ya fue cerrado.", data: null };
  }
  await db.query(
    `UPDATE production_plan_product_details ppd
     INNER JOIN production_plan_outputs ppo ON ppo.id = ppd.production_plan_output_id
     INNER JOIN production_plan_items ppi ON ppi.id = ppo.production_plan_item_id
     SET ppd.product_status = 'skipped', ppd.baker_notes = ?, ppd.reported_by = ?,
         ppd.reported_at = CURRENT_TIMESTAMP, ppd.completed_at = CURRENT_TIMESTAMP,
         ppi.finished_at = CURRENT_TIMESTAMP
     WHERE ppd.production_plan_output_id = ?`,
    [notes.slice(0, 500), Number(userId), Number(productionPlanOutputId)]
  );
  await refreshProductionPlanStatus(db, product.production_plan_id);
  return { code: 1, message: "Producto marcado como no elaborado.", data: null };
};

const finishProductionPlanProduct = async ({ productionPlanOutputId, userId, payload }) => {
  const db = await connect();
  const connection = await db.getConnection();
  const ownsTransaction = true;
  try {
    if (ownsTransaction) await connection.beginTransaction();
    const product = await getOwnedProductionPlanProduct(
      connection,
      productionPlanOutputId,
      userId,
      { forUpdate: true }
    );
    if (!product) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "Este producto no esta asignado a tu usuario.", data: null };
    }
    if (product.product_status === "completed" || product.production_batch_id) {
      if (ownsTransaction) await connection.rollback();
      return {
        code: 1,
        message: "El producto ya fue finalizado.",
        data: { production_batch_id: Number(product.production_batch_id || 0) || null },
      };
    }
    if (product.product_status !== "in_progress" || !product.item_started_at) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "Inicia el producto antes de finalizarlo.", data: null };
    }
    if (product.plan_status === "cancelled") {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "El plan fue cancelado.", data: null };
    }
    const progress = normalizeProductProgress(payload);
    if (!progress || !progress.actual_arrobas || !progress.produced_quantity) {
      if (ownsTransaction) await connection.rollback();
      return { code: 0, message: "Registra las arrobas utilizadas y la cantidad producida.", data: null };
    }

    const batchResult = await registerProductionBatch(
      {
        p_branch_id: Number(product.branch_id),
        p_recipe_id: Number(product.recipe_id),
        p_baker_employee_id: Number(product.baker_employee_id),
        p_produced_date: product.planned_date,
        p_batch_quantity: progress.actual_arrobas,
        p_outputs: [{ product_id: product.product_id, produced_quantity: progress.produced_quantity }],
        p_notes: progress.baker_notes || product.plan_notes || `Plan de produccion #${product.production_plan_id}`,
      },
      Number(userId),
      { connection }
    );
    if (batchResult?.code !== 1) {
        if (ownsTransaction) await connection.rollback();
      return batchResult;
    }

    const productionBatchId = Number(batchResult.data?.production_batch_id);
    await connection.query(
      `UPDATE production_plan_items
       SET production_batch_id = ?, finished_at = CURRENT_TIMESTAMP
       WHERE id = ? AND production_batch_id IS NULL`,
      [productionBatchId, Number(product.production_plan_item_id)]
    );
    await connection.query(
      `UPDATE production_sale_reservations psr
       INNER JOIN production_plan_outputs ppo ON ppo.id = psr.production_plan_output_id
       INNER JOIN production_batch_outputs pbo
         ON pbo.production_batch_id = ? AND pbo.product_id = ppo.product_id
       SET psr.production_batch_output_id = pbo.id
       WHERE ppo.id = ?
         AND psr.production_batch_output_id IS NULL
         AND psr.status IN ('reserved','partially_delivered')`,
      [productionBatchId, Number(productionPlanOutputId)]
    );
    await connection.query(
      `UPDATE production_plan_product_details
       SET product_status = 'completed', actual_arrobas = ?, produced_quantity = ?,
           actual_units_per_tray = ?, actual_tray_count = ?, actual_loose_units = ?,
           baker_notes = ?, reported_by = ?, reported_at = CURRENT_TIMESTAMP,
           completed_at = CURRENT_TIMESTAMP
       WHERE production_plan_output_id = ?`,
      [progress.actual_arrobas, progress.produced_quantity, progress.actual_units_per_tray,
        progress.actual_tray_count, progress.actual_loose_units, progress.baker_notes,
        Number(userId), Number(productionPlanOutputId)]
    );
    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'production_plan.product.finish', 'production_plan_outputs', ?,
         JSON_OBJECT('production_plan_id', ?, 'production_batch_id', ?, 'product_id', ?,
           'actual_arrobas', ?, 'produced_quantity', ?, 'inventory_state', 'pending_packaging'))`,
      [Number(userId), String(productionPlanOutputId), Number(product.production_plan_id),
        productionBatchId, Number(product.product_id), progress.actual_arrobas, progress.produced_quantity]
    );
    await refreshProductionPlanStatus(connection, product.production_plan_id);
    if (ownsTransaction) await connection.commit();
    return {
      ...batchResult,
      message: "Producto finalizado. La produccion queda pendiente de conteo y empaque.",
    };
  } catch (error) {
    if (ownsTransaction) await connection.rollback();
    throw error;
  } finally {
    if (ownsTransaction) connection.release();
  }
};

const correctProductionPlanProduct = async ({ productionPlanOutputId, actorUser = {}, payload = {} }) => {
  const db = await connect();
  const connection = await db.getConnection();
  const ownsTransaction = true;
  const actorUserId = Number(actorUser.userId || 0);
  const roleCodes = (Array.isArray(actorUser.roles) ? actorUser.roles : [])
    .map((role) => String(typeof role === "string" ? role : role?.code || role?.name || "").toUpperCase());
  const isAdministrator = roleCodes.includes("ADMIN") || roleCodes.includes("SUPER_ADMIN");
  const correctedArrobas = roundProductionQuantity(payload.p_actual_arrobas);
  const correctedQuantity = roundProductionQuantity(payload.p_produced_quantity);
  const reason = String(payload.p_reason || "").trim();
  if (!correctedArrobas || !correctedQuantity || !reason) {
    connection.release();
    return { code: 0, message: "Indica arrobas, cantidad producida y el motivo de la correccion.", data: null };
  }
  if (!Number.isInteger(Number(payload.p_produced_quantity))) {
    connection.release();
    return { code: 0, message: "La cantidad producida debe ser un numero entero.", data: null };
  }

  try {
    if (ownsTransaction) await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT
         ppd.id AS detail_id, ppd.product_status, ppd.actual_arrobas, ppd.produced_quantity,
         ppo.product_id, ppo.production_plan_item_id, ppi.recipe_id, ppi.production_batch_id,
         pp.branch_id, e.user_id AS baker_user_id,
         pb.status AS batch_status, pbo.id AS production_batch_output_id,
         pbo.packed_quantity, pbo.damaged_quantity, pbo.missing_quantity,
         COALESCE(pbo.direct_delivered_quantity, 0) AS direct_delivered_quantity
       FROM production_plan_outputs ppo
       INNER JOIN production_plan_product_details ppd ON ppd.production_plan_output_id = ppo.id
       INNER JOIN production_plan_items ppi ON ppi.id = ppo.production_plan_item_id
       INNER JOIN production_plans pp ON pp.id = ppi.production_plan_id
       INNER JOIN employees e ON e.id = pp.baker_employee_id
       INNER JOIN production_batches pb ON pb.id = ppi.production_batch_id
       INNER JOIN production_batch_outputs pbo
         ON pbo.production_batch_id = pb.id AND pbo.product_id = ppo.product_id
       WHERE ppo.id = ?
       LIMIT 1 FOR UPDATE`,
      [Number(productionPlanOutputId)]
    );
    if (!rows.length || rows[0].product_status !== "completed") {
      await connection.rollback();
      return { code: 0, message: "El producto no tiene una produccion finalizada para corregir.", data: null };
    }
    const product = rows[0];
    const accountedQuantity = Number(product.packed_quantity || 0)
      + Number(product.damaged_quantity || 0)
      + Number(product.missing_quantity || 0)
      + Number(product.direct_delivered_quantity || 0);
    const [reservationRows] = await connection.query(
      `SELECT COALESCE(SUM(quantity), 0) AS committed_quantity
       FROM production_sale_reservations
       WHERE production_plan_output_id = ?
         AND status NOT IN ('released','cancelled')`,
      [Number(productionPlanOutputId)]
    );
    const committedQuantity = Number(reservationRows[0]?.committed_quantity || 0);
    const hasPackaging = accountedQuantity > 0 || ["partially_packed", "packed"].includes(product.batch_status);
    const requiresAdministrator = hasPackaging || committedQuantity > 0;
    if (requiresAdministrator && !isAdministrator) {
      await connection.rollback();
      return { code: 0, message: "Despues del conteo, empaque o una reserva, solo un administrador puede corregir la produccion.", data: null };
    }
    if (!isAdministrator && Number(product.baker_user_id) !== actorUserId) {
      await connection.rollback();
      return { code: 0, message: "Esta produccion no esta asignada a tu usuario.", data: null };
    }
    if (correctedQuantity < Math.max(accountedQuantity, committedQuantity)) {
      await connection.rollback();
      return {
        code: 0,
        message: `La cantidad no puede ser menor a ${Math.max(accountedQuantity, committedQuantity).toLocaleString("es-CO")} unidades ya empacadas, entregadas o reservadas.`,
        data: null,
      };
    }

    const previousArrobas = Number(product.actual_arrobas);
    const previousQuantity = Number(product.produced_quantity);
    const arrobasDelta = roundProductionQuantity(correctedArrobas - previousArrobas);
    const scope = requiresAdministrator ? "post_packaging" : "pre_packaging";
    const [correctionInsert] = await connection.query(
      `INSERT INTO production_plan_product_corrections (
         production_plan_product_detail_id, production_batch_id, correction_scope,
         previous_actual_arrobas, corrected_actual_arrobas,
         previous_produced_quantity, corrected_produced_quantity, reason, corrected_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [Number(product.detail_id), Number(product.production_batch_id), scope,
        previousArrobas, correctedArrobas, previousQuantity, correctedQuantity,
        reason.slice(0, 500), actorUserId]
    );
    const correctionId = Number(correctionInsert.insertId);

    if (arrobasDelta !== 0) {
      const [materialRows] = await connection.query(
        `SELECT usage.raw_material_id, rm.unit_cost,
                ROUND(SUM(usage.quantity_per_arroba) * ABS(?), 3) AS adjustment_quantity
         FROM (
           SELECT ri.raw_material_id,
                  ri.quantity * (1 + COALESCE(ri.wastage_percent, 0) / 100) AS quantity_per_arroba
           FROM recipe_items ri WHERE ri.recipe_id = ?
           UNION ALL
           SELECT roi.raw_material_id,
                  roi.quantity * (1 + COALESCE(roi.wastage_percent, 0) / 100) AS quantity_per_arroba
           FROM recipe_output_items roi
           INNER JOIN recipe_outputs ro ON ro.id = roi.recipe_output_id
           WHERE ro.recipe_id = ? AND ro.product_id = ?
         ) usage
         INNER JOIN raw_materials rm ON rm.id = usage.raw_material_id
         GROUP BY usage.raw_material_id, rm.unit_cost`,
        [arrobasDelta, Number(product.recipe_id), Number(product.recipe_id), Number(product.product_id)]
      );
      for (const material of materialRows) {
        const quantity = Number(material.adjustment_quantity || 0);
        if (quantity <= 0) continue;
        await connection.query(
          `INSERT IGNORE INTO stock_raw_materials (branch_id, raw_material_id, quantity_on_hand, min_stock)
           VALUES (?, ?, 0, 0)`,
          [Number(product.branch_id), Number(material.raw_material_id)]
        );
        const [stockRows] = await connection.query(
          `SELECT quantity_on_hand FROM stock_raw_materials
           WHERE branch_id = ? AND raw_material_id = ? FOR UPDATE`,
          [Number(product.branch_id), Number(material.raw_material_id)]
        );
        if (arrobasDelta > 0 && Number(stockRows[0]?.quantity_on_hand || 0) < quantity) {
          await connection.rollback();
          return { code: 0, message: "No hay materia prima suficiente para aumentar las arrobas utilizadas.", data: null };
        }
        await connection.query(
          `UPDATE stock_raw_materials
           SET quantity_on_hand = quantity_on_hand ${arrobasDelta > 0 ? "-" : "+"} ?
           WHERE branch_id = ? AND raw_material_id = ?`,
          [quantity, Number(product.branch_id), Number(material.raw_material_id)]
        );
        await connection.query(
          `INSERT INTO inventory_movements (
             branch_id, item_type, raw_material_id, product_id, movement_type,
             quantity, unit_cost, reference_type, reference_id, notes, created_by
           ) VALUES (?, 'raw_material', ?, NULL, ?, ?, ?, 'production_correction', ?, ?, ?)`,
          [Number(product.branch_id), Number(material.raw_material_id),
            arrobasDelta > 0 ? "production_out" : "adjustment_in", quantity,
            material.unit_cost ?? null, correctionId, reason.slice(0, 500), actorUserId]
        );
      }
    }

    await connection.query(
      `UPDATE production_batches SET batch_quantity = ? WHERE id = ?`,
      [correctedArrobas, Number(product.production_batch_id)]
    );
    await connection.query(
      `UPDATE production_batch_outputs SET produced_quantity = ? WHERE id = ?`,
      [correctedQuantity, Number(product.production_batch_output_id)]
    );
    await connection.query(
      `UPDATE production_plan_product_details
       SET actual_arrobas = ?, produced_quantity = ?, baker_notes = ?,
           reported_by = ?, reported_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [correctedArrobas, correctedQuantity, reason.slice(0, 500), actorUserId, Number(product.detail_id)]
    );
    const remainingQuantity = correctedQuantity - accountedQuantity;
    await connection.query(
      `UPDATE production_batches
       SET status = CASE
         WHEN ? <= 0 THEN 'packed'
         WHEN ? > 0 THEN 'partially_packed'
         ELSE 'pending_packaging'
       END
       WHERE id = ?`,
      [remainingQuantity, accountedQuantity, Number(product.production_batch_id)]
    );
    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'production_plan.product.correct', 'production_plan_outputs', ?,
         JSON_OBJECT('correction_id', ?, 'scope', ?, 'previous_arrobas', ?, 'corrected_arrobas', ?,
           'previous_quantity', ?, 'corrected_quantity', ?, 'reason', ?))`,
      [actorUserId, String(productionPlanOutputId), correctionId, scope, previousArrobas,
        correctedArrobas, previousQuantity, correctedQuantity, reason.slice(0, 500)]
    );
    if (ownsTransaction) await connection.commit();
    return { code: 1, message: "Correccion registrada con trazabilidad.", data: { correction_id: correctionId } };
  } catch (error) {
    if (ownsTransaction) await connection.rollback();
    throw error;
  } finally {
    if (ownsTransaction) connection.release();
  }
};

const listUserNotifications = async ({ userId, onlyUnread } = {}) => {
  const db = await connect();
  const filters = ["user_id = ?"];
  const params = [Number(userId)];
  if (onlyUnread) {
    filters.push("viewed_at IS NULL");
  }
  const [rows] = await db.query(
    `SELECT id, notification_type, title, message, reference_type, reference_id, viewed_at, created_at
       FROM user_notifications
      WHERE ${filters.join(" AND ")}
      ORDER BY viewed_at IS NULL DESC, created_at DESC
      LIMIT 30`,
    params
  );
  return { code: 1, message: "notificaciones listadas", data: rows };
};

const markUserNotificationViewed = async ({ notificationId, userId }) => {
  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, reference_type, reference_id
         FROM user_notifications
        WHERE id = ?
          AND user_id = ?
        LIMIT 1
        FOR UPDATE`,
      [Number(notificationId), Number(userId)]
    );
    if (!rows.length) {
      await connection.rollback();
      return { code: 0, message: "NotificaciÃƒÂ³n no encontrada.", data: null };
    }

    await connection.query(
      "UPDATE user_notifications SET viewed_at = COALESCE(viewed_at, CURRENT_TIMESTAMP) WHERE id = ?",
      [Number(notificationId)]
    );
    if (rows[0].reference_type === "production_plan" && rows[0].reference_id) {
      await connection.query(
        `UPDATE production_plans
            SET status = IF(status = 'assigned', 'viewed', status),
                viewed_at = COALESCE(viewed_at, CURRENT_TIMESTAMP)
          WHERE id = ?`,
        [Number(rows[0].reference_id)]
      );
    }
    await connection.commit();
    return { code: 1, message: "NotificaciÃƒÂ³n marcada como vista.", data: { notification_id: Number(notificationId) } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const closeProductionOrder = async (payload, actorUserId) => {
  const db = await connect();
  const [pendingItems] = await db.query(
    `
      SELECT COUNT(*) AS total
      FROM production_order_items
      WHERE production_order_id = ?
        AND status <> 'cancelled'
        AND (status <> 'done' OR produced_qty < planned_qty)
    `,
    [payload.p_production_order_id]
  );

  if (Number(pendingItems[0]?.total || 0) > 0) {
    return {
      code: 0,
      message: "la orden de produccion tiene items pendientes o con cantidad faltante",
      data: {
        pending_items: Number(pendingItems[0].total),
      },
    };
  }

  const out = await callProcedure("sp_close_production_order", [
    payload.p_production_order_id,
    actorUserId || null,
  ]);
  const result = mapSpResult(out);

  if (result.code === 1) {
    const [columnRows] = await db.query(
      `
        SELECT COUNT(*) AS total
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'production_orders'
          AND COLUMN_NAME = 'source_order_id'
      `
    );

    if (Number(columnRows[0]?.total || 0) > 0) {
      await db.query(
        `
          UPDATE orders o
          INNER JOIN production_orders po ON po.source_order_id = o.id
          SET o.status = 'ready',
              o.updated_at = CURRENT_TIMESTAMP
          WHERE po.id = ?
            AND o.status = 'in_production'
        `,
        [payload.p_production_order_id]
      );
    }
  }

  return result;
};

const cancelProductionOrder = async (payload, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const productionOrderId = Number(payload.p_production_order_id || 0);
    const reason = payload.p_reason || null;

    const [orders] = await connection.query(
      "SELECT id, status FROM production_orders WHERE id = ? FOR UPDATE",
      [productionOrderId]
    );

    if (!orders.length) {
      await connection.rollback();
      return { code: 0, message: "orden de produccion no encontrada", data: null };
    }

    if (["completed", "cancelled"].includes(orders[0].status)) {
      await connection.rollback();
      return { code: 0, message: `la orden no permite cancelacion desde estado ${orders[0].status}`, data: null };
    }

    const [producedRows] = await connection.query(
      `
        SELECT COALESCE(SUM(produced_qty), 0) AS produced_qty
        FROM production_order_items
        WHERE production_order_id = ?
          AND status <> 'cancelled'
      `,
      [productionOrderId]
    );

    if (Number(producedRows[0]?.produced_qty || 0) > 0) {
      await connection.rollback();
      return { code: 0, message: "no se puede cancelar una orden con produccion registrada; ajusta los pendientes o cierra con trazabilidad", data: null };
    }

    await connection.query(
      "UPDATE production_order_items SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE production_order_id = ? AND status <> 'cancelled'",
      [productionOrderId]
    );

    await connection.query(
      "UPDATE production_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [productionOrderId]
    );

    await connection.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
        VALUES (?, 'production_order.cancel', 'production_orders', ?, JSON_OBJECT('reason', ?))
      `,
      [actorUserId || null, String(productionOrderId), reason]
    );

    await connection.commit();

    return {
      code: 1,
      message: "orden de produccion cancelada",
      data: {
        production_order_id: productionOrderId,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  listProductionOrders,
  createProductionOrder,
  listProductionOrderItems,
  upsertProductionOrderItem,
  updateProductionOrderItemPlan,
  cancelProductionOrderItem,
  registerProductionOrderItemResult,
  listProductionBaseData,
  listMyProductionBaseData,
  registerProductionResult,
  registerProductionBatch,
  registerMyProductionBatch,
  listPendingPackaging,
  createPackingReport,
  listJustifiedShortages,
  registerProductionDamage,
  getRawMaterialUsageReport,
  getRawMaterialUsageByProductReport,
  getPackingSummaryReport,
  getProductionDayReport,
  getProductionMonthReport,
  createProductionPlan,
  updateProductionPlan,
  listProductionPlans,
  startProductionPlanItem,
  finishProductionPlanItem,
  startProductionPlanProduct,
  saveProductionPlanProductProgress,
  skipProductionPlanProduct,
  finishProductionPlanProduct,
  correctProductionPlanProduct,
  listUserNotifications,
  markUserNotificationViewed,
  closeProductionOrder,
  cancelProductionOrder,
};








