const boom = require("@hapi/boom");
const { connect } = require("../data-access");
const { writeAudit } = require("./audit.service");

const codes = (values) => new Set((Array.isArray(values) ? values : []).map((value) => (
  typeof value === "string" ? value : value?.code || value?.name || value?.permission_code
)).filter(Boolean));

const isManager = (user) => {
  const roles = new Set([...codes(user?.roles)].map((role) => String(role).toUpperCase()));
  return roles.has("ADMIN") || roles.has("SUPER_ADMIN") || codes(user?.permissions).has("roles.manage");
};

const serialize = (row) => row ? {
  id: Number(row.id), message: row.message, display_from: row.display_from,
  force_logout_at: row.force_logout_at, is_active: Boolean(row.is_active),
  enforced_at: row.enforced_at, ended_at: row.ended_at, created_at: row.created_at,
} : null;

const getCurrent = async () => {
  const db = await connect();
  const [rows] = await db.query(
    `SELECT * FROM system_announcements
      WHERE is_active = 1 AND ended_at IS NULL AND display_from <= CURRENT_TIMESTAMP
      ORDER BY id DESC LIMIT 1`
  );
  return rows[0] || null;
};

const revokeNonManagerSessions = async (db) => {
  await db.query(
    `UPDATE user_sessions s
        JOIN users u ON u.id = s.user_id
         SET s.revoked_at = COALESCE(s.revoked_at, CURRENT_TIMESTAMP)
       WHERE s.revoked_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = u.id AND r.code IN ('ADMIN', 'SUPER_ADMIN')
         )
         AND NOT EXISTS (
           SELECT 1 FROM permissions p
            WHERE p.code = 'roles.manage'
              AND (
                EXISTS (
                  SELECT 1 FROM user_permissions up
                   WHERE up.user_id = u.id AND up.permission_id = p.id
                )
                OR (
                  NOT EXISTS (
                    SELECT 1 FROM user_permission_profiles upp
                     WHERE upp.user_id = u.id AND upp.permission_mode = 'custom'
                  )
                  AND EXISTS (
                    SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
                     WHERE ur.user_id = u.id AND rp.permission_id = p.id
                  )
                )
              )
         )`
  );
};

const enforceIfDue = async (row) => {
  if (!row || new Date(row.force_logout_at).getTime() > Date.now()) return row;
  const db = await connect();
  if (!row.enforced_at) {
    const [result] = await db.query(
      "UPDATE system_announcements SET enforced_at = CURRENT_TIMESTAMP WHERE id = ? AND enforced_at IS NULL",
      [row.id]
    );
    if (result.affectedRows) {
      await revokeNonManagerSessions(db);
      await writeAudit({ action: "system_announcement.enforce", entityName: "system_announcements", entityId: row.id, metadata: { message: row.message } });
    }
    row.enforced_at = new Date();
  }
  return row;
};

const assertSystemAccess = async (user) => {
  const row = await enforceIfDue(await getCurrent());
  if (row && new Date(row.force_logout_at).getTime() <= Date.now() && !isManager(user)) {
    const error = boom.locked("El sistema está temporalmente bloqueado por mantenimiento");
    error.output.payload.code = "SYSTEM_MAINTENANCE";
    error.output.payload.maintenance = serialize(row);
    throw error;
  }
  return serialize(row);
};

const list = async () => {
  const db = await connect();
  const [rows] = await db.query("SELECT * FROM system_announcements ORDER BY id DESC LIMIT 50");
  return rows.map(serialize);
};

const create = async ({ message, displayFrom, forceLogoutAt, userId, ipAddress }) => {
  const text = String(message || "").trim();
  const displayDate = displayFrom ? new Date(displayFrom) : new Date();
  const forceDate = new Date(forceLogoutAt);
  if (!text) throw boom.badRequest("El mensaje es obligatorio");
  if (Number.isNaN(displayDate.getTime())) throw boom.badRequest("La hora de publicacion no es valida");
  if (!forceLogoutAt || Number.isNaN(forceDate.getTime()) || forceDate.getTime() <= Date.now()) {
    throw boom.badRequest("La hora de bloqueo debe ser posterior a la hora actual");
  }
  if (displayDate.getTime() > forceDate.getTime()) {
    throw boom.badRequest("El aviso debe publicarse antes de la hora de bloqueo");
  }
  const db = await connect();
  await db.query("UPDATE system_announcements SET is_active = 0, ended_at = CURRENT_TIMESTAMP, ended_by = ? WHERE is_active = 1", [userId]);
  const [result] = await db.query(
    "INSERT INTO system_announcements (message, display_from, force_logout_at, created_by) VALUES (?, ?, ?, ?)",
    [text, displayDate, forceDate, userId]
  );
  await writeAudit({ actorUserId: userId, action: "system_announcement.create", entityName: "system_announcements", entityId: result.insertId, ipAddress, metadata: { message: text, force_logout_at: forceLogoutAt } });
  const [rows] = await db.query("SELECT * FROM system_announcements WHERE id = ?", [result.insertId]);
  return serialize(rows[0]);
};

const end = async ({ id, userId, ipAddress }) => {
  const db = await connect();
  const [result] = await db.query("UPDATE system_announcements SET is_active = 0, ended_at = CURRENT_TIMESTAMP, ended_by = ? WHERE id = ? AND is_active = 1", [userId, id]);
  if (!result.affectedRows) throw boom.notFound("El aviso no existe o ya terminó");
  await writeAudit({ actorUserId: userId, action: "system_announcement.end", entityName: "system_announcements", entityId: id, ipAddress });
};

module.exports = { assertSystemAccess, create, end, getCurrent, isManager, list, serialize };
