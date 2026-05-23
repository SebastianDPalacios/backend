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

module.exports = {
  signToken,
  verifyToken,
};
