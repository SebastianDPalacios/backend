const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  createRecipe,
  listRecipes,
  getRecipeBaseData,
  addRecipeItem,
  removeRecipeItem,
  publishRecipeVersion,
} = require("../services/recipes.service");

const router = express.Router();
const canManageRecipes = requirePermission("recipes.manage");

router.post("/", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await createRecipe(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await listRecipes({
      onlyActive: req.query.onlyActive,
      productId: req.query.product_id,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/base-data", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await getRecipeBaseData({
      onlyActive: req.query.onlyActive,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/items", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await addRecipeItem(
      { ...req.body, p_recipe_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/items/:rawMaterialId", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await removeRecipeItem(
      {
        p_recipe_id: Number(req.params.id),
        p_raw_material_id: Number(req.params.rawMaterialId),
      },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/publish", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await publishRecipeVersion(
      { p_recipe_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
