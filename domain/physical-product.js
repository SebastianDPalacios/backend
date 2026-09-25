const normalizeProductId = (value) => {
  const id = Number(value || 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error("producto inválido");
  return id;
};

const resolvePhysicalProduct = async (connection, productId, { lock = false } = {}) => {
  const commercialProductId = normalizeProductId(productId);
  const [rows] = await connection.query(
    `SELECT commercial.id AS commercial_product_id,
            COALESCE(commercial.physical_product_id, commercial.id) AS physical_product_id,
            physical.name AS physical_product_name,
            physical.unit AS physical_product_unit,
            physical.is_active AS physical_product_active,
            physical.deleted_at AS physical_product_deleted_at
       FROM products commercial
       INNER JOIN products physical
         ON physical.id = COALESCE(commercial.physical_product_id, commercial.id)
      WHERE commercial.id = ?
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [commercialProductId]
  );
  if (!rows.length) throw new Error("producto físico principal no encontrado");
  const row = rows[0];
  if (row.physical_product_deleted_at || Number(row.physical_product_active) !== 1) {
    throw new Error("el producto físico principal está inactivo");
  }
  return Object.freeze({
    commercialProductId,
    physicalProductId: Number(row.physical_product_id),
    physicalProductName: row.physical_product_name,
    unit: row.physical_product_unit,
    isVariant: commercialProductId !== Number(row.physical_product_id),
  });
};

module.exports = { normalizeProductId, resolvePhysicalProduct };

