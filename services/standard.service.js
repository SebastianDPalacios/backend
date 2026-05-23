const { callProcedure } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const lookupError = async (payload) => {
  const out = await callProcedure("sp_std_error_lookup", [
    payload.p_error_code || null,
  ]);
  return mapSpResult(out);
};

const getConfig = async (payload) => {
  const out = await callProcedure("sp_std_config_get", [
    payload.p_config_key || null,
  ]);
  return mapSpResult(out);
};

module.exports = {
  lookupError,
  getConfig,
};
