const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "components", "organisms", "orders", "AtomicOrderForm.js"),
  "utf8"
);

test("el vendedor se reinicia después de cada resultado que confirma la creación del pedido", () => {
  const saveBlock = source.slice(source.indexOf("const save = async"), source.indexOf("const retryPendingOrderOperations"));
  const sellerResets = saveBlock.match(/setSellerId\(""\)/g) || [];
  const customerResets = saveBlock.match(/setCustomerId\(""\)/g) || [];
  assert.equal(sellerResets.length, customerResets.length);
  assert.equal(sellerResets.length, 3);
});

test("un error sin pedido creado conserva el vendedor para permitir reintentar", () => {
  const saveBlock = source.slice(source.indexOf("const save = async"), source.indexOf("const retryPendingOrderOperations"));
  assert.match(saveBlock, /setError\(response\?\.message \|\| "No se pudo guardar el pedido"\);\s*return;/);
});
