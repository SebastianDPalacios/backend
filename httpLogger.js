const morgan = require("morgan");
const logger = require("./logger");

const httpLogger = morgan("combined", {
  stream: {
    write: (message) => logger.info(message.trim()),
  },
});

module.exports = httpLogger;
