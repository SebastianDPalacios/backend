const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const { listEmployees } = require("../services/employees.service");
const {
  listProductionOrders,
  createProductionOrder,
  listProductionOrderItems,
  upsertProductionOrderItem,
  updateProductionOrderItemPlan,
  cancelProductionOrderItem,
  registerProductionOrderItemResult,
  listProductionBaseData,
  listMyProductionBaseData,
  registerProductionResult,
  registerProductionBatch,
  registerMyProductionBatch,
  listPendingPackaging,
  createPackingReport,
  listJustifiedShortages,
  registerProductionDamage,
  getRawMaterialUsageReport,
  getRawMaterialUsageByProductReport,
  getPackingSummaryReport,
  getProductionDayReport,
  getProductionMonthReport,
  createProductionPlan,
  updateProductionPlan,
  listProductionPlans,
  startProductionPlanItem,
  finishProductionPlanItem,
  startProductionPlanProduct,
  saveProductionPlanProductProgress,
  skipProductionPlanProduct,
  finishProductionPlanProduct,
  correctProductionPlanProduct,
  listUserNotifications,
  markUserNotificationViewed,
  closeProductionOrder,
  cancelProductionOrder,
} = require("../services/production.service");

const router = express.Router();
const canManageProduction = requirePermission("production.manage");
const canRegisterBakerProduction = requirePermission("production.baker", "production.manage");
const canRegisterPackaging = requirePermission("production.packaging", "production.manage");

router.get("/plans", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await listProductionPlans({
      plannedDate: req.query.plannedDate || req.query.planned_date,
      bakerEmployeeId: req.query.bakerEmployeeId || req.query.baker_employee_id,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/plans", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await createProductionPlan(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/my-plans", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    const result = await listProductionPlans({
      userId: req.user.userId,
      plannedDate: req.query.plannedDate || req.query.planned_date,
      dateFrom: req.query.dateFrom || req.query.date_from,
      dateTo: req.query.dateTo || req.query.date_to,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/my-base-data", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    const result = await listMyProductionBaseData({ userId: req.user.userId });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/plans/:id", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    const result = await updateProductionPlan(Number(req.params.id), req.body, req.user);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/my-batches", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    const result = await registerMyProductionBatch(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router.post("/plans/items/:id/start", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    const result = await startProductionPlanItem({
      productionPlanItemId: Number(req.params.id),
      userId: req.user.userId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/plans/items/:id/finish", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    const result = await finishProductionPlanItem({
      productionPlanItemId: Number(req.params.id),
      userId: req.user.userId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/notifications", verifyToken, async (req, res, next) => {
  try {
    const result = await listUserNotifications({
      userId: req.user.userId,
      onlyUnread: req.query.onlyUnread === "1",
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/notifications/:id/viewed", verifyToken, async (req, res, next) => {
  try {
    const result = await markUserNotificationViewed({
      notificationId: Number(req.params.id),
      userId: req.user.userId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

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

router.post("/batches", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await registerProductionBatch(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/packaging/pending", verifyToken, canRegisterPackaging, async (req, res, next) => {
  try {
    const result = await listPendingPackaging({
      branchId: req.query.branchId || req.query.branch_id,
      search: req.query.search,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/packaging/packers", verifyToken, canRegisterPackaging, async (req, res, next) => {
  try {
    const result = await listEmployees({
      status: "active",
      jobType: "packer",
      search: req.query.search,
      page: 1,
      pageSize: 200,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/packaging/reports", verifyToken, canRegisterPackaging, async (req, res, next) => {
  try {
    const result = await createPackingReport(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/packaging/shortages", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await listJustifiedShortages({
      branchId: req.query.branchId || req.query.branch_id,
      productId: req.query.productId || req.query.product_id,
      missingReason: req.query.missingReason || req.query.missing_reason,
      search: req.query.search,
      dateFrom: req.query.dateFrom || req.query.date_from,
      dateTo: req.query.dateTo || req.query.date_to,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/damages", verifyToken, canRegisterPackaging, async (req, res, next) => {
  try {
    const result = await registerProductionDamage(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/reports/raw-material-usage", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await getRawMaterialUsageReport({
      dateFrom: req.query.dateFrom || req.query.date_from,
      dateTo: req.query.dateTo || req.query.date_to,
      branchId: req.query.branchId || req.query.branch_id,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/reports/raw-material-usage-by-product", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await getRawMaterialUsageByProductReport({
      dateFrom: req.query.dateFrom || req.query.date_from,
      dateTo: req.query.dateTo || req.query.date_to,
      branchId: req.query.branchId || req.query.branch_id,
      recipeId: req.query.recipeId || req.query.recipe_id,
      productId: req.query.productId || req.query.product_id,
      rawMaterialId: req.query.rawMaterialId || req.query.raw_material_id,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/plans/products/:id/start", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    res.json(await startProductionPlanProduct({
      productionPlanOutputId: Number(req.params.id),
      userId: req.user.userId,
    }));
  } catch (error) { next(error); }
});

router.patch("/plans/products/:id/progress", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    res.json(await saveProductionPlanProductProgress({
      productionPlanOutputId: Number(req.params.id),
      userId: req.user.userId,
      payload: req.body,
    }));
  } catch (error) { next(error); }
});

router.post("/plans/products/:id/skip", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    res.json(await skipProductionPlanProduct({
      productionPlanOutputId: Number(req.params.id),
      userId: req.user.userId,
      justification: req.body?.p_justification,
    }));
  } catch (error) { next(error); }
});

router.post("/plans/products/:id/finish", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    res.json(await finishProductionPlanProduct({
      productionPlanOutputId: Number(req.params.id),
      userId: req.user.userId,
      payload: req.body,
    }));
  } catch (error) { next(error); }
});

router.patch("/plans/products/:id/correction", verifyToken, canRegisterBakerProduction, async (req, res, next) => {
  try {
    res.json(await correctProductionPlanProduct({
      productionPlanOutputId: Number(req.params.id),
      actorUser: req.user,
      payload: req.body,
    }));
  } catch (error) { next(error); }
});
router.get("/reports/packing-summary", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await getPackingSummaryReport({
      dateFrom: req.query.dateFrom || req.query.date_from,
      dateTo: req.query.dateTo || req.query.date_to,
      branchId: req.query.branchId || req.query.branch_id,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/reports/day", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await getProductionDayReport({
      date: req.query.date,
      dateFrom: req.query.dateFrom || req.query.date_from,
      dateTo: req.query.dateTo || req.query.date_to,
      branchId: req.query.branchId || req.query.branch_id,
      recipeId: req.query.recipeId || req.query.recipe_id,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/reports/month", verifyToken, canManageProduction, async (req, res, next) => {
  try {
    const result = await getProductionMonthReport({
      month: req.query.month,
      dateFrom: req.query.dateFrom || req.query.date_from,
      dateTo: req.query.dateTo || req.query.date_to,
      branchId: req.query.branchId || req.query.branch_id,
      recipeId: req.query.recipeId || req.query.recipe_id,
    });
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





