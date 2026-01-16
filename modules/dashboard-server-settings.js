const serverDashboard = require("../handlers/server-dashboard");

const zypherousModule = { name: "Server Settings", target_platform: "10.0.0" };

module.exports.ZypherousModule = zypherousModule;

module.exports.load = async function (app, db) {
  app.get("/dashboard/server/:serverid/settings", async (req, res) => {
    return serverDashboard.serveSection(
      req,
      res,
      "dashboard/server/settings.ejs",
      "settings"
    );
  });
};
