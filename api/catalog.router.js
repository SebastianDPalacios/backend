const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  listBranches,
  listCustomers,
  listProducts,
  listRawMaterials,
  listTaxRates,
  listProductCategories,
  listRawMaterialCategories,
  listSuppliers,
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
const canManageProducts = requirePermission("products.manage");
const canManageMaterials = requirePermission("materials.manage");
const canManageCustomers = requirePermission("customers.manage");

router.get("/branches", verifyToken, async (req, res, next) => {
  try {
    const result = await listBranches({ onlyActive: req.query.onlyActive });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/customers", verifyToken, canManageCustomers, async (req, res, next) => {
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

router.get("/products", verifyToken, canManageProducts, async (req, res, next) => {
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

router.get("/raw-materials", verifyToken, canManageMaterials, async (req, res, next) => {
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

router.get("/tax-rates", verifyToken, canManageProducts, async (req, res, next) => {
  try {
    const result = await listTaxRates({
      onlyActive: req.query.onlyActive,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/product-categories", verifyToken, canManageProducts, async (req, res, next) => {
  try {
    const result = await listProductCategories({
      onlyActive: req.query.onlyActive,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/raw-material-categories", verifyToken, canManageMaterials, async (req, res, next) => {
  try {
    const result = await listRawMaterialCategories({
      onlyActive: req.query.onlyActive,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/suppliers", verifyToken, canManageMaterials, async (req, res, next) => {
  try {
    const result = await listSuppliers({
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

router.post("/tax-rates", verifyToken, canManageProducts, async (req, res, next) => {
  try {
    const result = await createTaxRate(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/tax-rates/:id", verifyToken, canManageProducts, async (req, res, next) => {
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

router.post("/product-categories", verifyToken, canManageProducts, async (req, res, next) => {
  try {
    const result = await createProductCategory(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/product-categories/:id", verifyToken, canManageProducts, async (req, res, next) => {
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

router.post("/raw-material-categories", verifyToken, canManageMaterials, async (req, res, next) => {
  try {
    const result = await createRawMaterialCategory(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/raw-material-categories/:id", verifyToken, canManageMaterials, async (req, res, next) => {
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

router.post("/suppliers", verifyToken, canManageMaterials, async (req, res, next) => {
  try {
    const result = await createSupplier(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/suppliers/:id", verifyToken, canManageMaterials, async (req, res, next) => {
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

router.post("/products", verifyToken, canManageProducts, async (req, res, next) => {
  try {
    const result = await createProduct(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/products/:id", verifyToken, canManageProducts, async (req, res, next) => {
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

router.patch("/products/:id/status", verifyToken, canManageProducts, async (req, res, next) => {
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

router.post("/raw-materials", verifyToken, canManageMaterials, async (req, res, next) => {
  try {
    const result = await createRawMaterial(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/raw-materials/:id", verifyToken, canManageMaterials, async (req, res, next) => {
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

router.patch("/raw-materials/:id/status", verifyToken, canManageMaterials, async (req, res, next) => {
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
