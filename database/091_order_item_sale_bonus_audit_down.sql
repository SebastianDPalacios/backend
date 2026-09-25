ALTER TABLE order_items
  DROP CHECK chk_order_items_sale_bonus_audit,
  DROP COLUMN sale_bonus_result_quantity,
  DROP COLUMN sale_bonus_product_price_used,
  DROP COLUMN sale_bonus_value_applied,
  DROP COLUMN sale_bonus_percent_applied,
  DROP COLUMN sale_bonus_invoiced_value;

