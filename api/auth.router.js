const express = require("express");
const boom = require("@hapi/boom");
const { verifyToken } = require("../middlewares/auth.handler");
const { login, refreshSession, logout } = require("../services/auth.service");
const announcements = require("../services/system-announcements.service");

const assertLoginAllowed = async (result) => {
  if (result?.code !== 1) return;
  try {
    await announcements.assertSystemAccess({ roles: result.data.roles, permissions: result.data.permissions });
  } catch (error) {
    if (result.data?.session_id && result.data?.user?.user_id) {
      await logout({ sessionId: result.data.session_id, userId: result.data.user.user_id });
    }
    throw error;
  }
};

const router = express.Router();

router.post("/login", async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      throw boom.badRequest("identifier y password son requeridos");
    }

    const result = await login({
      identifier,
      password,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || "unknown",
    });

    if (result.code !== 1) {
      return res.status(401).json(result);
    }
    await assertLoginAllowed(result);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const sessionId = req.body.sessionId || req.body.session_id;
    const userId = req.body.userId || req.body.user_id;
    const refreshToken = req.body.refreshToken || req.body.refresh_token;
    if (!sessionId || !userId || !refreshToken) {
      throw boom.badRequest("sessionId/session_id, userId/user_id y refreshToken/refresh_token son requeridos");
    }

    const result = await refreshSession({ sessionId, userId, refreshToken });
    if (result.code !== 1) {
      return res.status(401).json(result);
    }
    await assertLoginAllowed(result);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/logout", verifyToken, async (req, res, next) => {
  try {
    const sessionId = req.body.sessionId || req.body.session_id;
    if (!sessionId) {
      throw boom.badRequest("sessionId o session_id es requerido");
    }

    const result = await logout({
      sessionId,
      userId: req.user.userId,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/session", verifyToken, async (req, res, next) => {
  try {
    res.json({
      code: 1,
      message: "sesion activa",
      data: {
        user_id: req.user.userId,
        session_id: req.user.sessionId,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
