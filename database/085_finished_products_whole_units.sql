-- Bloque 8: los productos terminados se controlan exclusivamente en unidades enteras.
-- No modifica materias primas ni recetas.

CREATE TABLE IF NOT EXISTS product_unit_normalization_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  previous_unit VARCHAR(20) NULL,
  corrected_unit VARCHAR(20) NOT NULL DEFAULT 'unit',
  migration_key VARCHAR(80) NOT NULL,
  corrected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_unit_audit_migration (product_id, migration_key),
  KEY idx_product_unit_audit_product (product_id),
  CONSTRAINT fk_product_unit_audit_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Auditoria persistente de Tostado dulce y de cualquier otro producto mal configurado.
INSERT IGNORE INTO product_unit_normalization_audit (
  product_id, product_name, previous_unit, corrected_unit, migration_key
)
SELECT id, name, unit, 'unit', '085_finished_products_whole_units'
FROM products
WHERE id > 0 AND (unit IS NULL OR unit <> 'unit');

-- Normalizacion general; incluye Tostado dulce si estaba en gramos u otra unidad.
UPDATE products
SET unit = 'unit', updated_at = CURRENT_TIMESTAMP
WHERE id > 0 AND (unit IS NULL OR unit <> 'unit');

-- La base de datos tambien impide volver a guardar otra unidad en productos terminados.
ALTER TABLE products
  MODIFY COLUMN unit ENUM('unit') NOT NULL DEFAULT 'unit';

-- Resultados de auditoria para verificacion manual posterior a la migracion.
SELECT product_id, product_name, previous_unit, corrected_unit, corrected_at
FROM product_unit_normalization_audit
WHERE migration_key = '085_finished_products_whole_units'
ORDER BY product_name, product_id;

SELECT id, sku, name, unit
FROM products
WHERE LOWER(name) LIKE '%tostado dulce%'
   OR unit <> 'unit'
ORDER BY name, id;
