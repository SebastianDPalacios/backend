const express = require("express");
const { verifyToken } = require("../middlewares/auth.handler");
const {
  createRole,
  updateRole,
  createPermission,
  setRolePermissions,
} = require("../services/rbac.service");

const router = express.Router();

router.post("/roles", verifyToken, async (req, res, next) => {
  try {
    const result = await createRole(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/roles/:id", verifyToken, async (req, res, next) => {
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

router.post("/permissions", verifyToken, async (req, res, next) => {
  try {
    const result = await createPermission(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/roles/:id/permissions", verifyToken, async (req, res, next) => {
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
