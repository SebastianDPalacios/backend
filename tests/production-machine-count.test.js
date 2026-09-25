const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");
const countSource = serviceSource.slice(
  serviceSource.indexOf("const createPackingReport = async"),
  serviceSource.indexOf("const listPackingHistory = async")
);

test("el reporte del panadero no limita ni bloquea el conteo", () => {
  assert.match(countSource, /produced_quantity/);
  assert.equal(countSource.includes("exceedsAvailable"), false);
  assert.equal(countSource.includes("missing_quantity ="), false);
  assert.doesNotMatch(countSource, /packedQuantity\s*>\s*.*produced_quantity/);
});

test("solo lo empacado entra a inventario y los daños se registran individualmente", () => {
  assert.match(countSource, /quantity_on_hand = quantity_on_hand \+ VALUES\(quantity_on_hand\)/);
  assert.match(countSource, /movement_type[\s\S]*production_in/);
  assert.match(countSource, /for \(const damage of item\.damages\)/);
  assert.match(countSource, /INSERT INTO production_damages/);
  assert.match(countSource, /missing_quantity,[\s\S]*\) VALUES \(\?, \?, \?, \?, \?, \?, 0,/);
});

test("conteo, daños, inventario y lote se guardan en una sola transaccion", () => {
  assert.match(countSource, /beginTransaction\(\)/);
  assert.match(countSource, /commit\(\)/);
  assert.match(countSource, /rollback\(\)/);
  assert.match(countSource, /pending_packaging/);
  assert.match(countSource, /partially_packed/);
});
