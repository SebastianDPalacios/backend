-- Bloque 15: configuración comercial de Mayoristas.
-- No modifica productos, inventarios, pedidos ni movimientos históricos.

CREATE TABLE IF NOT EXISTS wholesale_price_lists (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(150) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  change_reason VARCHAR(500) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wholesale_price_lists_code (code),
  KEY idx_wholesale_price_lists_active (is_active, name),
  CONSTRAINT fk_wholesale_price_lists_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_wholesale_price_lists_updated_by FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT chk_wholesale_price_lists_active CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_wholesale_price_lists_reason CHECK (CHAR_LENGTH(TRIM(change_reason)) >= 5)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_wholesale_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  price_list_id BIGINT UNSIGNED NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  change_reason VARCHAR(500) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_wholesale_profiles_customer (customer_id),
  KEY idx_customer_wholesale_profiles_list (price_list_id, is_active),
  KEY idx_customer_wholesale_profiles_validity (is_active, valid_from, valid_to),
  CONSTRAINT fk_customer_wholesale_profiles_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_customer_wholesale_profiles_list FOREIGN KEY (price_list_id) REFERENCES wholesale_price_lists (id),
  CONSTRAINT fk_customer_wholesale_profiles_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_customer_wholesale_profiles_updated_by FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT chk_customer_wholesale_profiles_active CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_customer_wholesale_profiles_dates CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT chk_customer_wholesale_profiles_reason CHECK (CHAR_LENGTH(TRIM(change_reason)) >= 5)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wholesale_product_prices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  price_list_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  customer_scope_id BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(customer_id, 0)) STORED,
  regular_price_reference DECIMAL(14,2) NOT NULL,
  wholesale_price DECIMAL(14,2) NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  change_reason VARCHAR(500) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wholesale_product_prices_start (price_list_id, product_id, customer_scope_id, valid_from),
  KEY idx_wholesale_product_prices_resolution (price_list_id, product_id, customer_scope_id, is_active, valid_from, valid_to),
  KEY idx_wholesale_product_prices_customer (customer_id, is_active),
  CONSTRAINT fk_wholesale_product_prices_list FOREIGN KEY (price_list_id) REFERENCES wholesale_price_lists (id),
  CONSTRAINT fk_wholesale_product_prices_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_wholesale_product_prices_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_wholesale_product_prices_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_wholesale_product_prices_updated_by FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT chk_wholesale_product_prices_values CHECK (regular_price_reference > 0 AND wholesale_price > 0),
  CONSTRAINT chk_wholesale_product_prices_active CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_wholesale_product_prices_dates CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT chk_wholesale_product_prices_reason CHECK (CHAR_LENGTH(TRIM(change_reason)) >= 5)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wholesale_configuration_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type ENUM('price_list','customer_profile','product_price') NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  action_type ENUM('created','updated','activated','deactivated') NOT NULL,
  previous_values_json JSON NULL,
  new_values_json JSON NULL,
  reason VARCHAR(500) NOT NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wholesale_configuration_history_entity (entity_type, entity_id, created_at),
  KEY idx_wholesale_configuration_history_actor (changed_by, created_at),
  CONSTRAINT fk_wholesale_configuration_history_actor FOREIGN KEY (changed_by) REFERENCES users (id),
  CONSTRAINT chk_wholesale_configuration_history_reason CHECK (CHAR_LENGTH(TRIM(reason)) >= 5)
) ENGINE=InnoDB;
