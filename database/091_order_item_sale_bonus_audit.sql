-- Congela los componentes usados por Venta + vendaje sin recalcular históricos.
ALTER TABLE order_items
  ADD COLUMN sale_bonus_invoiced_value DECIMAL(14,2) NULL AFTER wholesale_price_list_name,
  ADD COLUMN sale_bonus_percent_applied DECIMAL(5,2) NULL AFTER sale_bonus_invoiced_value,
  ADD COLUMN sale_bonus_value_applied DECIMAL(14,2) NULL AFTER sale_bonus_percent_applied,
  ADD COLUMN sale_bonus_product_price_used DECIMAL(14,2) NULL AFTER sale_bonus_value_applied,
  ADD COLUMN sale_bonus_result_quantity DECIMAL(14,3) NULL AFTER sale_bonus_product_price_used,
  ADD CONSTRAINT chk_order_items_sale_bonus_audit
    CHECK (
      (sale_bonus_invoiced_value IS NULL OR sale_bonus_invoiced_value > 0)
      AND (sale_bonus_percent_applied IS NULL OR sale_bonus_percent_applied >= 0)
      AND (sale_bonus_value_applied IS NULL OR sale_bonus_value_applied >= 0)
      AND (sale_bonus_product_price_used IS NULL OR sale_bonus_product_price_used > 0)
      AND (sale_bonus_result_quantity IS NULL OR sale_bonus_result_quantity > 0)
    );

