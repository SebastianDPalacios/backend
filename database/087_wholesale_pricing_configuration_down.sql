-- Reversión estructural del Bloque 15.
-- Ejecutar solo sobre una copia respaldada y después de exportar el historial.

DROP TABLE IF EXISTS wholesale_configuration_history;
DROP TABLE IF EXISTS wholesale_product_prices;
DROP TABLE IF EXISTS customer_wholesale_profiles;
DROP TABLE IF EXISTS wholesale_price_lists;
