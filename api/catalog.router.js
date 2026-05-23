const express = require("express");
const { verifyToken } = require("../middlewares/auth.handler");
const {
  listBranches,
  listCustomers,
  listRoutes,
  listProducts,
  listRawMaterials,
  createBranch,
  updateBranch,
  createTaxRate,
  updateTaxRate,
  createProductCategory,
  updateProductCategory,
  createRawMaterialCategory,
  updateRawMaterialCategory,
  createSupplier,
  updateSupplier,
  createProduct,
  updateProduct,
  setProductStatus,
  createRawMaterial,
  updateRawMaterial,
  setRawMaterialStatus,
} = require("../services/catalog.service");

const router = express.Router();

router.get("/branches", verifyToken, async (req, res, next) => {
  try {
    const result = await listBranches({ onlyActive: req.query.onlyActive });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/customers", verifyToken, async (req, res, next) => {
  try {
    const result = await listCustomers({
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

router.get("/routes", verifyToken, async (req, res, next) => {
  try {
    const result = await listRoutes({
      onlyActive: req.query.onlyActive,
      refDate: req.query.refDate,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/products", verifyToken, async (req, res, next) => {
  try {
    const result = await listProducts({
      onlyActive: req.query.onlyActive,
      categoryId: req.query.categoryId,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/raw-materials", verifyToken, async (req, res, next) => {
  try {
    const result = await listRawMaterials({
      onlyActive: req.query.onlyActive,
      categoryId: req.query.categoryId,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/branches", verifyToken, async (req, res, next) => {
  try {
    const result = await createBranch(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/branches/:id", verifyToken, async (req, res, next) => {
  try {
    const result = await updateBranch(
      { ...req.body, p_branch_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/tax-rates", verifyToken, async (req, res, next) => {
  try {
    const result = await createTaxRate(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/tax-rates/:id", verifyToken, async (req, res, next) => {
  try {
    const result = await updateTaxRate(
      { ...req.body, p_tax_rate_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/product-categories", verifyToken, async (req, res, next) => {
  try {
    const result = await createProductCategory(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/product-categories/:id", verifyToken, async (req, res, next) => {
  try {
    const result = await updateProductCategory(
      { ...req.body, p_category_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/raw-material-categories", verifyToken, async (req, res, next) => {
  try {
    const result = await createRawMaterialCategory(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/raw-material-categories/:id", verifyToken, async (req, res, next) => {
  try {
    const result = await updateRawMaterialCategory(
      { ...req.body, p_category_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/suppliers", verifyToken, async (req, res, next) => {
  try {
    const result = await createSupplier(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/suppliers/:id", verifyToken, async (req, res, next) => {
  try {
    const result = await updateSupplier(
      { ...req.body, p_supplier_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/products", verifyToken, async (req, res, next) => {
  try {
    const result = await createProduct(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/products/:id", verifyToken, async (req, res, next) => {
  try {
    const result = await updateProduct(
      { ...req.body, p_product_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/products/:id/status", verifyToken, async (req, res, next) => {
  try {
    const result = await setProductStatus(
      { ...req.body, p_product_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/raw-materials", verifyToken, async (req, res, next) => {
  try {
    const result = await createRawMaterial(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/raw-materials/:id", verifyToken, async (req, res, next) => {
  try {
    const result = await updateRawMaterial(
      { ...req.body, p_raw_material_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/raw-materials/:id/status", verifyToken, async (req, res, next) => {
  try {
    const result = await setRawMaterialStatus(
      { ...req.body, p_raw_material_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
