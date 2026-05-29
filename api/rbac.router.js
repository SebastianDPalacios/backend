const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  listRoles,
  listPermissions,
  createRole,
  updateRole,
  createPermission,
  setRolePermissions,
} = require("../services/rbac.service");

const router = express.Router();
const canManageRoles = requirePermission("roles.manage");

router.get("/roles", verifyToken, canManageRoles, async (req, res, next) => {
  try {
    const result = await listRoles();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/roles", verifyToken, canManageRoles, async (req, res, next) => {
  try {
    const result = await createRole(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/roles/:id", verifyToken, canManageRoles, async (req, res, next) => {
  try {
    const result = await updateRole(
      { ...req.body, p_role_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/permissions", verifyToken, canManageRoles, async (req, res, next) => {
  try {
    const result = await listPermissions();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/permissions", verifyToken, canManageRoles, async (req, res, next) => {
  try {
    const result = await createPermission(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/roles/:id/permissions", verifyToken, canManageRoles, async (req, res, next) => {
  try {
    const result = await setRolePermissions(
      { ...req.body, p_role_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
