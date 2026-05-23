const express = require("express");
const boom = require("@hapi/boom");
const { verifyToken } = require("../middlewares/auth.handler");
const { getUserById, listUsers } = require("../services/users.service");

const router = express.Router();

router.get("/", verifyToken, async (req, res, next) => {
  try {
    const result = await listUsers({
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

router.get("/:id", verifyToken, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw boom.badRequest("id invalido");
    }

    const result = await getUserById(id);
    if (result.code !== 1) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
