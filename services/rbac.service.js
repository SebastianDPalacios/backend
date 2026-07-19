const { callProcedure, connect } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (error) {
    return [];
  }
};

const normalizePermissionCodes = (value) => {
  const source = parseJsonArray(value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value) : value);
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
};

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
        permissions: parseJsonArray(role.permissions),
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

const listUserViewAccess = async () => {
  const db = await connect();
  const [rows] = await db.query(`
    SELECT
      u.id,
      u.username,
      u.email,
      u.full_name,
      u.status,
      COALESCE(upp.permission_mode, 'inherit') AS permission_mode,
      COALESCE((
        SELECT CONCAT('[', GROUP_CONCAT(DISTINCT JSON_QUOTE(r.code) ORDER BY r.code SEPARATOR ','), ']')
        FROM user_roles ur
        INNER JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id
      ), '[]') AS roles_json,
      COALESCE((
        SELECT CONCAT('[', GROUP_CONCAT(JSON_QUOTE(x.code) ORDER BY x.code SEPARATOR ','), ']')
        FROM (
          SELECT DISTINCT p.code
          FROM user_roles ur
          INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
          INNER JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = u.id
        ) x
      ), '[]') AS inherited_permissions_json,
      COALESCE((
        SELECT CONCAT('[', GROUP_CONCAT(JSON_QUOTE(p.code) ORDER BY p.code SEPARATOR ','), ']')
        FROM user_permissions up
        INNER JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = u.id
      ), '[]') AS custom_permissions_json
    FROM users u
    LEFT JOIN user_permission_profiles upp ON upp.user_id = u.id
    WHERE u.deleted_at IS NULL
    ORDER BY u.username ASC
  `);

  return {
    code: 1,
    message: "accesos por usuario listados",
    data: {
      items: rows.map((user) => {
        const inheritedPermissions = parseJsonArray(user.inherited_permissions_json);
        const customPermissions = parseJsonArray(user.custom_permissions_json);
        const permissionMode = user.permission_mode === "custom" ? "custom" : "inherit";

        return {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          status: user.status,
          permission_mode: permissionMode,
          roles: parseJsonArray(user.roles_json),
          inherited_permissions: inheritedPermissions,
          permissions: customPermissions,
          effective_permissions: permissionMode === "custom" ? customPermissions : inheritedPermissions,
        };
      }),
    },
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

const setUserPermissions = async (payload, actorUserId) => {
  const userId = Number(payload.p_user_id);
  const permissionMode = payload.p_permission_mode === "custom" ? "custom" : "inherit";
  const permissionCodes = normalizePermissionCodes(payload.p_permission_codes_json);
  const db = await connect();

  if (!userId) {
    return { code: 0, message: "usuario invalido", data: null };
  }

  await db.beginTransaction();

  try {
    const [users] = await db.query(
      "SELECT id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      [userId]
    );

    if (users.length === 0) {
      await db.rollback();
      return { code: 0, message: "usuario no encontrado", data: null };
    }

    await db.query(
      `INSERT INTO user_permission_profiles (user_id, permission_mode, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE permission_mode = VALUES(permission_mode), updated_by = VALUES(updated_by)`,
      [userId, permissionMode, actorUserId || null]
    );

    await db.query("DELETE FROM user_permissions WHERE user_id = ?", [userId]);

    if (permissionMode === "custom" && permissionCodes.length > 0) {
      const placeholders = permissionCodes.map(() => "?").join(",");
      const [permissions] = await db.query(
        `SELECT id, code FROM permissions WHERE code IN (${placeholders})`,
        permissionCodes
      );
      const foundCodes = new Set(permissions.map((permission) => permission.code));
      const missingCodes = permissionCodes.filter((code) => !foundCodes.has(code));

      if (missingCodes.length > 0) {
        await db.rollback();
        return {
          code: 0,
          message: `permisos no encontrados: ${missingCodes.join(", ")}`,
          data: null,
        };
      }

      const values = permissions.map((permission) => [userId, permission.id, actorUserId || null]);
      await db.query(
        "INSERT INTO user_permissions (user_id, permission_id, granted_by) VALUES ?",
        [values]
      );
    }

    await db.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, metadata_json)
       VALUES (?, 'user.permissions.update', 'users', ?, JSON_OBJECT('mode', ?, 'permission_count', ?))`,
      [actorUserId || null, String(userId), permissionMode, permissionCodes.length]
    );

    await db.commit();

    return {
      code: 1,
      message: "accesos del usuario actualizados",
      data: { user_id: userId, permission_mode: permissionMode, permissions: permissionCodes },
    };
  } catch (error) {
    await db.rollback();
    throw error;
  }
};

module.exports = {
  listRoles,
  listPermissions,
  listUserViewAccess,
  createRole,
  updateRole,
  createPermission,
  setRolePermissions,
  setUserPermissions,
};
