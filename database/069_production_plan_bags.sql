USE panaderia_db;

ALTER TABLE production_plan_product_details
  MODIFY COLUMN request_mode ENUM('units', 'arrobas', 'bags') NOT NULL;
