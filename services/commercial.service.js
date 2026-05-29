const { callProcedure } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const createCustomer = async (payload, actorUserId) => {
  const out = await callProcedure("sp_customer_create", [
    payload.p_tax_id || null,
    payload.p_name || null,
    payload.p_email || null,
    payload.p_phone || null,
    payload.p_address || null,
    payload.p_status || null,
    payload.p_credit_limit || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateCustomer = async (payload, actorUserId) => {
  const out = await callProcedure("sp_customer_update", [
    payload.p_customer_id,
    payload.p_tax_id || null,
    payload.p_name || null,
    payload.p_email || null,
    payload.p_phone || null,
    payload.p_address || null,
    payload.p_status || null,
    payload.p_credit_limit || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const setCustomerStatus = async (payload, actorUserId) => {
  const out = await callProcedure("sp_customer_set_status", [
    payload.p_customer_id,
    payload.p_status || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createRoute = async (payload, actorUserId) => {
  const out = await callProcedure("sp_route_create", [
    payload.p_code || null,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_active ?? 1,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateRoute = async (payload, actorUserId) => {
  const out = await callProcedure("sp_route_update", [
    payload.p_route_id,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_active ?? null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const setRouteStatus = async (payload, actorUserId) => {
  const out = await callProcedure("sp_route_set_status", [
    payload.p_route_id,
    payload.p_is_active ?? null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const assignRouteDriver = async (payload, actorUserId) => {
  const out = await callProcedure("sp_route_assign_driver", [
    payload.p_route_id,
    payload.p_user_id || null,
    payload.p_assigned_from || null,
    payload.p_assigned_to || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

module.exports = {
  createCustomer,
  updateCustomer,
  setCustomerStatus,
  createRoute,
  updateRoute,
  setRouteStatus,
  assignRouteDriver,
};
