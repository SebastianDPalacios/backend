const { callProcedure, connect } = require("../data-access");
const { mapSpResult } = require("./sp-response");
const {
  EDITABLE_ORDER_STATUSES,
  calculateDeliveredCommission,
  calculateOrderLine,
  calculateOrderTotals,
  normalizeLineType,
  roundMoney,
  validateBonusAllowance,
} = require("../domain/sales-rules");

const isPastryCategoryName = (categoryName) => {
  return String(categoryName || "").toLowerCase().includes("pasteler");
};

const calculateBonusEligibleGrandTotal = (items) => {
  return items.reduce((total, item) => {
    if (item.line_type !== "sale" && item.lineType !== "sale") {
      return total;
    }
    if (isPastryCategoryName(item.category_name || item.categoryName)) {
      return total;
    }
    return total + Number(item.line_total || item.lineTotal || 0);
  }, 0);
};

const notifyOrderCreated = async (
  connection,
  { orderId, customerId, actorUserId, grandTotal }
) => {
  await connection.query(
    `INSERT INTO user_notifications (
       user_id, notification_type, title, message, reference_type, reference_id
     )
     SELECT DISTINCT
       u.id,
       'order.created',
       CONCAT('Nuevo pedido #', ?),
       CONCAT(
         COALESCE(c.name, 'Cliente'),
         ' registro un pedido por $',
         FORMAT(?, 0, 'es_CO')
       ),
       'order',
       ?
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     LEFT JOIN customers c ON c.id = ?
     WHERE r.code IN ('ADMIN', 'SUPER_ADMIN')
       AND u.status = 'active'
       AND u.deleted_at IS NULL
       AND u.id <> ?`,
    [
      Number(orderId),
      roundMoney(grandTotal),
      Number(orderId),
      Number(customerId),
      Number(actorUserId || 0),
    ]
  );
};

const listOrders = async ({
  status,
  search,
  dateFrom,
  dateTo,
  page,
  pageSize,
  actorUserId,
  canViewAll = false,
}) => {
  const db = await connect();
  const currentPage = Math.max(Number(page || 1), 1);
  const currentPageSize = Math.min(Math.max(Number(pageSize || 20), 1), 500);
  const offset = (currentPage - 1) * currentPageSize;
  const filters = [];
  const values = [];

  if (!canViewAll) {
    filters.push("o.sales_agent_user_id = ?");
    values.push(Number(actorUserId || 0));
  }

  if (status) {
    filters.push("o.status = ?");
    values.push(status);
  }

  if (search) {
    filters.push("(CAST(o.id AS CHAR) LIKE ? OR c.name LIKE ? OR seller.full_name LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (dateFrom) {
    filters.push("o.order_date >= ?");
    values.push(String(dateFrom).slice(0, 10));
  }

  if (dateTo) {
    filters.push("o.order_date <= ?");
    values.push(String(dateTo).slice(0, 10));
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
        c.phone AS customer_phone,
        c.address AS customer_address,
        c.neighborhood AS customer_neighborhood,
        o.sales_agent_user_id,
        seller.full_name AS sales_agent_name,
        o.order_date,
        o.delivery_date,
        o.actual_delivered_at,
        o.status,
        o.subtotal,
        o.tax_total,
        o.grand_total,
        o.bonus_percent,
        o.bonus_minimum_amount,
        o.seller_commission_percent,
        o.bonus_total,
        o.gift_total,
        o.exchange_total,
        o.commission_base,
        o.commission_total,
        o.print_count,
        o.last_printed_at,
        o.last_printed_by,
        last_printer.full_name AS last_printed_by_name,
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
      LEFT JOIN users seller ON seller.id = o.sales_agent_user_id
      LEFT JOIN users last_printer ON last_printer.id = o.last_printed_by
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
        p.unit AS product_unit,
        oi.line_type,
        oi.capture_mode,
        oi.requested_amount,
        oi.quantity,
        oi.unit_price,
        oi.tax_percent,
        oi.line_subtotal,
        oi.line_tax,
        oi.line_total,
        oi.commercial_value
      FROM order_items oi
      INNER JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
      ORDER BY p.name, FIELD(oi.line_type, 'sale', 'bonus', 'gift', 'exchange')
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

const listProductionReservations = async ({ orderId }) => {
  const db = await connect();
  const [rows] = await db.query(
    `
      SELECT
        psr.id,
        psr.order_item_id,
        psr.production_plan_output_id,
        psr.production_batch_output_id,
        psr.quantity,
        psr.delivered_quantity,
        psr.status,
        psr.notes,
        psr.created_at,
        psr.delivered_at,
        oi.product_id,
        p.name AS product_name,
        pp.planned_date,
        b.name AS branch_name,
        u.full_name AS baker_name,
        ppi.started_at,
        ppi.finished_at,
        ppi.production_batch_id
      FROM production_sale_reservations psr
      INNER JOIN order_items oi ON oi.id = psr.order_item_id
      INNER JOIN products p ON p.id = oi.product_id
      INNER JOIN production_plan_outputs ppo ON ppo.id = psr.production_plan_output_id
      INNER JOIN production_plan_items ppi ON ppi.id = ppo.production_plan_item_id
      INNER JOIN production_plans pp ON pp.id = ppi.production_plan_id
      INNER JOIN branches b ON b.id = pp.branch_id
      INNER JOIN employees e ON e.id = pp.baker_employee_id
      INNER JOIN users u ON u.id = e.user_id
      WHERE oi.order_id = ?
      ORDER BY psr.created_at DESC, psr.id DESC
    `,
    [Number(orderId)]
  );

  return { code: 1, message: "reservas de produccion listadas", data: { items: rows } };
};

const listProductionReservationOptions = async ({ orderId }) => {
  const db = await connect();
  const [orderRows] = await db.query(
    "SELECT id, branch_id, status FROM orders WHERE id = ? LIMIT 1",
    [Number(orderId)]
  );

  if (!orderRows.length) {
    return { code: 0, message: "pedido no encontrado", data: null };
  }

  const [rows] = await db.query(
    `
      SELECT
        oi.id AS order_item_id,
        oi.product_id,
        p.name AS product_name,
        oi.quantity AS ordered_quantity,
        ppo.id AS production_plan_output_id,
        ppi.id AS production_plan_item_id,
        ppi.production_batch_id,
        pp.planned_date,
        u.full_name AS baker_name,
        ppo.expected_quantity,
        pbo.id AS production_batch_output_id,
        pbo.produced_quantity,
        pbo.packed_quantity,
        pbo.damaged_quantity,
        pbo.missing_quantity,
        pbo.direct_delivered_quantity,
        COALESCE(source_reserved.reserved_quantity, 0) AS source_reserved_quantity,
        COALESCE(item_reserved.reserved_quantity, 0) AS item_reserved_quantity,
        GREATEST(
          CASE
            WHEN pbo.id IS NULL THEN ppo.expected_quantity
            ELSE pbo.produced_quantity
              - pbo.packed_quantity
              - pbo.damaged_quantity
              - pbo.missing_quantity
              - pbo.direct_delivered_quantity
          END - COALESCE(source_reserved.reserved_quantity, 0),
          0
        ) AS available_to_reserve,
        GREATEST(oi.quantity - COALESCE(item_reserved.reserved_quantity, 0), 0) AS order_pending_quantity,
        CASE WHEN pbo.id IS NULL THEN 'in_progress' ELSE 'finished' END AS production_stage
      FROM order_items oi
      INNER JOIN products p ON p.id = oi.product_id
      INNER JOIN production_plans pp
        ON pp.branch_id = ?
       AND pp.status IN ('viewed','completed')
      INNER JOIN production_plan_items ppi
        ON ppi.production_plan_id = pp.id
       AND ppi.started_at IS NOT NULL
      INNER JOIN production_plan_outputs ppo
        ON ppo.production_plan_item_id = ppi.id
       AND ppo.product_id = oi.product_id
      LEFT JOIN production_batch_outputs pbo
        ON pbo.production_batch_id = ppi.production_batch_id
       AND pbo.product_id = ppo.product_id
      LEFT JOIN (
        SELECT
          production_plan_output_id,
          SUM(quantity - delivered_quantity) AS reserved_quantity
        FROM production_sale_reservations
        WHERE status IN ('reserved','partially_delivered')
        GROUP BY production_plan_output_id
      ) source_reserved ON source_reserved.production_plan_output_id = ppo.id
      LEFT JOIN (
        SELECT
          order_item_id,
          SUM(
            CASE
              WHEN status IN ('reserved','partially_delivered') THEN quantity
              WHEN status = 'delivered' THEN delivered_quantity
              ELSE 0
            END
          ) AS reserved_quantity
        FROM production_sale_reservations
        GROUP BY order_item_id
      ) item_reserved ON item_reserved.order_item_id = oi.id
      WHERE oi.order_id = ?
        AND oi.line_type = 'sale'
      HAVING available_to_reserve > 0
        AND order_pending_quantity > 0
      ORDER BY pp.planned_date, p.name, ppo.id
    `,
    [Number(orderRows[0].branch_id), Number(orderId)]
  );

  return {
    code: 1,
    message: "produccion disponible para reservar",
    data: { items: rows },
  };
};

const createProductionReservation = async (payload, actorUserId) => {
  return {
    code: 0,
    message: "los pedidos comerciales se despachan desde inventario y no reservan produccion",
    data: null,
  };

  /* Legacy flow retained below for historical reference. */
  const orderId = Number(payload.p_order_id || 0);
  const orderItemId = Number(payload.p_order_item_id || 0);
  const productionPlanOutputId = Number(payload.p_production_plan_output_id || 0);
  const quantity = Number(payload.p_quantity || 0);

  if (!orderId || !orderItemId || !productionPlanOutputId || !Number.isFinite(quantity) || quantity <= 0) {
    return { code: 0, message: "selecciona producto, produccion y una cantidad mayor que cero", data: null };
  }

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `
        SELECT
          o.branch_id,
          o.status AS order_status,
          oi.product_id,
          oi.quantity AS ordered_quantity,
          ppo.expected_quantity,
          ppi.production_batch_id,
          pbo.id AS production_batch_output_id,
          pbo.produced_quantity,
          pbo.packed_quantity,
          pbo.damaged_quantity,
          pbo.missing_quantity,
          pbo.direct_delivered_quantity
        FROM orders o
        INNER JOIN order_items oi
          ON oi.order_id = o.id
         AND oi.id = ?
         AND oi.line_type = 'sale'
        INNER JOIN production_plan_outputs ppo
          ON ppo.id = ?
         AND ppo.product_id = oi.product_id
        INNER JOIN production_plan_items ppi
          ON ppi.id = ppo.production_plan_item_id
         AND ppi.started_at IS NOT NULL
        INNER JOIN production_plans pp
          ON pp.id = ppi.production_plan_id
         AND pp.branch_id = o.branch_id
         AND pp.status IN ('viewed','completed')
        LEFT JOIN production_batch_outputs pbo
          ON pbo.production_batch_id = ppi.production_batch_id
         AND pbo.product_id = ppo.product_id
        WHERE o.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [orderItemId, productionPlanOutputId, orderId]
    );

    if (!rows.length) {
      await connection.rollback();
      return { code: 0, message: "la produccion seleccionada no esta disponible para este pedido", data: null };
    }

    const source = rows[0];
    if (!["confirmed", "in_production", "ready"].includes(source.order_status)) {
      await connection.rollback();
      return { code: 0, message: "confirma el pedido antes de reservar produccion", data: null };
    }

    await connection.query(
      `
        SELECT id
        FROM production_sale_reservations
        WHERE production_plan_output_id = ?
           OR order_item_id = ?
        FOR UPDATE
      `,
      [productionPlanOutputId, orderItemId]
    );

    const [reservedRows] = await connection.query(
      `
        SELECT
          COALESCE(SUM(CASE
            WHEN production_plan_output_id = ?
             AND status IN ('reserved','partially_delivered')
            THEN quantity - delivered_quantity ELSE 0 END), 0) AS source_reserved,
          COALESCE(SUM(CASE
            WHEN order_item_id = ?
             AND status IN ('reserved','partially_delivered','delivered')
            THEN CASE WHEN status = 'delivered' THEN delivered_quantity ELSE quantity END
            ELSE 0 END), 0) AS item_reserved
        FROM production_sale_reservations
        WHERE production_plan_output_id = ?
           OR order_item_id = ?
      `,
      [productionPlanOutputId, orderItemId, productionPlanOutputId, orderItemId]
    );

    const sourceCapacity = source.production_batch_output_id
      ? Number(source.produced_quantity || 0)
        - Number(source.packed_quantity || 0)
        - Number(source.damaged_quantity || 0)
        - Number(source.missing_quantity || 0)
        - Number(source.direct_delivered_quantity || 0)
      : Number(source.expected_quantity || 0);
    const availableSource = Math.max(sourceCapacity - Number(reservedRows[0]?.source_reserved || 0), 0);
    const availableOrder = Math.max(Number(source.ordered_quantity || 0) - Number(reservedRows[0]?.item_reserved || 0), 0);

    if (quantity > availableSource || quantity > availableOrder) {
      await connection.rollback();
      return {
        code: 0,
        message: `solo puedes reservar hasta ${Math.min(availableSource, availableOrder)} unidades`,
        data: null,
      };
    }

    const [result] = await connection.query(
      `
        INSERT INTO production_sale_reservations (
          order_item_id, production_plan_output_id, production_batch_output_id,
          quantity, notes, created_by
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        orderItemId,
        productionPlanOutputId,
        source.production_batch_output_id || null,
        quantity,
        payload.p_notes || null,
        actorUserId || null,
      ]
    );

    await connection.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
        VALUES (?, 'production_sale.reserve', 'production_sale_reservations', ?,
          JSON_OBJECT('order_id', ?, 'order_item_id', ?, 'quantity', ?))
      `,
      [actorUserId || null, String(result.insertId), orderId, orderItemId, quantity]
    );
    await connection.commit();
    return {
      code: 1,
      message: "unidades reservadas desde produccion",
      data: { reservation_id: Number(result.insertId) },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const deliverProductionReservation = async ({ reservationId }, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `
        SELECT
          psr.id,
          psr.quantity,
          psr.delivered_quantity,
          psr.status,
          psr.production_batch_output_id,
          ppi.production_batch_id,
          ppo.product_id,
          oi.order_id,
          o.branch_id
        FROM production_sale_reservations psr
        INNER JOIN order_items oi ON oi.id = psr.order_item_id
        INNER JOIN orders o ON o.id = oi.order_id
        INNER JOIN production_plan_outputs ppo ON ppo.id = psr.production_plan_output_id
        INNER JOIN production_plan_items ppi ON ppi.id = ppo.production_plan_item_id
        WHERE psr.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [Number(reservationId)]
    );

    if (!rows.length) {
      await connection.rollback();
      return { code: 0, message: "reserva no encontrada", data: null };
    }
    const reservation = rows[0];
    if (!["reserved", "partially_delivered"].includes(reservation.status)) {
      await connection.rollback();
      return { code: 0, message: "la reserva ya no permite entrega", data: null };
    }
    if (!reservation.production_batch_id) {
      await connection.rollback();
      return { code: 0, message: "la produccion aun no ha sido finalizada por el panadero", data: null };
    }

    const [outputRows] = await connection.query(
      `
        SELECT id, production_batch_id, produced_quantity, packed_quantity,
               damaged_quantity, missing_quantity, direct_delivered_quantity
        FROM production_batch_outputs
        WHERE production_batch_id = ?
          AND product_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [Number(reservation.production_batch_id), Number(reservation.product_id)]
    );
    if (!outputRows.length) {
      await connection.rollback();
      return { code: 0, message: "el producto no fue generado en el lote final", data: null };
    }

    const output = outputRows[0];
    const quantity = Number(reservation.quantity) - Number(reservation.delivered_quantity);
    const available = Number(output.produced_quantity)
      - Number(output.packed_quantity)
      - Number(output.damaged_quantity)
      - Number(output.missing_quantity)
      - Number(output.direct_delivered_quantity);
    if (quantity <= 0 || quantity > available) {
      await connection.rollback();
      return {
        code: 0,
        message: `el lote solo tiene ${Math.max(available, 0)} unidades disponibles para entrega directa`,
        data: null,
      };
    }

    await connection.query(
      `UPDATE production_batch_outputs
          SET direct_delivered_quantity = direct_delivered_quantity + ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [quantity, Number(output.id)]
    );
    await connection.query(
      `UPDATE production_sale_reservations
          SET production_batch_output_id = ?,
              delivered_quantity = quantity,
              status = 'delivered',
              delivered_by = ?,
              delivered_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [Number(output.id), actorUserId || null, Number(reservationId)]
    );

    const [pendingRows] = await connection.query(
      `SELECT COUNT(*) AS pending
         FROM production_batch_outputs
        WHERE production_batch_id = ?
          AND produced_quantity - packed_quantity - damaged_quantity
              - missing_quantity - direct_delivered_quantity > 0`,
      [Number(output.production_batch_id)]
    );
    await connection.query(
      `UPDATE production_batches
          SET status = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [Number(pendingRows[0]?.pending || 0) === 0 ? "packed" : "partially_packed", Number(output.production_batch_id)]
    );
    await connection.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
        VALUES (?, 'production_sale.deliver', 'production_sale_reservations', ?,
          JSON_OBJECT('order_id', ?, 'production_batch_output_id', ?, 'quantity', ?))
      `,
      [actorUserId || null, String(reservationId), reservation.order_id, output.id, quantity]
    );
    await connection.commit();
    return {
      code: 1,
      message: "entrega directa confirmada; no ingreso al inventario",
      data: { reservation_id: Number(reservationId), delivered_quantity: quantity },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const releaseProductionReservation = async ({ reservationId }, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT id, delivered_quantity, status FROM production_sale_reservations WHERE id = ? FOR UPDATE",
      [Number(reservationId)]
    );
    if (!rows.length) {
      await connection.rollback();
      return { code: 0, message: "reserva no encontrada", data: null };
    }
    if (!["reserved", "partially_delivered"].includes(rows[0].status) || Number(rows[0].delivered_quantity) > 0) {
      await connection.rollback();
      return { code: 0, message: "solo puedes liberar una reserva que aun no fue entregada", data: null };
    }
    await connection.query(
      "UPDATE production_sale_reservations SET status = 'released' WHERE id = ?",
      [Number(reservationId)]
    );
    await connection.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
        VALUES (?, 'production_sale.release', 'production_sale_reservations', ?, JSON_OBJECT())
      `,
      [actorUserId || null, String(reservationId)]
    );
    await connection.commit();
    return { code: 1, message: "reserva liberada", data: { reservation_id: Number(reservationId) } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const listOrderBaseData = async ({
  onlyActive,
  search,
  page,
  pageSize,
  refDate,
  actorUserId,
  canViewAllCustomers = false,
}) => {
  const productsOut = await callProcedure("sp_product_list", [
      Number(onlyActive || 0),
      null,
      search || null,
      Number(page || 1),
      Number(pageSize || 20),
    ]);

  const products = mapSpResult(productsOut);
  const db = await connect();
  const customerFilters = [
    "c.deleted_at IS NULL",
    "c.status = 'active'",
  ];
  const customerValues = [];

  if (!canViewAllCustomers) {
    customerFilters.push(
      `EXISTS (
        SELECT 1
        FROM seller_customer_assignments sca
        WHERE sca.customer_id = c.id
          AND sca.sales_agent_user_id = ?
          AND sca.is_active = 1
      )`
    );
    customerValues.push(Number(actorUserId || 0));
  }
  if (search) {
    customerFilters.push("(c.name LIKE ? OR c.tax_id LIKE ? OR c.phone LIKE ?)");
    const like = `%${search}%`;
    customerValues.push(like, like, like);
  }

  const [customerRows] = await db.query(
    `SELECT c.id, c.tax_id, c.name, c.email, c.phone, c.address, c.neighborhood, c.credit_limit
     FROM customers c
     WHERE ${customerFilters.join(" AND ")}
     ORDER BY c.name, c.id
     LIMIT 200`,
    customerValues
  );
  const [settingsRows] = await db.query(
    `SELECT
       bonus_percent,
       bonus_minimum_amount,
       external_seller_commission_percent
     FROM sales_settings
     WHERE id = 1`
  );
  const [branchRows] = await db.query(
    `SELECT id, code, name, address, phone
     FROM branches
     WHERE is_active = 1
     ORDER BY name, id`
  );

  if (products.code !== 1) {
    return products;
  }

  const [productTaxRows] = await db.query(
    `SELECT
       p.id,
       p.category_id,
       pc.name AS category_name,
       t.rate_percent AS tax_percent
     FROM products p
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     INNER JOIN tax_rates t ON t.id = p.tax_rate_id
     WHERE p.deleted_at IS NULL`
  );
  const productMetaById = new Map(
    productTaxRows.map((row) => [Number(row.id), row])
  );
  if (Array.isArray(products.data?.items)) {
    products.data.items = products.data.items.map((product) => {
      const meta = productMetaById.get(Number(product.id)) || {};
      return {
        ...product,
        category_id: meta.category_id || product.category_id || null,
        category_name: meta.category_name || product.category_name || null,
        tax_percent: Number(meta.tax_percent || 0),
      };
    });
  }

  return {
    code: 1,
    message: "catalogos de orden obtenidos",
    data: {
      customers: {
        items: customerRows,
        total: customerRows.length,
        assigned_only: !canViewAllCustomers,
      },
      branches: {
        items: branchRows,
        total: branchRows.length,
      },
      products: products.data,
      sales_settings: settingsRows[0] || null,
    },
  };
};

const listSellerCustomerAssignments = async () => {
  const db = await connect();
  const [sellers] = await db.query(
    `SELECT DISTINCT
       u.id,
       u.full_name,
       u.username,
       u.email,
       u.phone
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE r.code = 'VENTAS'
       AND u.status = 'active'
       AND u.deleted_at IS NULL
     ORDER BY u.full_name, u.id`
  );
  const [customers] = await db.query(
    `SELECT
       c.id,
       c.tax_id,
       c.name,
       c.email,
       c.phone,
       c.address,
       sca.id AS assignment_id,
       sca.sales_agent_user_id,
       seller.full_name AS sales_agent_name,
       sca.assigned_at,
       assigner.full_name AS assigned_by_name
     FROM customers c
     LEFT JOIN seller_customer_assignments sca
       ON sca.customer_id = c.id
      AND sca.is_active = 1
     LEFT JOIN users seller ON seller.id = sca.sales_agent_user_id
     LEFT JOIN users assigner ON assigner.id = sca.assigned_by
     WHERE c.status = 'active'
       AND c.deleted_at IS NULL
     ORDER BY c.name, c.id`
  );

  return {
    code: 1,
    message: "asignaciones de clientes listadas",
    data: { sellers, customers },
  };
};

const assignCustomerToSeller = async ({ customerId, salesAgentUserId }, actorUserId) => {
  const normalizedCustomerId = Number(customerId || 0);
  const normalizedSellerId = Number(salesAgentUserId || 0);
  if (!normalizedCustomerId || !normalizedSellerId) {
    return { code: 0, message: "selecciona cliente y vendedor", data: null };
  }

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.query(
      `SELECT id
       FROM customers
       WHERE id = ?
         AND status = 'active'
         AND deleted_at IS NULL
       FOR UPDATE`,
      [normalizedCustomerId]
    );
    if (!customers.length) {
      await connection.rollback();
      return { code: 0, message: "cliente no encontrado o inactivo", data: null };
    }

    const [sellers] = await connection.query(
      `SELECT DISTINCT u.id
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ?
         AND u.status = 'active'
         AND u.deleted_at IS NULL
         AND r.code = 'VENTAS'
       LIMIT 1`,
      [normalizedSellerId]
    );
    if (!sellers.length) {
      await connection.rollback();
      return { code: 0, message: "vendedor externo no encontrado o inactivo", data: null };
    }

    const [currentRows] = await connection.query(
      `SELECT id, sales_agent_user_id
       FROM seller_customer_assignments
       WHERE customer_id = ?
         AND is_active = 1
       FOR UPDATE`,
      [normalizedCustomerId]
    );
    const previousSellerId = currentRows.length
      ? Number(currentRows[0].sales_agent_user_id)
      : null;

    await connection.query(
      `UPDATE seller_customer_assignments
       SET is_active = 0,
           active_customer_id = NULL,
           unassigned_by = ?,
           unassigned_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = ?
         AND is_active = 1
         AND sales_agent_user_id <> ?`,
      [actorUserId || null, normalizedCustomerId, normalizedSellerId]
    );

    await connection.query(
      `INSERT INTO seller_customer_assignments (
         sales_agent_user_id, customer_id, active_customer_id, is_active, assigned_by,
         assigned_at, unassigned_by, unassigned_at
       )
       VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         is_active = 1,
         active_customer_id = VALUES(active_customer_id),
         assigned_by = VALUES(assigned_by),
         assigned_at = CURRENT_TIMESTAMP,
         unassigned_by = NULL,
         unassigned_at = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [
        normalizedSellerId,
        normalizedCustomerId,
        normalizedCustomerId,
        actorUserId || null,
      ]
    );

    await connection.query(
      `INSERT INTO audit_logs (
         actor_user_id, action, entity_name, entity_id, metadata_json
       )
       VALUES (?, 'seller_customer.assign', 'seller_customer_assignments', ?, JSON_OBJECT(
         'customer_id', ?,
         'previous_sales_agent_user_id', ?,
         'sales_agent_user_id', ?
       ))`,
      [
        actorUserId || null,
        String(normalizedCustomerId),
        normalizedCustomerId,
        previousSellerId,
        normalizedSellerId,
      ]
    );

    await connection.commit();
    return {
      code: 1,
      message: previousSellerId && previousSellerId !== normalizedSellerId
        ? "cliente reasignado"
        : "cliente asignado",
      data: {
        customer_id: normalizedCustomerId,
        sales_agent_user_id: normalizedSellerId,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const syncSellerCustomers = async ({ salesAgentUserId, customerIds }, actorUserId) => {
  const normalizedSellerId = Number(salesAgentUserId || 0);
  const normalizedCustomerIds = Array.from(
    new Set(
      (Array.isArray(customerIds) ? customerIds : [])
        .map((customerId) => Number(customerId || 0))
        .filter((customerId) => Number.isInteger(customerId) && customerId > 0)
    )
  ).sort((a, b) => a - b);

  if (!normalizedSellerId) {
    return { code: 0, message: "selecciona un vendedor", data: null };
  }

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [sellers] = await connection.query(
      `SELECT DISTINCT u.id
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ?
         AND u.status = 'active'
         AND u.deleted_at IS NULL
         AND r.code = 'VENTAS'
       LIMIT 1`,
      [normalizedSellerId]
    );
    if (!sellers.length) {
      await connection.rollback();
      return { code: 0, message: "vendedor externo no encontrado o inactivo", data: null };
    }

    if (normalizedCustomerIds.length) {
      const placeholders = normalizedCustomerIds.map(() => "?").join(",");
      const [customers] = await connection.query(
        `SELECT id
         FROM customers
         WHERE id IN (${placeholders})
           AND status = 'active'
           AND deleted_at IS NULL
         ORDER BY id
         FOR UPDATE`,
        normalizedCustomerIds
      );
      if (customers.length !== normalizedCustomerIds.length) {
        await connection.rollback();
        return { code: 0, message: "uno o mas clientes no existen o estan inactivos", data: null };
      }

      await connection.query(
        `UPDATE seller_customer_assignments
         SET is_active = 0,
             active_customer_id = NULL,
             unassigned_by = ?,
             unassigned_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE customer_id IN (${placeholders})
           AND is_active = 1
           AND sales_agent_user_id <> ?`,
        [actorUserId || null, ...normalizedCustomerIds, normalizedSellerId]
      );
    }

    const currentParams = [actorUserId || null, normalizedSellerId];
    let omittedCondition = "";
    if (normalizedCustomerIds.length) {
      const placeholders = normalizedCustomerIds.map(() => "?").join(",");
      omittedCondition = `AND customer_id NOT IN (${placeholders})`;
      currentParams.push(...normalizedCustomerIds);
    }
    await connection.query(
      `UPDATE seller_customer_assignments
       SET is_active = 0,
           active_customer_id = NULL,
           unassigned_by = ?,
           unassigned_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE sales_agent_user_id = ?
         AND is_active = 1
         ${omittedCondition}`,
      currentParams
    );

    for (const customerId of normalizedCustomerIds) {
      await connection.query(
        `INSERT INTO seller_customer_assignments (
           sales_agent_user_id, customer_id, active_customer_id, is_active,
           assigned_by, assigned_at, unassigned_by, unassigned_at
         )
         VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP, NULL, NULL)
         ON DUPLICATE KEY UPDATE
           active_customer_id = VALUES(active_customer_id),
           is_active = 1,
           assigned_by = VALUES(assigned_by),
           assigned_at = CURRENT_TIMESTAMP,
           unassigned_by = NULL,
           unassigned_at = NULL,
           updated_at = CURRENT_TIMESTAMP`,
        [normalizedSellerId, customerId, customerId, actorUserId || null]
      );
    }

    await connection.query(
      `INSERT INTO audit_logs (
         actor_user_id, action, entity_name, entity_id, metadata_json
       )
       VALUES (?, 'seller_customer.sync', 'seller_customer_assignments', ?, JSON_OBJECT(
         'sales_agent_user_id', ?,
         'customers_count', ?,
         'customer_ids', CAST(? AS JSON)
       ))`,
      [
        actorUserId || null,
        String(normalizedSellerId),
        normalizedSellerId,
        normalizedCustomerIds.length,
        JSON.stringify(normalizedCustomerIds),
      ]
    );

    await connection.commit();
    return {
      code: 1,
      message: "cartera del vendedor actualizada",
      data: {
        sales_agent_user_id: normalizedSellerId,
        customer_ids: normalizedCustomerIds,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const unassignCustomerFromSeller = async ({ customerId }, actorUserId) => {
  const normalizedCustomerId = Number(customerId || 0);
  if (!normalizedCustomerId) {
    return { code: 0, message: "selecciona un cliente", data: null };
  }

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.query(
      `SELECT id
       FROM customers
       WHERE id = ?
       FOR UPDATE`,
      [normalizedCustomerId]
    );
    if (!customers.length) {
      await connection.rollback();
      return { code: 0, message: "cliente no encontrado", data: null };
    }

    const [currentRows] = await connection.query(
      `SELECT sales_agent_user_id
       FROM seller_customer_assignments
       WHERE customer_id = ?
         AND is_active = 1
       FOR UPDATE`,
      [normalizedCustomerId]
    );
    if (!currentRows.length) {
      await connection.rollback();
      return { code: 0, message: "el cliente no tiene vendedor asignado", data: null };
    }

    await connection.query(
      `UPDATE seller_customer_assignments
       SET is_active = 0,
           active_customer_id = NULL,
           unassigned_by = ?,
           unassigned_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = ?
         AND is_active = 1`,
      [actorUserId || null, normalizedCustomerId]
    );
    await connection.query(
      `INSERT INTO audit_logs (
         actor_user_id, action, entity_name, entity_id, metadata_json
       )
       VALUES (?, 'seller_customer.unassign', 'seller_customer_assignments', ?, JSON_OBJECT(
         'customer_id', ?,
         'sales_agent_user_id', ?
       ))`,
      [
        actorUserId || null,
        String(normalizedCustomerId),
        normalizedCustomerId,
        Number(currentRows[0].sales_agent_user_id),
      ]
    );
    await connection.commit();
    return {
      code: 1,
      message: "cliente retirado del vendedor",
      data: { customer_id: normalizedCustomerId },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getSalesSettings = async () => {
  const db = await connect();
  const [rows] = await db.query(
    `SELECT
       bonus_percent,
       bonus_minimum_amount,
       external_seller_commission_percent,
       updated_at
     FROM sales_settings
     WHERE id = 1`
  );

  return {
    code: 1,
    message: "reglas de venta obtenidas",
    data: rows[0] || null,
  };
};

const updateSalesSettings = async (payload, actorUserId) => {
  const bonusPercent = Number(payload.bonus_percent);
  const bonusMinimumAmount = Number(payload.bonus_minimum_amount);
  const commissionPercent = Number(payload.external_seller_commission_percent);

  if (!Number.isFinite(bonusPercent) || bonusPercent < 0 || bonusPercent > 100) {
    return { code: 0, message: "el porcentaje de vendaje debe estar entre 0 y 100", data: null };
  }
  if (!Number.isFinite(bonusMinimumAmount) || bonusMinimumAmount < 0) {
    return { code: 0, message: "la compra minima para vendaje no puede ser negativa", data: null };
  }
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    return { code: 0, message: "la comision debe estar entre 0 y 100", data: null };
  }

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE sales_settings
       SET bonus_percent = ?,
           bonus_minimum_amount = ?,
           external_seller_commission_percent = ?,
           updated_by = ?
       WHERE id = 1`,
      [
        roundMoney(bonusPercent),
        roundMoney(bonusMinimumAmount),
        roundMoney(commissionPercent),
        actorUserId || null,
      ]
    );
    await connection.query(
      `INSERT INTO audit_logs (
         actor_user_id, action, entity_name, entity_id, metadata_json
       )
       VALUES (
         ?, 'sales.settings.update', 'sales_settings', '1',
         JSON_OBJECT(
           'bonus_percent', ?,
           'bonus_minimum_amount', ?,
           'external_seller_commission_percent', ?
         )
       )`,
      [
        actorUserId || null,
        roundMoney(bonusPercent),
        roundMoney(bonusMinimumAmount),
        roundMoney(commissionPercent),
      ]
    );
    await connection.commit();
    return getSalesSettings();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const createOrder = async (payload, actorUserId, { canViewAllCustomers = false } = {}) => {
  const items = Array.isArray(payload.p_items_json) ? payload.p_items_json : null;
  if (items) {
    const branchId = Number(payload.p_branch_id || 0);
    const customerId = Number(payload.p_customer_id || 0);
    const orderDate = payload.p_order_date || null;
    const deliveryDate = payload.p_delivery_date || null;
    const db = await connect();
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();
      if (!branchId || !customerId || !orderDate) {
        await connection.rollback();
        return { code: 0, message: "sucursal, cliente y fecha son obligatorios", data: null };
      }
      if (deliveryDate && String(deliveryDate).slice(0, 10) < String(orderDate).slice(0, 10)) {
        await connection.rollback();
        return { code: 0, message: "la fecha de entrega no puede ser anterior al pedido", data: null };
      }
      if (String(payload.p_notes || "").length > 255) {
        await connection.rollback();
        return { code: 0, message: "las notas permiten maximo 255 caracteres", data: null };
      }
      if (!items.length) {
        await connection.rollback();
        return { code: 0, message: "agrega al menos un producto", data: null };
      }

      const [branches] = await connection.query(
        "SELECT id FROM branches WHERE id = ? AND is_active = 1 LIMIT 1",
        [branchId]
      );
      if (!branches.length) {
        await connection.rollback();
        return { code: 0, message: "sucursal no encontrada o inactiva", data: null };
      }

      const [customers] = await connection.query(
        `SELECT c.id
         FROM customers c
         WHERE c.id = ?
           AND c.status = 'active'
           AND c.deleted_at IS NULL
           AND (
             ? = 1
             OR EXISTS (
               SELECT 1
               FROM seller_customer_assignments sca
               WHERE sca.customer_id = c.id
                 AND sca.sales_agent_user_id = ?
                 AND sca.is_active = 1
             )
           )
         LIMIT 1`,
        [customerId, canViewAllCustomers ? 1 : 0, Number(actorUserId || 0)]
      );
      if (!customers.length) {
        await connection.rollback();
        return { code: 0, message: "cliente no asignado al vendedor o inactivo", data: null };
      }

      const [settingsRows] = await connection.query(
        `SELECT bonus_percent, bonus_minimum_amount, external_seller_commission_percent
         FROM sales_settings
         WHERE id = 1
         FOR UPDATE`
      );
      const settings = settingsRows[0];
      const normalizedItems = [];

      for (const item of items) {
        const productId = Number(item.product_id || item.p_product_id || 0);
        const lineType = normalizeLineType(item.line_type || item.p_line_type || "sale");
        const [products] = await connection.query(
          `SELECT
             p.id,
             p.unit,
             p.base_price,
             pc.name AS category_name,
             t.rate_percent
           FROM products p
           LEFT JOIN product_categories pc ON pc.id = p.category_id
           INNER JOIN tax_rates t ON t.id = p.tax_rate_id
           WHERE p.id = ?
             AND p.is_active = 1
             AND p.deleted_at IS NULL
             AND t.is_active = 1
           LIMIT 1`,
          [productId]
        );
        if (!products.length || !lineType) {
          await connection.rollback();
          return { code: 0, message: "uno de los productos no es valido", data: null };
        }
        if (lineType === "bonus" && isPastryCategoryName(products[0].category_name)) {
          await connection.rollback();
          return {
            code: 0,
            message: "los productos de pasteleria ya incluyen vendaje y no permiten vendaje adicional",
            data: null,
          };
        }

        try {
          normalizedItems.push({
            productId,
            categoryName: products[0].category_name || null,
            ...calculateOrderLine({
              unit: products[0].unit,
              unitPrice: products[0].base_price,
              taxPercent: products[0].rate_percent,
              lineType,
              captureMode: item.capture_mode || item.p_capture_mode || "quantity",
              requestedAmount: item.requested_amount ?? item.p_requested_amount,
              quantity: item.quantity ?? item.p_quantity,
            }),
          });
        } catch (error) {
          await connection.rollback();
          return { code: 0, message: error.message, data: null };
        }
      }

      const duplicateKeys = new Set();
      for (const item of normalizedItems) {
        const key = `${item.productId}:${item.lineType}`;
        if (duplicateKeys.has(key)) {
          await connection.rollback();
          return { code: 0, message: "no repitas el mismo producto con el mismo tipo", data: null };
        }
        duplicateKeys.add(key);
      }

      const totals = calculateOrderTotals(
        normalizedItems.map((item) => ({
          line_type: item.lineType,
          line_subtotal: item.lineSubtotal,
          line_tax: item.lineTax,
          line_total: item.lineTotal,
          commercial_value: item.commercialValue,
          category_name: item.categoryName,
        }))
      );
      if (!normalizedItems.some((item) => item.lineType === "sale")) {
        await connection.rollback();
        return { code: 0, message: "agrega al menos un producto de venta", data: null };
      }
      try {
        validateBonusAllowance({
          grandTotal: calculateBonusEligibleGrandTotal(normalizedItems),
          bonusTotal: totals.bonusTotal,
          bonusPercent: settings.bonus_percent,
          bonusMinimumAmount: settings.bonus_minimum_amount,
        });
      } catch (error) {
        await connection.rollback();
        return { code: 0, message: error.message, data: null };
      }

      const [orderResult] = await connection.query(
        `INSERT INTO orders (
           branch_id, customer_id, sales_agent_user_id, route_id,
           order_date, delivery_date, status, subtotal, tax_total, grand_total,
           bonus_percent, bonus_minimum_amount, seller_commission_percent,
           bonus_total, gift_total, exchange_total, notes, created_by
         )
         VALUES (?, ?, ?, NULL, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          customerId,
          actorUserId || null,
          orderDate,
          deliveryDate,
          roundMoney(totals.subtotal),
          roundMoney(totals.taxTotal),
          roundMoney(totals.grandTotal),
          roundMoney(settings.bonus_percent),
          roundMoney(settings.bonus_minimum_amount),
          roundMoney(settings.external_seller_commission_percent),
          roundMoney(totals.bonusTotal),
          roundMoney(totals.giftTotal),
          roundMoney(totals.exchangeTotal),
          payload.p_notes || null,
          actorUserId || null,
        ]
      );
      const orderId = Number(orderResult.insertId);

      for (const item of normalizedItems) {
        await connection.query(
          `INSERT INTO order_items (
             order_id, product_id, line_type, capture_mode, requested_amount,
             quantity, unit_price, tax_percent, line_subtotal, line_tax,
             line_total, commercial_value
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            item.productId,
            item.lineType,
            item.captureMode,
            item.requestedAmount,
            item.quantity,
            item.unitPrice,
            item.taxPercent,
            item.lineSubtotal,
            item.lineTax,
            item.lineTotal,
            item.commercialValue,
          ]
        );
      }

      await connection.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
         VALUES (?, 'order.create_atomic', 'orders', ?, JSON_OBJECT(
           'customer_id', ?, 'items_count', ?, 'grand_total', ?, 'bonus_total', ?
         ))`,
        [
          actorUserId || null,
          String(orderId),
          customerId,
          normalizedItems.length,
          roundMoney(totals.grandTotal),
          roundMoney(totals.bonusTotal),
        ]
      );
      await notifyOrderCreated(connection, {
        orderId,
        customerId,
        actorUserId,
        grandTotal: totals.grandTotal,
      });
      await connection.commit();
      return {
        code: 1,
        message: "pedido guardado",
        data: {
          order_id: orderId,
          grand_total: roundMoney(totals.grandTotal),
          bonus_total: roundMoney(totals.bonusTotal),
        },
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return {
    code: 0,
    message: "agrega al menos un producto para crear el pedido de forma atomica",
    data: null,
  };
};

const getOrderPrintData = async ({
  orderId,
  actorUserId,
  canViewAll = false,
}) => {
  const db = await connect();
  const [orders] = await db.query(
    `SELECT
       o.id,
       o.branch_id,
       b.name AS branch_name,
       b.address AS branch_address,
       b.phone AS branch_phone,
       o.customer_id,
       c.name AS customer_name,
       c.tax_id AS customer_identification,
       c.phone AS customer_phone,
       c.address AS customer_address,
       c.neighborhood AS customer_neighborhood,
       o.sales_agent_user_id,
       seller.full_name AS sales_agent_name,
       o.order_date,
       o.delivery_date,
       o.status,
       o.subtotal,
       o.tax_total,
       o.grand_total,
       o.bonus_total,
       o.gift_total,
       o.exchange_total,
       o.notes,
       o.print_count,
       o.last_printed_at,
       last_printer.full_name AS last_printed_by_name,
       o.created_at
     FROM orders o
     INNER JOIN branches b ON b.id = o.branch_id
     INNER JOIN customers c ON c.id = o.customer_id
     LEFT JOIN users seller ON seller.id = o.sales_agent_user_id
     LEFT JOIN users last_printer ON last_printer.id = o.last_printed_by
     WHERE o.id = ?
       AND (? = 1 OR o.sales_agent_user_id = ?)
     LIMIT 1`,
    [Number(orderId), canViewAll ? 1 : 0, Number(actorUserId || 0)]
  );

  if (!orders.length) {
    return { code: 0, message: "pedido no encontrado o sin acceso", data: null };
  }

  const [items] = await db.query(
    `SELECT
       oi.id,
       oi.product_id,
       p.sku AS product_sku,
       p.name AS product_name,
       pc.name AS category_name,
       oi.line_type,
       oi.capture_mode,
       oi.requested_amount,
       oi.quantity,
       oi.unit_price,
       oi.line_total,
       oi.commercial_value
     FROM order_items oi
     INNER JOIN products p ON p.id = oi.product_id
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     WHERE oi.order_id = ?
     ORDER BY pc.name, FIELD(oi.line_type, 'sale', 'bonus', 'gift', 'exchange'), p.name`,
    [Number(orderId)]
  );

  const [printLogs] = await db.query(
    `SELECT
       opl.id,
       opl.print_number,
       opl.confirmed_at,
       opl.printed_by,
       u.full_name AS printed_by_name
     FROM order_print_logs opl
     LEFT JOIN users u ON u.id = opl.printed_by
     WHERE opl.order_id = ?
     ORDER BY opl.print_number DESC
     LIMIT 20`,
    [Number(orderId)]
  );

  return {
    code: 1,
    message: "datos de impresion obtenidos",
    data: { order: orders[0], items, print_logs: printLogs },
  };
};

const confirmOrderPrint = async (
  { orderId, actorUserId, canViewAll = false }
) => {
  const db = await connect();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const [orders] = await connection.query(
      `SELECT id, status, sales_agent_user_id, print_count
       FROM orders
       WHERE id = ?
         AND (? = 1 OR sales_agent_user_id = ?)
       FOR UPDATE`,
      [Number(orderId), canViewAll ? 1 : 0, Number(actorUserId || 0)]
    );

    if (!orders.length) {
      await connection.rollback();
      return { code: 0, message: "pedido no encontrado o sin acceso", data: null };
    }

    if (orders[0].status === "cancelled") {
      await connection.rollback();
      return { code: 0, message: "un pedido cancelado no se puede confirmar como impreso", data: null };
    }

    const printNumber = Number(orders[0].print_count || 0) + 1;
    const [printResult] = await connection.query(
      `INSERT INTO order_print_logs (order_id, print_number, printed_by)
       VALUES (?, ?, ?)`,
      [Number(orderId), printNumber, Number(actorUserId || 0) || null]
    );

    await connection.query(
      `UPDATE orders
       SET print_count = ?,
           last_printed_at = CURRENT_TIMESTAMP,
           last_printed_by = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [printNumber, Number(actorUserId || 0) || null, Number(orderId)]
    );

    await connection.query(
      `INSERT INTO audit_logs (
         actor_user_id, action, entity_name, entity_id, metadata_json
       )
       VALUES (
         ?, 'order.print.confirm', 'order_print_logs', ?,
         JSON_OBJECT('order_id', ?, 'print_number', ?)
       )`,
      [
        Number(actorUserId || 0) || null,
        String(printResult.insertId),
        Number(orderId),
        printNumber,
      ]
    );

    await connection.commit();
    return {
      code: 1,
      message: `impresion #${printNumber} confirmada`,
      data: {
        order_id: Number(orderId),
        order_print_log_id: Number(printResult.insertId),
        print_number: printNumber,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const upsertOrderItem = async (payload, actorUserId) => {
  const orderId = Number(payload.p_order_id || 0);
  const productId = Number(payload.p_product_id || 0);
  const lineType = normalizeLineType(payload.p_line_type || "sale");
  const previousLineType = normalizeLineType(payload.p_previous_line_type || lineType || "sale");

  if (!orderId) {
    return { code: 0, message: "selecciona un pedido", data: null };
  }

  if (!productId) {
    return { code: 0, message: "selecciona un producto", data: null };
  }

  const db = await connect();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [orders] = await connection.query(
      `SELECT
         id, status, bonus_percent, bonus_minimum_amount
       FROM orders
       WHERE id = ?
       FOR UPDATE`,
      [orderId]
    );

    if (!orders.length) {
      await connection.rollback();
      return { code: 0, message: "pedido no encontrado", data: null };
    }

    if (!EDITABLE_ORDER_STATUSES.includes(orders[0].status)) {
      await connection.rollback();
      return {
        code: 0,
        message: "el pedido ya fue entregado o cancelado y no permite cambios",
        data: null,
      };
    }

    if (!lineType || !previousLineType) {
      await connection.rollback();
      return { code: 0, message: "selecciona un tipo de movimiento valido", data: null };
    }

    const wantsRemoval =
      payload.p_remove === true ||
      (String(payload.p_capture_mode || "quantity") === "quantity" &&
        Number(payload.p_quantity || 0) <= 0);

    if (wantsRemoval) {
      const [reservationRows] = await connection.query(
        `SELECT COUNT(*) AS total
         FROM production_sale_reservations psr
         INNER JOIN order_items oi ON oi.id = psr.order_item_id
         WHERE oi.order_id = ?
           AND oi.product_id = ?
           AND oi.line_type = ?
           AND psr.status IN ('reserved', 'partially_delivered', 'delivered')`,
        [orderId, productId, previousLineType]
      );

      if (Number(reservationRows[0]?.total || 0) > 0) {
        await connection.rollback();
        return {
          code: 0,
          message: "no puedes retirar un producto que tiene reservas o entregas desde produccion",
          data: null,
        };
      }

      await connection.query(
        `DELETE FROM order_items
         WHERE order_id = ? AND product_id = ? AND line_type = ?`,
        [orderId, productId, previousLineType]
      );
    } else {
      const [products] = await connection.query(
        `SELECT
           p.id,
           p.unit,
           p.base_price,
           pc.name AS category_name,
           t.rate_percent
         FROM products p
         LEFT JOIN product_categories pc ON pc.id = p.category_id
         INNER JOIN tax_rates t ON t.id = p.tax_rate_id
         WHERE p.id = ?
           AND p.is_active = 1
           AND p.deleted_at IS NULL
           AND t.is_active = 1
         LIMIT 1`,
        [productId]
      );

      if (!products.length) {
        await connection.rollback();
        return { code: 0, message: "producto no encontrado o inactivo", data: null };
      }
      if (lineType === "bonus" && isPastryCategoryName(products[0].category_name)) {
        await connection.rollback();
        return {
          code: 0,
          message: "los productos de pasteleria ya incluyen vendaje y no permiten vendaje adicional",
          data: null,
        };
      }

      let calculated;
      try {
        calculated = calculateOrderLine({
          unit: products[0].unit,
          unitPrice: products[0].base_price,
          taxPercent: products[0].rate_percent,
          lineType,
          captureMode: payload.p_capture_mode || "quantity",
          requestedAmount: payload.p_requested_amount,
          quantity: payload.p_quantity,
        });
      } catch (error) {
        await connection.rollback();
        return { code: 0, message: error.message, data: null };
      }

      if (previousLineType !== lineType) {
        const [reservationRows] = await connection.query(
          `SELECT COUNT(*) AS total
           FROM production_sale_reservations psr
           INNER JOIN order_items oi ON oi.id = psr.order_item_id
           WHERE oi.order_id = ?
             AND oi.product_id = ?
             AND oi.line_type = ?
             AND psr.status IN ('reserved', 'partially_delivered', 'delivered')`,
          [orderId, productId, previousLineType]
        );
        if (Number(reservationRows[0]?.total || 0) > 0) {
          await connection.rollback();
          return {
            code: 0,
            message: "no puedes cambiar el tipo de un producto con reservas o entregas",
            data: null,
          };
        }
        await connection.query(
          `DELETE FROM order_items
           WHERE order_id = ? AND product_id = ? AND line_type = ?`,
          [orderId, productId, previousLineType]
        );
      }

      if (lineType === "sale") {
        const [reservedRows] = await connection.query(
          `SELECT COALESCE(SUM(psr.quantity), 0) AS committed_quantity
           FROM production_sale_reservations psr
           INNER JOIN order_items oi ON oi.id = psr.order_item_id
           WHERE oi.order_id = ?
             AND oi.product_id = ?
             AND oi.line_type = 'sale'
             AND psr.status IN ('reserved', 'partially_delivered', 'delivered')`,
          [orderId, productId]
        );
        if (calculated.quantity < Number(reservedRows[0]?.committed_quantity || 0)) {
          await connection.rollback();
          return {
            code: 0,
            message: "la cantidad no puede ser menor que lo reservado o entregado desde produccion",
            data: null,
          };
        }
      }

      await connection.query(
        `INSERT INTO order_items (
           order_id, product_id, line_type, capture_mode, requested_amount,
           quantity, unit_price, tax_percent, line_subtotal, line_tax,
           line_total, commercial_value
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           capture_mode = VALUES(capture_mode),
           requested_amount = VALUES(requested_amount),
           quantity = VALUES(quantity),
           unit_price = VALUES(unit_price),
           tax_percent = VALUES(tax_percent),
           line_subtotal = VALUES(line_subtotal),
           line_tax = VALUES(line_tax),
           line_total = VALUES(line_total),
           commercial_value = VALUES(commercial_value)`,
        [
          orderId,
          productId,
          calculated.lineType,
          calculated.captureMode,
          calculated.requestedAmount,
          calculated.quantity,
          calculated.unitPrice,
          calculated.taxPercent,
          calculated.lineSubtotal,
          calculated.lineTax,
          calculated.lineTotal,
          calculated.commercialValue,
        ]
      );
    }

    const [itemRows] = await connection.query(
      `SELECT
         oi.line_type,
         oi.line_subtotal,
         oi.line_tax,
         oi.line_total,
         oi.commercial_value,
         pc.name AS category_name
       FROM order_items oi
       INNER JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       WHERE oi.order_id = ?`,
      [orderId]
    );
    const totals = calculateOrderTotals(itemRows);

    try {
      validateBonusAllowance({
        grandTotal: calculateBonusEligibleGrandTotal(itemRows),
        bonusTotal: totals.bonusTotal,
        bonusPercent: orders[0].bonus_percent,
        bonusMinimumAmount: orders[0].bonus_minimum_amount,
      });
    } catch (error) {
      await connection.rollback();
      return { code: 0, message: error.message, data: null };
    }

    await connection.query(
      `UPDATE orders
       SET subtotal = ?,
           tax_total = ?,
           grand_total = ?,
           bonus_total = ?,
           gift_total = ?,
           exchange_total = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        roundMoney(totals.subtotal),
        roundMoney(totals.taxTotal),
        roundMoney(totals.grandTotal),
        roundMoney(totals.bonusTotal),
        roundMoney(totals.giftTotal),
        roundMoney(totals.exchangeTotal),
        orderId,
      ]
    );

    await connection.query(
      `INSERT INTO audit_logs (
         actor_user_id, action, entity_name, entity_id, metadata_json
       )
       VALUES (
         ?, ?, 'orders', ?,
         JSON_OBJECT(
           'product_id', ?,
           'line_type', ?,
           'capture_mode', ?,
           'requested_amount', ?,
           'quantity', ?
         )
       )`,
      [
        actorUserId || null,
        wantsRemoval ? "order.item.remove" : "order.item.upsert",
        String(orderId),
        productId,
        lineType,
        payload.p_capture_mode || "quantity",
        payload.p_requested_amount || null,
        payload.p_quantity || null,
      ]
    );

    await connection.commit();
    return {
      code: 1,
      message: wantsRemoval ? "producto retirado del pedido" : "producto actualizado en el pedido",
      data: {
        order_id: orderId,
        totals: {
          grand_total: roundMoney(totals.grandTotal),
          bonus_total: roundMoney(totals.bonusTotal),
          gift_total: roundMoney(totals.giftTotal),
          exchange_total: roundMoney(totals.exchangeTotal),
        },
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const confirmOrder = async (payload, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();
  const orderId = Number(payload.p_order_id || 0);

  try {
    await connection.beginTransaction();
    const [orders] = await connection.query(
      `SELECT id, status, bonus_percent, bonus_minimum_amount
       FROM orders
       WHERE id = ?
       FOR UPDATE`,
      [orderId]
    );

    if (!orders.length) {
      await connection.rollback();
      return { code: 0, message: "pedido no encontrado", data: null };
    }
    if (orders[0].status !== "draft") {
      await connection.rollback();
      return { code: 0, message: "solo un pedido en borrador puede confirmarse", data: null };
    }

    const [items] = await connection.query(
      `SELECT
         oi.line_type,
         oi.line_subtotal,
         oi.line_tax,
         oi.line_total,
         oi.commercial_value,
         pc.name AS category_name
       FROM order_items oi
       INNER JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       WHERE oi.order_id = ?`,
      [orderId]
    );
    const totals = calculateOrderTotals(items);
    const saleItems = items.filter((item) => item.line_type === "sale").length;

    if (saleItems === 0) {
      await connection.rollback();
      return { code: 0, message: "agrega al menos un producto de venta antes de confirmar", data: null };
    }
    if (items.some((item) => item.line_type === "bonus" && isPastryCategoryName(item.category_name))) {
      await connection.rollback();
      return {
        code: 0,
        message: "los productos de pasteleria ya incluyen vendaje y no permiten vendaje adicional",
        data: null,
      };
    }

    try {
      validateBonusAllowance({
        grandTotal: calculateBonusEligibleGrandTotal(items),
        bonusTotal: totals.bonusTotal,
        bonusPercent: orders[0].bonus_percent,
        bonusMinimumAmount: orders[0].bonus_minimum_amount,
      });
    } catch (error) {
      await connection.rollback();
      return { code: 0, message: error.message, data: null };
    }

    await connection.query(
      `UPDATE orders
       SET status = 'confirmed',
           subtotal = ?,
           tax_total = ?,
           grand_total = ?,
           bonus_total = ?,
           gift_total = ?,
           exchange_total = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        roundMoney(totals.subtotal),
        roundMoney(totals.taxTotal),
        roundMoney(totals.grandTotal),
        roundMoney(totals.bonusTotal),
        roundMoney(totals.giftTotal),
        roundMoney(totals.exchangeTotal),
        orderId,
      ]
    );
    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'order.confirm', 'orders', ?, JSON_OBJECT(
         'grand_total', ?,
         'bonus_total', ?,
         'gift_total', ?,
         'exchange_total', ?
       ))`,
      [
        actorUserId || null,
        String(orderId),
        roundMoney(totals.grandTotal),
        roundMoney(totals.bonusTotal),
        roundMoney(totals.giftTotal),
        roundMoney(totals.exchangeTotal),
      ]
    );
    await connection.commit();
    return { code: 1, message: "pedido confirmado", data: { order_id: orderId } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const cancelOrder = async (payload, actorUserId) => {
  const db = await connect();
  const [reservationRows] = await db.query(
    `
      SELECT
        SUM(CASE WHEN psr.status IN ('reserved','partially_delivered') THEN 1 ELSE 0 END) AS active_reservations,
        SUM(CASE WHEN psr.status = 'delivered' THEN 1 ELSE 0 END) AS delivered_reservations
      FROM production_sale_reservations psr
      INNER JOIN order_items oi ON oi.id = psr.order_item_id
      WHERE oi.order_id = ?
    `,
    [Number(payload.p_order_id || 0)]
  );
  if (Number(reservationRows[0]?.active_reservations || 0) > 0) {
    return { code: 0, message: "libera las reservas de produccion antes de cancelar el pedido", data: null };
  }
  if (Number(reservationRows[0]?.delivered_reservations || 0) > 0) {
    return {
      code: 0,
      message: "el pedido ya tiene producto entregado directamente; registra una devolucion en lugar de cancelarlo",
      data: null,
    };
  }

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

const deliverOrder = async (payload, actorUserId) => {
  const orderId = Number(payload.p_order_id || 0);
  const db = await connect();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const [orders] = await connection.query(
      `SELECT
         id, status, sales_agent_user_id, seller_commission_percent
       FROM orders
       WHERE id = ?
       FOR UPDATE`,
      [orderId]
    );

    if (!orders.length) {
      await connection.rollback();
      return { code: 0, message: "pedido no encontrado", data: null };
    }

    const order = orders[0];
    if (order.status !== "dispatched") {
      await connection.rollback();
      return {
        code: 0,
        message: "solo un pedido enviado a despacho puede marcarse como entregado",
        data: null,
      };
    }
    if (!order.sales_agent_user_id) {
      await connection.rollback();
      return { code: 0, message: "el pedido no tiene vendedor asignado", data: null };
    }

    const [totalsRows] = await connection.query(
      `SELECT
         COALESCE(SUM(CASE WHEN line_type = 'sale' THEN line_total ELSE 0 END), 0)
           AS delivered_sales_total,
         COALESCE(SUM(CASE WHEN line_type = 'bonus' THEN commercial_value ELSE 0 END), 0)
           AS excluded_bonus_total,
         COALESCE(SUM(CASE WHEN line_type = 'gift' THEN commercial_value ELSE 0 END), 0)
           AS excluded_gift_total,
         COALESCE(SUM(CASE WHEN line_type = 'exchange' THEN commercial_value ELSE 0 END), 0)
           AS excluded_exchange_total
       FROM order_items
       WHERE order_id = ?`,
      [orderId]
    );

    const totals = totalsRows[0];
    let commission;
    try {
      commission = calculateDeliveredCommission({
        deliveredSalesTotal: totals.delivered_sales_total,
        returnedSalesTotal: 0,
        commissionPercent: order.seller_commission_percent,
      });
    } catch (error) {
      await connection.rollback();
      return { code: 0, message: error.message, data: null };
    }

    if (commission.deliveredSalesTotal <= 0) {
      await connection.rollback();
      return { code: 0, message: "el pedido no tiene ventas cobradas para entregar", data: null };
    }

    const deliveredAt = new Date();
    await connection.query(
      `INSERT INTO sales_commissions (
         order_id, sales_agent_user_id, delivered_sales_total,
         returned_sales_total, excluded_bonus_total, excluded_gift_total,
         excluded_exchange_total, commission_base, commission_percent,
         commission_amount, status, delivered_at, created_by
       )
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'accrued', ?, ?)`,
      [
        orderId,
        order.sales_agent_user_id,
        commission.deliveredSalesTotal,
        roundMoney(totals.excluded_bonus_total),
        roundMoney(totals.excluded_gift_total),
        roundMoney(totals.excluded_exchange_total),
        commission.commissionBase,
        roundMoney(order.seller_commission_percent),
        commission.commissionAmount,
        deliveredAt,
        actorUserId || null,
      ]
    );

    await connection.query(
      `UPDATE orders
       SET status = 'delivered',
           actual_delivered_at = ?,
           delivered_by = ?,
           commission_base = ?,
           commission_total = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        deliveredAt,
        actorUserId || null,
        commission.commissionBase,
        commission.commissionAmount,
        orderId,
      ]
    );

    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'order.deliver', 'orders', ?, JSON_OBJECT(
         'delivered_sales_total', ?,
         'excluded_bonus_total', ?,
         'excluded_gift_total', ?,
         'excluded_exchange_total', ?,
         'commission_base', ?,
         'commission_percent', ?,
         'commission_amount', ?
       ))`,
      [
        actorUserId || null,
        String(orderId),
        commission.deliveredSalesTotal,
        roundMoney(totals.excluded_bonus_total),
        roundMoney(totals.excluded_gift_total),
        roundMoney(totals.excluded_exchange_total),
        commission.commissionBase,
        roundMoney(order.seller_commission_percent),
        commission.commissionAmount,
      ]
    );

    await connection.commit();
    return {
      code: 1,
      message: "pedido entregado y comision calculada",
      data: {
        order_id: orderId,
        commission_base: commission.commissionBase,
        commission_amount: commission.commissionAmount,
      },
    };
  } catch (error) {
    await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      return { code: 0, message: "la comision de este pedido ya fue registrada", data: null };
    }
    throw error;
  } finally {
    connection.release();
  }
};

const listSalesCommissions = async ({ salesAgentUserId, dateFrom, dateTo } = {}) => {
  const db = await connect();
  const filters = ["sc.status IN ('accrued','adjusted')"];
  const values = [];

  if (salesAgentUserId) {
    filters.push("sc.sales_agent_user_id = ?");
    values.push(Number(salesAgentUserId));
  }
  if (dateFrom) {
    filters.push("DATE(sc.delivered_at) >= ?");
    values.push(String(dateFrom).slice(0, 10));
  }
  if (dateTo) {
    filters.push("DATE(sc.delivered_at) <= ?");
    values.push(String(dateTo).slice(0, 10));
  }

  const [rows] = await db.query(
    `SELECT
       sc.id,
       sc.order_id,
       sc.sales_agent_user_id,
       u.full_name AS sales_agent_name,
       c.name AS customer_name,
       sc.delivered_sales_total,
       sc.returned_sales_total,
       sc.excluded_bonus_total,
       sc.excluded_gift_total,
       sc.excluded_exchange_total,
       sc.commission_base,
       sc.commission_percent,
       sc.commission_amount,
       sc.status,
       sc.delivered_at
     FROM sales_commissions sc
     INNER JOIN orders o ON o.id = sc.order_id
     INNER JOIN customers c ON c.id = o.customer_id
     INNER JOIN users u ON u.id = sc.sales_agent_user_id
     WHERE ${filters.join(" AND ")}
     ORDER BY sc.delivered_at DESC, sc.id DESC`,
    values
  );

  const summary = rows.reduce(
    (acc, row) => {
      acc.orders += 1;
      acc.delivered_sales_total += Number(row.delivered_sales_total || 0);
      acc.returned_sales_total += Number(row.returned_sales_total || 0);
      acc.commission_base += Number(row.commission_base || 0);
      acc.commission_amount += Number(row.commission_amount || 0);
      return acc;
    },
    {
      orders: 0,
      delivered_sales_total: 0,
      returned_sales_total: 0,
      commission_base: 0,
      commission_amount: 0,
    }
  );

  return {
    code: 1,
    message: "comisiones listadas",
    data: {
      items: rows,
      summary: {
        ...summary,
        delivered_sales_total: roundMoney(summary.delivered_sales_total),
        returned_sales_total: roundMoney(summary.returned_sales_total),
        commission_base: roundMoney(summary.commission_base),
        commission_amount: roundMoney(summary.commission_amount),
      },
    },
  };
};

const getDailySalesSettlement = async ({
  salesAgentUserId,
  settlementDate,
  actorUserId,
  canViewAll = false,
} = {}) => {
  const db = await connect();
  const date = String(settlementDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const requestedSellerId = Number(salesAgentUserId || 0);
  const sellerId = canViewAll ? requestedSellerId : Number(actorUserId || 0);
  const [sellers] = canViewAll
    ? await db.query(
        `SELECT DISTINCT u.id, u.full_name
         FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         INNER JOIN roles r ON r.id = ur.role_id
         WHERE r.code = 'VENTAS'
           AND u.status = 'active'
           AND u.deleted_at IS NULL
         ORDER BY u.full_name`
      )
    : await db.query(
        `SELECT u.id, u.full_name
         FROM users u
         WHERE u.id = ?
           AND u.status = 'active'
           AND u.deleted_at IS NULL
         LIMIT 1`,
        [sellerId]
      );

  if (!sellerId) {
    if (!canViewAll) {
      return {
        code: 0,
        message: "selecciona un vendedor para consultar la liquidacion",
        data: { sellers },
      };
    }
  }

  const sellerRows = sellerId
    ? sellers.filter((seller) => Number(seller.id) === sellerId)
    : [{ id: null, full_name: "Todos los vendedores" }];

  if (!sellerRows.length) {
    return { code: 0, message: "vendedor no encontrado o inactivo", data: null };
  }

  const filters = [
    "DATE(sc.delivered_at) = ?",
    "sc.status IN ('accrued', 'adjusted')",
  ];
  const values = [date];

  if (sellerId) {
    filters.unshift("sc.sales_agent_user_id = ?");
    values.unshift(sellerId);
  }

  const [rows] = await db.query(
    `SELECT
       sc.id AS commission_id,
       sc.order_id,
       sc.sales_agent_user_id,
       u.full_name AS sales_agent_name,
       o.order_date,
       o.customer_id,
       c.name AS customer_name,
       c.address AS customer_address,
       c.phone AS customer_phone,
       sc.delivered_sales_total,
       sc.returned_sales_total,
       sc.commission_base,
       sc.commission_percent,
       sc.commission_amount,
       ROUND(sc.delivered_sales_total - sc.commission_amount, 2) AS amount_to_deliver,
       sc.status,
       sc.delivered_at
     FROM sales_commissions sc
     INNER JOIN orders o ON o.id = sc.order_id
     INNER JOIN customers c ON c.id = o.customer_id
     INNER JOIN users u ON u.id = sc.sales_agent_user_id
     WHERE ${filters.join(" AND ")}
     ORDER BY u.full_name, c.name, sc.delivered_at, sc.order_id`,
    values
  );

  const summary = rows.reduce(
    (acc, row) => {
      acc.order_count += 1;
      acc.delivered_sales_total += Number(row.delivered_sales_total || 0);
      acc.returned_sales_total += Number(row.returned_sales_total || 0);
      acc.commission_base += Number(row.commission_base || 0);
      acc.commission_amount += Number(row.commission_amount || 0);
      return acc;
    },
    {
      order_count: 0,
      delivered_sales_total: 0,
      returned_sales_total: 0,
      commission_base: 0,
      commission_amount: 0,
    }
  );

  return {
    code: 1,
    message: "liquidacion diaria calculada",
    data: {
      settlement_date: date,
      seller: sellerRows[0],
      sellers,
      items: rows,
      summary: {
        order_count: summary.order_count,
        delivered_sales_total: roundMoney(summary.delivered_sales_total),
        returned_sales_total: roundMoney(summary.returned_sales_total),
        commission_base: roundMoney(summary.commission_base),
        commission_amount: roundMoney(summary.commission_amount),
        amount_to_deliver: roundMoney(
          summary.delivered_sales_total - summary.commission_amount
        ),
      },
    },
  };
};

const RETURN_REASONS = new Set(["expired", "mold", "wet", "malformed", "other"]);

const listSalesReturnOptions = async ({ actorUserId, canViewAll = false } = {}) => {
  const db = await connect();
  const orderFilters = [
    "o.status = 'delivered'",
    "o.actual_delivered_at IS NOT NULL",
    "CURRENT_TIMESTAMP <= DATE_ADD(o.actual_delivered_at, INTERVAL 17 DAY)",
  ];
  const values = [];

  if (!canViewAll) {
    orderFilters.push("o.sales_agent_user_id = ?");
    values.push(Number(actorUserId || 0));
  }

  const [orders] = await db.query(
    `SELECT
       o.id,
       o.branch_id,
       o.customer_id,
       c.name AS customer_name,
       o.sales_agent_user_id,
       u.full_name AS sales_agent_name,
       o.order_date,
       o.actual_delivered_at,
       DATE_ADD(o.actual_delivered_at, INTERVAL 15 DAY) AS product_expires_at,
       DATE_ADD(o.actual_delivered_at, INTERVAL 17 DAY) AS report_deadline_at
     FROM orders o
     INNER JOIN customers c ON c.id = o.customer_id
     INNER JOIN users u ON u.id = o.sales_agent_user_id
     WHERE ${orderFilters.join(" AND ")}
     ORDER BY o.actual_delivered_at DESC, o.id DESC`,
    values
  );

  const orderIds = orders.map((order) => Number(order.id));
  let items = [];
  if (orderIds.length) {
    const placeholders = orderIds.map(() => "?").join(",");
    const [itemRows] = await db.query(
      `SELECT
         oi.id AS order_item_id,
         oi.order_id,
         oi.product_id,
         p.name AS product_name,
         p.sku AS product_sku,
         p.unit AS product_unit,
         oi.line_type,
         oi.quantity,
         oi.unit_price,
         oi.line_total,
         oi.commercial_value,
         GREATEST(
           oi.quantity - COALESCE(SUM(
             CASE
               WHEN sr.status IN ('pending_authorization','completed')
               THEN sri.quantity
               ELSE 0
             END
           ), 0),
           0
         ) AS returnable_quantity
       FROM order_items oi
       INNER JOIN products p ON p.id = oi.product_id
       LEFT JOIN sales_return_items sri ON sri.order_item_id = oi.id
       LEFT JOIN sales_returns sr ON sr.id = sri.sales_return_id
       WHERE oi.order_id IN (${placeholders})
       GROUP BY
         oi.id, oi.order_id, oi.product_id, p.name, p.sku, p.unit,
         oi.line_type, oi.quantity, oi.unit_price, oi.line_total,
         oi.commercial_value
       HAVING returnable_quantity > 0
       ORDER BY p.name`,
      orderIds
    );
    items = itemRows;
  }

  const [products] = await db.query(
    `SELECT id, sku, name, unit, base_price
     FROM products
     WHERE is_active = 1
       AND deleted_at IS NULL
     ORDER BY name`
  );

  return {
    code: 1,
    message: "opciones de cambios y devoluciones listadas",
    data: { orders, items, products },
  };
};

const listSalesReturns = async ({ actorUserId, canViewAll = false, status } = {}) => {
  const db = await connect();
  const filters = [];
  const values = [];

  if (!canViewAll) {
    filters.push("sr.sales_agent_user_id = ?");
    values.push(Number(actorUserId || 0));
  }
  if (status) {
    filters.push("sr.status = ?");
    values.push(status);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const [returns] = await db.query(
    `SELECT
       sr.id,
       sr.order_id,
       sr.sales_agent_user_id,
       seller.full_name AS sales_agent_name,
       o.customer_id,
       c.name AS customer_name,
       o.order_date,
       o.branch_id,
       b.name AS branch_name,
       sr.status,
       sr.reported_at,
       sr.product_expires_at,
       sr.report_deadline_at,
       sr.notes,
       sr.authorized_by,
       authorizer.full_name AS authorized_by_name,
       sr.authorized_at,
       sr.rejection_reason,
       sr.created_at
     FROM sales_returns sr
     INNER JOIN orders o ON o.id = sr.order_id
     INNER JOIN customers c ON c.id = o.customer_id
     INNER JOIN branches b ON b.id = o.branch_id
     INNER JOIN users seller ON seller.id = sr.sales_agent_user_id
     LEFT JOIN users authorizer ON authorizer.id = sr.authorized_by
     ${whereClause}
     ORDER BY sr.created_at DESC, sr.id DESC`,
    values
  );

  const returnIds = returns.map((row) => Number(row.id));
  let items = [];
  if (returnIds.length) {
    const placeholders = returnIds.map(() => "?").join(",");
    const [itemRows] = await db.query(
      `SELECT
         sri.id,
         sri.sales_return_id,
         sri.order_item_id,
         sri.returned_product_id,
         returned.name AS returned_product_name,
         returned.sku AS returned_product_sku,
         sri.replacement_product_id,
         replacement.name AS replacement_product_name,
         replacement.sku AS replacement_product_sku,
         sri.reason,
         sri.quantity,
         sri.returned_sale_value,
         sri.returned_commercial_value,
         sri.replacement_commercial_value,
         sri.notes
       FROM sales_return_items sri
       INNER JOIN products returned ON returned.id = sri.returned_product_id
       INNER JOIN products replacement ON replacement.id = sri.replacement_product_id
       WHERE sri.sales_return_id IN (${placeholders})
       ORDER BY sri.id`,
      returnIds
    );
    items = itemRows;
  }

  const itemsByReturn = items.reduce((acc, item) => {
    const key = String(item.sales_return_id);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});

  return {
    code: 1,
    message: "cambios y devoluciones listados",
    data: {
      items: returns.map((row) => ({
        ...row,
        items: itemsByReturn[String(row.id)] || [],
      })),
    },
  };
};

const createSalesReturn = async (payload, actorUserId) => {
  const orderId = Number(payload.p_order_id || 0);
  const inputItems = Array.isArray(payload.p_items) ? payload.p_items : [];

  if (!orderId || !inputItems.length) {
    return { code: 0, message: "selecciona un pedido y al menos un producto", data: null };
  }

  const db = await connect();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const [orders] = await connection.query(
      `SELECT
         id, branch_id, status, sales_agent_user_id, actual_delivered_at,
         DATE_ADD(actual_delivered_at, INTERVAL 15 DAY) AS product_expires_at,
         DATE_ADD(actual_delivered_at, INTERVAL 17 DAY) AS report_deadline_at,
         CURRENT_TIMESTAMP <= DATE_ADD(actual_delivered_at, INTERVAL 17 DAY) AS report_is_open
       FROM orders
       WHERE id = ?
       FOR UPDATE`,
      [orderId]
    );

    if (!orders.length || orders[0].status !== "delivered" || !orders[0].actual_delivered_at) {
      await connection.rollback();
      return { code: 0, message: "solo puedes reportar productos de un pedido entregado", data: null };
    }
    if (!Number(orders[0].report_is_open)) {
      await connection.rollback();
      return {
        code: 0,
        message: "el plazo de reporte termino dos dias despues del vencimiento",
        data: null,
      };
    }

    const normalizedItems = [];
    const seenItems = new Set();
    for (const input of inputItems) {
      const orderItemId = Number(input.order_item_id || 0);
      const replacementProductId = Number(input.replacement_product_id || 0);
      const quantity = Number(input.quantity || 0);
      const reason = String(input.reason || "");
      const uniqueKey = `${orderItemId}:${replacementProductId}`;

      if (!orderItemId || !replacementProductId || !Number.isFinite(quantity) || quantity <= 0) {
        await connection.rollback();
        return { code: 0, message: "revisa producto devuelto, reemplazo y cantidad", data: null };
      }
      if (!RETURN_REASONS.has(reason)) {
        await connection.rollback();
        return { code: 0, message: "selecciona un motivo de devolucion valido", data: null };
      }
      if (seenItems.has(uniqueKey)) {
        await connection.rollback();
        return { code: 0, message: "no repitas el mismo producto y reemplazo", data: null };
      }
      seenItems.add(uniqueKey);

      const [orderItems] = await connection.query(
        `SELECT
           oi.id, oi.product_id, oi.line_type, oi.quantity,
           oi.line_total, oi.commercial_value
         FROM order_items oi
         WHERE oi.id = ?
           AND oi.order_id = ?
         FOR UPDATE`,
        [orderItemId, orderId]
      );
      if (!orderItems.length) {
        await connection.rollback();
        return { code: 0, message: "un producto no pertenece al pedido entregado", data: null };
      }

      const [usedRows] = await connection.query(
        `SELECT COALESCE(SUM(sri.quantity), 0) AS used_quantity
         FROM sales_return_items sri
         INNER JOIN sales_returns sr ON sr.id = sri.sales_return_id
         WHERE sri.order_item_id = ?
           AND sr.status IN ('pending_authorization','completed')`,
        [orderItemId]
      );
      const availableQuantity =
        Number(orderItems[0].quantity || 0) - Number(usedRows[0]?.used_quantity || 0);
      if (quantity > availableQuantity) {
        await connection.rollback();
        return {
          code: 0,
          message: "la cantidad devuelta supera lo disponible del producto",
          data: null,
        };
      }

      const [replacementRows] = await connection.query(
        `SELECT id, base_price
         FROM products
         WHERE id = ?
           AND is_active = 1
           AND deleted_at IS NULL
         LIMIT 1`,
        [replacementProductId]
      );
      if (!replacementRows.length) {
        await connection.rollback();
        return { code: 0, message: "el producto de reemplazo no esta disponible", data: null };
      }

      const original = orderItems[0];
      const returnedCommercialValue = roundMoney(
        (Number(original.commercial_value || original.line_total || 0) /
          Number(original.quantity || 1)) *
          quantity
      );
      normalizedItems.push({
        orderItemId,
        returnedProductId: Number(original.product_id),
        replacementProductId,
        reason,
        quantity,
        returnedSaleValue:
          original.line_type === "sale"
            ? roundMoney((Number(original.line_total || 0) / Number(original.quantity || 1)) * quantity)
            : 0,
        returnedCommercialValue,
        replacementCommercialValue: roundMoney(Number(replacementRows[0].base_price || 0) * quantity),
        notes: String(input.notes || "").trim() || null,
      });
    }

    const [result] = await connection.query(
      `INSERT INTO sales_returns (
         order_id, sales_agent_user_id, status, reported_at,
         product_expires_at, report_deadline_at, notes, created_by
       )
       VALUES (?, ?, 'pending_authorization', CURRENT_TIMESTAMP, ?, ?, ?, ?)`,
      [
        orderId,
        orders[0].sales_agent_user_id,
        orders[0].product_expires_at,
        orders[0].report_deadline_at,
        String(payload.p_notes || "").trim() || null,
        actorUserId || null,
      ]
    );
    const salesReturnId = Number(result.insertId);

    for (const item of normalizedItems) {
      await connection.query(
        `INSERT INTO sales_return_items (
           sales_return_id, order_item_id, returned_product_id,
           replacement_product_id, reason, quantity, returned_sale_value,
           returned_commercial_value, replacement_commercial_value, notes
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          salesReturnId,
          item.orderItemId,
          item.returnedProductId,
          item.replacementProductId,
          item.reason,
          item.quantity,
          item.returnedSaleValue,
          item.returnedCommercialValue,
          item.replacementCommercialValue,
          item.notes,
        ]
      );
    }

    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'sales_return.create', 'sales_returns', ?, JSON_OBJECT(
         'order_id', ?,
         'items_count', ?
       ))`,
      [actorUserId || null, String(salesReturnId), orderId, normalizedItems.length]
    );

    await connection.commit();
    return {
      code: 1,
      message: "devolucion reportada y pendiente de autorizacion",
      data: { sales_return_id: salesReturnId },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const authorizeSalesReturn = async ({ salesReturnId, canAuthorize = false }, actorUserId) => {
  const db = await connect();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const [returns] = await connection.query(
      `SELECT sr.id, sr.order_id, sr.sales_agent_user_id, sr.status, o.branch_id
       FROM sales_returns sr
       INNER JOIN orders o ON o.id = sr.order_id
       WHERE sr.id = ?
       FOR UPDATE`,
      [Number(salesReturnId || 0)]
    );
    if (!returns.length) {
      await connection.rollback();
      return { code: 0, message: "devolucion no encontrada", data: null };
    }
    const salesReturn = returns[0];
    if (salesReturn.status !== "pending_authorization") {
      await connection.rollback();
      return { code: 0, message: "la devolucion ya fue procesada", data: null };
    }
    if (!canAuthorize) {
      await connection.rollback();
      return {
        code: 0,
        message: "solo un rol administrativo puede autorizar el cambio",
        data: null,
      };
    }

    const [items] = await connection.query(
      `SELECT *
       FROM sales_return_items
       WHERE sales_return_id = ?
       FOR UPDATE`,
      [salesReturn.id]
    );
    if (!items.length) {
      await connection.rollback();
      return { code: 0, message: "la devolucion no tiene productos", data: null };
    }

    const replacementTotals = items.reduce((acc, item) => {
      const productId = Number(item.replacement_product_id);
      acc[productId] = (acc[productId] || 0) + Number(item.quantity || 0);
      return acc;
    }, {});

    for (const [productIdText, quantity] of Object.entries(replacementTotals)) {
      const productId = Number(productIdText);
      await connection.query(
        `INSERT IGNORE INTO stock_products (
           branch_id, product_id, quantity_on_hand, min_stock
         ) VALUES (?, ?, 0, 0)`,
        [salesReturn.branch_id, productId]
      );
      const [stockRows] = await connection.query(
        `SELECT quantity_on_hand
         FROM stock_products
         WHERE branch_id = ?
           AND product_id = ?
         FOR UPDATE`,
        [salesReturn.branch_id, productId]
      );
      if (Number(stockRows[0]?.quantity_on_hand || 0) < quantity) {
        await connection.rollback();
        return {
          code: 0,
          message: `stock insuficiente para entregar el reemplazo del producto ${productId}`,
          data: null,
        };
      }
      await connection.query(
        `UPDATE stock_products
         SET quantity_on_hand = quantity_on_hand - ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE branch_id = ?
           AND product_id = ?`,
        [quantity, salesReturn.branch_id, productId]
      );
    }

    for (const item of items) {
      await connection.query(
        `INSERT INTO inventory_movements (
           branch_id, item_type, raw_material_id, product_id, movement_type,
           quantity, unit_cost, reference_type, reference_id, notes, created_by
         )
         VALUES (?, 'product', NULL, ?, 'return_in', ?, NULL,
           'sales_return', ?, ?, ?)`,
        [
          salesReturn.branch_id,
          item.returned_product_id,
          item.quantity,
          salesReturn.id,
          `Devolucion no vendible: ${item.reason}`,
          actorUserId,
        ]
      );
      await connection.query(
        `INSERT INTO inventory_movements (
           branch_id, item_type, raw_material_id, product_id, movement_type,
           quantity, unit_cost, reference_type, reference_id, notes, created_by
         )
         VALUES (?, 'product', NULL, ?, 'exchange_out', ?, NULL,
           'sales_return', ?, 'Producto entregado como reemplazo', ?)`,
        [
          salesReturn.branch_id,
          item.replacement_product_id,
          item.quantity,
          salesReturn.id,
          actorUserId,
        ]
      );
    }

    const returnedSalesTotal = roundMoney(
      items.reduce((total, item) => total + Number(item.returned_sale_value || 0), 0)
    );
    const [commissionRows] = await connection.query(
      `SELECT *
       FROM sales_commissions
       WHERE order_id = ?
       FOR UPDATE`,
      [salesReturn.order_id]
    );
    if (commissionRows.length) {
      const commission = commissionRows[0];
      const newReturnedTotal = roundMoney(
        Number(commission.returned_sales_total || 0) + returnedSalesTotal
      );
      const newBase = roundMoney(
        Math.max(Number(commission.delivered_sales_total || 0) - newReturnedTotal, 0)
      );
      const newAmount = roundMoney(
        newBase * (Number(commission.commission_percent || 0) / 100)
      );
      await connection.query(
        `UPDATE sales_commissions
         SET returned_sales_total = ?,
             commission_base = ?,
             commission_amount = ?,
             status = 'adjusted',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newReturnedTotal, newBase, newAmount, commission.id]
      );
      await connection.query(
        `UPDATE orders
         SET commission_base = ?,
             commission_total = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newBase, newAmount, salesReturn.order_id]
      );
    }

    await connection.query(
      `UPDATE sales_returns
       SET status = 'completed',
           authorized_by = ?,
           authorized_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [actorUserId, salesReturn.id]
    );
    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'sales_return.authorize', 'sales_returns', ?, JSON_OBJECT(
         'order_id', ?,
         'returned_sales_total', ?
       ))`,
      [actorUserId, String(salesReturn.id), salesReturn.order_id, returnedSalesTotal]
    );

    await connection.commit();
    return {
      code: 1,
      message: "devolucion autorizada y reemplazo registrado",
      data: { sales_return_id: Number(salesReturn.id) },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const rejectSalesReturn = async ({ salesReturnId, reason, canAuthorize = false }, actorUserId) => {
  const rejectionReason = String(reason || "").trim();
  if (rejectionReason.length < 5) {
    return { code: 0, message: "indica el motivo del rechazo", data: null };
  }

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [returns] = await connection.query(
      `SELECT id, sales_agent_user_id, status
       FROM sales_returns
       WHERE id = ?
       FOR UPDATE`,
      [Number(salesReturnId || 0)]
    );
    if (!returns.length) {
      await connection.rollback();
      return { code: 0, message: "devolucion no encontrada", data: null };
    }
    if (returns[0].status !== "pending_authorization") {
      await connection.rollback();
      return { code: 0, message: "la devolucion ya fue procesada", data: null };
    }
    if (!canAuthorize) {
      await connection.rollback();
      return {
        code: 0,
        message: "solo un rol administrativo puede rechazar el cambio",
        data: null,
      };
    }

    await connection.query(
      `UPDATE sales_returns
       SET status = 'rejected',
           rejected_by = ?,
           rejected_at = CURRENT_TIMESTAMP,
           rejection_reason = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [actorUserId, rejectionReason, returns[0].id]
    );
    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'sales_return.reject', 'sales_returns', ?, JSON_OBJECT(
         'reason', ?
       ))`,
      [actorUserId, String(returns[0].id), rejectionReason]
    );
    await connection.commit();
    return {
      code: 1,
      message: "devolucion rechazada",
      data: { sales_return_id: Number(returns[0].id) },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const createProductionFromOrder = async (payload, actorUserId) => {
  return {
    code: 0,
    message: "los pedidos comerciales se despachan desde inventario; la produccion se planifica de forma independiente",
    data: null,
  };

  /* Legacy flow retained below for historical reference. */
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
          SUM(oi.quantity) AS quantity,
          p.name AS product_name,
          r.id AS recipe_id
        FROM order_items oi
        INNER JOIN products p ON p.id = oi.product_id
        LEFT JOIN recipes r
          ON r.product_id = oi.product_id
         AND r.is_active = 1
        WHERE oi.order_id = ?
          AND oi.line_type = 'sale'
        GROUP BY oi.product_id, p.name, r.id
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
  const invoiceNumber = payload.p_invoice_number ? String(payload.p_invoice_number).trim() : null;

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
          branch_id, supplier_id, invoice_number, order_date, expected_date, status,
          subtotal, tax_total, grand_total, notes, created_by
        )
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
      `,
      [branchId, supplierId, invoiceNumber, orderDate, expectedDate, subtotal, taxTotal, grandTotal, notes, actorUserId || null]
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

      if (item.unitCost > 0) {
        await connection.query(
          "UPDATE raw_materials SET unit_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [item.unitCost, item.rawMaterialId]
        );
      }
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
    filters.push("(CAST(po.id AS CHAR) LIKE ? OR s.name LIKE ? OR po.invoice_number LIKE ? OR po.notes LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like, like);
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
        po.invoice_number,
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

const listPurchaseOrderHistory = async ({ branchId, supplierId, search, dateFrom, dateTo, page, pageSize } = {}) => {
  const db = await connect();
  const filters = ["po.status = 'received'"];
  const params = [];
  const limit = Math.min(Math.max(Number(pageSize || 9), 1), 100);
  const currentPage = Math.max(Number(page || 1), 1);
  const offset = (currentPage - 1) * limit;

  if (branchId) {
    filters.push("po.branch_id = ?");
    params.push(Number(branchId));
  }

  if (supplierId) {
    filters.push("po.supplier_id = ?");
    params.push(Number(supplierId));
  }

  if (dateFrom) {
    filters.push("po.order_date >= ?");
    params.push(String(dateFrom).slice(0, 10));
  }

  if (dateTo) {
    filters.push("po.order_date <= ?");
    params.push(String(dateTo).slice(0, 10));
  }

  if (search) {
    filters.push(
      "(CAST(po.id AS CHAR) LIKE ? OR s.name LIKE ? OR po.invoice_number LIKE ? OR po.notes LIKE ? OR rm.name LIKE ?)"
    );
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
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
        po.invoice_number,
        po.order_date,
        po.expected_date,
        po.status,
        po.grand_total,
        po.notes,
        po.created_at,
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

  const [countRows] = await db.query(
    `
      SELECT COUNT(*) AS total
      FROM (
        SELECT po.id
        FROM purchase_orders po
        INNER JOIN suppliers s ON s.id = po.supplier_id
        LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
        LEFT JOIN raw_materials rm ON rm.id = poi.raw_material_id
        ${where}
        GROUP BY po.id
      ) x
    `,
    params
  );

  return {
    code: 1,
    message: "facturas de compra listadas",
    data: {
      items: rows,
      page: currentPage,
      pageSize: limit,
      total: Number(countRows[0]?.total || 0),
    },
  };
};

const getPurchaseOrderDetail = async ({ purchaseOrderId }) => {
  const id = Number(purchaseOrderId || 0);

  if (!id) {
    return { code: 0, message: "selecciona una factura valida", data: null };
  }

  const db = await connect();
  const [orders] = await db.query(
    `
      SELECT
        po.id,
        po.branch_id,
        b.name AS branch_name,
        po.supplier_id,
        s.name AS supplier_name,
        po.invoice_number,
        po.order_date,
        po.expected_date,
        po.status,
        po.subtotal,
        po.tax_total,
        po.grand_total,
        po.notes,
        po.created_at
      FROM purchase_orders po
      INNER JOIN branches b ON b.id = po.branch_id
      INNER JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = ?
      LIMIT 1
    `,
    [id]
  );

  if (!orders.length) {
    return { code: 0, message: "factura de compra no encontrada", data: null };
  }

  const [items] = await db.query(
    `
      SELECT
        poi.id,
        poi.purchase_order_id,
        poi.raw_material_id,
        rm.name AS raw_material_name,
        rm.unit AS raw_material_unit,
        rm.purchase_package_name,
        rm.purchase_package_quantity,
        poi.quantity,
        poi.unit_cost,
        poi.tax_percent,
        poi.line_subtotal,
        poi.line_tax,
        poi.line_total
      FROM purchase_order_items poi
      INNER JOIN raw_materials rm ON rm.id = poi.raw_material_id
      WHERE poi.purchase_order_id = ?
      ORDER BY rm.name
    `,
    [id]
  );

  return {
    code: 1,
    message: "detalle de factura obtenido",
    data: {
      order: orders[0],
      items,
    },
  };
};

module.exports = {
  listOrders,
  listOrderItems,
  listProductionReservations,
  listProductionReservationOptions,
  listOrderBaseData,
  listSellerCustomerAssignments,
  assignCustomerToSeller,
  syncSellerCustomers,
  unassignCustomerFromSeller,
  getSalesSettings,
  updateSalesSettings,
  createOrder,
  getOrderPrintData,
  confirmOrderPrint,
  upsertOrderItem,
  createProductionReservation,
  deliverProductionReservation,
  releaseProductionReservation,
  confirmOrder,
  cancelOrder,
  dispatchOrder,
  deliverOrder,
  listSalesCommissions,
  getDailySalesSettlement,
  listSalesReturnOptions,
  listSalesReturns,
  createSalesReturn,
  authorizeSalesReturn,
  rejectSalesReturn,
  createProductionFromOrder,
  createPurchaseOrder,
  listPendingPurchaseOrders,
  listPurchaseOrderHistory,
  getPurchaseOrderDetail,
  receivePurchaseOrder,
};
