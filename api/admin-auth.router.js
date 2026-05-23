const express = require("express");
const { verifyToken } = require("../middlewares/auth.handler");
const {
  createUser,
  updateUserProfile,
  assignUserRoles,
  setUserStatus,
  forceUserPasswordReset,
  logoutAllUserSessions,
  resetUserPasswordByAdmin,
  changeOwnPassword,
} = require("../services/admin-auth.service");

const router = express.Router();

router.post("/users", verifyToken, async (req, res, next) => {
  try {
    const result = await createUser(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/users/:id/profile", verifyToken, async (req, res, next) => {
  try {
    const result = await updateUserProfile(
      { ...req.body, p_user_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/users/:id/roles", verifyToken, async (req, res, next) => {
  try {
    const result = await assignUserRoles(
      { ...req.body, p_user_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/users/:id/status", verifyToken, async (req, res, next) => {
  try {
    const result = await setUserStatus(
      { ...req.body, p_user_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/users/:id/force-password-reset", verifyToken, async (req, res, next) => {
  try {
    const result = await forceUserPasswordReset(
      { ...req.body, p_user_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/users/:id/logout-all", verifyToken, async (req, res, next) => {
  try {
    const result = await logoutAllUserSessions(
      { ...req.body, p_user_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/users/:id/reset-password", verifyToken, async (req, res, next) => {
  try {
    const result = await resetUserPasswordByAdmin(
      { ...req.body, p_target_user_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/change-password", verifyToken, async (req, res, next) => {
  try {
    const result = await changeOwnPassword(
      { ...req.body, p_user_id: req.user.userId },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
