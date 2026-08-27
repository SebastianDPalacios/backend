const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const service = require("../services/system-announcements.service");

const router = express.Router();
router.get("/current", verifyToken, async (req, res, next) => {
  try { res.json({ code: 1, message: "aviso actual", data: await service.assertSystemAccess(req.user) }); } catch (error) { next(error); }
});
router.get("/", verifyToken, requirePermission("roles.manage"), async (req, res, next) => {
  try { res.json({ code: 1, message: "avisos obtenidos", data: await service.list() }); } catch (error) { next(error); }
});
router.post("/", verifyToken, requirePermission("roles.manage"), async (req, res, next) => {
  try {
    const data = await service.create({
      message: req.body.message,
      displayFrom: req.body.display_from || req.body.displayFrom,
      forceLogoutAt: req.body.force_logout_at || req.body.forceLogoutAt,
      userId: req.user.userId,
      ipAddress: req.ip,
    });
    res.status(201).json({ code: 1, message: "aviso programado", data });
  } catch (error) { next(error); }
});
router.patch("/:id/end", verifyToken, requirePermission("roles.manage"), async (req, res, next) => {
  try { await service.end({ id: req.params.id, userId: req.user.userId, ipAddress: req.ip }); res.json({ code: 1, message: "aviso finalizado", data: null }); } catch (error) { next(error); }
});
module.exports = router;
