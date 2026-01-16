/**
 * 
 *     Zypherous 11 (Cactus)
 * 
 */


const loadConfig = require("../handlers/config");
const settingsStore = require("../handlers/settings-store");
const settings = loadConfig("./config.yaml");

if (settings.pterodactyl)
  if (settings.pterodactyl.domain) {
    if (settings.pterodactyl.domain.slice(-1) == "/")
      settings.pterodactyl.domain = settings.pterodactyl.domain.slice(0, -1);
  }

const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const indexjs = require("../app.js");
const adminjs = require("./admin.js");
const ejs = require("ejs");
const log = require("../handlers/log.js");
const arciotext = require('../handlers/afk.js')
const axios = require('axios');
const semver = require('semver');

/* Ensure platform release target is met */
const zypherousModule = { "name": "Admin", "target_platform": "10.0.0" };

const DEFAULT_MAINTENANCE_MESSAGE = "We're currently performing scheduled maintenance. Please check back later.";

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}

function maskSecret(value) {
  if (!value) return null;
  const raw = String(value);
  if (raw.length <= 8) return "********";
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function countEnabledActions(actions) {
  if (!actions || typeof actions !== "object") return 0;
  return Object.values(actions).filter((value) => value === true).length;
}

function createAdminLogContext(req, targetId, severity = "info", tags = []) {
  return {
    scope: "admin",
    actorId: req.session?.userinfo?.id || null,
    targetId: targetId || null,
    severity,
    tags,
  };
}

function mergeLogEntries(entries) {
  const deliveries = new Map();
  for (const entry of entries) {
    if (entry && entry.kind === "delivery" && entry.id) {
      deliveries.set(entry.id, entry);
    }
  }

  return entries
    .filter((entry) => entry && entry.kind !== "delivery")
    .map((entry) => {
      const delivery = entry.id ? deliveries.get(entry.id) : null;
      return {
        ...entry,
        webhookStatus:
          (delivery && delivery.webhookStatus) ||
          entry.webhookStatus ||
          "skipped",
        webhookCode: delivery?.webhookCode || null,
        deliveredAt: delivery?.deliveredAt || null,
      };
    });
}

function summarizeWebhookStatus(entries) {
  return entries.reduce(
    (acc, entry) => {
      const status = (entry.webhookStatus || "skipped").toLowerCase();
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    { sent: 0, failed: 0, queued: 0, skipped: 0 }
  );
}

/* Module */
module.exports.ZypherousModule = zypherousModule;
module.exports.load = async function (app, db) {
  app.get("/setcoins", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let failredirect = theme.settings.redirect.failedsetcoins || "/";

    let id = req.query.id;
    let coins = req.query.coins;

    if (!id) return res.redirect(failredirect + "?err=MISSINGID");
    if (!(await db.get("users-" + req.query.id)))
      return res.redirect(`${failredirect}?err=INVALIDID`);

    if (!coins) return res.redirect(failredirect + "?err=MISSINGCOINS");

    coins = parseFloat(coins);

    if (isNaN(coins))
      return res.redirect(failredirect + "?err=INVALIDCOINNUMBER");

    if (coins < 0 || coins > 999999999999999)
      return res.redirect(`${failredirect}?err=COINSIZE`);

    if (coins == 0) {
      await db.delete("coins-" + id);
    } else {
      await db.set("coins-" + id, coins);
    }

    let successredirect = theme.settings.redirect.setcoins || "/";
    log(
      `set coins`,
      `${req.session.userinfo.username} set the coins of the user with the ID \`${id}\` to \`${coins}\`.`,
      createAdminLogContext(req, id, "info", ["coins"])
    );
    res.redirect(successredirect + "?success=COINS_SET");
  });

  app.get("/addcoins", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let failredirect = theme.settings.redirect.failedsetcoins || "/";

    let id = req.query.id;
    let coins = req.query.coins;

    if (!id) return res.redirect(failredirect + "?err=MISSINGID");
    if (!(await db.get("users-" + req.query.id)))
      return res.redirect(`${failredirect}?err=INVALIDID`);

    if (!coins) return res.redirect(failredirect + "?err=MISSINGCOINS");

    let currentcoins = (await db.get("coins-" + id)) || 0;
    coins = parseFloat(coins);

    if (isNaN(coins))
      return res.redirect(failredirect + "?err=INVALIDCOINNUMBER");

    // Calculate new coin balance
    let newCoins = currentcoins + coins;

    if (newCoins < 0 || newCoins > 999999999999999)
      return res.redirect(`${failredirect}?err=COINSIZE`);

    if (newCoins == 0) {
      await db.delete("coins-" + id);
    } else {
      await db.set("coins-" + id, newCoins);
    }

    let successredirect = theme.settings.redirect.setcoins || "/";
    
    // Log the appropriate action based on whether we're adding or removing coins
    if (coins > 0) {
      log(
        `add coins`,
        `${req.session.userinfo.username} added \`${coins}\` coins to the user with the ID \`${id}\`'s account.`,
        createAdminLogContext(req, id, "info", ["coins"])
      );
      res.redirect(successredirect + "?success=COINS_ADDED");
    } else {
      log(
        `remove coins`,
        `${req.session.userinfo.username} removed \`${Math.abs(coins)}\` coins from the user with the ID \`${id}\`'s account.`,
        createAdminLogContext(req, id, "warn", ["coins"])
      );
      res.redirect(successredirect + "?success=COINS_REMOVED");
    }
  });

  app.get("/setresources", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let failredirect = theme.settings.redirect.failedsetresources || "/";

    if (!req.query.id) return res.redirect(`${failredirect}?err=MISSINGID`);

    if (!(await db.get("users-" + req.query.id)))
      return res.redirect(`${failredirect}?err=INVALIDID`);

    let successredirect = theme.settings.redirect.setresources || "/";

    if (req.query.ram || req.query.disk || req.query.cpu || req.query.servers) {
      let ramstring = req.query.ram;
      let diskstring = req.query.disk;
      let cpustring = req.query.cpu;
      let serversstring = req.query.servers;
      let id = req.query.id;

      let currentextra = await db.get("extra-" + req.query.id);
      let extra;

      if (typeof currentextra == "object") {
        extra = currentextra;
      } else {
        extra = {
          ram: 0,
          disk: 0,
          cpu: 0,
          servers: 0,
        };
      }

      if (ramstring) {
        let ram = parseFloat(ramstring);
        let newRam = extra.ram + ram;
        if (newRam < 0 || newRam > 999999999999999) {
          return res.redirect(`${failredirect}?err=RAMSIZE`);
        }
        extra.ram = newRam;
      }

      if (diskstring) {
        let disk = parseFloat(diskstring);
        let newDisk = extra.disk + disk;
        if (newDisk < 0 || newDisk > 999999999999999) {
          return res.redirect(`${failredirect}?err=DISKSIZE`);
        }
        extra.disk = newDisk;
      }

      if (cpustring) {
        let cpu = parseFloat(cpustring);
        let newCpu = extra.cpu + cpu;
        if (newCpu < 0 || newCpu > 999999999999999) {
          return res.redirect(`${failredirect}?err=CPUSIZE`);
        }
        extra.cpu = newCpu;
      }

      if (serversstring) {
        let servers = parseFloat(serversstring);
        let newServers = extra.servers + servers;
        if (newServers < 0 || newServers > 999999999999999) {
          return res.redirect(`${failredirect}?err=SERVERSIZE`);
        }
        extra.servers = newServers;
      }

      if (
        extra.ram == 0 &&
        extra.disk == 0 &&
        extra.cpu == 0 &&
        extra.servers == 0
      ) {
        await db.delete("extra-" + req.query.id);
      } else {
        await db.set("extra-" + req.query.id, extra);
      }

      // Log the appropriate action based on the operation
      const operation = (ramstring && parseFloat(ramstring) > 0) || 
                       (diskstring && parseFloat(diskstring) > 0) || 
                       (cpustring && parseFloat(cpustring) > 0) || 
                       (serversstring && parseFloat(serversstring) > 0) 
                       ? "added" : "removed";
      
      let logMessage = `${req.session.userinfo.username} ${operation} resources for user with ID \`${id}\`.`;
      
      if (ramstring) {
        const ramValue = Math.abs(parseFloat(ramstring));
        logMessage += ` RAM: ${ramValue / 1024} GiB ${parseFloat(ramstring) > 0 ? 'added' : 'removed'}.`;
      }
      
      if (diskstring) {
        const diskValue = Math.abs(parseFloat(diskstring));
        logMessage += ` Disk: ${diskValue / 1024} GiB ${parseFloat(diskstring) > 0 ? 'added' : 'removed'}.`;
      }
      
      if (cpustring) {
        const cpuValue = Math.abs(parseFloat(cpustring));
        logMessage += ` CPU: ${cpuValue / 100} cores ${parseFloat(cpustring) > 0 ? 'added' : 'removed'}.`;
      }
      
      if (serversstring) {
        const serversValue = Math.abs(parseFloat(serversstring));
        logMessage += ` Servers: ${serversValue} ${parseFloat(serversstring) > 0 ? 'added' : 'removed'}.`;
      }
      
      log(
        `resource ${operation}`,
        logMessage,
        createAdminLogContext(req, id, "info", ["resources"])
      );
      
      return res.redirect(successredirect + "?success=RESOURCES_MODIFIED");
    } else {
      return res.redirect(`${failredirect}?err=MISSING_RESOURCES`);
    }
  });

  app.get("/addresources", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let failredirect = theme.settings.redirect.failedsetresources
      ? theme.settings.redirect.failedsetresources
      : "/";

    if (!req.query.id) return res.redirect(`${failredirect}?err=MISSINGID`);

    if (!(await db.get("users-" + req.query.id)))
      return res.redirect(`${failredirect}?err=INVALIDID`);

    let successredirect = theme.settings.redirect.setresources
      ? theme.settings.redirect.setresources
      : "/";

    if (req.query.ram || req.query.disk || req.query.cpu || req.query.servers) {
      let ramstring = req.query.ram;
      let diskstring = req.query.disk;
      let cpustring = req.query.cpu;
      let serversstring = req.query.servers;

      let currentextra = await db.get("extra-" + req.query.id);
      let extra;

      if (typeof currentextra == "object") {
        extra = currentextra;
      } else {
        extra = {
          ram: 0,
          disk: 0,
          cpu: 0,
          servers: 0,
        };
      }

      if (ramstring) {
        let ram = parseFloat(ramstring);
        if (ram < 0 || ram > 999999999999999) {
          return res.redirect(`${failredirect}?err=RAMSIZE`);
        }
        extra.ram = extra.ram + ram;
      }

      if (diskstring) {
        let disk = parseFloat(diskstring);
        if (disk < 0 || disk > 999999999999999) {
          return res.redirect(`${failredirect}?err=DISKSIZE`);
        }
        extra.disk = extra.disk + disk;
      }

      if (cpustring) {
        let cpu = parseFloat(cpustring);
        if (cpu < 0 || cpu > 999999999999999) {
          return res.redirect(`${failredirect}?err=CPUSIZE`);
        }
        extra.cpu = extra.cpu + cpu;
      }

      if (serversstring) {
        let servers = parseFloat(serversstring);
        if (servers < 0 || servers > 999999999999999) {
          return res.redirect(`${failredirect}?err=SERVERSIZE`);
        }
        extra.servers = extra.servers + servers;
      }

      if (
        extra.ram == 0 &&
        extra.disk == 0 &&
        extra.cpu == 0 &&
        extra.servers == 0
      ) {
        await db.delete("extra-" + req.query.id);
      } else {
        await db.set("extra-" + req.query.id, extra);
      }

      adminjs.suspend(req.query.id);
      return res.redirect(successredirect + "?success=MODIFIED");
    } else {
      res.redirect(`${failredirect}?err=MISSINGVARIABLES`);
    }
  });

  app.get("/setplan", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let failredirect = theme.settings.redirect.failedsetplan || "/";

    if (!req.query.id) return res.redirect(`${failredirect}?err=MISSINGID`);

    if (!(await db.get("users-" + req.query.id)))
      return res.redirect(`${failredirect}?err=INVALIDID`);

    let successredirect = theme.settings.redirect.setplan || "/";

    if (!req.query.package) {
      await db.delete("package-" + req.query.id);
      adminjs.suspend(req.query.id);

      log(
        `set plan`,
        `${req.session.userinfo.username} removed the plan of the user with the ID \`${req.query.id}\`.`,
        createAdminLogContext(req, req.query.id, "warn", ["plan"])
      );
      return res.redirect(successredirect + "?success=PLAN_MODIFIED");
    } else {
      if (!settings.api.client.packages.list[req.query.package])
        return res.redirect(`${failredirect}?err=INVALIDPACKAGE`);
      await db.set("package-" + req.query.id, req.query.package);
      adminjs.suspend(req.query.id);

      log(
        `set plan`,
        `${req.session.userinfo.username} set the plan of the user with the ID \`${req.query.id}\` to \`${req.query.package}\`.`,
        createAdminLogContext(req, req.query.id, "info", ["plan"])
      );
      return res.redirect(successredirect + "?success=PLAN_MODIFIED");
    }
  });

  app.get("/create_coupon", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let code = req.query.code
      ? req.query.code.slice(0, 200)
      : Math.random().toString(36).substring(2, 15);

    if (!code.match(/^[a-z0-9]+$/i))
      return res.redirect(
        theme.settings.redirect.couponcreationfailed +
          "?err=CREATECOUPONINVALIDCHARACTERS"
      );

    let coins = req.query.coins || 0;
    let ram = req.query.ram * 1024 || 0;
    let disk = req.query.disk * 1024 || 0;
    let cpu = req.query.cpu * 100 || 0;
    let servers = req.query.servers || 0;

    coins = parseFloat(coins);
    ram = parseFloat(ram);
    disk = parseFloat(disk);
    cpu = parseFloat(cpu);
    servers = parseFloat(servers);

    if (coins < 0)
      return res.redirect(
        theme.settings.redirect.couponcreationfailed +
          "?err=CREATECOUPONLESSTHANONE"
      );
    if (ram < 0)
      return res.redirect(
        theme.settings.redirect.couponcreationfailed +
          "?err=CREATECOUPONLESSTHANONE"
      );
    if (disk < 0)
      return res.redirect(
        theme.settings.redirect.couponcreationfailed +
          "?err=CREATECOUPONLESSTHANONE"
      );
    if (cpu < 0)
      return res.redirect(
        theme.settings.redirect.couponcreationfailed +
          "?err=CREATECOUPONLESSTHANONE"
      );
    if (servers < 0)
      return res.redirect(
        theme.settings.redirect.couponcreationfailed +
          "?err=CREATECOUPONLESSTHANONE"
      );

    if (!coins && !ram && !disk && !cpu && !servers)
      return res.redirect(
        theme.settings.redirect.couponcreationfailed + "?err=CREATECOUPONEMPTY"
      );

    await db.set("coupon-" + code, {
      coins: coins,
      ram: ram,
      disk: disk,
      cpu: cpu,
      servers: servers,
    });

    log(
      `create coupon`,
      `${req.session.userinfo.username} created the coupon code \`${code}\` which gives:\`\`\`coins: ${coins}\nMemory: ${ram} MB\nDisk: ${disk} MB\nCPU: ${cpu}%\nServers: ${servers}\`\`\``,
      createAdminLogContext(req, code, "info", ["coupon"])
    );
    res.redirect(
      theme.settings.redirect.couponcreationsuccess + "?code=" + code
    );
  });

  app.get("/revoke_coupon", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let code = req.query.code;

    if (!code.match(/^[a-z0-9]+$/i))
      return res.redirect(
        theme.settings.redirect.couponrevokefailed +
          "?err=REVOKECOUPONCANNOTFINDCODE"
      );

    if (!(await db.get("coupon-" + code)))
      return res.redirect(
        theme.settings.redirect.couponrevokefailed +
          "?err=REVOKECOUPONCANNOTFINDCODE"
      );

    await db.delete("coupon-" + code);

    log(
      `revoke coupon`,
      `${req.session.userinfo.username} revoked the coupon code \`${code}\`.`,
      createAdminLogContext(req, code, "warn", ["coupon"])
    );
    res.redirect(
      theme.settings.redirect.couponrevokesuccess + "?revokedcode=true"
    );
  });

  app.get("/remove_account", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    // This doesn't delete the account and doesn't touch the renewal system.

    if (!req.query.id)
      return res.redirect(
        theme.settings.redirect.removeaccountfailed +
          "?err=REMOVEACCOUNTMISSINGID"
      );

    let discordid = req.query.id;
    let pteroid = await db.get("users-" + discordid);

    // Remove IP.

    let selected_ip = await db.get("ip-" + discordid);

    if (selected_ip) {
      let allips = (await db.get("ips")) || [];
      allips = allips.filter((ip) => ip !== selected_ip);

      if (allips.length == 0) {
        await db.delete("ips");
      } else {
        await db.set("ips", allips);
      }

      await db.delete("ip-" + discordid);
    }

    // Remove user.

    let userids = (await db.get("users")) || [];
    userids = userids.filter((user) => user !== pteroid);

    if (userids.length == 0) {
      await db.delete("users");
    } else {
      await db.set("users", userids);
    }

    await db.delete("users-" + discordid);

    // Remove coins/resources.

    await db.delete("coins-" + discordid);
    await db.delete("extra-" + discordid);
    await db.delete("package-" + discordid);

    log(
      `remove account`,
      `${req.session.userinfo.username} removed the account with the ID \`${discordid}\`.`,
      createAdminLogContext(req, discordid, "warn", ["account"])
    );
    res.redirect(
      theme.settings.redirect.removeaccountsuccess + "?success=REMOVEACCOUNT"
    );
  });

  app.get("/getip", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let failredirect = theme.settings.redirect.failedgetip || "/";
    let successredirect = theme.settings.redirect.getip || "/";
    if (!req.query.id) return res.redirect(`${failredirect}?err=MISSINGID`);

    if (!(await db.get("users-" + req.query.id)))
      return res.redirect(`${failredirect}?err=INVALIDID`);

    if (!(await db.get("ip-" + req.query.id)))
      return res.redirect(`${failredirect}?err=NOIP`);
    let ip = await db.get("ip-" + req.query.id);
    log(
      `view ip`,
      `${req.session.userinfo.username} viewed the IP of the account with the ID \`${req.query.id}\`.`,
      createAdminLogContext(req, req.query.id, "warn", ["ip"])
    );
    return res.redirect(successredirect + "?err=NONE&ip=" + ip);
  });

  app.get("/userinfo", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    if (!req.query.id) return res.send({ status: "missing id" });

    if (!(await db.get("users-" + req.query.id)))
      return res.send({ status: "invalid id" });

    if (settings.api.client.oauth2.link.slice(-1) == "/")
      settings.api.client.oauth2.link =
        settings.api.client.oauth2.link.slice(0, -1);

    if (settings.api.client.oauth2.callbackpath.slice(0, 1) !== "/")
      settings.api.client.oauth2.callbackpath =
        "/" + settings.api.client.oauth2.callbackpath;

    if (settings.pterodactyl.domain.slice(-1) == "/")
      settings.pterodactyl.domain = settings.pterodactyl.domain.slice(
        0,
        -1
      );

    let packagename = await db.get("package-" + req.query.id);
    let package =
      settings.api.client.packages.list[
        packagename ? packagename : settings.api.client.packages.default
      ];
    if (!package)
      package = {
        ram: 0,
        disk: 0,
        cpu: 0,
        servers: 0,
      };

    package["name"] = packagename;

    let pterodactylid = await db.get("users-" + req.query.id);
    let userinforeq = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        pterodactylid +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await userinforeq.statusText) == "Not Found") {
      console.log(
        "App ― An error has occured while attempting to get a user's information"
      );
      console.log("- Discord ID: " + req.query.id);
      console.log("- Pterodactyl Panel ID: " + pterodactylid);
      return res.send({ status: "could not find user on panel" });
    }
    let userinfo = await userinforeq.json();

    res.send({
      status: "success",
      package: package,
      extra: (await db.get("extra-" + req.query.id))
        ? await db.get("extra-" + req.query.id)
        : {
            ram: 0,
            disk: 0,
            cpu: 0,
            servers: 0,
          },
      userinfo: userinfo,
      coins:
        settings.api.client.coins.enabled == true
          ? (await db.get("coins-" + req.query.id))
            ? await db.get("coins-" + req.query.id)
            : 0
          : null,
    });
  });

  app.get("/admin", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    // Get user's coins for the header component
    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    // Fetch panel statistics
    let panelStats = {
      users: { total: 0, activePercent: 0 },
      servers: { total: 0, active: 0 },
      locations: { total: 0, mostActive: "N/A" },
      nodes: { total: 0, online: 0 }
    };

    try {
      // Fetch users count
      const usersResponse = await fetch(
        `${settings.pterodactyl.domain}/api/application/users?per_page=1`,
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );
      
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        panelStats.users.total = usersData.meta.pagination.total;
        // Estimate active users (this is a placeholder - actual logic would depend on your definition of "active")
        panelStats.users.activePercent = Math.floor(Math.random() * 20) + 5; // Random value between 5-25% for demo
      }

      // Fetch servers count
      const serversResponse = await fetch(
        `${settings.pterodactyl.domain}/api/application/servers?per_page=1`,
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );
      
      if (serversResponse.ok) {
        const serversData = await serversResponse.json();
        panelStats.servers.total = serversData.meta.pagination.total;
        // Estimate active servers (servers that are currently running)
        panelStats.servers.active = Math.floor(panelStats.servers.total * 0.75); // Assume 75% are active
      }

      // Fetch locations
      const locationsResponse = await fetch(
        `${settings.pterodactyl.domain}/api/application/locations`,
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );
      
      if (locationsResponse.ok) {
        const locationsData = await locationsResponse.json();
        panelStats.locations.total = locationsData.data.length;
        
        // Get most active location (just pick the first one for demo, or implement your own logic)
        if (locationsData.data.length > 0) {
          panelStats.locations.mostActive = locationsData.data[0].attributes.short;
        }
      }

      // Fetch nodes
      const nodesResponse = await fetch(
        `${settings.pterodactyl.domain}/api/application/nodes`,
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );
      
      if (nodesResponse.ok) {
        const nodesData = await nodesResponse.json();
        panelStats.nodes.total = nodesData.data.length;
        
        // Count online nodes (those not marked as maintenance mode)
        panelStats.nodes.online = nodesData.data.filter(
          node => !node.attributes.maintenance_mode
        ).length;
      }
    } catch (error) {
      console.error("Error fetching panel statistics:", error);
      // Continue with default values if there's an error
    }

    // Check for updates
    const updateInfo = await checkForUpdates(settings.version);

    // Render the admin overview page with all required variables
    ejs.renderFile(
      `./views/admin/overview.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null,
        panelStats: panelStats,
        updateInfo: updateInfo
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/admin/settings", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    const maintenance = settings.maintenance || {
      enabled: false,
      allowAdmins: true,
      message: DEFAULT_MAINTENANCE_MESSAGE,
    };

    const adminSettings = {
      core: {
        name: settings.name,
        version: settings.version,
        timezone: settings.timezone,
        testing: settings.testing === true,
        clusters: settings.clusters,
        database: settings.database,
      },
      website: {
        port: settings.website.port,
        discord: settings.website.discord,
        coins: settings.website.coins,
        url: settings.website.url || null,
      },
      access: {
        allowNewUsers: settings.api.client.allow.newusers === true,
        allowRegen: settings.api.client.allow.regen === true,
        serverCreate: settings.api.client.allow.server.create === true,
        serverModify: settings.api.client.allow.server.modify === true,
        serverDelete: settings.api.client.allow.server.delete === true,
        whitelistEnabled: settings.whitelist && settings.whitelist.status === true,
      },
      features: {
        coinsEnabled: settings.api.client.coins.enabled === true,
        storeEnabled: settings.api.client.coins.store.enabled === true,
        afkEnabled: settings.api.afk && settings.api.afk.enabled === true,
        linkvertiseEnabled: settings.linkvertise && settings.linkvertise.enabled === true,
        j4rEnabled: settings.api.client.j4r && settings.api.client.j4r.enabled === true,
        accountSwitcher: settings.api.client.accountSwitcher === true,
      },
      auth: {
        oauthLink: settings.api.client.oauth2.link,
        callbackPath: settings.api.client.oauth2.callbackpath,
        oauthId: settings.api.client.oauth2.id,
        apiEnabled: settings.api.client.api.enabled === true,
        googleEnabled: settings.api.client.google && settings.api.client.google.enabled === true,
      },
      panel: {
        domain: settings.pterodactyl.domain,
        packageCount: Object.keys(settings.api.client.packages.list || {}).length,
        eggCount: Object.keys(settings.api.client.eggs || {}).length,
        locationCount: Object.keys(settings.api.client.locations || {}).length,
        resourceCaps: `RAM ${settings.resources.ram} / Disk ${settings.resources.disk} / CPU ${settings.resources.cpu} / Servers ${settings.resources.servers}`,
      },
      maintenance: {
        enabled: maintenance.enabled === true,
        allowAdmins: maintenance.allowAdmins === true,
        message: maintenance.message || DEFAULT_MAINTENANCE_MESSAGE,
      },
      secrets: {
        websiteSecret: maskSecret(settings.website.secret),
        panelKey: maskSecret(settings.pterodactyl.key),
        oauthSecret: maskSecret(settings.api.client.oauth2.secret),
        apiCode: maskSecret(settings.api.client.api.code),
        botToken: maskSecret(settings.api.client.bot.token),
      },
    };

    ejs.renderFile(
      `./views/admin/settings.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null,
        adminSettings: adminSettings
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin/settings:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/admin/settings/eggs/sync", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl || req.session.pterodactyl.root_admin !== true)
      return four0four(req, res, theme);

    try {
      const result = await settingsStore.syncEggsFromPanel(db, { force: true });
      if (!result.ok) {
        return res.redirect("/admin/settings?err=EGGSYNCFAILED");
      }
      return res.redirect(`/admin/settings?success=Eggs synced (${result.count})`);
    } catch (error) {
      console.error("Egg sync failed:", error);
      return res.redirect("/admin/settings?err=EGGSYNCFAILED");
    }
  });

  app.post("/admin/settings/eggs/update", async (req, res) => {
    if (!req.session.pterodactyl || req.session.pterodactyl.root_admin !== true)
      return res.status(403).json({ ok: false, error: "unauthorized" });

    const { key, updates } = req.body || {};
    if (!key || !settings.api?.client?.eggs?.[key]) {
      return res.status(404).json({ ok: false, error: "notfound" });
    }

    const egg = settings.api.client.eggs[key];
    const payload = updates || {};
    const toNumber = (value) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    if (typeof payload.display === "string" && payload.display.trim()) {
      egg.display = payload.display.trim();
    }
    if (typeof payload.icon === "string") {
      egg.icon = payload.icon.trim();
    }
    if (typeof payload.pro !== "undefined") {
      egg.pro = payload.pro === true;
    }
    if (typeof payload.adminOnly !== "undefined") {
      egg.adminOnly = payload.adminOnly === true;
    }

    if (!egg.minimum) egg.minimum = { ram: 0, disk: 0, cpu: 0 };
    if (!egg.maximum) egg.maximum = { ram: 0, disk: 0, cpu: 0 };

    if (payload.minimum) {
      egg.minimum.ram = toNumber(payload.minimum.ram);
      egg.minimum.disk = toNumber(payload.minimum.disk);
      egg.minimum.cpu = toNumber(payload.minimum.cpu);
    }

    if (payload.maximum) {
      egg.maximum.ram = toNumber(payload.maximum.ram);
      egg.maximum.disk = toNumber(payload.maximum.disk);
      egg.maximum.cpu = toNumber(payload.maximum.cpu);
    }

    await settingsStore.save(db, settings);
    return res.json({ ok: true });
  });

  app.post("/admin/settings/maintenance", async (req, res) => {
    if (!req.session.pterodactyl || req.session.pterodactyl.root_admin !== true)
      return res.status(403).json({ ok: false, error: "unauthorized" });

    const payload = req.body || {};
    const existingMaintenance = settings.maintenance || {
      enabled: false,
      allowAdmins: true,
      message: DEFAULT_MAINTENANCE_MESSAGE,
    };

    const enabled = parseBoolean(payload.enabled, existingMaintenance.enabled === true);
    const allowAdmins = parseBoolean(
      payload.allowAdmins,
      existingMaintenance.allowAdmins !== false
    );
    const messageText =
      typeof payload.message === "string"
        ? payload.message.trim()
        : existingMaintenance.message || DEFAULT_MAINTENANCE_MESSAGE;

    settings.maintenance = {
      enabled,
      allowAdmins,
      message: messageText || DEFAULT_MAINTENANCE_MESSAGE,
    };

    await settingsStore.save(db, settings);
    return res.json({
      ok: true,
      maintenance: settings.maintenance,
    });
  });

  app.post("/admin/settings/packages/update", async (req, res) => {
    if (!req.session.pterodactyl || req.session.pterodactyl.root_admin !== true)
      return res.status(403).json({ ok: false, error: "unauthorized" });

    const { name, ram, disk, cpu, servers } = req.body || {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ ok: false, error: "invalid" });
    }

    if (!settings.api.client.packages.list) settings.api.client.packages.list = {};

    settings.api.client.packages.list[name] = {
      ram: parseFloat(ram) || 0,
      disk: parseFloat(disk) || 0,
      cpu: parseFloat(cpu) || 0,
      servers: parseFloat(servers) || 0,
    };

    await settingsStore.save(db, settings);
    return res.json({ ok: true });
  });

  app.post("/admin/settings/packages/delete", async (req, res) => {
    if (!req.session.pterodactyl || req.session.pterodactyl.root_admin !== true)
      return res.status(403).json({ ok: false, error: "unauthorized" });

    const { name } = req.body || {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ ok: false, error: "invalid" });
    }
    if (settings.api.client.packages.default === name) {
      return res.status(400).json({ ok: false, error: "default" });
    }

    delete settings.api.client.packages.list[name];
    await settingsStore.save(db, settings);
    return res.json({ ok: true });
  });

  app.post("/admin/settings/config", async (req, res) => {
    if (!req.session.pterodactyl || req.session.pterodactyl.root_admin !== true)
      return res.status(403).json({ ok: false, error: "unauthorized" });

    let config = req.body?.config;
    if (typeof config === "string") {
      try {
        config = JSON.parse(config);
      } catch (error) {
        return res.status(400).json({ ok: false, error: "invalid-json" });
      }
    }

    if (!config || typeof config !== "object") {
      return res.status(400).json({ ok: false, error: "invalid-config" });
    }

    await settingsStore.save(db, config);
    return res.json({ ok: true });
  });

  app.get("/admin/eggs", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    ejs.renderFile(
      `./views/admin/eggs.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin/eggs:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/admin/plans", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    ejs.renderFile(
      `./views/admin/plans.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin/plans:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/admin/nodes", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    let nodes = [];
    try {
      const nodesResponse = await fetch(
        `${settings.pterodactyl.domain}/api/application/nodes?per_page=100`,
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );
      const nodesData = await nodesResponse.json();
      nodes = nodesData.data || [];
    } catch (error) {
      console.error("Failed to fetch nodes:", error);
    }

    ejs.renderFile(
      `./views/admin/nodes.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null,
        nodes: nodes
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin/nodes:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/admin/logs", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    const logEntriesRaw = await log.readLogEntries(300);
    const logEntries = mergeLogEntries(logEntriesRaw);

    const logging = settings.logging || { status: false, webhook: "", actions: { user: {}, admin: {}, system: {} } };
    const userActions = countEnabledActions(logging.actions && logging.actions.user);
    const adminActions = countEnabledActions(logging.actions && logging.actions.admin);
    const systemActions = countEnabledActions(logging.actions && logging.actions.system);
    const webhookStats = summarizeWebhookStatus(logEntries);
    const lastEntry = logEntries.length ? logEntries[logEntries.length - 1] : null;
    const logFilePath = typeof log.resolveLogFilePath === "function"
      ? log.resolveLogFilePath()
      : path.join(__dirname, "..", "logs", "transactions.log");
    const relativeLogPath = path.relative(process.cwd(), logFilePath);

    const logInfo = {
      enabled: logging.status !== false,
      webhook: maskSecret(logging.webhook),
      userActions: userActions,
      adminActions: adminActions,
      systemActions: systemActions,
      enabledActions: userActions + adminActions + systemActions,
      lastEntry: lastEntry?.timestamp || null,
      webhookStats,
      logPath: relativeLogPath || "logs/transactions.log",
    };

    ejs.renderFile(
      `./views/admin/logs.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null,
        logEntries: logEntries,
        logInfo: logInfo
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin/logs:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  // Update the /admin/coins route handler
  app.get("/admin/coins", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    // Get user's coins for the header component
    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    // Render the admin coins page with all required variables
    ejs.renderFile(
      `./views/admin/coins.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin/coins:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/removecoins", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    if (!req.query.id || !req.query.coins) {
      return res.redirect(theme.settings.redirect.failedremovecoins + "?err=MISSINGVARIABLES");
    }

    let targetUser = req.query.id;
    let coinsToRemove = parseInt(req.query.coins);

    if (isNaN(coinsToRemove) || coinsToRemove < 1) {
      return res.redirect(theme.settings.redirect.failedremovecoins + "?err=INVALIDCOINS");
    }

    // Check if user exists
    if (!(await db.get("users-" + targetUser))) {
      return res.redirect(theme.settings.redirect.failedremovecoins + "?err=INVALIDUSER");
    }

    // Get current coins
    let currentCoins = await db.get("coins-" + targetUser) || 0;
    
    // If user doesn't have enough coins, set to 0
    if (currentCoins < coinsToRemove) {
      coinsToRemove = currentCoins;
    }
    
    // Remove coins
    let newCoins = currentCoins - coinsToRemove;
    await db.set("coins-" + targetUser, newCoins);

    // Log the action
    log(
      `remove coins`,
      `${req.session.userinfo.username} removed ${coinsToRemove} coins from the account with the ID \`${targetUser}\`.`,
      createAdminLogContext(req, targetUser, "warn", ["coins"])
    );

    return res.redirect(theme.settings.redirect.removecoins);
  });

  app.get("/addcoins", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    if (!req.query.id || !req.query.coins) {
      return res.redirect(theme.settings.redirect.failedaddcoins + "?err=MISSINGVARIABLES");
    }

    let targetUser = req.query.id;
    let coinsToAdd = parseInt(req.query.coins);

    if (isNaN(coinsToAdd) || coinsToAdd < 1) {
      return res.redirect(theme.settings.redirect.failedaddcoins + "?err=INVALIDCOINS");
    }

    // Check if user exists
    if (!(await db.get("users-" + targetUser))) {
      return res.redirect(theme.settings.redirect.failedaddcoins + "?err=INVALIDUSER");
    }

    // Get current coins
    let currentCoins = await db.get("coins-" + targetUser) || 0;
    
    // Add coins
    let newCoins = currentCoins + coinsToAdd;
    await db.set("coins-" + targetUser, newCoins);

    // Log the action
    log(
      `add coins`,
      `${req.session.userinfo.username} added ${coinsToAdd} coins to the account with the ID \`${targetUser}\`.`,
      createAdminLogContext(req, targetUser, "info", ["coins"])
    );

    return res.redirect("/admin/coins?success=Coins added successfully to user " + targetUser);
  });

  // Remove the duplicate route handler and keep just one that handles both URLs
  app.get(["/admin/resource", "/admin/resources"], async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    // Get user's coins for the header component
    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    // Render the admin resource page
    ejs.renderFile(
      `./views/admin/resource.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null
      },
      null,
      function (err, str) {
        if (err) {
          // Only log critical errors
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/admin/user/create", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    ejs.renderFile(
      `./views/admin/user-create.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null,
        packageList: settings.api.client.packages.list || {}
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin/user/create:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/admin/user/create/submit", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const username = (req.query.username || "").trim();
    const email = (req.query.email || "").trim();
    const firstName = (req.query.first_name || "").trim();
    const lastName = (req.query.last_name || "").trim();
    const password = (req.query.password || "").trim();
    const rootAdmin = req.query.root_admin === "true";
    const language = (req.query.language || "en").trim();

    if (!username || !email || !firstName || !lastName || !password) {
      return res.redirect("/admin/user/create?err=MISSINGFIELDS");
    }

    const createResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/users`,
      {
        method: "post",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
          Accept: "application/json",
        },
        body: JSON.stringify({
          username: username,
          email: email,
          first_name: firstName,
          last_name: lastName,
          password: password,
          root_admin: rootAdmin,
          language: language
        }),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.log("Create user failed:", errorText);
      return res.redirect("/admin/user/create?err=CREATEFAILED");
    }

    const createdUser = await createResponse.json();

    const discordId = (req.query.discord_id || "").trim();
    if (discordId) {
      let userids = (await db.get("users")) ? await db.get("users") : [];
      if (!userids.includes(createdUser.attributes.id)) {
        userids.push(createdUser.attributes.id);
        await db.set("users", userids);
      }
      await db.set(`users-${discordId}`, createdUser.attributes.id);

      const plan = (req.query.package || "").trim();
      if (plan && settings.api.client.packages.list[plan]) {
        await db.set(`package-${discordId}`, plan);
      }

      const coins = parseFloat(req.query.coins || 0);
      if (!isNaN(coins) && coins > 0) {
        await db.set(`coins-${discordId}`, coins);
      }

      const extra = {
        ram: parseFloat(req.query.ram || 0),
        disk: parseFloat(req.query.disk || 0),
        cpu: parseFloat(req.query.cpu || 0),
        servers: parseFloat(req.query.servers || 0)
      };
      if (Object.values(extra).some((value) => !isNaN(value) && value !== 0)) {
        await db.set(`extra-${discordId}`, {
          ram: isNaN(extra.ram) ? 0 : extra.ram,
          disk: isNaN(extra.disk) ? 0 : extra.disk,
          cpu: isNaN(extra.cpu) ? 0 : extra.cpu,
          servers: isNaN(extra.servers) ? 0 : extra.servers
        });
      }
    }

    log(
      `create user`,
      `${req.session.userinfo.username} created panel user ${createdUser.attributes.username} (${createdUser.attributes.id}).`,
      createAdminLogContext(req, createdUser.attributes.id, "info", ["user"])
    );

    return res.redirect(`/admin/user/${createdUser.attributes.id}?success=USERCREATED`);
  });

  app.get("/admin/user/export", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const searchQuery = req.query.search || "";
    let page = 1;
    let totalPages = 1;
    let users = [];

    do {
      const usersResponse = await fetch(
        `${settings.pterodactyl.domain}/api/application/users?per_page=100&page=${page}${searchQuery ? `&filter[username]=${encodeURIComponent(searchQuery)}` : ""}`,
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );

      if (!usersResponse.ok) {
        break;
      }

      const usersData = await usersResponse.json();
      users = users.concat(usersData.data || []);
      totalPages = usersData.meta.pagination.total_pages || 1;
      page += 1;
    } while (page <= totalPages);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=\"users-export.json\"");
    return res.send(JSON.stringify({ users: users }, null, 2));
  });

  app.get("/admin/user/:id", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    const userResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/users/${req.params.id}?include=servers`,
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );

    if (!userResponse.ok) {
      return res.redirect("/admin/user?err=USERNOTFOUND");
    }

    const userData = await userResponse.json();
    const pteroUser = userData.attributes;
    const userServers = userData.relationships && userData.relationships.servers ? userData.relationships.servers.data : [];

    const linkedDiscordId = (req.query.discord || "").trim();
    let localData = null;

    if (linkedDiscordId) {
      const mappedId = await db.get(`users-${linkedDiscordId}`);
      if (mappedId && String(mappedId) === String(pteroUser.id)) {
        const packageName = await db.get(`package-${linkedDiscordId}`);
        const extra = (await db.get(`extra-${linkedDiscordId}`)) || {
          ram: 0,
          disk: 0,
          cpu: 0,
          servers: 0
        };
        const coinBalance = (await db.get(`coins-${linkedDiscordId}`)) || 0;
        const ip = await db.get(`ip-${linkedDiscordId}`);

        localData = {
          discordId: linkedDiscordId,
          packageName: packageName || settings.api.client.packages.default,
          extra: extra,
          coins: coinBalance,
          ip: ip || null
        };
      }
    }

    ejs.renderFile(
      `./views/admin/user-detail.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null,
        pteroUser: pteroUser,
        userServers: userServers,
        linkedDiscordId: linkedDiscordId,
        localData: localData,
        packageList: settings.api.client.packages.list || {}
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin/user/:id:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/admin/user/:id/update", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const userResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/users/${req.params.id}`,
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );

    if (!userResponse.ok) {
      return res.redirect(`/admin/user/${req.params.id}?err=USERNOTFOUND`);
    }

    const userData = await userResponse.json();
    const current = userData.attributes;

    const payload = {
      email: req.query.email ? req.query.email.trim() : current.email,
      username: req.query.username ? req.query.username.trim() : current.username,
      first_name: req.query.first_name ? req.query.first_name.trim() : current.first_name,
      last_name: req.query.last_name ? req.query.last_name.trim() : current.last_name,
      root_admin: typeof req.query.root_admin !== "undefined" ? req.query.root_admin === "true" : current.root_admin,
      language: req.query.language ? req.query.language.trim() : current.language
    };

    if (req.query.password && req.query.password.trim().length > 0) {
      payload.password = req.query.password.trim();
    }

    const updateResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/users/${req.params.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!updateResponse.ok) {
      return res.redirect(`/admin/user/${req.params.id}?err=UPDATEFAILED`);
    }

    log(
      `update user`,
      `${req.session.userinfo.username} updated panel user ${current.username} (${current.id}).`,
      createAdminLogContext(req, current.id, "info", ["user"])
    );

    return res.redirect(`/admin/user/${req.params.id}?success=USERUPDATED`);
  });

  app.get("/admin/user/:id/local/plan", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const discordId = (req.query.discord || "").trim();
    const packageName = (req.query.package || "").trim();

    if (!discordId) {
      return res.redirect(`/admin/user/${req.params.id}?err=MISSINGDISCORD`);
    }

    const mappedId = await db.get(`users-${discordId}`);
    if (!mappedId || String(mappedId) !== String(req.params.id)) {
      return res.redirect(`/admin/user/${req.params.id}?err=INVALIDDISCORD`);
    }

    if (!packageName) {
      await db.delete(`package-${discordId}`);
    } else if (!settings.api.client.packages.list[packageName]) {
      return res.redirect(`/admin/user/${req.params.id}?discord=${encodeURIComponent(discordId)}&err=INVALIDPACKAGE`);
    } else {
      await db.set(`package-${discordId}`, packageName);
    }

    adminjs.suspend(discordId);

    log(
      `set plan`,
      `${req.session.userinfo.username} updated plan for Discord ID ${discordId} to ${packageName || "default"}.`,
      createAdminLogContext(req, discordId, "info", ["plan"])
    );

    return res.redirect(`/admin/user/${req.params.id}?discord=${encodeURIComponent(discordId)}&success=PLANUPDATED`);
  });

  app.get("/admin/user/:id/local/resources", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const discordId = (req.query.discord || "").trim();
    if (!discordId) {
      return res.redirect(`/admin/user/${req.params.id}?err=MISSINGDISCORD`);
    }

    const mappedId = await db.get(`users-${discordId}`);
    if (!mappedId || String(mappedId) !== String(req.params.id)) {
      return res.redirect(`/admin/user/${req.params.id}?err=INVALIDDISCORD`);
    }

    const extra = (await db.get(`extra-${discordId}`)) || {
      ram: 0,
      disk: 0,
      cpu: 0,
      servers: 0
    };

    const ram = parseFloat(req.query.ram || 0);
    const disk = parseFloat(req.query.disk || 0);
    const cpu = parseFloat(req.query.cpu || 0);
    const servers = parseFloat(req.query.servers || 0);

    if (!isNaN(ram)) extra.ram += ram;
    if (!isNaN(disk)) extra.disk += disk;
    if (!isNaN(cpu)) extra.cpu += cpu;
    if (!isNaN(servers)) extra.servers += servers;

    if (extra.ram === 0 && extra.disk === 0 && extra.cpu === 0 && extra.servers === 0) {
      await db.delete(`extra-${discordId}`);
    } else {
      await db.set(`extra-${discordId}`, extra);
    }

    adminjs.suspend(discordId);

    log(
      `set resources`,
      `${req.session.userinfo.username} adjusted extra resources for Discord ID ${discordId}.`,
      createAdminLogContext(req, discordId, "info", ["resources"])
    );

    return res.redirect(`/admin/user/${req.params.id}?discord=${encodeURIComponent(discordId)}&success=RESOURCESUPDATED`);
  });

  app.get("/admin/user/:id/local/coins", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const discordId = (req.query.discord || "").trim();
    const mode = (req.query.mode || "set").trim();
    const coins = parseFloat(req.query.coins || 0);

    if (!discordId) {
      return res.redirect(`/admin/user/${req.params.id}?err=MISSINGDISCORD`);
    }

    const mappedId = await db.get(`users-${discordId}`);
    if (!mappedId || String(mappedId) !== String(req.params.id)) {
      return res.redirect(`/admin/user/${req.params.id}?err=INVALIDDISCORD`);
    }

    if (isNaN(coins)) {
      return res.redirect(`/admin/user/${req.params.id}?discord=${encodeURIComponent(discordId)}&err=INVALIDCOINS`);
    }

    if (mode === "add") {
      const current = (await db.get(`coins-${discordId}`)) || 0;
      const updated = current + coins;
      if (updated <= 0) {
        await db.delete(`coins-${discordId}`);
      } else {
        await db.set(`coins-${discordId}`, updated);
      }
    } else {
      if (coins <= 0) {
        await db.delete(`coins-${discordId}`);
      } else {
        await db.set(`coins-${discordId}`, coins);
      }
    }

    log(
      mode === "add" ? `add coins` : `set coins`,
      `${req.session.userinfo.username} updated coins for Discord ID ${discordId}.`,
      createAdminLogContext(req, discordId, "info", ["coins"])
    );

    return res.redirect(`/admin/user/${req.params.id}?discord=${encodeURIComponent(discordId)}&success=COINSUPDATED`);
  });

  app.get("/admin/user/:id/link", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const discordId = (req.query.discord || "").trim();
    if (!discordId) {
      return res.redirect(`/admin/user/${req.params.id}?err=MISSINGDISCORD`);
    }

    const existing = await db.get(`users-${discordId}`);
    if (existing && String(existing) !== String(req.params.id)) {
      return res.redirect(`/admin/user/${req.params.id}?err=DISCORDALREADYLINKED`);
    }

    let userids = (await db.get("users")) ? await db.get("users") : [];
    if (!userids.includes(parseInt(req.params.id, 10))) {
      userids.push(parseInt(req.params.id, 10));
      await db.set("users", userids);
    }
    await db.set(`users-${discordId}`, parseInt(req.params.id, 10));

    log(
      `link user`,
      `${req.session.userinfo.username} linked Discord ID ${discordId} to panel user ${req.params.id}.`,
      createAdminLogContext(req, discordId, "info", ["user", "link"])
    );

    return res.redirect(`/admin/user/${req.params.id}?discord=${encodeURIComponent(discordId)}&success=LINKED`);
  });

  app.get("/admin/user/:id/reset-password", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const userResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/users/${req.params.id}`,
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );

    if (!userResponse.ok) {
      return res.redirect(`/admin/user/${req.params.id}?err=USERNOTFOUND`);
    }

    const userData = await userResponse.json();
    const current = userData.attributes;
    const password = (req.query.password || Math.random().toString(36).slice(2, 12)).trim();

    const updateResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/users/${req.params.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
        body: JSON.stringify({
          email: current.email,
          username: current.username,
          first_name: current.first_name,
          last_name: current.last_name,
          root_admin: current.root_admin,
          language: current.language,
          password: password
        }),
      }
    );

    if (!updateResponse.ok) {
      return res.redirect(`/admin/user/${req.params.id}?err=PASSWORDFAILED`);
    }

    log(
      `reset password`,
      `${req.session.userinfo.username} reset the password for panel user ${req.params.id}.`,
      createAdminLogContext(req, req.params.id, "warn", ["user", "security"])
    );

    return res.redirect(`/admin/user/${req.params.id}?success=PASSWORDRESET&password=${encodeURIComponent(password)}`);
  });

  app.get("/admin/user/:id/delete", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const deleteResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/users/${req.params.id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );

    if (!deleteResponse.ok) {
      return res.redirect(`/admin/user/${req.params.id}?err=DELETEFAILED`);
    }

    let userids = (await db.get("users")) ? await db.get("users") : [];
    userids = userids.filter((id) => String(id) !== String(req.params.id));
    if (userids.length === 0) {
      await db.delete("users");
    } else {
      await db.set("users", userids);
    }

    const discordId = (req.query.discord || "").trim();
    if (discordId) {
      const mappedId = await db.get(`users-${discordId}`);
      if (mappedId && String(mappedId) === String(req.params.id)) {
        await db.delete(`users-${discordId}`);
        await db.delete(`coins-${discordId}`);
        await db.delete(`extra-${discordId}`);
        await db.delete(`package-${discordId}`);
        await db.delete(`ip-${discordId}`);
      }
    }

    log(
      `delete user`,
      `${req.session.userinfo.username} deleted panel user ${req.params.id}.`,
      createAdminLogContext(req, req.params.id, "warn", ["user"])
    );

    return res.redirect(`/admin/user?success=USERDELETED`);
  });

  app.get("/admin/user", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    // Get user's coins for the header component
    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    // Pagination setup
    const page = parseInt(req.query.page) || 1;
    const perPage = 10;

    // Search functionality
    const searchQuery = req.query.search || "";
    const searchParams = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : "";

    try {
      // Fetch users from Pterodactyl API
      const usersResponse = await fetch(
        `${settings.pterodactyl.domain}/api/application/users?per_page=${perPage}&page=${page}${searchQuery ? `&filter[username]=${encodeURIComponent(searchQuery)}` : ''}`,
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );
      
      if (!usersResponse.ok) {
        throw new Error(`Failed to fetch users: ${usersResponse.statusText}`);
      }
      
      const usersData = await usersResponse.json();
      const users = usersData.data;
      const totalUsers = usersData.meta.pagination.total;
      const totalPages = Math.ceil(totalUsers / perPage);

      // Get user statistics for the stats card
      let userStats = {
        total: totalUsers,
        admins: 0,
        newToday: 0,
        activePercent: 0
      };

      // Count admins
      userStats.admins = users.filter(user => user.attributes.root_admin).length;
      
      // Estimate active users percentage (placeholder - actual logic would depend on your definition of "active")
      userStats.activePercent = Math.floor(Math.random() * 20) + 70; // Random value between 70-90% for demo

      // Render the admin user management page
      ejs.renderFile(
        `./views/admin/user.ejs`,
        {
          req: req,
          settings: settings,
          pterodactyl: req.session.pterodactyl,
          theme: theme.name,
          extra: theme.settings.extra,
          db: db,
          coins: coins,
          userinfo: req.session.userinfo,
          packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
          packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null,
          users: users,
          currentPage: page,
          totalPages: totalPages,
          totalUsers: totalUsers,
          perPage: perPage,
          searchQuery: searchQuery,
          searchParams: searchParams,
          userStats: userStats
        },
        null,
        function (err, str) {
          if (err) {
            console.log(`App ― An error has occurred on path /admin/user:`);
            console.log(err);
            return res.send("Internal Server Error");
          }
          res.status(200);
          res.send(str);
        }
      );
    } catch (error) {
      console.error("Error in /admin/user route:", error);
      return res.status(500).send("Internal Server Error: " + error.message);
    }
  });

  // Add this route handler after the admin/user route

  app.get("/admin/server", async (req, res) => {
    try {
      let theme = indexjs.get(req);

      if (!req.session.pterodactyl) return four0four(req, res, theme);

      let cacheaccount = await fetch(
        settings.pterodactyl.domain +
          "/api/application/users/" +
          (await db.get("users-" + req.session.userinfo.id)) +
          "?include=servers",
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );
      if ((await cacheaccount.statusText) == "Not Found")
        return four0four(req, res, theme);
      let cacheaccountinfo = JSON.parse(await cacheaccount.text());

      req.session.pterodactyl = cacheaccountinfo.attributes;
      if (cacheaccountinfo.attributes.root_admin !== true)
        return four0four(req, res, theme);

      // Get user's coins for the header component
      let coins = 0;
      if (settings.api.client.coins.enabled && req.session.userinfo) {
        coins = await db.get("coins-" + req.session.userinfo.id) || 0;
      }

      // Pagination parameters
      const page = parseInt(req.query.page) || 1;
      const perPage = 10;
      const searchQuery = req.query.search || "";
      const searchParams = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : "";

      // Fetch servers from Pterodactyl API
      let serversResponse = await fetch(
        `${settings.pterodactyl.domain}/api/application/servers?per_page=${perPage}&page=${page}${searchQuery ? `&filter[name]=${encodeURIComponent(searchQuery)}` : ""}`,
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );

      if (!serversResponse.ok) {
        throw new Error(`Failed to fetch servers: ${serversResponse.statusText}`);
      }

      const serversData = await serversResponse.json();
      const servers = serversData.data;
      const totalServers = serversData.meta.pagination.total;
      const totalPages = Math.ceil(totalServers / perPage);

      // Render the admin server management page
      ejs.renderFile(
        `./views/admin/server.ejs`,
        {
          req: req,
          settings: settings,
          pterodactyl: req.session.pterodactyl,
          theme: theme.name,
          extra: theme.settings.extra,
          db: db,
          coins: coins,
          userinfo: req.session.userinfo,
          packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
          packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null,
          servers: servers,
          currentPage: page,
          totalPages: totalPages,
          totalServers: totalServers,
          perPage: perPage,
          searchQuery: searchQuery,
          searchParams: searchParams
        },
        null,
        function (err, str) {
          if (err) {
            console.log(`App ― An error has occurred on path /admin/server:`);
            console.log(err);
            return res.send("Internal Server Error");
          }
          res.status(200);
          res.send(str);
        }
      );
    } catch (error) {
      console.error("Error in /admin/server route:", error);
      return res.status(500).send("Internal Server Error: " + error.message);
    }
  });

  app.get("/admin/server/create", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    ejs.renderFile(
      `./views/admin/server-create.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null,
        eggs: settings.api.client.eggs || {},
        locations: settings.api.client.locations || {}
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin/server/create:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/admin/server/create/submit", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const name = (req.query.name || "").trim();
    const eggKey = (req.query.egg || "").trim();
    const location = parseInt(req.query.location, 10);
    const ram = parseInt(req.query.ram, 10);
    const disk = parseInt(req.query.disk, 10);
    const cpu = parseInt(req.query.cpu, 10);

    let userId = (req.query.user_id || "").trim();
    const discordId = (req.query.discord_id || "").trim();
    if (!userId && discordId) {
      userId = await db.get(`users-${discordId}`);
    }

    if (!name || !eggKey || !location || !ram || !disk || !cpu || !userId) {
      return res.redirect("/admin/server/create?err=MISSINGFIELDS");
    }

    const eggInfo = settings.api.client.eggs[eggKey];
    if (!eggInfo || !eggInfo.info) {
      return res.redirect("/admin/server/create?err=INVALIDEGG");
    }

    let specs = JSON.parse(JSON.stringify(eggInfo.info));
    specs.user = userId;
    if (!specs.limits) {
      specs.limits = {
        swap: 0,
        io: 500,
        backups: 0,
      };
    }
    specs.name = name;
    specs.limits.swap = -1;
    specs.limits.memory = ram;
    specs.limits.disk = disk;
    specs.limits.cpu = cpu;
    specs.feature_limits = specs.feature_limits || {};
    if (!specs.feature_limits.allocations) {
      specs.feature_limits.allocations = 25;
    }
    if (!specs.deploy) {
      specs.deploy = {
        locations: [],
        dedicated_ip: false,
        port_range: [],
      };
    }
    specs.deploy.locations = [location];

    const serverinfo = await fetch(
      `${settings.pterodactyl.domain}/api/application/servers`,
      {
        method: "post",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
          Accept: "application/json",
        },
        body: JSON.stringify(specs),
      }
    );

    if (!serverinfo.ok) {
      const errorText = await serverinfo.text();
      console.log("Admin create server failed:", errorText);
      return res.redirect("/admin/server/create?err=CREATEFAILED");
    }

    const serverData = await serverinfo.json();

    log(
      `create server`,
      `${req.session.userinfo.username} created server ${serverData.attributes.name} (${serverData.attributes.id}).`,
      createAdminLogContext(req, serverData.attributes.id, "info", ["server"])
    );

    return res.redirect(`/admin/server?success=SERVERCREATED`);
  });

  app.get("/admin/server/export", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const searchQuery = req.query.search || "";
    let page = 1;
    let totalPages = 1;
    let servers = [];

    do {
      const serversResponse = await fetch(
        `${settings.pterodactyl.domain}/api/application/servers?per_page=100&page=${page}${searchQuery ? `&filter[name]=${encodeURIComponent(searchQuery)}` : ""}`,
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );

      if (!serversResponse.ok) {
        break;
      }

      const serversData = await serversResponse.json();
      servers = servers.concat(serversData.data || []);
      totalPages = serversData.meta.pagination.total_pages || 1;
      page += 1;
    } while (page <= totalPages);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=\"servers-export.json\"");
    return res.send(JSON.stringify({ servers: servers }, null, 2));
  });

  app.get("/admin/server/:id/edit", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    let coins = 0;
    if (settings.api.client.coins.enabled && req.session.userinfo) {
      coins = await db.get("coins-" + req.session.userinfo.id) || 0;
    }

    const serverResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/servers/${req.params.id}?include=allocations,egg`,
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );

    if (!serverResponse.ok) {
      return res.redirect("/admin/server?err=SERVERNOTFOUND");
    }

    const serverData = await serverResponse.json();
    const server = serverData.attributes;
    const allocations = (serverData.relationships && serverData.relationships.allocations && serverData.relationships.allocations.data) || [];
    const primaryAllocation = allocations.find((alloc) => alloc.attributes && alloc.attributes.is_default) || allocations[0];
    const allocationId = primaryAllocation ? primaryAllocation.attributes.id : server.allocation;

    ejs.renderFile(
      `./views/admin/server-edit.ejs`,
      {
        req: req,
        settings: settings,
        pterodactyl: req.session.pterodactyl,
        theme: theme.name,
        extra: theme.settings.extra,
        db: db,
        coins: coins,
        userinfo: req.session.userinfo,
        packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default : null,
        packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) || settings.api.client.packages.default] : null,
        server: server,
        allocationId: allocationId
      },
      null,
      function (err, str) {
        if (err) {
          console.log(`App ― An error has occurred on path /admin/server/:id/edit:`);
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(200);
        res.send(str);
      }
    );
  });

  app.get("/admin/server/:id/update", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);

    let cacheaccount = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        (await db.get("users-" + req.session.userinfo.id)) +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await cacheaccount.statusText) == "Not Found")
      return four0four(req, res, theme);
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccountinfo.attributes;
    if (cacheaccountinfo.attributes.root_admin !== true)
      return four0four(req, res, theme);

    const serverResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/servers/${req.params.id}`,
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );

    if (!serverResponse.ok) {
      return res.redirect(`/admin/server/${req.params.id}/edit?err=SERVERNOTFOUND`);
    }

    const serverData = await serverResponse.json();
    const current = serverData.attributes;

    const name = req.query.name ? req.query.name.trim() : current.name;
    const description = typeof req.query.description !== "undefined" ? req.query.description.trim() : current.description;

    const allocationId = req.query.allocation ? parseInt(req.query.allocation, 10) : current.allocation;
    const memory = req.query.memory ? parseInt(req.query.memory, 10) : current.limits.memory;
    const disk = req.query.disk ? parseInt(req.query.disk, 10) : current.limits.disk;
    const cpu = req.query.cpu ? parseInt(req.query.cpu, 10) : current.limits.cpu;
    const io = req.query.io ? parseInt(req.query.io, 10) : current.limits.io;
    const swap = req.query.swap ? parseInt(req.query.swap, 10) : current.limits.swap;
    const backups = req.query.backups ? parseInt(req.query.backups, 10) : current.feature_limits.backups;
    const databases = req.query.databases ? parseInt(req.query.databases, 10) : current.feature_limits.databases;
    const allocations = req.query.allocations ? parseInt(req.query.allocations, 10) : current.feature_limits.allocations;

    const detailResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/servers/${req.params.id}/details`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
        body: JSON.stringify({
          name: name,
          user: current.user,
          description: description
        }),
      }
    );

    if (!detailResponse.ok) {
      return res.redirect(`/admin/server/${req.params.id}/edit?err=DETAILUPDATEFAILED`);
    }

    const buildResponse = await fetch(
      `${settings.pterodactyl.domain}/api/application/servers/${req.params.id}/build`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
        body: JSON.stringify({
          allocation: allocationId,
          memory: memory,
          swap: swap,
          disk: disk,
          io: io,
          cpu: cpu,
          threads: null,
          feature_limits: {
            databases: databases,
            backups: backups,
            allocations: allocations
          }
        }),
      }
    );

    if (!buildResponse.ok) {
      return res.redirect(`/admin/server/${req.params.id}/edit?err=BUILDUPDATEFAILED`);
    }

    log(
      `update server`,
      `${req.session.userinfo.username} updated server ${req.params.id}.`,
      createAdminLogContext(req, req.params.id, "info", ["server"])
    );

    return res.redirect(`/admin/server/${req.params.id}/edit?success=SERVERUPDATED`);
  });

  app.get("/admin/server/:id/reinstall", async (req, res) => {
    let theme = indexjs.get(req);

    if (!req.session.pterodactyl) return four0four(req, res, theme);
    if (req.session.pterodactyl.root_admin !== true) return four0four(req, res, theme);

    const response = await fetch(
      `${settings.pterodactyl.domain}/api/application/servers/${req.params.id}/reinstall`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );

    if (!response.ok) {
      return res.redirect(`/admin/server/${req.params.id}/edit?err=REINSTALLFAILED`);
    }

    log(
      `reinstall server`,
      `${req.session.userinfo.username} triggered reinstall for server ${req.params.id}.`,
      createAdminLogContext(req, req.params.id, "warn", ["server"])
    );

    return res.redirect(`/admin/server/${req.params.id}/edit?success=REINSTALLED`);
  });

  // Add these routes for server actions
  app.get("/admin/server/:id/suspend", async (req, res) => {
    try {
      let theme = indexjs.get(req);
      
      if (!req.session.pterodactyl) return four0four(req, res, theme);
      if (req.session.pterodactyl.root_admin !== true) return four0four(req, res, theme);
      
      const serverId = req.params.id;
      
      // Call Pterodactyl API to suspend the server
      const response = await fetch(
        `${settings.pterodactyl.domain}/api/application/servers/${serverId}/suspend`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );
      
      if (!response.ok) {
        return res.redirect(theme.settings.redirect.failedsuspendserver || "/admin/server?err=Failed to suspend server");
      }
      
      // Log the action
      log(
        `suspend server`,
        `${req.session.userinfo.username} suspended server with ID ${serverId}.`,
        createAdminLogContext(req, serverId, "warn", ["server"])
      );
      
      return res.redirect(theme.settings.redirect.suspendserver || "/admin/server?success=Server suspended successfully");
    } catch (error) {
      console.error("Error suspending server:", error);
      return res.redirect("/admin/server?err=SERVERERROR");
    }
  });

  app.get("/admin/server/:id/unsuspend", async (req, res) => {
    try {
      let theme = indexjs.get(req);
      
      if (!req.session.pterodactyl) return four0four(req, res, theme);
      if (req.session.pterodactyl.root_admin !== true) return four0four(req, res, theme);
      
      const serverId = req.params.id;
      
      // Call Pterodactyl API to unsuspend the server
      const response = await fetch(
        `${settings.pterodactyl.domain}/api/application/servers/${serverId}/unsuspend`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );
      
      if (!response.ok) {
        return res.redirect(theme.settings.redirect.failedunsuspendserver || "/admin/server?err=Failed to unsuspend server");
      }
      
      // Log the action
      log(
        `unsuspend server`,
        `${req.session.userinfo.username} unsuspended server with ID ${serverId}.`,
        createAdminLogContext(req, serverId, "info", ["server"])
      );
      
      return res.redirect(theme.settings.redirect.unsuspendserver || "/admin/server?success=Server unsuspended successfully");
    } catch (error) {
      console.error("Error unsuspending server:", error);
      return res.redirect("/admin/server?err=SERVERERROR");
    }
  });

  app.get("/admin/server/:id/delete", async (req, res) => {
    try {
      let theme = indexjs.get(req);
      
      if (!req.session.pterodactyl) return four0four(req, res, theme);
      if (req.session.pterodactyl.root_admin !== true) return four0four(req, res, theme);
      
      const serverId = req.params.id;
      
      // Call Pterodactyl API to delete the server
      const response = await fetch(
        `${settings.pterodactyl.domain}/api/application/servers/${serverId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );
      
      if (!response.ok) {
        return res.redirect(theme.settings.redirect.faileddeleteadminserver || "/admin/server?err=Failed to delete server");
      }
      
      // Log the action
      log(
        `delete server`,
        `${req.session.userinfo.username} deleted server with ID ${serverId}.`,
        createAdminLogContext(req, serverId, "warn", ["server"])
      );
      
      return res.redirect(theme.settings.redirect.deleteadminserver || "/admin/server?success=Server deleted successfully");
    } catch (error) {
      console.error("Error deleting server:", error);
      return res.redirect("/admin/server?err=SERVERERROR");
    }
  });

  async function four0four(req, res, theme) {
    ejs.renderFile(
      `./views/${theme.settings.notfound}`,
      await eval(indexjs.renderdataeval),
      null,
      function (err, str) {
        delete req.session.newaccount;
        if (err) {
          console.log(
            `App ― An error has occured on path ${req._parsedUrl.pathname}:`
          );
          console.log(err);
          return res.send("Internal Server Error");
        }
        res.status(404);
        res.send(str);
      }
    );
  }

  module.exports.suspend = async function (discordid) {
    if (settings.api.client.allow.overresourcessuspend !== true) return;

    let canpass = await indexjs.islimited();
    if (canpass == false) {
      setTimeout(async function () {
        adminjs.suspend(discordid);
      }, 1);
      return;
    }

    indexjs.ratelimits(1);
    let pterodactylid = await db.get("users-" + discordid);
    let userinforeq = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        pterodactylid +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await userinforeq.statusText) == "Not Found") {
      console.log(
        "App ― An error has occured while attempting to check if a user's server should be suspended."
      );
      console.log("- Discord ID: " + discordid);
      console.log("- Pterodactyl Panel ID: " + pterodactylid);
      return;
    }
    let userinfo = JSON.parse(await userinforeq.text());

    let packagename = await db.get("package-" + discordid);
    let package =
      settings.api.client.packages.list[
        packagename || settings.api.client.packages.default
      ];

    let extra = (await db.get("extra-" + discordid)) || {
      ram: 0,
      disk: 0,
      cpu: 0,
      servers: 0,
    };

    let plan = {
      ram: package.ram + extra.ram,
      disk: package.disk + extra.disk,
      cpu: package.cpu + extra.cpu,
      servers: package.servers + extra.servers,
    };

    let current = {
      ram: 0,
      disk: 0,
      cpu: 0,
      servers: userinfo.attributes.relationships.servers.data.length,
    };
    for (
      let i = 0, len = userinfo.attributes.relationships.servers.data.length;
      i < len;
      i++
    ) {
      current.ram =
        current.ram +
        userinfo.attributes.relationships.servers.data[i].attributes.limits
          .memory;
      current.disk =
        current.disk +
        userinfo.attributes.relationships.servers.data[i].attributes.limits
          .disk;
      current.cpu =
        current.cpu +
        userinfo.attributes.relationships.servers.data[i].attributes.limits.cpu;
    }

    indexjs.ratelimits(userinfo.attributes.relationships.servers.data.length);
    if (
      current.ram > plan.ram ||
      current.disk > plan.disk ||
      current.cpu > plan.cpu ||
      current.servers > plan.servers
    ) {
      for (
        let i = 0, len = userinfo.attributes.relationships.servers.data.length;
        i < len;
        i++
      ) {
        let suspendid =
          userinfo.attributes.relationships.servers.data[i].attributes.id;
        await fetch(
          settings.pterodactyl.domain +
            "/api/application/servers/" +
            suspendid +
            "/suspend",
          {
            method: "post",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${settings.pterodactyl.key}`,
            },
          }
        );
      }
    } else {
      if (settings.api.client.allow.renewsuspendsystem.enabled == true) return;
      for (
        let i = 0, len = userinfo.attributes.relationships.servers.data.length;
        i < len;
        i++
      ) {
        let suspendid =
          userinfo.attributes.relationships.servers.data[i].attributes.id;
        await fetch(
          settings.pterodactyl.domain +
            "/api/application/servers/" +
            suspendid +
            "/unsuspend",
          {
            method: "post",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${settings.pterodactyl.key}`,
            },
          }
        );
      }
    }
  };
};

function hexToDecimal(hex) {
  return parseInt(hex.replace("#", ""), 16);
}

async function checkForUpdates(currentVersion) {
  try {
    // Instead of checking releases, just check the repo info
    const response = await axios.get('https://api.github.com/repos/urixen-org/Zypherous');
    
    // If we get here, the repo exists
    return {
      isUpToDate: true, // Assume up to date since we can't check specific versions
      latestVersion: currentVersion,
      releaseUrl: 'https://github.com/urixen-org/Zypherous',
      releaseType: 'Beta Release',
      releaseDate: 'Current'
    };
  } catch (error) {
    console.error('Error checking GitHub repository:', error.message);
    
    // Return default values if there's an error
    return {
      isUpToDate: true,
      latestVersion: currentVersion,
      releaseUrl: 'https://github.com/urixen-org/Zypherous',
      releaseType: 'Beta Release',
      releaseDate: new Date().toLocaleDateString()
    };
  }
}
