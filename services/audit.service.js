const { connect } = require("../data-access");
const logger = require("../logger");

const SENSITIVE_KEYS = new Set([
  "password", "current_password", "new_password", "password_hash", "token",
  "access_token", "refresh_token", "authorization", "secret",
]);

const sanitize = (value, depth = 0) => {
  if (depth > 4) return "[contenido omitido]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.entries(value).reduce((result, [key, item]) => {
    result[key] = SENSITIVE_KEYS.has(String(key).toLowerCase()) ? "[protegido]" : sanitize(item, depth + 1);
    return result;
  }, {});
};

const inferEntity = (path) => {
  const parts = String(path || "").split("?")[0].split("/").filter(Boolean);
  return parts[1] || parts[0] || "system";
};

const inferEntityId = (req, responseBody) => {
  const responseData = responseBody?.data;
  return req.params?.id || req.params?.itemId || req.params?.customerId
    || responseData?.id || responseData?.order_id || responseData?.production_plan_id || null;
};

const writeAudit = async ({ actorUserId, action, entityName, entityId, ipAddress, metadata, skipWhenDetailedSince }) => {
  try {
    const db = await connect();
    if (actorUserId && skipWhenDetailedSince) {
      const [existing] = await db.query(
        `SELECT id FROM audit_logs
          WHERE actor_user_id = ? AND created_at >= DATE_SUB(?, INTERVAL 1 SECOND)
            AND action NOT LIKE 'system.%'
          LIMIT 1`,
        [actorUserId, skipWhenDetailedSince]
      );
      if (existing.length) return;
    }
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, ip_address, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [actorUserId || null, action, entityName, entityId == null ? null : String(entityId), ipAddress || null, JSON.stringify(sanitize(metadata))]
    );
  } catch (error) {
    logger.error(`No se pudo registrar auditoría: ${error.message}`);
  }
};

const auditMutations = (req, res, next) => {
  const method = String(req.method || "GET").toUpperCase();
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const isExport = method === "GET" && /(?:export|download|excel)/i.test(req.originalUrl || "");
  const excluded = /^\/api\/reports\/audit(?:\/|\?|$)/.test(req.originalUrl || "")
    || /^\/api\/auth\/(?:login|refresh|logout)(?:\/|\?|$)/.test(req.originalUrl || "");
  if ((!isMutation && !isExport) || excluded) return next();
  const requestStartedAt = new Date();

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const successful = res.statusCode < 400 && (body?.code === undefined || Number(body.code) === 1);
    if (successful) {
      const entityName = inferEntity(req.originalUrl);
      setImmediate(() => writeAudit({
        actorUserId: req.user?.userId,
        action: isExport ? "system.export" : `system.${method.toLowerCase()}`,
        entityName,
        entityId: inferEntityId(req, body),
        ipAddress: req.ip,
        metadata: {
          method,
          route: req.baseUrl ? `${req.baseUrl}${req.route?.path || ""}` : req.originalUrl,
          parameters: req.params,
          changes: req.body,
          result_message: body?.message || null,
        },
        skipWhenDetailedSince: requestStartedAt,
      }));
    }
    return originalJson(body);
  };
  next();
};

module.exports = { auditMutations, sanitize, writeAudit };
