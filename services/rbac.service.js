const { callProcedure, connect } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const listRoles = async () => {
  const db = await connect();
  const [rows] = await db.query(`
    SELECT
      r.id,
      r.code,
      r.name,
      r.description,
      r.is_system_role,
      r.created_at,
      COALESCE(
        JSON_ARRAYAGG(
          CASE
            WHEN p.code IS NULL THEN NULL
            ELSE p.code
          END
        ),
        JSON_ARRAY()
      ) AS permissions
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    GROUP BY r.id, r.code, r.name, r.description, r.is_system_role, r.created_at
    ORDER BY r.is_system_role DESC, r.code ASC
  `);

  return {
    code: 1,
    message: "roles listados",
    data: {
      items: rows.map((role) => ({
        ...role,
        permissions: Array.isArray(role.permissions) ? role.permissions.filter(Boolean) : [],
      })),
    },
  };
};

const listPermissions = async () => {
  const db = await connect();
  const [rows] = await db.query(`
    SELECT id, code, name, description, created_at
    FROM permissions
    ORDER BY code ASC
  `);

  return {
    code: 1,
    message: "permisos listados",
    data: { items: rows },
  };
};

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
  listRoles,
  listPermissions,
  createRole,
  updateRole,
  createPermission,
  setRolePermissions,
};
