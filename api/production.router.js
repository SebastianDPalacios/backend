const express = require("express");
const { verifyToken } = require("../middlewares/auth.handler");
const {
  listProductionBaseData,
  registerProductionResult,
  closeProductionOrder,
} = require("../services/production.service");

const router = express.Router();

router.get("/base-data", verifyToken, async (req, res, next) => {
  try {
    const result = await listProductionBaseData({
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

router.post("/results", verifyToken, async (req, res, next) => {
  try {
    const result = await registerProductionResult(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/close", verifyToken, async (req, res, next) => {
  try {
    const result = await closeProductionOrder(
      { p_production_order_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
