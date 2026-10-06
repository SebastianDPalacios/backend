const { callProcedure, connect } = require("../data-access");
const { mapSpResult } = require("./sp-response");
const {
  FINISHED_PRODUCT_UNIT,
  validateFinishedProductUnit,
  isWholeFinishedProductQuantity,
} = require("../domain/finished-product-rules");

const getRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
};

const withRows = (payload, rows) => {
  if (Array.isArray(payload)) return rows;
  if (Array.isArray(payload?.items)) return { ...payload, items: rows };
  if (Array.isArray(payload?.rows)) return { ...payload, rows };
  return payload;
};

const normalizePurchasePackage = (payload) => {
  const name = String(payload.p_purchase_package_name || payload.purchase_package_name || "").trim();
  const quantity = Number(payload.p_purchase_package_quantity ?? payload.purchase_package_quantity ?? 0);

  return {
    name: name || null,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
  };
};

const saveRawMaterialPurchasePackage = async (rawMaterialId, payload) => {
  const packageData = normalizePurchasePackage(payload);
  const db = await connect();

  await db.query(
    "UPDATE raw_materials SET purchase_package_name = ?, purchase_package_quantity = ? WHERE id = ?",
    [packageData.name, packageData.quantity, rawMaterialId]
  );
};

const normalizeInventoryUsageType = (payload) => {
  const value = String(payload.p_inventory_usage_type || payload.inventory_usage_type || "").trim();
  return value === "packaging" ? "packaging" : "production";
};

const saveRawMaterialInventoryUsage = async (rawMaterialId, payload) => {
  const db = await connect();
  await db.query(
    "UPDATE raw_materials SET inventory_usage_type = ? WHERE id = ?",
    [normalizeInventoryUsageType(payload), rawMaterialId]
  );
};

const normalizeInventoryValuation = (payload) => {
  const value = payload.p_is_inventory_valued ?? payload.is_inventory_valued;
  return value === false || value === 0 || value === "0" ? 0 : 1;
};

const saveRawMaterialInventoryValuation = async (rawMaterialId, payload) => {
  const db = await connect();
  await db.query(
    "UPDATE raw_materials SET is_inventory_valued = ? WHERE id = ?",
    [normalizeInventoryValuation(payload), rawMaterialId]
  );
};

const savePhysicalProductRelation = async (productId, requestedPhysicalProductId) => {
  const db = await connect();
  const physicalProductId = requestedPhysicalProductId ? Number(requestedPhysicalProductId) : null;
  if (!physicalProductId) {
    await db.query("UPDATE products SET physical_product_id = NULL WHERE id = ?", [Number(productId)]);
    return;
  }
  if (Number(productId) === physicalProductId) {
    throw new Error("un producto no puede ser variante de sí mismo");
  }
  const [targets] = await db.query(
    `SELECT id
       FROM products
      WHERE id = ? AND physical_product_id IS NULL AND is_active = 1 AND deleted_at IS NULL AND unit = ?
      LIMIT 1`,
    [physicalProductId, FINISHED_PRODUCT_UNIT]
  );
  if (!targets.length) throw new Error("selecciona un producto físico principal activo");
  await db.query("UPDATE products SET physical_product_id = ? WHERE id = ?", [physicalProductId, Number(productId)]);
};

const validatePhysicalProductRelation = async (productId, requestedPhysicalProductId) => {
  const physicalProductId = requestedPhysicalProductId ? Number(requestedPhysicalProductId) : null;
  if (!physicalProductId) return null;
  if (Number(productId || 0) === physicalProductId) return "un producto no puede ser variante de sí mismo";
  const db = await connect();
  const [targets] = await db.query(
    `SELECT id FROM products
      WHERE id = ? AND physical_product_id IS NULL AND is_active = 1 AND deleted_at IS NULL AND unit = ?
      LIMIT 1`,
    [physicalProductId, FINISHED_PRODUCT_UNIT]
  );
  return targets.length ? null : "selecciona un producto físico principal activo";
};

const validateActiveProductCategory = async (categoryId) => {
  const db = await connect();
  const [rows] = await db.query(
    `SELECT id FROM product_categories
      WHERE id = ? AND is_active = 1 AND deleted_at IS NULL
      LIMIT 1`,
    [Number(categoryId || 0)]
  );
  return rows.length > 0;
};

const enrichRawMaterialPackages = async (payload) => {
  const rows = getRows(payload);
  const ids = rows.map((row) => Number(row.id || 0)).filter((id) => id > 0);

  if (!ids.length) {
    return payload;
  }

  const placeholders = ids.map(() => "?").join(",");
  const db = await connect();
  const [packageRows] = await db.query(
    `SELECT id, purchase_package_name, purchase_package_quantity, inventory_usage_type,
            COALESCE(is_inventory_valued, 1) AS is_inventory_valued
       FROM raw_materials
      WHERE id IN (${placeholders})`,
    ids
  );
  const packageById = new Map(packageRows.map((row) => [Number(row.id), row]));

  return withRows(
    payload,
    rows.map((row) => ({
      ...row,
      purchase_package_name: packageById.get(Number(row.id))?.purchase_package_name || null,
      purchase_package_quantity: packageById.get(Number(row.id))?.purchase_package_quantity || null,
      inventory_usage_type: packageById.get(Number(row.id))?.inventory_usage_type || "production",
      is_inventory_valued: Number(packageById.get(Number(row.id))?.is_inventory_valued ?? 1),
    }))
  );
};

const listBranches = async ({ onlyActive }) => {
  const out = await callProcedure("sp_branch_list", [Number(onlyActive || 0)]);
  return mapSpResult(out);
};

const listCustomers = async ({ status, search, page, pageSize }) => {
  const out = await callProcedure("sp_customer_list", [
    status || null,
    search || null,
    Number(page || 1),
    Number(pageSize || 20),
  ]);
  return mapSpResult(out);
};

const listRoutes = async ({ onlyActive, refDate }) => {
  const out = await callProcedure("sp_route_list", [
    Number(onlyActive || 0),
    refDate || null,
  ]);
  return mapSpResult(out);
};

const listProducts = async ({ onlyActive, categoryId, search, page, pageSize }) => {
  const out = await callProcedure("sp_product_list", [
    Number(onlyActive || 0),
    categoryId ? Number(categoryId) : null,
    search || null,
    Number(page || 1),
    Number(pageSize || 20),
  ]);
  const result = mapSpResult(out);
  if (result.code === 1 && Array.isArray(result.data?.items) && result.data.items.length) {
    const db = await connect();
    const ids = result.data.items.map((item) => Number(item.id)).filter(Boolean);
    const [rows] = await db.query(
      `SELECT p.id, p.includes_bonus, p.physical_product_id, physical.name AS physical_product_name
         FROM products p
         LEFT JOIN products physical ON physical.id = p.physical_product_id
        WHERE p.id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    const flags = new Map(rows.map((row) => [Number(row.id), row]));
    result.data.items = result.data.items.map((item) => ({
      ...item,
      unit: FINISHED_PRODUCT_UNIT,
      includes_bonus: Number(flags.get(Number(item.id))?.includes_bonus || 0),
      physical_product_id: flags.get(Number(item.id))?.physical_product_id || null,
      physical_product_name: flags.get(Number(item.id))?.physical_product_name || item.name,
      is_commercial_variant: Boolean(flags.get(Number(item.id))?.physical_product_id),
    }));
  }
  return result;
};

const listRawMaterials = async ({ onlyActive, categoryId, search, page, pageSize }) => {
  const out = await callProcedure("sp_raw_material_list", [
    Number(onlyActive || 0),
    categoryId ? Number(categoryId) : null,
    search || null,
    Number(page || 1),
    Number(pageSize || 20),
  ]);
  const result = mapSpResult(out);

  if (result.code !== 1) {
    return result;
  }

  return {
    ...result,
    data: await enrichRawMaterialPackages(result.data),
  };
};

const listTaxRates = async ({ onlyActive }) => {
  const out = await callProcedure("sp_tax_rate_list", [Number(onlyActive || 0)]);
  return mapSpResult(out);
};

const listProductCategories = async ({ onlyActive }) => {
  const out = await callProcedure("sp_product_category_list", [Number(onlyActive || 0)]);
  const result = mapSpResult(out);
  if (result.code !== 1) return result;

  const rows = getRows(result.data);
  if (!rows.length) return result;
  const db = await connect();
  const [deletedRows] = await db.query(
    `SELECT id FROM product_categories
      WHERE deleted_at IS NOT NULL AND id IN (${rows.map(() => "?").join(",")})`,
    rows.map((row) => Number(row.id))
  );
  const deletedIds = new Set(deletedRows.map((row) => Number(row.id)));
  const visibleRows = rows.filter((row) => !deletedIds.has(Number(row.id)));
  return { ...result, data: withRows(result.data, visibleRows) };
};

const listRawMaterialCategories = async ({ onlyActive }) => {
  const out = await callProcedure("sp_raw_material_category_list", [Number(onlyActive || 0)]);
  return mapSpResult(out);
};

const listSuppliers = async ({ status, search, page, pageSize }) => {
  const out = await callProcedure("sp_supplier_list", [
    status || null,
    search || null,
    Number(page || 1),
    Number(pageSize || 20),
  ]);
  return mapSpResult(out);
};

const createBranch = async (payload, actorUserId) => {
  const code = String(payload.p_code || "").trim().toUpperCase();
  const name = String(payload.p_name || "").trim();
  const address = String(payload.p_address || "").trim();
  const phone = String(payload.p_phone || "").trim();
  if (!/^[A-Z0-9_-]{2,30}$/.test(code)) {
    return { code: 0, message: "El código debe tener entre 2 y 30 caracteres y usar solo letras, números, guion o guion bajo", data: null };
  }
  if (name.length < 2 || name.length > 120) {
    return { code: 0, message: "El nombre debe tener entre 2 y 120 caracteres", data: null };
  }
  if (address.length > 255 || phone.length > 30) {
    return { code: 0, message: "La dirección o el teléfono superan la longitud permitida", data: null };
  }
  const out = await callProcedure("sp_branch_create", [
    code,
    name,
    address || null,
    phone || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateBranch = async (payload, actorUserId) => {
  const branchId = Number(payload.p_branch_id || 0);
  const name = String(payload.p_name || "").trim();
  const address = String(payload.p_address || "").trim();
  const phone = String(payload.p_phone || "").trim();
  if (!Number.isInteger(branchId) || branchId <= 0) {
    return { code: 0, message: "Sucursal inválida", data: null };
  }
  if (name.length < 2 || name.length > 120) {
    return { code: 0, message: "El nombre debe tener entre 2 y 120 caracteres", data: null };
  }
  if (address.length > 255 || phone.length > 30) {
    return { code: 0, message: "La dirección o el teléfono superan la longitud permitida", data: null };
  }
  const out = await callProcedure("sp_branch_update", [
    branchId,
    name,
    address || null,
    phone || null,
    payload.p_is_active ?? null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createTaxRate = async (payload, actorUserId) => {
  const out = await callProcedure("sp_tax_rate_create", [
    payload.p_code || null,
    payload.p_name || null,
    payload.p_rate_percent || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateTaxRate = async (payload, actorUserId) => {
  const out = await callProcedure("sp_tax_rate_update", [
    payload.p_tax_rate_id,
    payload.p_name || null,
    payload.p_rate_percent || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createProductCategory = async (payload, actorUserId) => {
  const out = await callProcedure("sp_product_category_create", [
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateProductCategory = async (payload, actorUserId) => {
  const out = await callProcedure("sp_product_category_update", [
    payload.p_category_id,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createRawMaterialCategory = async (payload, actorUserId) => {
  const out = await callProcedure("sp_raw_material_category_create", [
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateRawMaterialCategory = async (payload, actorUserId) => {
  const out = await callProcedure("sp_raw_material_category_update", [
    payload.p_category_id,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createSupplier = async (payload, actorUserId) => {
  const out = await callProcedure("sp_supplier_create", [
    payload.p_tax_id || null,
    payload.p_name || null,
    payload.p_email || null,
    payload.p_phone || null,
    payload.p_address || null,
    payload.p_contact_name || null,
    payload.p_status || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateSupplier = async (payload, actorUserId) => {
  const out = await callProcedure("sp_supplier_update", [
    payload.p_supplier_id,
    payload.p_tax_id || null,
    payload.p_name || null,
    payload.p_email || null,
    payload.p_phone || null,
    payload.p_address || null,
    payload.p_contact_name || null,
    payload.p_status || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createProduct = async (payload, actorUserId) => {
  const unitValidation = validateFinishedProductUnit(payload.p_unit);
  if (!unitValidation.valid) {
    return { code: 0, message: "Los productos terminados solo pueden manejarse en Unidades.", data: null };
  }
  if (!isWholeFinishedProductQuantity(payload.p_min_stock ?? 0, { allowZero: true })) {
    return { code: 0, message: "El stock minimo del producto debe ser una cantidad entera.", data: null };
  }
  if (!await validateActiveProductCategory(payload.p_category_id)) {
    return { code: 0, message: "Selecciona una categoría activa.", data: null };
  }
  if (payload.p_units_per_bag !== null && payload.p_units_per_bag !== undefined
    && payload.p_units_per_bag !== "" && !isWholeFinishedProductQuantity(payload.p_units_per_bag)) {
    return { code: 0, message: "Las unidades por bulto deben ser una cantidad entera mayor a cero.", data: null };
  }
  const physicalRelationError = await validatePhysicalProductRelation(null, payload.p_physical_product_id);
  if (physicalRelationError) return { code: 0, message: physicalRelationError, data: null };
  let out;
  try {
    const db = await connect();
    const sku = String(payload.p_sku || "").trim();
    const name = String(payload.p_name || "").trim();
    const [duplicates] = await db.query(
      `SELECT sku, name
         FROM products
        WHERE (? <> '' AND sku = ?)
           OR LOWER(name) = LOWER(?)
        LIMIT 1`,
      [sku, sku, name]
    );

    if (duplicates.length) {
      const sameSku = sku && String(duplicates[0].sku || "").toLowerCase() === sku.toLowerCase();
      return {
        code: 0,
        message: sameSku
          ? "Ya existe un producto con ese SKU. Escribe un identificador diferente."
          : "Ya existe un producto con ese nombre. Escribe un nombre diferente.",
        data: null,
      };
    }

    out = await callProcedure("sp_product_create", [
      payload.p_sku || null,
      payload.p_name || null,
      payload.p_description || null,
      payload.p_category_id || null,
      payload.p_tax_rate_id || null,
      FINISHED_PRODUCT_UNIT,
      payload.p_base_price ?? null,
      payload.p_min_stock ?? null,
      payload.p_units_per_bag ?? null,
      payload.p_is_active || null,
      actorUserId || null,
    ]);
  } catch (error) {
    const databaseMessage = String(error?.sqlMessage || error?.message || "");
    if (error?.code === "ER_DUP_ENTRY") {
      const isSkuConflict = /(sku|uq_.*sku)/i.test(databaseMessage);
      return {
        code: 0,
        message: isSkuConflict
          ? "Ya existe un producto con ese SKU. Escribe un identificador diferente."
          : "Ya existe un producto con esos datos. Revisa el SKU y el nombre.",
        data: null,
      };
    }
    if (error?.code === "ER_NO_REFERENCED_ROW_2") {
      return {
        code: 0,
        message: "La categoría o la tasa de impuesto seleccionada ya no está disponible. Vuelve a seleccionarla.",
        data: null,
      };
    }
    if (error?.code === "ER_SIGNAL_EXCEPTION" && databaseMessage) {
      return { code: 0, message: databaseMessage, data: null };
    }
    throw error;
  }
  const result = mapSpResult(out);
  if (result.code === 1 && result.data?.product_id) {
    const db = await connect();
    await db.query("UPDATE products SET includes_bonus = ? WHERE id = ?", [Number(payload.p_includes_bonus || 0), Number(result.data.product_id)]);
    await savePhysicalProductRelation(Number(result.data.product_id), payload.p_physical_product_id);
  }
  return result;
};

const updateProduct = async (payload, actorUserId) => {
  const unitValidation = validateFinishedProductUnit(payload.p_unit);
  if (!unitValidation.valid) {
    return { code: 0, message: "Los productos terminados solo pueden manejarse en Unidades.", data: null };
  }
  if (!isWholeFinishedProductQuantity(payload.p_min_stock ?? 0, { allowZero: true })) {
    return { code: 0, message: "El stock minimo del producto debe ser una cantidad entera.", data: null };
  }
  if (!await validateActiveProductCategory(payload.p_category_id)) {
    return { code: 0, message: "Selecciona una categoría activa.", data: null };
  }
  if (payload.p_units_per_bag !== null && payload.p_units_per_bag !== undefined
    && payload.p_units_per_bag !== "" && !isWholeFinishedProductQuantity(payload.p_units_per_bag)) {
    return { code: 0, message: "Las unidades por bulto deben ser una cantidad entera mayor a cero.", data: null };
  }
  const physicalRelationError = await validatePhysicalProductRelation(payload.p_product_id, payload.p_physical_product_id);
  if (physicalRelationError) return { code: 0, message: physicalRelationError, data: null };
  const out = await callProcedure("sp_product_update", [
    payload.p_product_id,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_category_id || null,
    payload.p_tax_rate_id || null,
    FINISHED_PRODUCT_UNIT,
    payload.p_base_price ?? null,
    payload.p_min_stock ?? null,
    payload.p_units_per_bag ?? null,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  const result = mapSpResult(out);
  if (result.code === 1) {
    const db = await connect();
    await db.query("UPDATE products SET includes_bonus = ? WHERE id = ?", [Number(payload.p_includes_bonus || 0), Number(payload.p_product_id)]);
    await savePhysicalProductRelation(Number(payload.p_product_id), payload.p_physical_product_id);
  }
  return result;
};

const updateProductYield = async (payload, actorUserId) => {
  if (!isWholeFinishedProductQuantity(payload.p_units_per_bag)) {
    return { code: 0, message: "Las unidades por bulto deben ser una cantidad entera mayor a cero.", data: null };
  }
  const out = await callProcedure("sp_product_yield_update", [
    payload.p_product_id,
    payload.p_units_per_bag ?? null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const setProductStatus = async (payload, actorUserId) => {
  const out = await callProcedure("sp_product_set_status", [
    payload.p_product_id,
    payload.p_is_active || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const deleteProduct = async (payload, actorUserId) => {
  const productId = Number(payload.p_product_id || 0);
  const reason = String(payload.p_reason || "").trim() || null;
  if (!productId) return { code: 0, message: "selecciona un producto", data: null };

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [products] = await connection.query(
      `SELECT id, name, sku, physical_product_id, is_active, deleted_at
         FROM products WHERE id = ? FOR UPDATE`,
      [productId]
    );
    if (!products.length || products[0].deleted_at) {
      await connection.rollback();
      return { code: 0, message: "producto no encontrado o ya eliminado", data: null };
    }
    const [variants] = await connection.query(
      `SELECT COUNT(*) AS total FROM products
        WHERE physical_product_id = ? AND deleted_at IS NULL`,
      [productId]
    );
    if (Number(variants[0]?.total || 0) > 0) {
      await connection.rollback();
      return { code: 0, message: "no puedes eliminar el producto físico mientras tenga variantes comerciales asociadas", data: null };
    }

    await connection.query(
      `UPDATE products
          SET is_active = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [productId]
    );
    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'product.delete', 'products', ?, JSON_OBJECT('reason', ?, 'name', ?, 'sku', ?))`,
      [actorUserId || null, String(productId), reason, products[0].name, products[0].sku]
    );
    await connection.commit();
    return { code: 1, message: "producto eliminado sin afectar sus registros históricos", data: { product_id: productId } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const deleteProductCategory = async (payload, actorUserId) => {
  const categoryId = Number(payload.p_category_id || 0);
  const reason = String(payload.p_reason || "").trim() || null;
  if (!categoryId) return { code: 0, message: "selecciona una categoría", data: null };

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [categories] = await connection.query(
      `SELECT id, name, deleted_at FROM product_categories WHERE id = ? FOR UPDATE`,
      [categoryId]
    );
    if (!categories.length || categories[0].deleted_at) {
      await connection.rollback();
      return { code: 0, message: "categoría no encontrada o ya eliminada", data: null };
    }
    const [products] = await connection.query(
      `SELECT COUNT(*) AS total FROM products
        WHERE category_id = ? AND deleted_at IS NULL`,
      [categoryId]
    );
    if (Number(products[0]?.total || 0) > 0) {
      await connection.rollback();
      return { code: 0, message: "reasigna o elimina los productos de esta categoría antes de eliminarla", data: null };
    }

    await connection.query(
      `UPDATE product_categories
          SET is_active = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [categoryId]
    );
    await connection.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'product_category.delete', 'product_categories', ?, JSON_OBJECT('reason', ?, 'name', ?))`,
      [actorUserId || null, String(categoryId), reason, categories[0].name]
    );
    await connection.commit();
    return { code: 1, message: "categoría eliminada sin afectar sus registros históricos", data: { category_id: categoryId } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const createRawMaterial = async (payload, actorUserId) => {
  const shouldAutoGenerateSku = !payload.p_sku;
  const temporarySku = shouldAutoGenerateSku ? `RM-TMP-${Date.now()}-${Math.floor(Math.random() * 1000)}` : payload.p_sku;

  const out = await callProcedure("sp_raw_material_create", [
    temporarySku,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_category_id || null,
    payload.p_supplier_id || null,
    payload.p_unit || null,
    payload.p_unit_cost ?? null,
    payload.p_min_stock ?? null,
    payload.p_is_active ?? null,
    actorUserId || null,
  ]);
  const result = mapSpResult(out);

  if (!shouldAutoGenerateSku || result.code !== 1 || !result.data?.raw_material_id) {
    if (result.code === 1 && result.data?.raw_material_id) {
      await saveRawMaterialPurchasePackage(Number(result.data.raw_material_id), payload);
      await saveRawMaterialInventoryUsage(Number(result.data.raw_material_id), payload);
      await saveRawMaterialInventoryValuation(Number(result.data.raw_material_id), payload);
    }
    return result;
  }

  const rawMaterialId = Number(result.data.raw_material_id);
  const sku = `RM-${String(rawMaterialId).padStart(6, "0")}`;
  const db = await connect();
  await db.query("UPDATE raw_materials SET sku = ? WHERE id = ?", [sku, rawMaterialId]);
  await saveRawMaterialPurchasePackage(rawMaterialId, payload);
  await saveRawMaterialInventoryUsage(rawMaterialId, payload);
  await saveRawMaterialInventoryValuation(rawMaterialId, payload);

  return {
    ...result,
    data: {
      ...result.data,
      sku,
    },
  };
};

const updateRawMaterial = async (payload, actorUserId) => {
  const out = await callProcedure("sp_raw_material_update", [
    payload.p_raw_material_id,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_category_id || null,
    payload.p_supplier_id || null,
    payload.p_unit || null,
    payload.p_unit_cost ?? null,
    payload.p_min_stock ?? null,
    payload.p_is_active ?? null,
    actorUserId || null,
  ]);
  const result = mapSpResult(out);

  if (result.code === 1) {
    await saveRawMaterialPurchasePackage(Number(payload.p_raw_material_id), payload);
    await saveRawMaterialInventoryUsage(Number(payload.p_raw_material_id), payload);
    await saveRawMaterialInventoryValuation(Number(payload.p_raw_material_id), payload);
  }

  return result;
};

const setRawMaterialStatus = async (payload, actorUserId) => {
  const out = await callProcedure("sp_raw_material_set_status", [
    payload.p_raw_material_id,
    payload.p_is_active ?? null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

module.exports = {
  listBranches,
  listCustomers,
  listRoutes,
  listProducts,
  listRawMaterials,
  listTaxRates,
  listProductCategories,
  listRawMaterialCategories,
  listSuppliers,
  createBranch,
  updateBranch,
  createTaxRate,
  updateTaxRate,
  createProductCategory,
  updateProductCategory,
  createRawMaterialCategory,
  updateRawMaterialCategory,
  createSupplier,
  updateSupplier,
  createProduct,
  updateProduct,
  updateProductYield,
  setProductStatus,
  deleteProduct,
  deleteProductCategory,
  createRawMaterial,
  updateRawMaterial,
  setRawMaterialStatus,
};
