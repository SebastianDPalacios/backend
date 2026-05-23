const express = require("express");
const { verifyToken } = require("../middlewares/auth.handler");
const { lookupError, getConfig } = require("../services/standard.service");

const router = express.Router();

router.get("/errors/:code", verifyToken, async (req, res, next) => {
  try {
    const result = await lookupError({ p_error_code: req.params.code });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/config/:key", verifyToken, async (req, res, next) => {
  try {
    const result = await getConfig({ p_config_key: req.params.key });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/template-operation", verifyToken, async (req, res, next) => {
  try {
    res.status(501).json({
      code: 0,
      message: "sp_std_template_operation no esta disponible en esta version",
      data: null,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
