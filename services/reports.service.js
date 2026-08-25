const { connect } = require("../data-access");

const listAuditLogs = async ({ search, action, entityName, actorUserId, dateFrom, dateTo, page, pageSize }) => {
  const db = await connect();
  const currentPage = Math.max(Number(page || 1), 1);
  const currentPageSize = Math.min(Math.max(Number(pageSize || 30), 1), 100);
  const offset = (currentPage - 1) * currentPageSize;
  const filters = [];
  const values = [];

  if (search) {
    filters.push("(al.action LIKE ? OR al.entity_name LIKE ? OR al.entity_id LIKE ? OR u.username LIKE ? OR u.full_name LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (action) {
    filters.push("al.action = ?");
    values.push(action);
  }

  if (entityName) {
    filters.push("al.entity_name = ?");
    values.push(entityName);
  }

  if (actorUserId) {
    filters.push("al.actor_user_id = ?");
    values.push(Number(actorUserId));
  }

  if (dateFrom) {
    filters.push("al.created_at >= ?");
    values.push(`${dateFrom} 00:00:00`);
  }

  if (dateTo) {
    filters.push("al.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    values.push(`${dateTo} 00:00:00`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const [rows] = await db.query(
    `
      SELECT
        al.id,
        al.created_at,
        al.actor_user_id,
        COALESCE(u.full_name, u.username, 'Sistema') AS actor_name,
        u.username,
        al.action,
        al.entity_name,
        al.entity_id,
        al.ip_address,
        al.metadata_json
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.actor_user_id
      ${whereClause}
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT ? OFFSET ?
    `,
    [...values, currentPageSize, offset]
  );
  const [[countRow]] = await db.query(
    `SELECT COUNT(*) AS total FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_user_id ${whereClause}`,
    values
  );
  const [entities] = await db.query("SELECT DISTINCT entity_name AS value FROM audit_logs WHERE entity_name IS NOT NULL ORDER BY entity_name");
  const [actions] = await db.query("SELECT DISTINCT action AS value FROM audit_logs WHERE action IS NOT NULL ORDER BY action");
  const [actors] = await db.query(
    `SELECT DISTINCT u.id AS value, COALESCE(u.full_name, u.username) AS label
       FROM audit_logs al JOIN users u ON u.id = al.actor_user_id ORDER BY label`
  );

  return {
    code: 1,
    message: "auditoria listada",
    data: {
      items: rows,
      page: currentPage,
      pageSize: currentPageSize,
      total: Number(countRow.total || 0),
      totalPages: Math.max(Math.ceil(Number(countRow.total || 0) / currentPageSize), 1),
      filters: { entities, actions, actors },
    },
  };
};

module.exports = {
  listAuditLogs,
};
