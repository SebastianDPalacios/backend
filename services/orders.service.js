const { callProcedure } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const listOrderBaseData = async ({ onlyActive, search, page, pageSize, refDate }) => {
  const [customersOut, productsOut] = await Promise.all([
    callProcedure("sp_customer_list", [null, search || null, Number(page || 1), Number(pageSize || 20)]),
    callProcedure("sp_product_list", [
      Number(onlyActive || 0),
      null,
      search || null,
      Number(page || 1),
      Number(pageSize || 20),
    ]),
  ]);

  const customers = mapSpResult(customersOut);
  const products = mapSpResult(productsOut);

  if (customers.code !== 1) {
    return customers;
  }

  if (products.code !== 1) {
    return products;
  }

  return {
    code: 1,
    message: "catalogos de orden obtenidos",
    data: {
      customers: customers.data,
      routes: [],
      products: products.data,
    },
  };
};

const createOrder = async (payload, actorUserId) => {
  const out = await callProcedure("sp_create_order", [
    payload.p_branch_id || null,
    payload.p_customer_id || null,
    payload.p_route_id || null,
    payload.p_order_date || null,
    payload.p_delivery_date || null,
    payload.p_notes || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const upsertOrderItem = async (payload, actorUserId) => {
  const out = await callProcedure("sp_order_upsert_item", [
    payload.p_order_id,
    payload.p_product_id || null,
    payload.p_quantity || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const confirmOrder = async (payload, actorUserId) => {
  const out = await callProcedure("sp_confirm_order", [
    payload.p_order_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const cancelOrder = async (payload, actorUserId) => {
  const out = await callProcedure("sp_cancel_order", [
    payload.p_order_id,
    payload.p_reason || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const dispatchOrder = async (payload, actorUserId) => {
  const out = await callProcedure("sp_dispatch_order", [
    payload.p_order_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const receivePurchaseOrder = async (payload, actorUserId) => {
  const out = await callProcedure("sp_receive_purchase_order", [
    payload.p_purchase_order_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

module.exports = {
  listOrderBaseData,
  createOrder,
  upsertOrderItem,
  confirmOrder,
  cancelOrder,
  dispatchOrder,
  receivePurchaseOrder,
};
