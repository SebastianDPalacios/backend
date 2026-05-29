const { callProcedure, callProcedureWithoutData, connect } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const listOrders = async ({ status, search, page, pageSize }) => {
  const db = await connect();
  const currentPage = Math.max(Number(page || 1), 1);
  const currentPageSize = Math.min(Math.max(Number(pageSize || 20), 1), 100);
  const offset = (currentPage - 1) * currentPageSize;
  const filters = [];
  const values = [];

  if (status) {
    filters.push("o.status = ?");
    values.push(status);
  }

  if (search) {
    filters.push("(CAST(o.id AS CHAR) LIKE ? OR c.name LIKE ? OR r.name LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const [rows] = await db.query(
    `
      SELECT
        o.id,
        o.branch_id,
        b.name AS branch_name,
        o.customer_id,
        c.name AS customer_name,
        o.route_id,
        r.name AS route_name,
        o.order_date,
        o.delivery_date,
        o.status,
        o.subtotal,
        o.tax_total,
        o.grand_total,
        o.notes,
        o.created_at,
        o.updated_at,
        px.production_order_id,
        px.production_status,
        px.production_planned_qty,
        px.production_produced_qty,
        px.production_pending_items
      FROM orders o
      INNER JOIN branches b ON b.id = o.branch_id
      INNER JOIN customers c ON c.id = o.customer_id
      LEFT JOIN delivery_routes r ON r.id = o.route_id
      LEFT JOIN (
        SELECT
          po.source_order_id,
          MAX(po.id) AS production_order_id,
          MAX(po.status) AS production_status,
          COALESCE(SUM(poi.planned_qty), 0) AS production_planned_qty,
          COALESCE(SUM(poi.produced_qty), 0) AS production_produced_qty,
          SUM(
            CASE
              WHEN poi.status = 'cancelled' THEN 0
              WHEN poi.status <> 'done' OR poi.produced_qty < poi.planned_qty THEN 1
              ELSE 0
            END
          ) AS production_pending_items
        FROM production_orders po
        LEFT JOIN production_order_items poi ON poi.production_order_id = po.id
        WHERE po.source_order_id IS NOT NULL
          AND po.status <> 'cancelled'
        GROUP BY po.source_order_id
      ) px ON px.source_order_id = o.id
      ${whereClause}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ? OFFSET ?
    `,
    [...values, currentPageSize, offset]
  );

  return {
    code: 1,
    message: "pedidos listados",
    data: {
      items: rows,
      page: currentPage,
      pageSize: currentPageSize,
    },
  };
};

const listOrderItems = async ({ orderId }) => {
  const db = await connect();
  const [rows] = await db.query(
    `
      SELECT
        oi.id,
        oi.order_id,
        oi.product_id,
        p.sku AS product_sku,
        p.name AS product_name,
        oi.quantity,
        oi.unit_price,
        oi.tax_percent,
        oi.line_subtotal,
        oi.line_tax,
        oi.line_total
      FROM order_items oi
      INNER JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
      ORDER BY p.name
    `,
    [orderId]
  );

  return {
    code: 1,
    message: "items de pedido listados",
    data: {
      items: rows,
    },
  };
};

const listOrderBaseData = async ({ onlyActive, search, page, pageSize, refDate }) => {
  const [customersOut, routesOut, productsOut] = await Promise.all([
    callProcedure("sp_customer_list", [null, search || null, Number(page || 1), Number(pageSize || 20)]),
    callProcedure("sp_route_list", [Number(onlyActive || 0), refDate || null]),
    callProcedure("sp_product_list", [
      Number(onlyActive || 0),
      null,
      search || null,
      Number(page || 1),
      Number(pageSize || 20),
    ]),
  ]);

  const customers = mapSpResult(customersOut);
  const routes = mapSpResult(routesOut);
  const products = mapSpResult(productsOut);

  if (customers.code !== 1) {
    return customers;
  }

  if (routes.code !== 1) {
    return routes;
  }

  if (products.code !== 1) {
    return products;
  }

  return {
    code: 1,
    message: "catalogos de orden obtenidos",
    data: {
      customers: customers.data,
      routes: routes.data,
      products: products.data,
    },
  };
};

const createOrder = async (payload, actorUserId) => {
  const out = await callProcedure("sp_create_order", [
    payload.p_branch_id || null,
    payload.p_customer_id || null,
    payload.p_route_id || null,
    payload.p_order_date || null,
    payload.p_delivery_date || null,
    payload.p_notes || null,
    actorUserId || null,
  ]);
  const result = mapSpResult(out);
  const orderId = Number(result.data || 0);

  if (result.code === 1 && orderId > 0) {
    return {
      ...result,
      data: {
        order_id: orderId,
      },
    };
  }

  return result;
};

const upsertOrderItem = async (payload, actorUserId) => {
  const quantity = Number(payload.p_quantity || 0);
  const orderId = Number(payload.p_order_id || 0);
  const productId = Number(payload.p_product_id || 0);

  if (!orderId) {
    return { code: 0, message: "selecciona un pedido", data: null };
  }

  if (!productId) {
    return { code: 0, message: "selecciona un producto", data: null };
  }

  const db = await connect();
  const [orders] = await db.query("SELECT id, status FROM orders WHERE id = ?", [orderId]);

  if (!orders.length) {
    return { code: 0, message: "pedido no encontrado", data: null };
  }

  if (orders[0].status !== "draft") {
    return { code: 0, message: "solo puedes editar items cuando el pedido esta en borrador", data: null };
  }

  if (quantity <= 0) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        "DELETE FROM order_items WHERE order_id = ? AND product_id = ?",
        [orderId, productId]
      );

      const [totals] = await connection.query(
        `
          SELECT
            COALESCE(ROUND(SUM(line_subtotal), 2), 0) AS subtotal,
            COALESCE(ROUND(SUM(line_tax), 2), 0) AS tax_total,
            COALESCE(ROUND(SUM(line_total), 2), 0) AS grand_total
          FROM order_items
          WHERE order_id = ?
        `,
        [orderId]
      );

      await connection.query(
        `
          UPDATE orders
          SET subtotal = ?,
              tax_total = ?,
              grand_total = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          Number(totals[0]?.subtotal || 0),
          Number(totals[0]?.tax_total || 0),
          Number(totals[0]?.grand_total || 0),
          orderId,
        ]
      );

      await connection.query(
        `
          INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
          VALUES (?, 'order.item.remove', 'orders', ?, JSON_OBJECT('product_id', ?))
        `,
        [actorUserId || null, String(orderId), productId]
      );

      await connection.commit();

      return {
        code: 1,
        message: "item de pedido eliminado",
        data: null,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  const out = await callProcedureWithoutData("sp_order_upsert_item", [
    orderId,
    productId,
    quantity,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const confirmOrder = async (payload, actorUserId) => {
  const out = await callProcedureWithoutData("sp_confirm_order", [
    payload.p_order_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const cancelOrder = async (payload, actorUserId) => {
  const out = await callProcedure("sp_cancel_order", [
    payload.p_order_id,
    payload.p_reason || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const dispatchOrder = async (payload, actorUserId) => {
  const db = await connect();
  const orderId = Number(payload.p_order_id || 0);

  if (orderId) {
    const [rows] = await db.query(
      `
        SELECT
          o.status,
          po.id AS production_order_id,
          po.status AS production_status,
          SUM(
            CASE
              WHEN poi.status = 'cancelled' THEN 0
              WHEN poi.status <> 'done' OR poi.produced_qty < poi.planned_qty THEN 1
              ELSE 0
            END
          ) AS pending_items
        FROM orders o
        LEFT JOIN production_orders po
          ON po.source_order_id = o.id
         AND po.status <> 'cancelled'
        LEFT JOIN production_order_items poi ON poi.production_order_id = po.id
        WHERE o.id = ?
        GROUP BY o.id, o.status, po.id, po.status
      `,
      [orderId]
    );

    const row = rows[0];
    if (row?.status === "in_production" && row.production_status === "completed" && Number(row.pending_items || 0) === 0) {
      await db.query("UPDATE orders SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [orderId]);
    }
  }

  const out = await callProcedure("sp_dispatch_order", [
    orderId || payload.p_order_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createProductionFromOrder = async (payload, actorUserId) => {
  const orderId = Number(payload.p_order_id || 0);
  const plannedDate = String(payload.p_planned_date || new Date().toISOString().slice(0, 10)).slice(0, 10);

  if (!orderId) {
    return { code: 0, message: "selecciona un pedido", data: null };
  }

  const db = await connect();
  const [columnRows] = await db.query(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'production_orders'
        AND COLUMN_NAME = 'source_order_id'
    `
  );

  if (Number(columnRows[0]?.total || 0) === 0) {
    return {
      code: 0,
      message: "falta ejecutar database/032_link_orders_to_production.sql para vincular pedidos con produccion",
      data: null,
    };
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [orders] = await connection.query(
      "SELECT id, branch_id, status, delivery_date FROM orders WHERE id = ? FOR UPDATE",
      [orderId]
    );

    if (!orders.length) {
      await connection.rollback();
      return { code: 0, message: "pedido no encontrado", data: null };
    }

    const order = orders[0];
    if (order.status !== "confirmed") {
      await connection.rollback();
      return { code: 0, message: "solo puedes crear produccion desde un pedido confirmado", data: null };
    }

    const [existing] = await connection.query(
      "SELECT id FROM production_orders WHERE source_order_id = ? AND status <> 'cancelled' LIMIT 1",
      [orderId]
    );

    if (existing.length) {
      await connection.rollback();
      return {
        code: 0,
        message: `este pedido ya tiene orden de produccion #${existing[0].id}`,
        data: { production_order_id: existing[0].id },
      };
    }

    const [items] = await connection.query(
      `
        SELECT
          oi.product_id,
          oi.quantity,
          p.name AS product_name,
          r.id AS recipe_id
        FROM order_items oi
        INNER JOIN products p ON p.id = oi.product_id
        LEFT JOIN recipes r
          ON r.product_id = oi.product_id
         AND r.is_active = 1
        WHERE oi.order_id = ?
      `,
      [orderId]
    );

    if (!items.length) {
      await connection.rollback();
      return { code: 0, message: "el pedido no tiene productos para planificar", data: null };
    }

    const missingRecipes = items.filter((item) => !item.recipe_id);
    if (missingRecipes.length) {
      await connection.rollback();
      return {
        code: 0,
        message: `hay productos sin receta activa: ${missingRecipes.map((item) => item.product_name).join(", ")}`,
        data: { missing_recipes: missingRecipes },
      };
    }

    const [productionOrderResult] = await connection.query(
      `
        INSERT INTO production_orders (
          source_order_id, branch_id, planned_date, status, notes, created_by
        )
        VALUES (?, ?, ?, 'planned', ?, ?)
      `,
      [
        orderId,
        order.branch_id,
        plannedDate || order.delivery_date || new Date().toISOString().slice(0, 10),
        `Generada desde pedido #${orderId}`,
        actorUserId || null,
      ]
    );

    const productionOrderId = productionOrderResult.insertId;
    for (const item of items) {
      await connection.query(
        `
          INSERT INTO production_order_items (
            production_order_id, product_id, recipe_id, planned_qty, produced_qty, status
          )
          VALUES (?, ?, ?, ?, 0, 'pending')
        `,
        [productionOrderId, item.product_id, item.recipe_id, item.quantity]
      );
    }

    await connection.query(
      "UPDATE orders SET status = 'in_production', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [orderId]
    );

    await connection.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
        VALUES (?, 'order.production.create', 'orders', ?, JSON_OBJECT('production_order_id', ?, 'items_count', ?))
      `,
      [actorUserId || null, String(orderId), productionOrderId, items.length]
    );

    await connection.commit();

    return {
      code: 1,
      message: "orden de produccion creada desde pedido",
      data: {
        order_id: orderId,
        production_order_id: productionOrderId,
        items_count: items.length,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const receivePurchaseOrder = async (payload, actorUserId) => {
  const out = await callProcedure("sp_receive_purchase_order", [
    payload.p_purchase_order_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createPurchaseOrder = async (payload, actorUserId) => {
  const branchId = Number(payload.p_branch_id || 0);
  const supplierId = Number(payload.p_supplier_id || 0);
  const items = Array.isArray(payload.p_items_json) ? payload.p_items_json : [];
  const notes = payload.p_notes || null;
  const orderDate = payload.p_order_date || new Date().toISOString().slice(0, 10);
  const expectedDate = payload.p_expected_date || null;

  if (!branchId) {
    return { code: 0, message: "selecciona una sucursal", data: null };
  }

  if (!supplierId) {
    return { code: 0, message: "selecciona un proveedor", data: null };
  }

  if (!items.length) {
    return { code: 0, message: "agrega al menos una materia prima", data: null };
  }

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const normalizedItems = [];
    for (const item of items) {
      const rawMaterialId = Number(item.raw_material_id || item.p_raw_material_id || 0);
      const quantity = Number(item.quantity || item.p_quantity || 0);
      const unitCost = Number(item.unit_cost || item.p_unit_cost || 0);
      const taxPercent = Number(item.tax_percent || item.p_tax_percent || 0);

      if (!rawMaterialId || quantity <= 0 || unitCost < 0 || taxPercent < 0) {
        await connection.rollback();
        return { code: 0, message: "revisa materia prima, cantidad y costo", data: null };
      }

      normalizedItems.push({ rawMaterialId, quantity, unitCost, taxPercent });
    }

    const subtotal = normalizedItems.reduce((acc, item) => acc + item.quantity * item.unitCost, 0);
    const taxTotal = normalizedItems.reduce((acc, item) => acc + item.quantity * item.unitCost * (item.taxPercent / 100), 0);
    const grandTotal = subtotal + taxTotal;

    const [orderResult] = await connection.query(
      `
        INSERT INTO purchase_orders (
          branch_id, supplier_id, order_date, expected_date, status,
          subtotal, tax_total, grand_total, notes, created_by
        )
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
      `,
      [branchId, supplierId, orderDate, expectedDate, subtotal, taxTotal, grandTotal, notes, actorUserId || null]
    );

    const purchaseOrderId = orderResult.insertId;
    for (const item of normalizedItems) {
      const lineSubtotal = item.quantity * item.unitCost;
      const lineTax = lineSubtotal * (item.taxPercent / 100);
      const lineTotal = lineSubtotal + lineTax;

      await connection.query(
        `
          INSERT INTO purchase_order_items (
            purchase_order_id, raw_material_id, quantity, unit_cost, tax_percent,
            line_subtotal, line_tax, line_total
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          purchaseOrderId,
          item.rawMaterialId,
          item.quantity,
          item.unitCost,
          item.taxPercent,
          lineSubtotal,
          lineTax,
          lineTotal,
        ]
      );
    }

    await connection.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
        VALUES (?, 'purchase_order.create', 'purchase_orders', ?, JSON_OBJECT('items_count', ?, 'grand_total', ?))
      `,
      [actorUserId || null, String(purchaseOrderId), normalizedItems.length, grandTotal]
    );

    await connection.commit();
    return {
      code: 1,
      message: "orden de compra creada",
      data: {
        purchase_order_id: purchaseOrderId,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const listPendingPurchaseOrders = async ({ branchId, search, page, pageSize } = {}) => {
  const db = await connect();
  const filters = ["po.status IN ('draft', 'sent', 'partially_received')"];
  const params = [];
  const limit = Math.min(Math.max(Number(pageSize || 30), 1), 100);
  const offset = (Math.max(Number(page || 1), 1) - 1) * limit;

  if (branchId) {
    filters.push("po.branch_id = ?");
    params.push(Number(branchId));
  }

  if (search) {
    filters.push("(CAST(po.id AS CHAR) LIKE ? OR s.name LIKE ? OR po.notes LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const [rows] = await db.query(
    `
      SELECT
        po.id,
        po.branch_id,
        b.name AS branch_name,
        po.supplier_id,
        s.name AS supplier_name,
        po.order_date,
        po.expected_date,
        po.status,
        po.grand_total,
        po.notes,
        COUNT(poi.id) AS items_count,
        GROUP_CONCAT(DISTINCT rm.name ORDER BY rm.name SEPARATOR ', ') AS material_names
      FROM purchase_orders po
      INNER JOIN branches b ON b.id = po.branch_id
      INNER JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      LEFT JOIN raw_materials rm ON rm.id = poi.raw_material_id
      ${where}
      GROUP BY po.id
      ORDER BY po.order_date DESC, po.id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );

  return {
    code: 1,
    message: "ordenes de compra pendientes obtenidas",
    data: {
      items: rows,
      page: Number(page || 1),
      pageSize: limit,
    },
  };
};

module.exports = {
  listOrders,
  listOrderItems,
  listOrderBaseData,
  createOrder,
  upsertOrderItem,
  confirmOrder,
  cancelOrder,
  dispatchOrder,
  createProductionFromOrder,
  createPurchaseOrder,
  listPendingPurchaseOrders,
  receivePurchaseOrder,
};
