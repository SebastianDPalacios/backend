const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workspace = path.join(__dirname, "../..");
const auditPath = path.join(workspace, "database/audits/block_12_historical_data_audit.sql");
const correctionsPath = path.join(workspace, "database/corrections/block_12");
const auditSource = fs.readFileSync(auditPath, "utf8");

test("la auditoría histórica es exclusivamente de lectura", () => {
  assert.doesNotMatch(auditSource, /^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|CREATE|REPLACE|TRUNCATE)\b/im);
  assert.match(auditSource, /affected_count/);
  assert.match(auditSource, /ORDER BY audit_type/);
});

test("la auditoría cubre los siete problemas y excluye Mayoristas", () => {
  for (const key of [
    "01_obsequios_como_cambios", "02_cambios_producto_incorrecto",
    "03_productos_terminados_unidad_incorrecta", "04_conteos_artificiales_unidad",
    "05_danos_sin_conteo", "06_registros_sin_fecha_operativa", "07_correcciones_incompletas",
  ]) assert.match(auditSource, new RegExp(key));
  assert.ok((auditSource.match(/NOT LIKE '%mayorista%'/g) || []).length >= 7);
});

test("cada tipo de corrección tiene un script separado y bloqueado", () => {
  const files = fs.readdirSync(correctionsPath).filter((file) => file.endsWith(".sql"));
  assert.equal(files.length, 7);
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(correctionsPath, file), "utf8");
    assert.match(source, /SIGNAL SQLSTATE '45000'/);
  });
});
