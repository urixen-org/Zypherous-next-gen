const serverDashboard = require("../handlers/server-dashboard");

const zypherousModule = { name: "Server Files", target_platform: "10.0.0" };

module.exports.ZypherousModule = zypherousModule;

module.exports.load = async function (app, db) {
  app.get("/dashboard/server/:serverid/files", async (req, res) => {
    return serverDashboard.serveSection(
      req,
      res,
      "dashboard/server/files.ejs",
      "files"
    );
  });
};
