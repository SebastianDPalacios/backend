const express = require("express");
const { verifyToken, requireAdministrativeRole } = require("../middlewares/auth.handler");
const {
  createWholesalePriceList,
  deactivateWholesalePrice,
  listWholesaleConfiguration,
  listWholesaleHistory,
  saveWholesalePrice,
  setWholesaleCustomer,
  updateWholesalePriceList,
  listWholesaleDuplicateProducts,
  approveWholesaleProductEquivalence,
} = require("../services/wholesale.service");

const router = express.Router();

router.use(verifyToken, requireAdministrativeRole);

router.get("/configuration", async (req, res, next) => {
  try {
    res.json(await listWholesaleConfiguration());
  } catch (error) { next(error); }
});

router.get("/history", async (req, res, next) => {
  try {
    res.json(await listWholesaleHistory(req.query));
  } catch (error) { next(error); }
});

router.get("/duplicate-products/audit", async (req, res, next) => {
  try {
    res.json(await listWholesaleDuplicateProducts());
  } catch (error) { next(error); }
});

router.post("/duplicate-products/approve", async (req, res, next) => {
  try {
    res.json(await approveWholesaleProductEquivalence(req.body || {}, req.user.userId));
  } catch (error) { next(error); }
});

router.post("/price-lists", async (req, res, next) => {
  try {
    res.json(await createWholesalePriceList(req.body || {}, req.user.userId));
  } catch (error) { next(error); }
});

router.put("/price-lists/:id", async (req, res, next) => {
  try {
    res.json(await updateWholesalePriceList({ ...req.body, priceListId: req.params.id }, req.user.userId));
  } catch (error) { next(error); }
});

router.put("/customers/:id", async (req, res, next) => {
  try {
    res.json(await setWholesaleCustomer({ ...req.body, customerId: req.params.id }, req.user.userId));
  } catch (error) { next(error); }
});

router.post("/prices", async (req, res, next) => {
  try {
    res.json(await saveWholesalePrice(req.body || {}, req.user.userId));
  } catch (error) { next(error); }
});

router.put("/prices/:id", async (req, res, next) => {
  try {
    res.json(await saveWholesalePrice({ ...req.body, priceId: req.params.id }, req.user.userId));
  } catch (error) { next(error); }
});

router.post("/prices/:id/deactivate", async (req, res, next) => {
  try {
    res.json(await deactivateWholesalePrice({ priceId: req.params.id, reason: req.body?.reason }, req.user.userId));
  } catch (error) { next(error); }
});

module.exports = router;
