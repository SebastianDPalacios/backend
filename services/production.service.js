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
  message: "Este registro directo fue reemplazado. Envía la producción al panadero, finaliza el lote y registra el empaque; solo lo empacado entra al inventario de venta.",
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

const registerProductionResult = async (payload, actorUserId) => {
  return {
    code: 0,
    message: "El registro manual fue reemplazado. Crea una asignación, finaliza la producción y registra el empaque; solo las unidades empacadas quedan disponibles para vender.",
    data: null,
  };
};

const registerProductionBatch = async (payload, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();
  const branchId = Number(payload.p_branch_id || 0);
  const requestedRecipeId = Number(payload.p_recipe_id || 0);
  const bakerEmployeeId = Number(payload.p_baker_employee_id || 0);
  const batchQuantity = Number(payload.p_batch_quantity || 1);
  const selectedOutputs = Array.isArray(payload.p_outputs) ? payload.p_outputs : payload.p_outputs_json || [];
  const requestedProductIds = selectedOutputs
    .map((item) => Number(item.product_id))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!branchId || !requestedRecipeId || !bakerEmployeeId || batchQuantity <= 0) {
    connection.release();
    return {
      code: 0,
      message: "Completa sucursal, receta vigente, panadero y una cantidad de arrobas mayor a cero.",
      data: null,
    };
  }

  try {
    await connection.beginTransaction();

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
      await connection.rollback();
      return { code: 0, message: "La receta no existe o no tiene una versión vigente.", data: null };
    }

    const recipeId = Number(recipeRows[0].id);
    const [branchRows] = await connection.query(
      "SELECT id, name FROM branches WHERE id = ? AND is_active = 1 LIMIT 1",
      [branchId]
    );
    if (!branchRows.length) {
      await connection.rollback();
      return { code: 0, message: "La sucursal no existe o está inactiva.", data: null };
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
      await connection.rollback();
      return { code: 0, message: "El panadero no existe o está inactivo.", data: null };
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
      await connection.rollback();
      return { code: 0, message: "Selecciona productos finales que pertenezcan a la versión vigente de la receta.", data: null };
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
      await connection.rollback();
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
          `Consumo automático de receta V${recipeRows[0].version_no}`,
          actorUserId || null,
        ]
      );
    }

    for (const output of outputRows) {
      const producedQuantity = Math.round(Number(output.expected_quantity) * batchQuantity * 1000) / 1000;
      await connection.query(
        `INSERT INTO production_batch_outputs (
           production_batch_id, product_id, expected_quantity, produced_quantity, packing_note
         ) VALUES (?, ?, ?, ?, ?)`,
        [
          productionBatchId,
          Number(output.product_id),
          Number(output.expected_quantity),
          producedQuantity,
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

    await connection.commit();
    return {
      code: 1,
      message: "Producción registrada con la versión vigente y todos sus ingredientes descontados.",
      data: {
        production_batch_id: productionBatchId,
        recipe_id: recipeId,
        recipe_version: Number(recipeRows[0].version_no),
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
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
    return { code: 0, message: "Agrega al menos un producto empacado o dañado.", data: null };
  }

  if (validOutputIds.length !== items.length) {
    return { code: 0, message: "Hay un producto de producción inválido en el reporte.", data: null };
  }

  if (new Set(validOutputIds).size !== validOutputIds.length) {
    return {
      code: 0,
      message: "Cada producto debe aparecer una sola vez en el reporte de empaque.",
      data: null,
    };
  }

  const hasInvalidQuantity = items.some((item) => {
    const packed = Number(item.packed_quantity || 0);
    const damaged = Number(item.damaged_quantity || 0);
    const missing = Number(item.missing_quantity || 0);

    return [packed, damaged, missing].some((value) => !Number.isFinite(value) || value < 0)
      || packed + damaged + missing <= 0;
  });

  if (hasInvalidQuantity) {
    return {
      code: 0,
      message: "Revisa las cantidades: deben ser positivas y al menos una debe ser mayor que cero.",
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
      message: "Todo faltante debe incluir un motivo y una explicación.",
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
  return mapSpResult(out);
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
        COUNT(DISTINCT pb.id) AS batches_count,
        COALESCE(SUM(pbo.produced_quantity), 0) AS produced_quantity,
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
      GROUP BY pbo.product_id, p.name, p.sku
      ORDER BY p.name
    `,
    values
  );

  const [rawMaterialRows] = await db.query(
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
  const [recipeMaterialRows] = await db.query(
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
      recipe_materials_usage: recipeMaterialRows,
    },
  };
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
      message: "Selecciona sucursal, fecha, panadero y al menos una receta.",
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
      return { code: 0, message: "La sucursal o el panadero no están disponibles.", data: null };
    }

    const normalizedItems = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const requestedRecipeId = Number(item.recipe_id || 0);
      const arrobas = Number(item.arrobas || 0);
      if (!requestedRecipeId || arrobas <= 0) {
        await connection.rollback();
        return { code: 0, message: `Revisa la receta ${index + 1} y su cantidad de arrobas.`, data: null };
      }

      const [recipeRows] = await connection.query(
        `SELECT current_recipe.id,
                current_recipe.version_no,
                current_recipe.notes
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
        await connection.rollback();
        return { code: 0, message: `La receta ${index + 1} no tiene una versión vigente.`, data: null };
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

      if (!selectedOutputs.length || (requestedProductIds.length && selectedOutputs.length !== new Set(requestedProductIds).size)) {
        await connection.rollback();
        return { code: 0, message: `Selecciona productos válidos para la receta ${index + 1}.`, data: null };
      }

      normalizedItems.push({
        recipeId,
        recipeVersion: Number(recipeRows[0].version_no),
        recipeName: String(recipeRows[0].notes || `Receta #${recipeId}`).split(/\s+-\s+/)[0],
        arrobas,
        outputs: selectedOutputs,
      });
    }

    const [planInsert] = await connection.query(
      `INSERT INTO production_plans (
         branch_id, planned_date, baker_employee_id, status, notes, created_by
       ) VALUES (?, ?, ?, 'assigned', ?, ?)`,
      [branchId, plannedDate, bakerEmployeeId, payload.p_notes || null, actorUserId || null]
    );
    const productionPlanId = Number(planInsert.insertId);

    for (let index = 0; index < normalizedItems.length; index += 1) {
      const item = normalizedItems[index];
      const [itemInsert] = await connection.query(
        `INSERT INTO production_plan_items (
           production_plan_id, recipe_id, arrobas, sort_order
         ) VALUES (?, ?, ?, ?)`,
        [productionPlanId, item.recipeId, item.arrobas, index + 1]
      );
      const planItemId = Number(itemInsert.insertId);

      for (const output of item.outputs) {
        await connection.query(
          `INSERT INTO production_plan_outputs (
             production_plan_item_id, product_id, expected_quantity
           ) VALUES (?, ?, ?)`,
          [
            planItemId,
            Number(output.product_id),
            Math.round(Number(output.expected_quantity) * item.arrobas * 1000) / 1000,
          ]
        );
      }
    }

    const totalArrobas = normalizedItems.reduce((sum, item) => sum + item.arrobas, 0);
    await connection.query(
      `INSERT INTO user_notifications (
         user_id, notification_type, title, message, reference_type, reference_id
       ) VALUES (?, 'production_plan', ?, ?, 'production_plan', ?)`,
      [
        Number(bakerRows[0].user_id),
        `Producción asignada para ${plannedDate}`,
        `${normalizedItems.length} receta(s) y ${totalArrobas.toLocaleString("es-CO")} arroba(s) en ${branchRows[0].name}.`,
        productionPlanId,
      ]
    );

    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'production_plan.create', 'production_plans', ?,
         JSON_OBJECT('planned_date', ?, 'baker_employee_id', ?, 'recipes', ?, 'arrobas', ?))`,
      [
        actorUserId || null,
        String(productionPlanId),
        plannedDate,
        bakerEmployeeId,
        normalizedItems.length,
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

const listProductionPlans = async ({ userId, plannedDate, bakerEmployeeId } = {}) => {
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
    return { code: 1, message: "planes de producción listados", data: [] };
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
         ppo.production_plan_item_id,
         ppo.product_id,
         p.name AS product_name,
         ppo.expected_quantity,
         COALESCE(reserved.reserved_quantity, 0) AS reserved_quantity,
         COALESCE(reserved.delivered_quantity, 0) AS direct_delivered_quantity
       FROM production_plan_outputs ppo
       INNER JOIN products p ON p.id = ppo.product_id
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

  return {
    code: 1,
    message: "planes de producción listados",
    data: plans.map((plan) => ({ ...plan, items: itemsByPlan[String(plan.id)] || [] })),
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
    return { code: 0, message: "Esta producción no está asignada a tu usuario.", data: null };
  }
  if (rows[0].status === "cancelled") {
    return { code: 0, message: "Esta asignación fue cancelada.", data: null };
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
    message: rows[0].production_batch_id ? "La producción ya está finalizada." : "Producción iniciada.",
    data: {
      production_plan_item_id: Number(productionPlanItemId),
      production_batch_id: rows[0].production_batch_id ? Number(rows[0].production_batch_id) : null,
    },
  };
};

const finishProductionPlanItem = async ({ productionPlanItemId, userId }) => {
  const db = await connect();
  const lockConnection = await db.getConnection();
  const lockName = `production_plan_item_${Number(productionPlanItemId)}`;
  let lockAcquired = false;

  try {
    const [lockRows] = await lockConnection.query("SELECT GET_LOCK(?, 5) AS acquired", [lockName]);
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) {
      return { code: 0, message: "La producción se está iniciando. Espera un momento.", data: null };
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
      return { code: 0, message: "Esta producción no está asignada a tu usuario.", data: null };
    }

    const item = itemRows[0];
    if (item.production_batch_id) {
      return {
        code: 1,
        message: "Esta producción ya fue iniciada.",
        data: { production_batch_id: Number(item.production_batch_id) },
      };
    }

    if (item.status === "cancelled") {
      return { code: 0, message: "Esta asignación fue cancelada.", data: null };
    }
    if (!item.started_at) {
      return { code: 0, message: "Primero debes iniciar la producción.", data: null };
    }

    const [outputRows] = await lockConnection.query(
      `SELECT product_id
       FROM production_plan_outputs
       WHERE production_plan_item_id = ?
       ORDER BY id`,
      [Number(productionPlanItemId)]
    );

    const batchResult = await registerProductionBatch(
      {
        p_branch_id: Number(item.branch_id),
        p_recipe_id: Number(item.recipe_id),
        p_baker_employee_id: Number(item.baker_employee_id),
        p_produced_date: item.planned_date,
        p_batch_quantity: Number(item.arrobas),
        p_outputs: outputRows.map((output) => ({ product_id: Number(output.product_id) })),
        p_notes: item.notes || `Plan de producción #${item.production_plan_id}`,
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
      message: "Producción iniciada. El lote quedó pendiente de conteo y empaque.",
      data: { production_batch_id: productionBatchId },
    };
  } finally {
    if (lockAcquired) {
      await lockConnection.query("SELECT RELEASE_LOCK(?)", [lockName]);
    }
    lockConnection.release();
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
      return { code: 0, message: "Notificación no encontrada.", data: null };
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
    return { code: 1, message: "Notificación marcada como vista.", data: { notification_id: Number(notificationId) } };
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
  registerProductionResult,
  registerProductionBatch,
  listPendingPackaging,
  createPackingReport,
  listJustifiedShortages,
  registerProductionDamage,
  getRawMaterialUsageReport,
  getPackingSummaryReport,
  getProductionDayReport,
  getProductionMonthReport,
  createProductionPlan,
  listProductionPlans,
  startProductionPlanItem,
  finishProductionPlanItem,
  listUserNotifications,
  markUserNotificationViewed,
  closeProductionOrder,
  cancelProductionOrder,
};
