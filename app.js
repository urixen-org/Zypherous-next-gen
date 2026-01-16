/**
 * 
 *     Zypherous 11 (Cactus)
 * 
 */

"use strict";

// Load logging.
require("./handlers/console.js")();

// Load packages.
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const chalk = require("chalk");
const axios = require("axios");
const JavaScriptObfuscator = require("javascript-obfuscator");
const arciotext = require("./handlers/afk.js");
const cluster = require("cluster");
const os = require("os");
const ejs = require("ejs");
const readline = require("readline");
const chokidar = require('chokidar');
const logEvent = require("./handlers/log.js");

global.Buffer = global.Buffer || require("buffer").Buffer;

if (typeof btoa === "undefined") {
  global.btoa = function (str) {
    return Buffer.from(str, "binary").toString("base64");
  };
}
if (typeof atob === "undefined") {
  global.atob = function (b64Encoded) {
    return Buffer.from(b64Encoded, "base64").toString("binary");
  };
}

// Load settings.
const loadConfig = require("./handlers/config");
const settings = loadConfig("./config.yaml");
const settingsStore = require("./handlers/settings-store");


const defaultthemesettings = {
  index: "index.ejs",
  notfound: "index.ejs",
  redirect: {},
  pages: {},
  mustbeloggedin: [],
  mustbeadmin: [],
  variables: {},
};

const DEFAULT_EXTRA_RESOURCES = { ram: 0, disk: 0, cpu: 0, servers: 0 };
let cachedAfkScript = { key: null, code: "" };

function buildAfkScript() {
  if (!settings?.api?.afk) return "";

  const cacheKey = `${settings.api.afk.every}|${settings.api.afk.coins}`;
  if (cachedAfkScript.key === cacheKey && cachedAfkScript.code) {
    return cachedAfkScript.code;
  }

  const script = `
    let everywhat = ${settings.api.afk.every};
    let gaincoins = ${settings.api.afk.coins};
    let wspath = "ws";

    ${arciotext}
  `;

  cachedAfkScript = {
    key: cacheKey,
    code: JavaScriptObfuscator.obfuscate(script).getObfuscatedCode(),
  };

  return cachedAfkScript.code;
}

/**
 * Renders data for the theme.
 * @param {Object} req - The request object.
 * @param {Object} theme - The theme object.
 * @returns {Promise<Object>} The rendered data.
 */
async function renderdataeval(req, theme) {
  const userId = req.session?.userinfo?.id;
  const coinsEnabled = settings?.api?.client?.coins?.enabled === true;

  const [packageNameRaw, extraResourcesRaw, coinsRaw, balanceRaw] =
    await Promise.all([
      userId ? db.get(`package-${userId}`) : Promise.resolve(null),
      userId ? db.get(`extra-${userId}`) : Promise.resolve(null),
      userId && coinsEnabled ? db.get(`coins-${userId}`) : Promise.resolve(null),
      userId ? db.get(`bal-${userId}`) : Promise.resolve(null),
    ]);

  const packageName =
    packageNameRaw || settings?.api?.client?.packages?.default || null;
  const extraresources = userId
    ? extraResourcesRaw || { ...DEFAULT_EXTRA_RESOURCES }
    : null;
  const packages =
    userId && packageName
      ? settings?.api?.client?.packages?.list?.[packageName] || null
      : null;
  const coins =
    coinsEnabled && userId ? coinsRaw || 0 : coinsEnabled ? null : null;
  const bal = userId ? balanceRaw || 0 : null;

  const renderdata = {
    req,
    settings,
    userinfo: req.session.userinfo,
    packagename: userId ? packageName : null,
    extraresources,
    packages,
    coins,
    bal,
    pterodactyl: req.session.pterodactyl,
    extra: theme.settings.variables,
    db: db,
    workerId: workerIds[cluster.worker?.id] || null,
  };

  renderdata.arcioafktext =
    settings?.api?.afk?.enabled === true
      ? buildAfkScript()
      : "";
  return renderdata;
}

module.exports.renderdataeval = renderdataeval;

// Load database
const Database = require("keyv");
const db = new Database(settings.database);

module.exports.db = db;

// Helper function to generate random 6-character IDs
function generateRandomId(length = 6) {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getOrderedModuleFiles() {
  const moduleFiles = fs
    .readdirSync("./modules")
    .filter((file) => file.endsWith(".js"));

  const maintenanceIndex = moduleFiles.indexOf("maintenance.js");
  if (maintenanceIndex !== -1) {
    moduleFiles.splice(maintenanceIndex, 1);
    moduleFiles.unshift("maintenance.js");
  }

  return moduleFiles;
}

const workerIds = {};

function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function startCluster() {
if (cluster.isMaster) {
  // Display ASCII art and loading spinner
  const asciiArt = fs.readFileSync('./handlers/ascii.txt', 'utf8');
  console.log('\n' + asciiArt + '\n');

  let spinnerFrames = ['-', '\\', '|', '/'];
  let currentFrame = 0;
  
  const spinner = setInterval(() => {
    process.stdout.write(chalk.gray('\r' + spinnerFrames[currentFrame++] + ' Working on it...'));
    currentFrame %= spinnerFrames.length;
  }, 100);
  
  setTimeout(() => {
    clearInterval(spinner);
    process.stdout.write('\r');
    startApp();
  }, 3000);

  function startApp() {
    // Create tree view of modules in /modules/
    const moduleFiles = getOrderedModuleFiles();
    const settingsVersion = settings.version;
  
    console.log(chalk.gray("Loading modules tree..."));
    console.log(chalk.gray("Version: " + settingsVersion));

    let modulesTable = [];

    moduleFiles.forEach(file => {
      const module = require('./modules/' + file);
      if (!module.load || !module.ZypherousModule) {
        modulesTable.push({ File: file, Status: 'No module information', 'Target Platform': 'Unknown' });
        return;
      }
    
      const { name, target_platform } = module.ZypherousModule;
  
      modulesTable.push({ File: file, Name: name, Status: 'Module loaded!', 'Target Platform': target_platform });
    });

    console.table(modulesTable);
  
    const numCPUs = settings.clusters;
    console.log(chalk.gray('Starting workers on Zypherous ' + settings.version));
    console.log(chalk.gray(`Master ${process.pid} is running`));
    console.log(chalk.gray(`Forking ${numCPUs} workers...`));
  
    if (numCPUs > 48 || numCPUs < 1) {
      console.log(chalk.red('Error: Clusters amount was either below 1, or above 48.'))
      process.exit()
    }

    for (let i = 0; i < numCPUs; i++) {
      const worker = cluster.fork();
      const workerId = generateRandomId();
      workerIds[worker.id] = workerId; // Store the worker ID
    }
  
    cluster.on('exit', (worker, code, signal) => {
      console.log(chalk.red(`Worker ${worker.process.pid} died. Forking a new worker...`));
      logEvent(
        "worker exit",
        `Worker ${worker.process.pid} exited (code ${code || "unknown"}, signal ${signal || "none"}).`,
        { scope: "system", severity: "error", workerId: worker.process.pid, tags: ["cluster"], force: true }
      );
      const newWorker = cluster.fork();
      const workerId = generateRandomId();
      workerIds[newWorker.id] = workerId; // Assign new ID for the new worker
      logEvent(
        "worker fork",
        `Spawned replacement worker ${newWorker.id} (pid ${newWorker.process.pid}).`,
        { scope: "system", severity: "info", workerId: newWorker.process.pid, tags: ["cluster"], force: true }
      );
    });
    
    // Watch for file changes and reboot workers
    const restartWorkers = debounce((changedPath) => {
      console.log(chalk.yellow(`File changed: ${changedPath}. Rebooting workers...`));
      logEvent(
        "workers reboot",
        `Recycling workers after change in ${changedPath}.`,
        { scope: "system", severity: "warn", tags: ["cluster", "reload"], force: true }
      );
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
    }, 300);

    const watcher = chokidar.watch('./modules', { ignoreInitial: true });
    const watcher2 = chokidar.watch('./config.yaml', { ignoreInitial: true });
    watcher.on('change', restartWorkers);
    watcher2.on('change', restartWorkers);
  }
  
  cluster.on('online', (worker) => {
    const workerTree = Object.values(cluster.workers).map(worker => ({
      id: worker.id,
      pid: worker.process.pid,
      state: worker.state,
      workerId: workerIds[worker.id] // Include the worker ID in the table
    }));
    console.log(chalk.gray('Current workers status:'));
    console.table(workerTree);
    logEvent(
      "worker online",
      `Worker ${worker.id} (pid ${worker.process.pid}) is online.`,
      { scope: "system", severity: "info", workerId: worker.process.pid, tags: ["cluster"], force: true }
    );
  });

} else {
  // Load websites.
  const express = require("express");
  const app = express();
  app.set('view engine', 'ejs');
  require("express-ws")(app);

  // Load express addons.
  const session = require("express-session");
  const SessionStore = require("./handlers/session");
  const indexjs = require("./app.js");

  // Load the website.
  module.exports.app = app;

  app.use((req, res, next) => {
    res.setHeader("X-Developed-By", "Vspcoderz");
    next();
  });

  app.use(
    session({
      store: new SessionStore({ uri: settings.database }),
      secret: settings.website.secret,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }, // Set to true if using https
    })
  );

  app.use(
    express.json({
      inflate: true,
      limit: "500kb",
      reviver: null,
      strict: true,
      type: "application/json",
      verify: undefined,
    })
  );

  const listener = app.listen(settings.website.port, async function () {
    /* clear all afk sessions */
    await db.set('afkSessions', {});
    console.log(
      chalk.white("Web cluster is now ") + chalk.green('online')
    );
  });

  var cache = false;
  app.use(function (req, res, next) {
    let manager = settings.api.client.ratelimits;
    if (manager[req._parsedUrl.pathname]) {
      if (cache == true) {
        setTimeout(async () => {
          let allqueries = Object.entries(req.query);
          let querystring = "";
          for (let query of allqueries) {
            querystring = querystring + "&" + query[0] + "=" + query[1];
          }
          querystring = "?" + querystring.slice(1);
          res.redirect(
            (req._parsedUrl.pathname.slice(0, 1) == "/"
              ? req._parsedUrl.pathname
              : "/" + req._parsedUrl.pathname) + querystring
          );
        }, 1000);
        return;
      } else {
        cache = true;
        setTimeout(async () => {
          cache = false;
        }, 1000 * manager[req._parsedUrl.pathname]);
      }
    }
    next();
  });

    // Load the API files.
    const moduleFiles = getOrderedModuleFiles();

    moduleFiles.forEach((file) => {
      let apifile = require(`./modules/${file}`);
      apifile.load(app, db);
    });

  app.all("*", async (req, res) => {
    if (req.session.pterodactyl)
      if (
        req.session.pterodactyl.id !==
        (await db.get("users-" + req.session.userinfo.id))
      )
        return res.redirect("/login?prompt=none");
    let theme = indexjs.get(req);
    if (settings.api.afk.enabled == true)
      req.session.arcsessiontoken = Math.random().toString(36).substring(2, 15);
    if (theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname))
      if (!req.session.userinfo || !req.session.pterodactyl)
        return res.redirect(
          "/login" +
            (req._parsedUrl.pathname.slice(0, 1) == "/"
              ? "?redirect=" + req._parsedUrl.pathname.slice(1)
              : "")
        );
    if (theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
      const renderData = await renderdataeval(req, theme);
      res.render(theme.settings.notfound, renderData);
      return;
    }
    const data = await renderdataeval(req, theme);
    res.render(theme.settings.pages[req._parsedUrl.pathname.slice(1)] || theme.settings.notfound, data);
  });

  module.exports.get = function (req) {
    return {
      settings: fs.existsSync(`./views/pages.json`)
        ? JSON.parse(fs.readFileSync(`./views/pages.json`).toString())
        : defaultthemesettings
    };
  };

  module.exports.islimited = async function () {
    return cache == true ? false : true;
  };

  module.exports.ratelimits = async function (length) {
    if (cache == true) return setTimeout(indexjs.ratelimits, 1);
    cache = true;
    setTimeout(async function () {
      cache = false;
    }, length * 1000);
  };

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
}
}

settingsStore
  .init(db, "./config.yaml")
  .then(() => {
    settingsStore.startAutoRefresh(db);
    startCluster();
  })
  .catch((error) => {
    console.error("Failed to initialize settings:", error);
    process.exit(1);
  });
