const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  listProductionOrders,
  createProductionOrder,
  listProductionOrderItems,
  upsertProductionOrderItem,
  updateProductionOrderItemPlan,
  cancelProductionOrderItem,
  registerProductionOrderItemResult,
  listProductionBaseData,
  registerProductionResult,
  closeProductionOrder,
  cancelProductionOrder,
} = require("../services/production.service");

const router = express.Router();
const canManageProduction = requirePermission("production.manage");

router.get("/orders", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await listProductionOrders({
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

router.post("/orders", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await createProductionOrder(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/orders/:id/items", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await listProductionOrderItems({
      productionOrderId: Number(req.params.id),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/items", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await upsertProductionOrderItem(
      { ...req.body, p_production_order_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/orders/:id/items/:itemId", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await updateProductionOrderItemPlan(
      {
        ...req.body,
        p_production_order_id: Number(req.params.id),
        p_production_order_item_id: Number(req.params.itemId),
      },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/items/:itemId/cancel", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await cancelProductionOrderItem(
      {
        ...req.body,
        p_production_order_id: Number(req.params.id),
        p_production_order_item_id: Number(req.params.itemId),
      },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/items/:itemId/results", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await registerProductionOrderItemResult(
      {
        ...req.body,
        p_production_order_id: Number(req.params.id),
        p_production_order_item_id: Number(req.params.itemId),
      },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/base-data", verifyToken, canManageProduction, async (req, res, next) => {
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

router.post("/results", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await registerProductionResult(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/close", verifyToken, canManageProduction, async (req, res, next) => {
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

router.post("/orders/:id/cancel", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await cancelProductionOrder(
      { ...req.body, p_production_order_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
