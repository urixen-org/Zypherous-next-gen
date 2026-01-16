const serverDashboard = require("../handlers/server-dashboard");

const zypherousModule = { name: "Server Plugins", target_platform: "10.0.0" };

module.exports.ZypherousModule = zypherousModule;

module.exports.load = async function (app, db) {
  app.get("/dashboard/server/:serverid/plugins", async (req, res) => {
    return serverDashboard.serveSection(
      req,
      res,
      "dashboard/server/plugins.ejs",
      "plugins"
    );
  });
};
