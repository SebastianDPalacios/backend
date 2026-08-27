const jwt = require("jsonwebtoken");
const boom = require("@hapi/boom");
const { connect } = require("../data-access");
const { assertSystemAccess } = require("../services/system-announcements.service");

const signToken = (payload, secret, expiresIn) => {
  return jwt.sign(payload, secret || process.env.JWT_SECRET, {
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || "15m",
  });
};

const assertSessionIsActive = async (user) => {
  const userId = Number(user?.userId);
  const sessionId = Number(user?.sessionId);

  if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(sessionId) || sessionId <= 0) {
    throw boom.unauthorized("sesion invalida");
  }

  const db = await connect();
  const [rows] = await db.query(
    `SELECT id
       FROM user_sessions
      WHERE id = ?
        AND user_id = ?
        AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1`,
    [sessionId, userId]
  );

  if (!rows.length) {
    throw boom.unauthorized("sesion revocada o expirada");
  }
};

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      throw boom.unauthorized("token no enviado");
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user;
    await assertSystemAccess(req.user);
    await assertSessionIsActive(req.user);
    next();
  } catch (error) {
    next(error?.isBoom ? error : boom.unauthorized(error?.message || "token invalido o expirado"));
  }
};

const normalizeCodes = (items) => {
  if (!Array.isArray(items)) {
    return new Set();
  }

  return new Set(
    items
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object") {
          return item.code || item.permission_code || item.name;
        }

        return null;
      })
      .filter(Boolean)
  );
};

const requirePermission = (...permissionCodes) => {
  return (req, res, next) => {
    const permissions = normalizeCodes(req.user ? req.user.permissions : []);
    const roles = normalizeCodes(req.user ? req.user.roles : []);

    if (roles.has("SUPER_ADMIN") || roles.has("ADMIN") || permissionCodes.some((code) => permissions.has(code))) {
      next();
      return;
    }

    next(boom.forbidden(`permiso requerido: ${permissionCodes.join(" o ")}`));
  };
};

module.exports = {
  signToken,
  verifyToken,
  requirePermission,
};
