const { connect } = require("../data-access");

const listAuditLogs = async ({ search, action, entityName, page, pageSize }) => {
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

  return {
    code: 1,
    message: "auditoria listada",
    data: {
      items: rows,
      page: currentPage,
      pageSize: currentPageSize,
    },
  };
};

module.exports = {
  listAuditLogs,
};
