const logger = require("../logger");

function logErrors(err, req, res, next) {
  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
  });
  next(err);
}

function boomErrorHandler(err, req, res, next) {
  if (err && err.isBoom) {
    const {
      output: { statusCode, payload },
    } = err;
    res.status(statusCode).json(payload);
    return;
  }
  next(err);
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({
    message: "Error interno del servidor",
    details: process.env.NODE_ENV === "production" ? undefined : err.message,
  });
}

module.exports = { logErrors, boomErrorHandler, errorHandler };
