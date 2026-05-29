const bcrypt = require("bcryptjs");
const { callProcedure } = require("../data-access");
const { mapSpResult } = require("./sp-response");

const validatePasswordPolicy = async ({ password, username, email }) => {
  const out = await callProcedure("sp_auth_validate_password_policy", [
    password || null,
    username || null,
    email || null,
  ]);
  return mapSpResult(out);
};

const hashPassword = async (password) => {
  if (!password) return null;
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 12);
  return bcrypt.hash(password, saltRounds);
};

const createUser = async (payload, actorUserId) => {
  const rawPassword = payload.p_password_hash || null;
  const validation = await validatePasswordPolicy({
    password: rawPassword,
    username: payload.p_username,
    email: payload.p_email,
  });

  if (validation.code !== 1) {
    return validation;
  }

  const passwordHash = await hashPassword(rawPassword);

  const out = await callProcedure("sp_user_create", [
    payload.p_username || null,
    payload.p_email || null,
    passwordHash,
    payload.p_password_algo || "bcrypt",
    payload.p_full_name || null,
    payload.p_phone || null,
    payload.p_role_code || null,
    payload.p_must_change_password || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const updateUserProfile = async (payload, actorUserId) => {
  const out = await callProcedure("sp_user_update_profile", [
    payload.p_user_id,
    payload.p_full_name || null,
    payload.p_email || null,
    payload.p_phone || null,
    payload.p_status || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const assignUserRoles = async (payload, actorUserId) => {
  const roleCodes = payload.p_role_codes_json;
  const normalizedRoles = roleCodes && typeof roleCodes === "object" ? JSON.stringify(roleCodes) : roleCodes || null;
  const out = await callProcedure("sp_user_assign_roles", [
    payload.p_user_id,
    normalizedRoles,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const setUserStatus = async (payload, actorUserId) => {
  const out = await callProcedure("sp_user_set_status", [
    payload.p_user_id,
    payload.p_status || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const forceUserPasswordReset = async (payload, actorUserId) => {
  const out = await callProcedure("sp_user_force_password_reset", [
    payload.p_user_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const logoutAllUserSessions = async (payload, actorUserId) => {
  const out = await callProcedure("sp_auth_logout_all", [
    payload.p_user_id,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const resetUserPasswordByAdmin = async (payload, actorUserId) => {
  const newPassword = payload.p_new_password_hash || null;
  const validation = await validatePasswordPolicy({
    password: newPassword,
    username: payload.p_target_username,
    email: payload.p_target_email,
  });

  if (validation.code !== 1) {
    return validation;
  }

  const passwordHash = await hashPassword(newPassword);
  const out = await callProcedure("sp_auth_reset_password_admin", [
    payload.p_target_user_id,
    passwordHash,
    payload.p_new_password_algo || "bcrypt",
    payload.p_force_change_next_login || null,
    payload.p_revoke_all_sessions || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

const changeOwnPassword = async (payload, actorUserId) => {
  const newPassword = payload.p_new_password_hash || null;
  const validation = await validatePasswordPolicy({
    password: newPassword,
    username: payload.p_username,
    email: payload.p_email,
  });

  if (validation.code !== 1) {
    return validation;
  }

  const passwordHash = await hashPassword(newPassword);
  const out = await callProcedure("sp_auth_change_password", [
    payload.p_user_id,
    payload.p_expected_current_hash || null,
    passwordHash,
    payload.p_new_password_algo || "bcrypt",
    payload.p_revoke_all_sessions || null,
    actorUserId || null,
  ]);
  return mapSpResult(out);
};

module.exports = {
  createUser,
  updateUserProfile,
  assignUserRoles,
  setUserStatus,
  forceUserPasswordReset,
  logoutAllUserSessions,
  resetUserPasswordByAdmin,
  changeOwnPassword,
};
