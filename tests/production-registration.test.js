const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  validateProductionRegistrationDate,
  validateProductionRequestKey,
} = require("../domain/production-registration");
const serviceSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");

test("permite al panadero registrar unicamente la fecha actual", () => {
  assert.equal(validateProductionRegistrationDate({ producedDate: "2026-09-18", currentDate: "2026-09-18" }).valid, true);
  assert.match(validateProductionRegistrationDate({ producedDate: "2026-09-17", currentDate: "2026-09-18" }).message, /administrador/);
});

test("prohibe fechas futuras incluso al administrador", () => {
  const result = validateProductionRegistrationDate({ producedDate: "2026-09-19", currentDate: "2026-09-18", canManageAll: true });
  assert.equal(result.valid, false);
  assert.match(result.message, /futura/);
});

test("exige motivo al administrador para produccion retroactiva", () => {
  assert.equal(validateProductionRegistrationDate({ producedDate: "2026-09-17", currentDate: "2026-09-18", canManageAll: true }).valid, false);
  const valid = validateProductionRegistrationDate({
    producedDate: "2026-09-17",
    currentDate: "2026-09-18",
    canManageAll: true,
    retroactiveReason: "Correccion del cierre anterior",
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.retroactiveReason, "Correccion del cierre anterior");
});

test("valida una clave de solicitud estable para impedir duplicados", () => {
  assert.equal(validateProductionRequestKey("production:8f0f6b9e-2410-4dda-9913").valid, true);
  assert.equal(validateProductionRequestKey("corta").valid, false);
});

test("el registro conserva transaccion, receta exacta, inventario, lote y responsables", () => {
  assert.match(serviceSource, /beginTransaction\(\)/);
  assert.match(serviceSource, /current_recipe\.id = \?/);
  assert.match(serviceSource, /current_recipe\.is_current = 1/);
  assert.match(serviceSource, /FOR UPDATE/);
  assert.match(serviceSource, /movement_type[\s\S]*production_out/);
  assert.match(serviceSource, /pending_packaging/);
  assert.match(serviceSource, /baker_employee_id/);
  assert.match(serviceSource, /client_request_key/);
  assert.equal(serviceSource.includes("p_production_plan_id"), false);
});
