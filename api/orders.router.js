const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  listOrders,
  listOrderItems,
  listProductionReservations,
  listProductionReservationOptions,
  listOrderBaseData,
  listSellerCustomerAssignments,
  assignCustomerToSeller,
  syncSellerCustomers,
  unassignCustomerFromSeller,
  getSalesSettings,
  updateSalesSettings,
  createOrder,
  getOrderPrintData,
  confirmOrderPrint,
  upsertOrderItem,
  createProductionReservation,
  deliverProductionReservation,
  releaseProductionReservation,
  confirmOrder,
  cancelOrder,
  dispatchOrder,
  deliverOrder,
  updateOrderDeliveryDate,
  updateOrderCustomer,
  updateOrderSeller,
  listSalesCommissions,
  listSalesGifts,
  getDailySalesSettlement,
  createSalesGift,
  getCustomerCreditBalance,
  listSalesReturnOptions,
  listSalesReturns,
  createSalesReturn,
  authorizeSalesReturn,
  rejectSalesReturn,
  createProductionFromOrder,
  createPurchaseOrder,
  listPendingPurchaseOrders,
  listPurchaseOrderHistory,
  getPurchaseOrderDetail,
  receivePurchaseOrder,
} = require("../services/orders.service");

const router = express.Router();
const canManageOrders = requirePermission("orders.manage");
const canManageInventory = requirePermission("inventory.manage");
const canConfigureSales = requirePermission("roles.manage");
const administrativeRoleCodes = ["ADMIN", "SUPER_ADMIN", "ADMINISTRATIVO", "ADMINISTRATIVE"];

const hasElevatedCustomerAccess = (user = {}) => {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const roleCodes = roles
    .map((role) => (typeof role === "string" ? role : role?.code))
    .filter(Boolean)
    .map((role) => String(role).trim().toUpperCase());

  return roleCodes.some((code) => administrativeRoleCodes.includes(code));
};

const requireAdministrativeRole = (req, res, next) => {
  if (!hasElevatedCustomerAccess(req.user)) {
    return res.status(403).json({ code: 0, message: "solo un administrador puede eliminar pedidos", data: null });
  }
  return next();
};

router.get("/", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await listOrders({
      status: req.query.status,
      search: req.query.search,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      page: req.query.page,
      pageSize: req.query.pageSize,
      actorUserId: req.user.userId,
      canViewAll: hasElevatedCustomerAccess(req.user),
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
      actorUserId: req.user.userId,
      canViewAllCustomers: hasElevatedCustomerAccess(req.user),
      salesAgentUserId: req.query.salesAgentUserId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await createOrder(req.body, req.user.userId, {
      canViewAllCustomers: hasElevatedCustomerAccess(req.user),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/settings/sales", verifyToken, canConfigureSales, async (req, res, next) => {
  try {
    const result = await getSalesSettings();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/seller-customer-assignments", verifyToken, canConfigureSales, async (req, res, next) => {
  try {
    const result = await listSellerCustomerAssignments();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/seller-customer-assignments/:customerId", verifyToken, canConfigureSales, async (req, res, next) => {
  try {
    const result = await assignCustomerToSeller(
      {
        customerId: Number(req.params.customerId),
        salesAgentUserId: Number(req.body?.sales_agent_user_id),
      },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/seller-customer-assignments/seller/:sellerId", verifyToken, canConfigureSales, async (req, res, next) => {
  try {
    const result = await syncSellerCustomers(
      {
        salesAgentUserId: Number(req.params.sellerId),
        customerIds: req.body?.customer_ids,
      },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete("/seller-customer-assignments/:customerId", verifyToken, canConfigureSales, async (req, res, next) => {
  try {
    const result = await unassignCustomerFromSeller(
      { customerId: Number(req.params.customerId) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/commissions", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await listSalesCommissions({
      salesAgentUserId: req.query.salesAgentUserId,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      actorUserId: req.user.userId,
      canViewAll: hasElevatedCustomerAccess(req.user),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/commissions/daily-settlement", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await getDailySalesSettlement({
      salesAgentUserId: req.query.salesAgentUserId,
      settlementDate: req.query.date,
      actorUserId: req.user.userId,
      canViewAll: hasElevatedCustomerAccess(req.user),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/gifts", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await listSalesGifts({
      salesAgentUserId: req.query.salesAgentUserId,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      actorUserId: req.user.userId,
      canViewAll: hasElevatedCustomerAccess(req.user),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/gifts", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await createSalesGift(req.body, req.user.userId, {
      canViewAllCustomers: hasElevatedCustomerAccess(req.user),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/customer-credits/:customerId", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await getCustomerCreditBalance({
      customerId: req.params.customerId,
      actorUserId: req.user.userId,
      canViewAll: hasElevatedCustomerAccess(req.user),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router.get("/returns/options", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await listSalesReturnOptions({
      actorUserId: req.user.userId,
      canViewAll: hasElevatedCustomerAccess(req.user),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/returns", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await listSalesReturns({
      actorUserId: req.user.userId,
      canViewAll: hasElevatedCustomerAccess(req.user),
      status: req.query.status,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/returns", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await createSalesReturn(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/returns/:id/authorize", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await authorizeSalesReturn(
      {
        salesReturnId: Number(req.params.id),
        canAuthorize: hasElevatedCustomerAccess(req.user),
      },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/returns/:id/reject", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await rejectSalesReturn(
      {
        salesReturnId: Number(req.params.id),
        reason: req.body?.reason,
        canAuthorize: hasElevatedCustomerAccess(req.user),
      },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/settings/sales", verifyToken, canConfigureSales, async (req, res, next) => {
  try {
    const result = await updateSalesSettings(req.body, req.user.userId);
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

router.get("/purchase-orders/history", verifyToken, canManageInventory, async (req, res, next) => {
  try {
    const result = await listPurchaseOrderHistory({
      branchId: req.query.branchId,
      supplierId: req.query.supplierId,
      search: req.query.search,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/purchase-orders/:id/detail", verifyToken, canManageInventory, async (req, res, next) => {
  try {
    const result = await getPurchaseOrderDetail({
      purchaseOrderId: Number(req.params.id),
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

router.get("/:id/print-data", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await getOrderPrintData({
      orderId: Number(req.params.id),
      actorUserId: req.user.userId,
      canViewAll: hasElevatedCustomerAccess(req.user),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/confirm-print", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await confirmOrderPrint({
      orderId: Number(req.params.id),
      actorUserId: req.user.userId,
      canViewAll: hasElevatedCustomerAccess(req.user),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/production-reservations", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await listProductionReservations({ orderId: Number(req.params.id) });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/production-reservation-options", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await listProductionReservationOptions({ orderId: Number(req.params.id) });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/production-reservations", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await createProductionReservation(
      { ...req.body, p_order_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/production-reservations/:id/deliver", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await deliverProductionReservation(
      { reservationId: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/production-reservations/:id/release", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await releaseProductionReservation(
      { reservationId: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/:id/delivery-date", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await updateOrderDeliveryDate(
      {
        orderId: Number(req.params.id),
        deliveryDate: req.body?.delivery_date,
      },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router.put("/:id/customer", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await updateOrderCustomer(
      {
        orderId: Number(req.params.id),
        customerId: Number(req.body?.customer_id),
        actorUserId: req.user.userId,
        canViewAll: hasElevatedCustomerAccess(req.user),
      }
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router.put("/:id/seller", verifyToken, canManageOrders, requireAdministrativeRole, async (req, res, next) => {
  try {
    const result = await updateOrderSeller({
      orderId: Number(req.params.id),
      salesAgentUserId: Number(req.body?.sales_agent_user_id),
      customerId: Number(req.body?.customer_id),
      actorUserId: req.user.userId,
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

router.post("/:id/cancel", verifyToken, canManageOrders, requireAdministrativeRole, async (req, res, next) => {
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

router.post("/:id/deliver", verifyToken, canManageOrders, async (req, res, next) => {
  try {
    const result = await deliverOrder(
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



