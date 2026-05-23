const express = require("express");
const { verifyToken } = require("../middlewares/auth.handler");
const {
  listOrderBaseData,
  createOrder,
  upsertOrderItem,
  confirmOrder,
  cancelOrder,
  dispatchOrder,
  receivePurchaseOrder,
} = require("../services/orders.service");

const router = express.Router();

router.get("/base-data", verifyToken, async (req, res, next) => {
  try {
    const result = await listOrderBaseData({
      onlyActive: req.query.onlyActive,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.pageSize,
      refDate: req.query.refDate,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/", verifyToken, async (req, res, next) => {
  try {
    const result = await createOrder(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/items", verifyToken, async (req, res, next) => {
  try {
    const result = await upsertOrderItem(
      { ...req.body, p_order_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/confirm", verifyToken, async (req, res, next) => {
  try {
    const result = await confirmOrder(
      { p_order_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/cancel", verifyToken, async (req, res, next) => {
  try {
    const result = await cancelOrder(
      { ...req.body, p_order_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/dispatch", verifyToken, async (req, res, next) => {
  try {
    const result = await dispatchOrder(
      { p_order_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/purchase-orders/:id/receive", verifyToken, async (req, res, next) => {
  try {
    const result = await receivePurchaseOrder(
      { p_purchase_order_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
