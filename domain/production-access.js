const normalizeAccessCodes = (items = []) => new Set(
  (Array.isArray(items) ? items : [])
    .map((item) => typeof item === "string" ? item : item?.code || item?.permission_code || item?.name)
    .filter(Boolean)
    .map((code) => String(code).trim().toUpperCase())
);

const getProductionAccess = (user = {}) => {
  const roles = normalizeAccessCodes(user.roles);
  const permissions = normalizeAccessCodes(user.permissions);
  const administrator = roles.has("ADMIN") || roles.has("SUPER_ADMIN") || permissions.has("PRODUCTION.MANAGE");

  return {
    administrator,
    baker: administrator || permissions.has("PRODUCTION.BAKER"),
    packer: administrator || permissions.has("PRODUCTION.PACKAGING"),
  };
};

const isProductionAdministrator = (user) => getProductionAccess(user).administrator;

module.exports = {
  normalizeAccessCodes,
  getProductionAccess,
  isProductionAdministrator,
};
