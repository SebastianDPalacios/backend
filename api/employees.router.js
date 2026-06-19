const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  createEmployee,
  listEmployees,
} = require("../services/employees.service");

const router = express.Router();
const canManageUsers = requirePermission("users.manage", "employees.manage", "production.manage");

router.get("/", verifyToken, canManageUsers, async (req, res, next) => {
  try {
    const result = await listEmployees({
      status: req.query.status,
      jobType: req.query.jobType || req.query.job_type,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/", verifyToken, canManageUsers, async (req, res, next) => {
  try {
    const result = await createEmployee(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
