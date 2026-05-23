const express = require("express");
const { verifyToken } = require("../middlewares/auth.handler");
const {
  createRecipe,
  addRecipeItem,
  removeRecipeItem,
  publishRecipeVersion,
} = require("../services/recipes.service");

const router = express.Router();

router.post("/", verifyToken, async (req, res, next) => {
  try {
    const result = await createRecipe(req.body, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/items", verifyToken, async (req, res, next) => {
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

router.delete("/:id/items/:rawMaterialId", verifyToken, async (req, res, next) => {
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

router.post("/:id/publish", verifyToken, async (req, res, next) => {
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
