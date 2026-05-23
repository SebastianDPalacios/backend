const mysql = require("mysql2/promise");

let pool;

const getDbEnv = () => ({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || "panaderia_db",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
});

const validateDbEnv = (env) => {
  const missing = [];
  if (!env.host) missing.push("DB_HOST");
  if (!env.database) missing.push("DB_NAME");
  if (!env.user) missing.push("DB_USER");

  if (missing.length > 0) {
    throw new Error(`Configuracion DB incompleta. Variables faltantes: ${missing.join(", ")}`);
  }
};

const poolConfig = () => ({
  host: getDbEnv().host,
  port: getDbEnv().port,
  database: getDbEnv().database,
  user: getDbEnv().user,
  password: getDbEnv().password,
  waitForConnections: true,
  connectionLimit: getDbEnv().connectionLimit,
  queueLimit: 0,
  multipleStatements: true,
});

const connect = async () => {
  if (!pool) {
    validateDbEnv(getDbEnv());
    pool = mysql.createPool(poolConfig());
  }
  return pool;
};

const normalizeOutRow = (resultSets) => {
  const outRows = resultSets?.find?.((set) => Array.isArray(set) && set.length && set[0].o_code !== undefined);
  if (!outRows || !outRows.length) {
    return { o_code: -1, o_message: "respuesta de procedimiento invalida", o_data_json: null };
  }
  return outRows[0];
};

const callProcedure = async (name, inputs = []) => {
  const db = await connect();
  const inPlaceholders = inputs.map(() => "?").join(",");
  const callArgs = inPlaceholders ? `${inPlaceholders}, @o_code, @o_message, @o_data_json` : "@o_code, @o_message, @o_data_json";
  const sql = `SET @o_code = 0, @o_message = '', @o_data_json = NULL; CALL ${name}(${callArgs}); SELECT @o_code AS o_code, @o_message AS o_message, @o_data_json AS o_data_json;`;
  const [resultSets] = await db.query(sql, inputs);
  return normalizeOutRow(resultSets);
};

module.exports = {
  connect,
  callProcedure,
};
