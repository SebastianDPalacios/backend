const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const { listAuditLogs } = require("../services/reports.service");

const router = express.Router();
const canViewReports = requirePermission("reports.view");

router.get("/audit", verifyToken, canViewReports, async (req, res, next) => {
  try {
    const result = await listAuditLogs({
      search: req.query.search,
      action: req.query.action,
      entityName: req.query.entityName,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
