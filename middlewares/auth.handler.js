const jwt = require("jsonwebtoken");
const boom = require("@hapi/boom");

const signToken = (payload, secret, expiresIn) => {
  return jwt.sign(payload, secret || process.env.JWT_SECRET, {
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || "15m",
  });
};

const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      throw boom.unauthorized("token no enviado");
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user;
    next();
  } catch (error) {
    next(boom.unauthorized("token invalido o expirado"));
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
