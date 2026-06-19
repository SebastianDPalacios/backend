const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  createCustomer,
  updateCustomer,
  setCustomerStatus,
} = require("../services/commercial.service");

const router = express.Router();
const canManageCustomers = requirePermission("customers.manage");

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

module.exports = router;
