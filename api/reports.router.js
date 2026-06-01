const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const { listAuditLogs } = require("../services/reports.service");

const router = express.Router();
const canViewAudit = requirePermission("roles.manage");

router.get("/audit", verifyToken, canViewAudit, async (req, res, next) => {
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
