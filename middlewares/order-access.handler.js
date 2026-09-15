const { connect } = require("../data-access");

const ADMINISTRATIVE_ROLES = ["ADMIN", "SUPER_ADMIN", "ADMINISTRATIVO", "ADMINISTRATIVE"];

const isAdministrativeUser = (user = {}) => {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return roles.some((role) => {
    const code = typeof role === "string" ? role : role?.code;
    return ADMINISTRATIVE_ROLES.includes(String(code || "").trim().toUpperCase());
  });
};

const createOwnershipMiddleware = ({
  resource = "order",
  resolveResourceId = (req) => req.params?.id,
  connectDb = connect,
} = {}) => async (req, res, next) => {
  if (isAdministrativeUser(req.user)) {
    next();
    return;
  }

  const resourceId = Number(resolveResourceId(req) || 0);
  const actorUserId = Number(req.user?.userId || 0);
  if (!Number.isInteger(resourceId) || resourceId <= 0 || !actorUserId) {
    res.status(400).json({ code: 0, message: "pedido invalido", data: null });
    return;
  }

  try {
    const db = await connectDb();
    const [rows] = resource === "reservation"
      ? await db.query(
          `SELECT 1
           FROM production_sale_reservations reservation
           INNER JOIN order_items item ON item.id = reservation.order_item_id
           INNER JOIN orders o ON o.id = item.order_id
           WHERE reservation.id = ?
             AND o.sales_agent_user_id = ?
           LIMIT 1`,
          [resourceId, actorUserId]
        )
      : await db.query(
          `SELECT 1
           FROM orders o
           WHERE o.id = ?
             AND o.sales_agent_user_id = ?
           LIMIT 1`,
          [resourceId, actorUserId]
        );

    if (!rows.length) {
      res.status(403).json({ code: 0, message: "pedido no encontrado o sin acceso", data: null });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

const requireOrderAccess = createOwnershipMiddleware();
const requireReservationOrderAccess = createOwnershipMiddleware({ resource: "reservation" });
const requireBodyOrderAccess = createOwnershipMiddleware({
  resolveResourceId: (req) => req.body?.p_order_id || req.body?.order_id,
});

module.exports = {
  createOwnershipMiddleware,
  isAdministrativeUser,
  requireBodyOrderAccess,
  requireOrderAccess,
  requireReservationOrderAccess,
};
