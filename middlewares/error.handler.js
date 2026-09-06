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
  const databaseMessage = String(err?.sqlMessage || err?.message || "");
  let message = "No se pudo completar la operación. Intenta nuevamente.";

  if (err?.code === "ER_DUP_ENTRY") {
    message = /(sku|uq_.*sku)/i.test(databaseMessage)
      ? "Ya existe un producto con ese SKU. Escribe un identificador diferente."
      : "Ya existe un registro con esos datos. Revisa los valores ingresados.";
  } else if (err?.code === "ER_NO_REFERENCED_ROW_2") {
    message = "Una de las opciones seleccionadas ya no está disponible. Actualiza la página y selecciónala nuevamente.";
  } else if (err?.code === "ER_BAD_NULL_ERROR") {
    message = "Falta completar un dato obligatorio. Revisa los campos del formulario.";
  } else if (["ER_DATA_TOO_LONG", "ER_TRUNCATED_WRONG_VALUE", "ER_WARN_DATA_OUT_OF_RANGE"].includes(err?.code)) {
    message = "Uno de los valores tiene un formato o tamaño inválido. Revisa los campos del formulario.";
  } else if (err?.code === "ER_SIGNAL_EXCEPTION" && databaseMessage) {
    message = databaseMessage;
  }

  res.status(500).json({
    message,
    details: process.env.NODE_ENV === "production" ? undefined : err.message,
  });
}

module.exports = { logErrors, boomErrorHandler, errorHandler };
