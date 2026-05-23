const express = require("express");
const { verifyToken } = require("../middlewares/auth.handler");
const {
  listInventoryBaseData,
  applyInventoryMovement,
} = require("../services/inventory.service");

const router = express.Router();

router.get("/base-data", verifyToken, async (req, res, next) => {
  try {
    const result = await listInventoryBaseData({
      onlyActive: req.query.onlyActive,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/movements", verifyToken, async (req, res, next) => {
  try {
    const result = await applyInventoryMovement(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
