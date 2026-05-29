const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  createCustomer,
  updateCustomer,
  setCustomerStatus,
  createRoute,
  updateRoute,
  setRouteStatus,
  assignRouteDriver,
} = require("../services/commercial.service");

const router = express.Router();
const canManageCustomers = requirePermission("customers.manage");
const canManageRoutes = requirePermission("routes.manage");

router.post("/customers", verifyToken, canManageCustomers, async (req, res, next) => {
  try {
    const result = await createCustomer(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/customers/:id", verifyToken, canManageCustomers, async (req, res, next) => {
  try {
    const result = await updateCustomer(
      { ...req.body, p_customer_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/customers/:id/status", verifyToken, canManageCustomers, async (req, res, next) => {
  try {
    const result = await setCustomerStatus(
      { ...req.body, p_customer_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/routes", verifyToken, canManageRoutes, async (req, res, next) => {
  try {
    const result = await createRoute(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/routes/:id", verifyToken, canManageRoutes, async (req, res, next) => {
  try {
    const result = await updateRoute(
      { ...req.body, p_route_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/routes/:id/status", verifyToken, canManageRoutes, async (req, res, next) => {
  try {
    const result = await setRouteStatus(
      { ...req.body, p_route_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/routes/:id/assign-driver", verifyToken, canManageRoutes, async (req, res, next) => {
  try {
    const result = await assignRouteDriver(
      { ...req.body, p_route_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
