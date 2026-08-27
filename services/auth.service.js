const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { callProcedure, connect } = require("../data-access");
const { signToken } = require("../middlewares/auth.handler");
const { mapSpResult } = require("./sp-response");

const hashToken = (value) => crypto.createHash("sha256").update(value).digest("hex");

const addDaysAsSqlDatetime = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + Number(days));
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
const getActiveEmployeeForUser = async (userId) => {
  const db = await connect();
  const [rows] = await db.query(
    `SELECT id, employee_code, job_type, custom_job_title, status
       FROM employees
      WHERE user_id = ?
        AND deleted_at IS NULL
        AND status = 'active'
      ORDER BY id DESC
      LIMIT 1`,
    [userId]
  );

  return rows[0] || null;
};

const login = async ({ identifier, password, ipAddress, userAgent }) => {
  const startOut = await callProcedure("sp_auth_login_start", [identifier]);
  const start = mapSpResult(startOut);

  if (start.code !== 1 || !start.data) {
    return start;
  }

  const isValidPassword = await bcrypt.compare(password || "", start.data.password_hash || "");
  if (!isValidPassword) {
    await callProcedure("sp_auth_login_fail", [
      identifier,
      start.data.user_id,
      ipAddress,
    ]);
    return {
      code: 0,
      message: "credenciales invalidas",
      data: null,
    };
  }

  const refreshToken = crypto.randomBytes(48).toString("hex");
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = addDaysAsSqlDatetime(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 7);

  const successOut = await callProcedure("sp_auth_login_success", [
    start.data.user_id,
    identifier,
    refreshTokenHash,
    userAgent,
    ipAddress,
    expiresAt,
  ]);

  const success = mapSpResult(successOut);
  if (success.code !== 1 || !success.data) {
    return success;
  }

  const permissionsOut = await callProcedure("sp_permission_list_by_user", [start.data.user_id]);
  const permissions = mapSpResult(permissionsOut);
  const employee = await getActiveEmployeeForUser(start.data.user_id);
  const roles = permissions.data ? permissions.data.roles : [];
  const permissionCodes = permissions.data ? permissions.data.permissions : [];
  const accessToken = signToken({
    user: {
      userId: start.data.user_id,
      sessionId: success.data.session_id,
      username: start.data.username,
      email: start.data.email,
      roles,
      permissions: permissionCodes,
      employee,
    },
  });

  return {
    code: 1,
    message: "inicio de sesion exitoso",
    data: {
      access_token: accessToken,
      refresh_token: refreshToken,
      session_id: success.data.session_id,
      user: {
        user_id: start.data.user_id,
        username: start.data.username,
        email: start.data.email,
        must_change_password: success.data.must_change_password,
        employee,
      },
      roles,
      permissions: permissionCodes,
    },
  };
};

const refreshSession = async ({ sessionId, userId, refreshToken }) => {
  const currentHash = hashToken(refreshToken || "");
  const newRefreshToken = crypto.randomBytes(48).toString("hex");
  const newHash = hashToken(newRefreshToken);
  const newExpiresAt = addDaysAsSqlDatetime(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 7);

  const out = await callProcedure("sp_auth_refresh_session", [
    sessionId,
    userId,
    currentHash,
    newHash,
    newExpiresAt,
  ]);

  const result = mapSpResult(out);
  if (result.code !== 1) {
    return result;
  }

  const permissionsOut = await callProcedure("sp_permission_list_by_user", [userId]);
  const permissions = mapSpResult(permissionsOut);
  const roles = permissions.data ? permissions.data.roles : [];
  const permissionCodes = permissions.data ? permissions.data.permissions : [];
  const employee = await getActiveEmployeeForUser(userId);
  const accessToken = signToken({
    user: {
      userId,
      sessionId,
      roles,
      permissions: permissionCodes,
      employee,
    },
  });
  return {
    code: 1,
    message: "sesion renovada",
    data: {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      session_id: sessionId,
      expires_at: result.data ? result.data.expires_at : null,
      user: { user_id: Number(userId) },
      roles,
      permissions: permissionCodes,
    },
  };
};

const logout = async ({ sessionId, userId }) => {
  const out = await callProcedure("sp_auth_logout", [sessionId, userId]);
  return mapSpResult(out);
};

module.exports = {
  login,
  refreshSession,
  logout,
};



