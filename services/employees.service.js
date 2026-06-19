const { connect } = require("../data-access");

const JOB_TYPES = new Set(["baker", "packer", "operator", "admin", "other"]);

const createEmployee = async (payload, actorUserId) => {
  const userId = Number(payload.p_user_id || 0);
  const jobType = JOB_TYPES.has(payload.p_job_type) ? payload.p_job_type : "other";
  const customJobTitle = String(payload.p_custom_job_title || "").trim();

  if (!userId) {
    return { code: 0, message: "selecciona un usuario", data: null };
  }
  if (jobType === "other" && customJobTitle.length < 3) {
    return {
      code: 0,
      message: "escribe el nombre del nuevo cargo con al menos 3 caracteres",
      data: null,
    };
  }
  if (customJobTitle.length > 100) {
    return { code: 0, message: "el nombre del cargo permite maximo 100 caracteres", data: null };
  }

  const db = await connect();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.query(
      `SELECT id
       FROM users
       WHERE id = ?
         AND status = 'active'
         AND deleted_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      [userId]
    );
    if (!users.length) {
      await connection.rollback();
      return { code: 0, message: "usuario no encontrado o inactivo", data: null };
    }

    const [existing] = await connection.query(
      "SELECT id FROM employees WHERE user_id = ? AND deleted_at IS NULL LIMIT 1",
      [userId]
    );
    if (existing.length) {
      await connection.rollback();
      return { code: 0, message: "el usuario ya tiene un empleado asociado", data: null };
    }

    const [result] = await connection.query(
      `INSERT INTO employees (
         user_id, employee_code, document_id, job_type,
         custom_job_title, status, notes
       )
       VALUES (?, NULLIF(TRIM(?), ''), NULLIF(TRIM(?), ''), ?, ?, 'active', ?)`,
      [
        userId,
        payload.p_employee_code || null,
        payload.p_document_id || null,
        jobType,
        jobType === "other" ? customJobTitle : null,
        payload.p_notes || null,
      ]
    );

    const employeeId = Number(result.insertId);
    await connection.query(
      `INSERT INTO audit_logs (
         actor_user_id, action, entity_name, entity_id, metadata_json
       )
       VALUES (
         ?, 'employee.create', 'employees', ?,
         JSON_OBJECT('user_id', ?, 'job_type', ?, 'custom_job_title', ?)
       )`,
      [
        actorUserId || null,
        String(employeeId),
        userId,
        jobType,
        jobType === "other" ? customJobTitle : null,
      ]
    );

    await connection.commit();
    return {
      code: 1,
      message: "empleado creado",
      data: { employee_id: employeeId },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const listEmployees = async ({ status, jobType, search, page, pageSize } = {}) => {
  const db = await connect();
  const currentPage = Math.max(Number(page || 1), 1);
  const currentPageSize = Math.min(Math.max(Number(pageSize || 50), 1), 200);
  const offset = (currentPage - 1) * currentPageSize;
  const filters = ["e.deleted_at IS NULL"];
  const values = [];

  if (status) {
    filters.push("e.status = ?");
    values.push(status);
  }
  if (jobType) {
    filters.push("e.job_type = ?");
    values.push(jobType);
  }
  if (search) {
    filters.push(`(
      u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ?
      OR e.employee_code LIKE ? OR e.document_id LIKE ?
      OR e.custom_job_title LIKE ?
    )`);
    const term = `%${search}%`;
    values.push(term, term, term, term, term, term);
  }

  const [rows] = await db.query(
    `SELECT
       e.id,
       e.user_id,
       e.employee_code,
       e.document_id,
       e.job_type,
       e.custom_job_title,
       e.status,
       e.notes,
       u.full_name,
       u.username,
       u.email
     FROM employees e
     INNER JOIN users u ON u.id = e.user_id
     WHERE ${filters.join(" AND ")}
     ORDER BY u.full_name
     LIMIT ? OFFSET ?`,
    [...values, currentPageSize, offset]
  );

  return {
    code: 1,
    message: "empleados listados",
    data: {
      items: rows,
      page: currentPage,
      pageSize: currentPageSize,
    },
  };
};

module.exports = {
  createEmployee,
  listEmployees,
};
