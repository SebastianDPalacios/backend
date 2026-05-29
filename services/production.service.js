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
        "SELECT id FROM recipes WHERE id = ? AND product_id = ? AND is_active = 1",
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

const registerProductionOrderItemResult = async (payload, actorUserId) => {
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
    "SELECT output_quantity FROM recipes WHERE id = ? AND product_id = ? AND is_active = 1",
    [item.recipe_id, item.product_id]
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
  closeProductionOrder,
  cancelProductionOrder,
};
