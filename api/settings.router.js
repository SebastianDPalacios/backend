const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  getPosTicketSettings,
  getCurrentCommercialVersion,
  publishCommercialVersion,
  updatePosTicketSettings,
} = require("../services/settings.service");

const router = express.Router();
const canConfigureTicket = requirePermission("roles.manage");

router.get("/system-version", verifyToken, async (req, res, next) => {
  try {
    res.json(await getCurrentCommercialVersion());
  } catch (error) {
    next(error);
  }
});

router.post("/system-version", verifyToken, canConfigureTicket, async (req, res, next) => {
  try {
    res.status(201).json(await publishCommercialVersion(req.body || {}, req.user.userId));
  } catch (error) {
    next(error);
  }
});

router.get("/pos-ticket", verifyToken, async (req, res, next) => {
  try {
    const result = await getPosTicketSettings();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/pos-ticket", verifyToken, canConfigureTicket, async (req, res, next) => {
  try {
    const result = await updatePosTicketSettings(req.body || {}, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
