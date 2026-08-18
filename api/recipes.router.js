const express = require("express");
const { verifyToken, requirePermission } = require("../middlewares/auth.handler");
const {
  createRecipe,
  listRecipes,
  getRecipeDetail,
  getRecipeBaseData,
  createCostingRecipe,
  createRecipeVersion,
  addRecipeItem,
  removeRecipeItem,
  publishRecipeVersion,
  addRecipeOutput,
  removeRecipeOutput,
  listRecipeOutputs,
  deleteRecipeFamily,
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
      onlyCurrent: req.query.includeVersions !== "1",
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

router.get("/:id", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await getRecipeDetail({
      recipeId: Number(req.params.id),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    res.json(await deleteRecipeFamily({ recipeId: Number(req.params.id) }, req.user.userId));
  } catch (error) {
    next(error);
  }
});

router.post("/costing", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await createCostingRecipe(req.body, req.user.userId);
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

router.post("/:id/version", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await createRecipeVersion(Number(req.params.id), req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/outputs", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await listRecipeOutputs({
      p_recipe_id: Number(req.params.id),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/outputs", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await addRecipeOutput(
      { ...req.body, p_recipe_id: Number(req.params.id) },
      req.user.userId
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/outputs/:productId", verifyToken, canManageRecipes, async (req, res, next) => {
  try {
    const result = await removeRecipeOutput(
      {
        p_recipe_id: Number(req.params.id),
        p_product_id: Number(req.params.productId),
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
