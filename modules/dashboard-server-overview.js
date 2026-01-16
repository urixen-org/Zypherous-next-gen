const serverDashboard = require("../handlers/server-dashboard");

const zypherousModule = { name: "Server Overview", target_platform: "10.0.0" };

module.exports.ZypherousModule = zypherousModule;

module.exports.load = async function (app, db) {
  app.get("/dashboard/server/:serverid", async (req, res) => {
    return serverDashboard.serveSection(
      req,
      res,
      "dashboard/server/overview.ejs",
      "overview"
    );
  });

  app.get("/dashboard/server/:serverid/overview", async (req, res) => {
    return serverDashboard.serveSection(
      req,
      res,
      "dashboard/server/overview.ejs",
      "overview"
    );
  });
};
