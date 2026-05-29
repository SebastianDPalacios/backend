const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  listInventoryBaseData,
  applyInventoryMovement,
} = require("../services/inventory.service");

const router = express.Router();
const canManageInventory = requirePermission("inventory.manage");

router.get("/base-data", verifyToken, canManageInventory, async (req, res, next) => {
  try {
    const result = await listInventoryBaseData({
      onlyActive: req.query.onlyActive,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.pageSize,
      branchId: req.query.branchId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/movements", verifyToken, canManageInventory, async (req, res, next) => {
  try {
    const result = await applyInventoryMovement(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
