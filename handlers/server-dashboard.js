const fetch = require("node-fetch");
const loadConfig = require("./config");
const indexjs = require("../app.js");

const settings = loadConfig("./config.yaml");

const SERVER_TABS = [
  { key: "overview", label: "Overview" },
  { key: "console", label: "Console" },
  { key: "files", label: "Files" },
  { key: "plugins", label: "Plugins" },
  { key: "subdomain", label: "Subdomain" },
  { key: "schedules", label: "Schedules" },
  { key: "settings", label: "Settings" },
  { key: "network", label: "Network" },
  { key: "support", label: "Support" }
];

function getPanelDomain() {
  if (!settings.pterodactyl || !settings.pterodactyl.domain) return "";
  return settings.pterodactyl.domain.endsWith("/")
    ? settings.pterodactyl.domain.slice(0, -1)
    : settings.pterodactyl.domain;
}

async function fetchServerDetails(serverId) {
  const panelDomain = getPanelDomain();
  if (!panelDomain) throw new Error("Pterodactyl domain is not configured.");
  const response = await fetch(
    `${panelDomain}/api/application/servers/${serverId}?include=allocations,egg,node,location,schedules`,
    {
      method: "get",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.pterodactyl.key}`
      }
    }
  );
  if (!response.ok) {
    throw new Error(`Unable to fetch server ${serverId}: ${response.status}`);
  }

  return response.json();
}

function attemptRedirectToLogin(req, res) {
  const redirectBase = req._parsedUrl
    ? req._parsedUrl.pathname
    : req.originalUrl || "";
  const redirectPath = redirectBase.startsWith("/")
    ? redirectBase.slice(1)
    : redirectBase;
  res.redirect("/login" + (redirectPath ? "?redirect=" + redirectPath : ""));
}

async function resolveServer(req, res) {
  if (!req.session.userinfo || !req.session.pterodactyl) {
    attemptRedirectToLogin(req, res);
    return null;
  }

  const serverId = req.params.serverid;
  if (!serverId) {
    res.redirect("/servers");
    return null;
  }

  const sessionServers =
    req.session.pterodactyl.relationships &&
    req.session.pterodactyl.relationships.servers &&
    Array.isArray(req.session.pterodactyl.relationships.servers.data)
      ? req.session.pterodactyl.relationships.servers.data
      : [];

  const ownedServer = sessionServers.find(
    (server) =>
      server.attributes.id === serverId ||
      server.attributes.identifier === serverId
  );

  if (!ownedServer) {
    res.redirect("/dashboard?err=SERVERNOTFOUND");
    return null;
  }

  try {
    const serverData = await fetchServerDetails(ownedServer.attributes.id);
    return { serverData, sessionServer: ownedServer };
  } catch (error) {
    console.error(
      "Server dashboard: unable to resolve server details",
      error.message
    );
    res.redirect("/dashboard?err=SERVERNOTFOUND");
    return null;
  }
}

function buildTabs(basePath) {
  return SERVER_TABS.map((tab) => ({
    ...tab,
    href: `${basePath}${tab.key === "overview" ? "" : `/${tab.key}`}`
  }));
}

async function serveSection(req, res, view, section) {
  const resolved = await resolveServer(req, res);
  if (!resolved) return;

  const { serverData } = resolved;
  const serverId = serverData.attributes && serverData.attributes.id;
  const basePath = `/dashboard/server/${serverId}`;
  const theme = indexjs.get(req);
  const renderData = await indexjs.renderdataeval(req, theme);

  renderData.server = serverData;
  renderData.serverBasePath = basePath;
  renderData.serverTabs = buildTabs(basePath);
  renderData.serverSection = section;
  const panelDomain = getPanelDomain();
  renderData.serverConsoleUrl = panelDomain
    ? `${panelDomain}/server/${serverData.attributes.identifier}`
    : "/servers";

  res.render(view, renderData);
}

module.exports = {
  serveSection
};
