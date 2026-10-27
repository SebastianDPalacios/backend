const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const readBackend = (relativePath) => fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
const readFrontend = (relativePath) => fs.readFileSync(path.join(__dirname, "../../frontend", relativePath), "utf8");

const migration = readBackend("database/097_system_commercial_versions.sql");
const service = readBackend("services/settings.service.js");
const router = readBackend("api/settings.router.js");
const layout = readFrontend("src/layouts/UserLayout.js");

test("la versión comercial es única e independiente de frontend y backend", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS system_commercial_versions/);
  assert.match(migration, /'1\.0\.0'/);
  assert.match(service, /getCurrentCommercialVersion/);
  assert.doesNotMatch(layout, /package\.json/);
});

test("todos los usuarios autenticados pueden consultar la versión y solo administración puede publicarla", () => {
  assert.match(router, /get\("\/system-version", verifyToken/);
  assert.match(router, /post\("\/system-version", verifyToken, canConfigureTicket/);
  assert.match(service, /\^\\d\+\\\.\\d\+\\\.\\d\+\$/);
  assert.match(service, /system_version\.publish/);
});

test("el cliente visualiza una versión y novedades sin datos técnicos", () => {
  assert.match(layout, /Versión \{systemVersion\.version\}/);
  assert.match(layout, /Acerca del sistema/);
  assert.match(layout, /Última actualización/);
  assert.match(layout, /Novedades/);
  assert.doesNotMatch(layout, /commit|migraci.n|backend|frontend/i);
});
