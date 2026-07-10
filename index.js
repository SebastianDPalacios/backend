const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const cors = require("cors");
const compression = require("compression");
const httpLogger = require("./httpLogger");
const logger = require("./logger");
const { logErrors, boomErrorHandler, errorHandler } = require("./middlewares/error.handler");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

app.use(cors());
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(httpLogger);

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "panaderia-backend" });
});

app.use("/api/auth", require("./api/auth.router"));
app.use("/api/users", require("./api/users.router"));
app.use("/api/employees", require("./api/employees.router"));
app.use("/api/catalog", require("./api/catalog.router"));
app.use("/api/orders", require("./api/orders.router"));
app.use("/api/dashboard", require("./api/dashboard.router"));
app.use("/api/production", require("./api/production.router"));
app.use("/api/inventory", require("./api/inventory.router"));
app.use("/api/commercial", require("./api/commercial.router"));
app.use("/api/recipes", require("./api/recipes.router"));
app.use("/api/rbac", require("./api/rbac.router"));
app.use("/api/admin-auth", require("./api/admin-auth.router"));
app.use("/api/reports", require("./api/reports.router"));
app.use("/api/standard", require("./api/standard.router"));
app.use("/api/settings", require("./api/settings.router"));

app.use(logErrors);
app.use(boomErrorHandler);
app.use(errorHandler);

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  logger.info(`Servidor iniciado en puerto ${port} (${process.env.NODE_ENV || "development"})`);
  console.log(`Panaderia backend corriendo en http://localhost:${port}`);
});
