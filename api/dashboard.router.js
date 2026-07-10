const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const { getMonthlyDashboard } = require("../services/dashboard.service");

const router = express.Router();

router.get("/monthly", verifyToken, requirePermission("reports.view"), async (req, res, next) => {
  try {
    const result = await getMonthlyDashboard({
      month: req.query.month,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
