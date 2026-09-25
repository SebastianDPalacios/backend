ALTER TABLE wholesale_product_prices
  ADD CONSTRAINT chk_wholesale_product_prices_whole_value
  CHECK (wholesale_price = FLOOR(wholesale_price));
