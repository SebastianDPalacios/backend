const test = require("node:test");
const assert = require("node:assert/strict");
const { createOwnershipMiddleware } = require("../middlewares/order-access.handler");

const createResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
});

test("permite a un administrador acceder a cualquier pedido", async () => {
  let connected = false;
  let nextCalled = false;
  const middleware = createOwnershipMiddleware({ connectDb: async () => { connected = true; } });
  await middleware(
    { params: { id: "99" }, user: { userId: 7, roles: [{ code: "ADMIN" }] } },
    createResponse(),
    () => { nextCalled = true; }
  );
  assert.equal(nextCalled, true);
  assert.equal(connected, false);
});

test("permite al vendedor acceder a un pedido propio", async () => {
  let receivedValues;
  let nextCalled = false;
  const middleware = createOwnershipMiddleware({
    connectDb: async () => ({ query: async (_sql, values) => { receivedValues = values; return [[{ allowed: 1 }]]; } }),
  });
  await middleware(
    { params: { id: "31" }, user: { userId: 12, roles: ["VENTAS"] } },
    createResponse(),
    () => { nextCalled = true; }
  );
  assert.deepEqual(receivedValues, [31, 12]);
  assert.equal(nextCalled, true);
});

test("deniega al vendedor el pedido de otro vendedor", async () => {
  let nextCalled = false;
  const response = createResponse();
  const middleware = createOwnershipMiddleware({
    connectDb: async () => ({ query: async () => [[]] }),
  });
  await middleware(
    { params: { id: "31" }, user: { userId: 12, roles: ["VENTAS"] } },
    response,
    () => { nextCalled = true; }
  );
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.code, 0);
});

test("valida que una reserva pertenezca a un pedido del vendedor", async () => {
  let receivedSql = "";
  const response = createResponse();
  const middleware = createOwnershipMiddleware({
    resource: "reservation",
    connectDb: async () => ({ query: async (sql) => { receivedSql = sql; return [[]]; } }),
  });
  await middleware(
    { params: { id: "8" }, user: { userId: 4, roles: ["VENTAS"] } },
    response,
    () => assert.fail("no debe autorizar una reserva ajena")
  );
  assert.match(receivedSql, /item\.order_id/);
  assert.equal(response.statusCode, 403);
});
