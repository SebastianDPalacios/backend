const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const routerSource = fs.readFileSync(path.join(__dirname, "../api/production.router.js"), "utf8");
const serviceSource = fs.readFileSync(path.join(__dirname, "../services/production.service.js"), "utf8");

test("retira todos los endpoints operativos del plan informativo", () => {
  const retiredRoutes = [
    "/plans/items/:id/start",
    "/plans/items/:id/finish",
    "/plans/products/:id/start",
    "/plans/products/:id/progress",
    "/plans/products/:id/skip",
    "/plans/products/:id/finish",
    "/plans/products/:id/correction",
  ];

  retiredRoutes.forEach((route) => assert.equal(routerSource.includes(route), false, route));
});

test("retira las funciones que convertian planes en produccion", () => {
  [
    "startProductionPlanItem",
    "finishProductionPlanItem",
    "startProductionPlanProduct",
    "saveProductionPlanProductProgress",
    "skipProductionPlanProduct",
    "finishProductionPlanProduct",
    "correctProductionPlanProduct",
  ].forEach((functionName) => assert.equal(serviceSource.includes(functionName), false, functionName));
});

test("conserva listas, produccion libre y empaque como flujos independientes", () => {
  [
    'router.post("/plans"',
    'router.put("/plans/:id"',
    'router.post("/plans/:id/cancel"',
    'router.post("/my-batches"',
    'router.get("/packaging/pending"',
    'router.post("/packaging/reports"',
  ].forEach((route) => assert.equal(routerSource.includes(route), true, route));

  assert.equal(serviceSource.includes("const registerMyProductionBatch"), true);
  assert.equal(serviceSource.includes("const listPendingPackaging"), true);
  assert.equal(serviceSource.includes("const createPackingReport"), true);
});

