const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceSource = fs.readFileSync(path.join(__dirname, "..", "services", "inventory.service.js"), "utf8");
const routerSource = fs.readFileSync(path.join(__dirname, "..", "api", "inventory.router.js"), "utf8");

test("eliminar stock bloquea la existencia y registra exactamente la salida disponible", () => {
  assert.match(serviceSource, /SELECT quantity_on_hand[\s\S]*FOR UPDATE/);
  assert.match(serviceSource, /SET quantity_on_hand = 0/);
  assert.match(serviceSource, /'adjustment_out'[\s\S]*currentStock/);
  assert.match(serviceSource, /inventory\.stock\.zeroed/);
});

test("eliminar stock de una variante opera sobre el producto fisico principal", () => {
  assert.match(serviceSource, /resolvePhysicalProduct\(connection, requestedItemId, \{ lock: true \}\)/);
  assert.match(serviceSource, /inventoryItemId = physicalProduct\.physicalProductId/);
});

test("solo administracion puede llevar una existencia a cero", () => {
  assert.match(routerSource, /\/stock\/zero", verifyToken, canManageInventory, requireAdministrativeRole/);
});
