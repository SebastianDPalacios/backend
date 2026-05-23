const { callProcedure } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const getUserById = async (userId) => {
  const out = await callProcedure("sp_user_get_by_id", [Number(userId)]);
  return mapSpResult(out);
};

const listUsers = async ({ status, search, page, pageSize }) => {
  const out = await callProcedure("sp_user_list", [
    status || null,
    search || null,
    Number(page || 1),
    Number(pageSize || 20),
  ]);
  return mapSpResult(out);
};

module.exports = {
  getUserById,
  listUsers,
};
