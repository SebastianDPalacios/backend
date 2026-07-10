const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  getPosTicketSettings,
  updatePosTicketSettings,
} = require("../services/settings.service");

const router = express.Router();
const canConfigureTicket = requirePermission("roles.manage");

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
