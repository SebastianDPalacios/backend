const { callProcedure } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const createRole = async (payload, actorUserId) => {
  const out = await callProcedure("sp_role_create", [
    payload.p_code || null,
    payload.p_name || null,
    payload.p_description || null,
    payload.p_is_system_role || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateRole = async (payload, actorUserId) => {
  const out = await callProcedure("sp_role_update", [
    payload.p_role_id,
    payload.p_name || null,
    payload.p_description || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const createPermission = async (payload, actorUserId) => {
  const out = await callProcedure("sp_permission_create", [
    payload.p_code || null,
    payload.p_name || null,
    payload.p_description || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const setRolePermissions = async (payload, actorUserId) => {
  const permissionCodes = payload.p_permission_codes_json;
  const normalizedPermissions = permissionCodes && typeof permissionCodes === "object"
    ? JSON.stringify(permissionCodes)
    : permissionCodes || null;

  const out = await callProcedure("sp_role_set_permissions", [
    payload.p_role_id,
    normalizedPermissions,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

module.exports = {
  createRole,
  updateRole,
  createPermission,
  setRolePermissions,
};
