const boom = require("@hapi/boom");
const { connect } = require("../data-access");

const asPositiveId = (value, fieldName) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw boom.badRequest(`${fieldName} es obligatorio`);
  }
  return id;
};

const asReason = (value) => {
  const reason = String(value || "").trim();
  if (reason.length > 500) {
    throw boom.badRequest("el motivo no puede superar los 500 caracteres");
  }
  return reason || null;
};

const asDate = (value, fieldName, optional = false) => {
  if (optional && !value) return null;
  const normalized = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw boom.badRequest(`${fieldName} debe usar el formato YYYY-MM-DD`);
  }
  return normalized;
};

const asBoolean = (value, fallback = true) => {
  if ([true, 1, "1", "true"].includes(value)) return true;
  if ([false, 0, "0", "false"].includes(value)) return false;
  return fallback;
};

const assertDateRange = (validFrom, validTo) => {
  if (validTo && validTo < validFrom) {
    throw boom.badRequest("la fecha final no puede ser anterior a la fecha inicial");
  }
};

const insertHistory = async (connection, {
  entityType,
  entityId,
  actionType,
  previousValues = null,
  newValues = null,
  reason,
  actorUserId,
}) => {
  await connection.query(
    `INSERT INTO wholesale_configuration_history
       (entity_type, entity_id, action_type, previous_values_json, new_values_json, reason, changed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      entityId,
      actionType,
      previousValues ? JSON.stringify(previousValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      reason,
      actorUserId,
    ]
  );
};

const listWholesaleConfiguration = async () => {
  const db = await connect();
  const [availableCustomers] = await db.query(
    `SELECT id, name, tax_id, status
       FROM customers
      WHERE status = 'active' AND deleted_at IS NULL
      ORDER BY name ASC`
  );
  const [availableProducts] = await db.query(
    `SELECT id, sku, name, base_price, unit, is_active
       FROM products
      WHERE is_active = 1 AND deleted_at IS NULL
      ORDER BY name ASC`
  );
  const [priceLists] = await db.query(
    `SELECT id, code, name, is_active, change_reason, created_by, updated_by, created_at, updated_at
       FROM wholesale_price_lists
      ORDER BY is_active DESC, name ASC`
  );
  const [customers] = await db.query(
    `SELECT profile.id, profile.customer_id, customer.name AS customer_name,
            profile.price_list_id, price_list.name AS price_list_name,
            profile.valid_from, profile.valid_to, profile.is_active,
            profile.change_reason, profile.created_by, profile.updated_by,
            profile.created_at, profile.updated_at
       FROM customer_wholesale_profiles profile
       INNER JOIN customers customer ON customer.id = profile.customer_id
       INNER JOIN wholesale_price_lists price_list ON price_list.id = profile.price_list_id
      ORDER BY profile.is_active DESC, customer.name ASC`
  );
  const [prices] = await db.query(
    `SELECT price.id, price.price_list_id, price_list.name AS price_list_name,
            price.product_id, product.name AS product_name, price.customer_id,
            customer.name AS customer_name, price.regular_price_reference,
            price.wholesale_price, price.valid_from, price.valid_to, price.is_active,
            price.change_reason, price.created_by, price.updated_by,
            price.created_at, price.updated_at
       FROM wholesale_product_prices price
       INNER JOIN wholesale_price_lists price_list ON price_list.id = price.price_list_id
       INNER JOIN products product ON product.id = price.product_id
       LEFT JOIN customers customer ON customer.id = price.customer_id
      ORDER BY price.is_active DESC, product.name ASC, customer.name ASC, price.valid_from DESC`
  );

  return {
    code: 1,
    message: "configuración mayorista obtenida",
    data: { availableCustomers, availableProducts, priceLists, customers, prices },
  };
};

const listWholesaleHistory = async ({ entityType, entityId, limit = 200 } = {}) => {
  const db = await connect();
  const params = [];
  const filters = [];
  if (entityType) {
    filters.push("history.entity_type = ?");
    params.push(String(entityType));
  }
  if (entityId) {
    filters.push("history.entity_id = ?");
    params.push(asPositiveId(entityId, "entityId"));
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  params.push(safeLimit);
  const [items] = await db.query(
    `SELECT history.*, user.full_name AS changed_by_name
       FROM wholesale_configuration_history history
       INNER JOIN users user ON user.id = history.changed_by
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY history.created_at DESC, history.id DESC
      LIMIT ?`,
    params
  );
  return { code: 1, message: "historial mayorista obtenido", data: items };
};

const createWholesalePriceList = async (payload, actorUserId) => {
  const code = String(payload.code || "").trim().toUpperCase();
  const name = String(payload.name || "").trim();
  const reason = asReason(payload.reason);
  const actorId = asPositiveId(actorUserId, "actorUserId");
  if (!/^[A-Z0-9_-]{2,60}$/.test(code)) throw boom.badRequest("el código de la lista no es válido");
  if (name.length < 2 || name.length > 150) throw boom.badRequest("el nombre de la lista no es válido");

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO wholesale_price_lists
         (code, name, is_active, change_reason, created_by, updated_by)
       VALUES (?, ?, 1, ?, ?, ?)`,
      [code, name, reason, actorId, actorId]
    );
    const newValues = { id: result.insertId, code, name, is_active: 1 };
    await insertHistory(connection, {
      entityType: "price_list", entityId: result.insertId, actionType: "created",
      newValues, reason, actorUserId: actorId,
    });
    await connection.commit();
    return { code: 1, message: "lista mayorista creada", data: newValues };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const updateWholesalePriceList = async ({ priceListId, name, isActive, reason }, actorUserId) => {
  const id = asPositiveId(priceListId, "priceListId");
  const actorId = asPositiveId(actorUserId, "actorUserId");
  const normalizedName = String(name || "").trim();
  const normalizedReason = asReason(reason);
  if (normalizedName.length < 2 || normalizedName.length > 150) throw boom.badRequest("el nombre de la lista no es válido");
  const active = asBoolean(isActive, true) ? 1 : 0;
  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT * FROM wholesale_price_lists WHERE id = ? FOR UPDATE", [id]);
    if (!rows.length) throw boom.notFound("lista mayorista no encontrada");
    const previousValues = rows[0];
    await connection.query(
      `UPDATE wholesale_price_lists
          SET name = ?, is_active = ?, change_reason = ?, updated_by = ?
        WHERE id = ?`,
      [normalizedName, active, normalizedReason, actorId, id]
    );
    const newValues = { ...previousValues, name: normalizedName, is_active: active, change_reason: normalizedReason, updated_by: actorId };
    const actionType = Number(previousValues.is_active) === active ? "updated" : (active ? "activated" : "deactivated");
    await insertHistory(connection, {
      entityType: "price_list", entityId: id, actionType, previousValues, newValues,
      reason: normalizedReason, actorUserId: actorId,
    });
    await connection.commit();
    return { code: 1, message: "lista mayorista actualizada", data: newValues };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const setWholesaleCustomer = async ({ customerId, priceListId, validFrom, validTo, isActive, reason }, actorUserId) => {
  const customer = asPositiveId(customerId, "customerId");
  const list = asPositiveId(priceListId, "priceListId");
  const actorId = asPositiveId(actorUserId, "actorUserId");
  const from = asDate(validFrom, "validFrom");
  const to = asDate(validTo, "validTo", true);
  const active = asBoolean(isActive, true) ? 1 : 0;
  const normalizedReason = asReason(reason);
  assertDateRange(from, to);

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [customerRows] = await connection.query("SELECT id, status FROM customers WHERE id = ? FOR UPDATE", [customer]);
    if (!customerRows.length || customerRows[0].status !== "active") throw boom.badRequest("el cliente debe estar activo");
    const [listRows] = await connection.query("SELECT id, is_active FROM wholesale_price_lists WHERE id = ? FOR UPDATE", [list]);
    if (!listRows.length) throw boom.badRequest("la lista mayorista no existe");
    if (active && !Number(listRows[0].is_active)) throw boom.badRequest("la lista mayorista debe estar activa");
    const [existingRows] = await connection.query("SELECT * FROM customer_wholesale_profiles WHERE customer_id = ? FOR UPDATE", [customer]);
    const previousValues = existingRows[0] || null;

    if (previousValues) {
      await connection.query(
        `UPDATE customer_wholesale_profiles
            SET price_list_id = ?, valid_from = ?, valid_to = ?, is_active = ?,
                change_reason = ?, updated_by = ?
          WHERE id = ?`,
        [list, from, to, active, normalizedReason, actorId, previousValues.id]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO customer_wholesale_profiles
           (customer_id, price_list_id, valid_from, valid_to, is_active, change_reason, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [customer, list, from, to, active, normalizedReason, actorId, actorId]
      );
      existingRows.push({ id: result.insertId });
    }

    const entityId = previousValues?.id || existingRows[0].id;
    const newValues = { id: entityId, customer_id: customer, price_list_id: list, valid_from: from, valid_to: to, is_active: active };
    const actionType = previousValues
      ? (Number(previousValues.is_active) === active ? "updated" : (active ? "activated" : "deactivated"))
      : "created";
    await insertHistory(connection, {
      entityType: "customer_profile", entityId, actionType, previousValues, newValues,
      reason: normalizedReason, actorUserId: actorId,
    });
    await connection.commit();
    return { code: 1, message: "cliente mayorista actualizado", data: newValues };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const saveWholesalePrice = async (payload, actorUserId) => {
  const priceId = payload.priceId ? asPositiveId(payload.priceId, "priceId") : null;
  const priceListId = asPositiveId(payload.priceListId, "priceListId");
  const productId = asPositiveId(payload.productId, "productId");
  const customerId = payload.customerId ? asPositiveId(payload.customerId, "customerId") : null;
  const actorId = asPositiveId(actorUserId, "actorUserId");
  const wholesalePrice = Number(payload.wholesalePrice);
  if (!Number.isInteger(wholesalePrice) || wholesalePrice <= 0) {
    throw boom.badRequest("el precio mayorista debe ser mayor que 0 y no puede tener decimales");
  }
  const validFrom = asDate(payload.validFrom, "validFrom");
  const validTo = asDate(payload.validTo, "validTo", true);
  const active = asBoolean(payload.isActive, true) ? 1 : 0;
  const reason = asReason(payload.reason);
  assertDateRange(validFrom, validTo);

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [listRows] = await connection.query("SELECT id, is_active FROM wholesale_price_lists WHERE id = ? FOR UPDATE", [priceListId]);
    if (!listRows.length || !Number(listRows[0].is_active)) throw boom.badRequest("la lista mayorista debe estar activa");
    const [productRows] = await connection.query("SELECT id, base_price, is_active FROM products WHERE id = ? FOR UPDATE", [productId]);
    if (!productRows.length || !Number(productRows[0].is_active)) throw boom.badRequest("el producto debe estar activo");
    const regularPriceReference = Number(productRows[0].base_price);
    if (!Number.isFinite(regularPriceReference) || regularPriceReference <= 0) throw boom.badRequest("el producto debe tener precio regular mayor que 0");

    if (customerId) {
      const [profileRows] = await connection.query(
        `SELECT id FROM customer_wholesale_profiles
          WHERE customer_id = ? AND price_list_id = ? AND is_active = 1
          FOR UPDATE`,
        [customerId, priceListId]
      );
      if (!profileRows.length) throw boom.badRequest("el cliente debe estar activo en la lista mayorista seleccionada");
    }

    let previousValues = null;
    if (priceId) {
      const [priceRows] = await connection.query("SELECT * FROM wholesale_product_prices WHERE id = ? FOR UPDATE", [priceId]);
      if (!priceRows.length) throw boom.notFound("precio mayorista no encontrado");
      previousValues = priceRows[0];
    }

    if (active) {
      const [overlaps] = await connection.query(
        `SELECT id
           FROM wholesale_product_prices
          WHERE price_list_id = ?
            AND product_id = ?
            AND customer_scope_id = ?
            AND is_active = 1
            AND id <> COALESCE(?, 0)
            AND valid_from <= COALESCE(?, '9999-12-31')
            AND COALESCE(valid_to, '9999-12-31') >= ?
          FOR UPDATE`,
        [priceListId, productId, customerId || 0, priceId, validTo, validFrom]
      );
      if (overlaps.length) throw boom.conflict("ya existe un precio activo para el mismo producto, cliente y periodo");
    }

    let entityId = priceId;
    if (priceId) {
      await connection.query(
        `UPDATE wholesale_product_prices
            SET price_list_id = ?, product_id = ?, customer_id = ?,
                regular_price_reference = ?, wholesale_price = ?, valid_from = ?, valid_to = ?,
                is_active = ?, change_reason = ?, updated_by = ?
          WHERE id = ?`,
        [priceListId, productId, customerId, regularPriceReference, wholesalePrice, validFrom, validTo, active, reason, actorId, priceId]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO wholesale_product_prices
           (price_list_id, product_id, customer_id, regular_price_reference, wholesale_price,
            valid_from, valid_to, is_active, change_reason, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [priceListId, productId, customerId, regularPriceReference, wholesalePrice, validFrom, validTo, active, reason, actorId, actorId]
      );
      entityId = result.insertId;
    }

    const newValues = {
      id: entityId, price_list_id: priceListId, product_id: productId, customer_id: customerId,
      regular_price_reference: regularPriceReference, wholesale_price: wholesalePrice,
      valid_from: validFrom, valid_to: validTo, is_active: active,
    };
    const actionType = previousValues
      ? (Number(previousValues.is_active) === active ? "updated" : (active ? "activated" : "deactivated"))
      : "created";
    await insertHistory(connection, {
      entityType: "product_price", entityId, actionType, previousValues, newValues,
      reason, actorUserId: actorId,
    });
    await connection.commit();
    return { code: 1, message: "precio mayorista guardado", data: newValues };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const deactivateWholesalePrice = async ({ priceId, reason }, actorUserId) => {
  const id = asPositiveId(priceId, "priceId");
  const actorId = asPositiveId(actorUserId, "actorUserId");
  const normalizedReason = asReason(reason);
  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT * FROM wholesale_product_prices WHERE id = ? FOR UPDATE", [id]);
    if (!rows.length) throw boom.notFound("precio mayorista no encontrado");
    const previousValues = rows[0];
    const newValues = { ...previousValues, is_active: 0, change_reason: normalizedReason, updated_by: actorId };
    if (Number(previousValues.is_active)) {
      await connection.query(
        `UPDATE wholesale_product_prices
            SET is_active = 0, change_reason = ?, updated_by = ?
          WHERE id = ?`,
        [normalizedReason, actorId, id]
      );
      await insertHistory(connection, {
        entityType: "product_price", entityId: id, actionType: "deactivated",
        previousValues, newValues, reason: normalizedReason, actorUserId: actorId,
      });
    }
    await connection.commit();
    return { code: 1, message: "precio mayorista desactivado", data: newValues };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const normalizeDuplicateName = (value) => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\b(mayoristas?|mayoreo|wholesale)\b/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim();

const listWholesaleDuplicateProducts = async () => {
  const db = await connect();
  const [rows] = await db.query(
    `SELECT p.id, p.name, p.sku, p.category_id, category.name AS category_name,
            p.base_price, p.physical_product_id,
            physical.name AS configured_physical_product_name,
            COALESCE((SELECT SUM(stock.quantity_on_hand) FROM stock_products stock WHERE stock.product_id = p.id), 0) AS stock_actual,
            (SELECT COUNT(*) FROM inventory_movements movement WHERE movement.product_id = p.id) AS movement_count,
            (SELECT COUNT(*) FROM order_items item WHERE item.product_id = p.id) AS sales_count,
            (SELECT COUNT(*) FROM sales_return_items return_item
              WHERE return_item.returned_product_id = p.id OR return_item.replacement_product_id = p.id) AS return_count,
            (SELECT COUNT(*) FROM production_batch_outputs output WHERE output.product_id = p.id) AS production_count,
            (SELECT COUNT(*) FROM packing_report_items packing WHERE packing.product_id = p.id) AS packing_count,
            (SELECT GROUP_CONCAT(DISTINCT CONCAT('Receta #', recipe.id, ' v', recipe.version_no) ORDER BY recipe.id SEPARATOR ', ')
               FROM recipes recipe
               LEFT JOIN recipe_outputs recipe_output ON recipe_output.recipe_id = recipe.id
              WHERE recipe.product_id = p.id OR recipe_output.product_id = p.id) AS recipes
       FROM products p
       INNER JOIN product_categories category ON category.id = p.category_id
       LEFT JOIN products physical ON physical.id = p.physical_product_id
      WHERE p.deleted_at IS NULL
      ORDER BY category.name, p.name, p.id`
  );
  const candidates = rows.filter((row) => /mayor|mayoreo|wholesale/i.test(`${row.name} ${row.sku} ${row.category_name}`));
  const [branches] = await db.query("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY name");
  const items = candidates.map((candidate) => {
    const normalized = normalizeDuplicateName(candidate.name);
    const possible = rows
      .filter((product) => Number(product.id) !== Number(candidate.id)
        && !/mayor|mayoreo|wholesale/i.test(`${product.name} ${product.sku} ${product.category_name}`))
      .map((product) => ({
        ...product,
        score: (normalizeDuplicateName(product.name) === normalized ? 100 : 0)
          + (Number(product.category_id) === Number(candidate.category_id) ? 20 : 0),
      }))
      .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)))[0];
    return { ...candidate, possible_physical_product: possible?.score > 20 ? possible : null };
  });
  return {
    code: 1,
    message: "reporte de posibles productos mayoristas duplicados",
    data: { items, products: rows.filter((product) => !product.physical_product_id), branches },
  };
};

const approveWholesaleProductEquivalence = async (payload, actorUserId) => {
  const commercialProductId = asPositiveId(payload.commercialProductId, "commercialProductId");
  const physicalProductId = asPositiveId(payload.physicalProductId, "physicalProductId");
  const branchId = asPositiveId(payload.branchId, "branchId");
  const actorId = asPositiveId(actorUserId, "actorUserId");
  const confirmedStock = Number(payload.confirmedPhysicalStock);
  const reason = asReason(payload.reason);
  if (commercialProductId === physicalProductId) throw boom.badRequest("la variante y el producto físico deben ser diferentes");
  if (!Number.isInteger(confirmedStock) || confirmedStock < 0) throw boom.badRequest("el stock físico confirmado debe ser un entero igual o mayor que cero");

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [products] = await connection.query(
      `SELECT id, name, sku, unit, physical_product_id
         FROM products
        WHERE id IN (?, ?) AND is_active = 1 AND deleted_at IS NULL
        ORDER BY id FOR UPDATE`,
      [commercialProductId, physicalProductId]
    );
    const commercial = products.find((item) => Number(item.id) === commercialProductId);
    const physical = products.find((item) => Number(item.id) === physicalProductId);
    if (!commercial || !physical) throw boom.badRequest("los productos deben existir y estar activos");
    if (physical.physical_product_id) throw boom.badRequest("el producto físico seleccionado no puede ser otra variante");
    if (commercial.unit !== "unit" || physical.unit !== "unit") throw boom.badRequest("ambos productos deben manejarse en unidades");

    await connection.query(
      `INSERT IGNORE INTO stock_products (branch_id, product_id, quantity_on_hand, min_stock)
       VALUES (?, ?, 0, 0), (?, ?, 0, 0)`,
      [branchId, commercialProductId, branchId, physicalProductId]
    );
    const [stocks] = await connection.query(
      `SELECT product_id, quantity_on_hand FROM stock_products
        WHERE branch_id = ? AND product_id IN (?, ?) ORDER BY product_id FOR UPDATE`,
      [branchId, commercialProductId, physicalProductId]
    );
    const commercialStock = Number(stocks.find((item) => Number(item.product_id) === commercialProductId)?.quantity_on_hand || 0);
    const physicalStock = Number(stocks.find((item) => Number(item.product_id) === physicalProductId)?.quantity_on_hand || 0);
    const delta = confirmedStock - physicalStock;
    const before = { commercial, physical, branch_id: branchId, commercial_stock: commercialStock, physical_stock: physicalStock };
    const after = { commercial_product_id: commercialProductId, physical_product_id: physicalProductId, branch_id: branchId, confirmed_physical_stock: confirmedStock };
    const [insert] = await connection.query(
      `INSERT INTO physical_product_reconciliations
         (commercial_product_id, physical_product_id, branch_id, previous_physical_product_id,
          commercial_stock_before, physical_stock_before, confirmed_physical_stock, inventory_delta,
          backup_before_json, result_after_json, reason, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [commercialProductId, physicalProductId, branchId, commercial.physical_product_id || null,
        commercialStock, physicalStock, confirmedStock, delta, JSON.stringify(before), JSON.stringify(after), reason, actorId]
    );
    const reconciliationId = Number(insert.insertId);
    await connection.query("UPDATE products SET physical_product_id = ? WHERE id = ?", [physicalProductId, commercialProductId]);
    if (delta !== 0) {
      await connection.query(
        `UPDATE stock_products SET quantity_on_hand = ?, updated_at = CURRENT_TIMESTAMP
          WHERE branch_id = ? AND product_id = ?`,
        [confirmedStock, branchId, physicalProductId]
      );
      await connection.query(
        `INSERT INTO inventory_movements
          (branch_id, item_type, raw_material_id, product_id, movement_type, quantity, unit_cost,
           reference_type, reference_id, notes, created_by)
         VALUES (?, 'product', NULL, ?, ?, ?, NULL, 'physical_product_reconciliation', ?, ?, ?)`,
        [branchId, physicalProductId, delta > 0 ? "adjustment_in" : "adjustment_out", Math.abs(delta),
          reconciliationId, reason || `Conciliación física de ${commercial.name}`, actorId]
      );
    }
    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'wholesale.physical_product.reconcile', 'physical_product_reconciliations', ?, ?)`,
      [actorId, String(reconciliationId), JSON.stringify({ before, after, inventory_delta: delta })]
    );
    await connection.commit();
    return { code: 1, message: "equivalencia aprobada y stock físico conciliado", data: { reconciliation_id: reconciliationId, before, after, inventory_delta: delta } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  createWholesalePriceList,
  deactivateWholesalePrice,
  listWholesaleConfiguration,
  listWholesaleHistory,
  saveWholesalePrice,
  setWholesaleCustomer,
  updateWholesalePriceList,
  listWholesaleDuplicateProducts,
  approveWholesaleProductEquivalence,
};
