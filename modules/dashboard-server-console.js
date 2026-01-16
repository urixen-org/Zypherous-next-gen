const serverDashboard = require("../handlers/server-dashboard");

const zypherousModule = { name: "Server Console", target_platform: "10.0.0" };

module.exports.ZypherousModule = zypherousModule;

module.exports.load = async function (app, db) {
  app.get("/dashboard/server/:serverid/console", async (req, res) => {
    return serverDashboard.serveSection(
      req,
      res,
      "dashboard/server/console.ejs",
      "console"
    );
  });
};
