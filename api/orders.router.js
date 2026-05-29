const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  listOrders,
  listOrderItems,
  listOrderBaseData,
  createOrder,
  upsertOrderItem,
  confirmOrder,
  cancelOrder,
  dispatchOrder,
  createProductionFromOrder,
  createPurchaseOrder,
  listPendingPurchaseOrders,
  receivePurchaseOrder,
} = require("../services/orders.service");

const router = express.Router();
const canManageOrders = requirePermission("orders.manage");
const canManageInventory = requirePermission("inventory.manage");

router.get("/", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await listOrders({
      status: req.query.status,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/base-data", verifyToken, canManageOrders, async (req, res, next) => {
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

router.post("/", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await createOrder(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/purchase-orders/pending", verifyToken, canManageInventory, async (req, res, next) => {
  try {
    const result = await listPendingPurchaseOrders({
      branchId: req.query.branchId,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/purchase-orders", verifyToken, canManageInventory, async (req, res, next) => {
  try {
    const result = await createPurchaseOrder(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/items", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await listOrderItems({
      orderId: Number(req.params.id),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/items", verifyToken, canManageOrders, async (req, res, next) => {
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

router.post("/:id/confirm", verifyToken, canManageOrders, async (req, res, next) => {
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

router.post("/:id/cancel", verifyToken, canManageOrders, async (req, res, next) => {
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

router.post("/:id/dispatch", verifyToken, canManageOrders, async (req, res, next) => {
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

router.post("/:id/create-production", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await createProductionFromOrder(
      { ...req.body, p_order_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/purchase-orders/:id/receive", verifyToken, canManageInventory, async (req, res, next) => {
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
