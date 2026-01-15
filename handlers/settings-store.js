const fs = require("fs");
const toml = require("@iarna/toml");
const fetch = require("node-fetch");

const SETTINGS_KEY = "config:settings";
const SETTINGS_UPDATED_KEY = "config:settings-updated";

const settings = global.__settings || {};
global.__settings = settings;

let lastUpdatedAt = null;

function applySettings(nextSettings) {
  const snapshot =
    nextSettings === settings
      ? JSON.parse(JSON.stringify(nextSettings))
      : nextSettings;
  const keys = Object.keys(settings);
  for (const key of keys) {
    delete settings[key];
  }
  Object.assign(settings, snapshot);
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(target, source) {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    for (const [key, value] of Object.entries(source)) {
      if (isObject(value)) {
        output[key] = mergeDeep(target[key] || {}, value);
      } else {
        output[key] = value;
      }
    }
  }
  return output;
}

async function fetchPaged(url, headers) {
  const items = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}page=${page}&per_page=100`, {
      headers,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to fetch ${url} (status ${response.status}): ${body}`);
    }

    const payload = await response.json();
    items.push(...(payload.data || []));

    const meta = payload.meta || {};
    const pagination = meta.pagination || {};
    totalPages = pagination.total_pages || 1;
    page += 1;
  }

  return items;
}

function buildEnvironment(variables = []) {
  const environment = {};
  for (const variable of variables) {
    const attrs = variable.attributes || variable;
    if (!attrs || !attrs.env_variable) continue;
    environment[attrs.env_variable] = attrs.default_value ?? "";
  }
  return environment;
}

function findExistingEgg(existingEggs, eggId) {
  if (!existingEggs) return null;
  const entries = Object.entries(existingEggs);
  for (const [key, value] of entries) {
    if (value && value.info && value.info.egg === eggId) {
      return { key, value };
    }
  }
  const fallbackKey = `egg-${eggId}`;
  if (existingEggs[fallbackKey]) {
    return { key: fallbackKey, value: existingEggs[fallbackKey] };
  }
  return null;
}

function normalizeEggEntry(existing, payload) {
  const minimum = existing?.minimum || { ram: 0, disk: 0, cpu: 0 };
  const maximum = existing?.maximum || { ram: 0, disk: 0, cpu: 0 };

  return {
    display: existing?.display || payload.name || `Egg ${payload.id}`,
    icon: existing?.icon || "",
    pro: existing?.pro === true,
    adminOnly: existing?.adminOnly === true,
    minimum,
    maximum,
    info: {
      egg: payload.id,
      docker_image: existing?.info?.docker_image || payload.docker_image || payload.dockerImage || "",
      startup: existing?.info?.startup || payload.startup || "",
      environment: existing?.info?.environment || payload.environment || {},
      feature_limits: existing?.info?.feature_limits || { databases: 0, backups: 0 },
    },
  };
}

async function syncEggsFromPanel(db, { force = false } = {}) {
  if (!settings.pterodactyl || !settings.pterodactyl.domain || !settings.pterodactyl.key) {
    return { ok: false, reason: "missing-panel-config" };
  }

  const baseUrl = settings.pterodactyl.domain.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${settings.pterodactyl.key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const nests = await fetchPaged(`${baseUrl}/api/application/nests`, headers);
  const eggsByKey = {};
  const existingEggs = settings.api?.client?.eggs || {};

  for (const nest of nests) {
    const nestId = nest.attributes?.id ?? nest.id;
    if (!nestId) continue;

    const eggs = await fetchPaged(`${baseUrl}/api/application/nests/${nestId}/eggs?include=variables`, headers);

    for (const egg of eggs) {
      const attrs = egg.attributes || egg;
      if (!attrs || !attrs.id) continue;

      const existingEntry = findExistingEgg(existingEggs, attrs.id);
      const variables = egg.relationships?.variables?.data || attrs.relationships?.variables?.data || [];
      const environment = buildEnvironment(variables);

      const normalized = normalizeEggEntry(existingEntry?.value, {
        id: attrs.id,
        name: attrs.name,
        docker_image: attrs.docker_image || (attrs.docker_images ? Object.values(attrs.docker_images)[0] : ""),
        startup: attrs.startup,
        environment,
      });

      const eggKey = existingEntry?.key || `egg-${attrs.id}`;
      eggsByKey[eggKey] = normalized;
    }
  }

  if (!settings.api) settings.api = {};
  if (!settings.api.client) settings.api.client = {};
  settings.api.client.eggs = eggsByKey;

  await db.set(SETTINGS_KEY, settings);
  await db.set(SETTINGS_UPDATED_KEY, Date.now());

  return { ok: true, count: Object.keys(eggsByKey).length, forced: force };
}

async function init(db, filePath) {
  const fileSettings = toml.parse(fs.readFileSync(filePath, "utf8"));
  applySettings(fileSettings);

  const storedSettings = await db.get(SETTINGS_KEY);
  if (storedSettings && typeof storedSettings === "object") {
    applySettings(mergeDeep(fileSettings, storedSettings));
  } else {
    await db.set(SETTINGS_KEY, settings);
    await db.set(SETTINGS_UPDATED_KEY, Date.now());
  }

  const eggCount = settings.api?.client?.eggs ? Object.keys(settings.api.client.eggs).length : 0;
  if (eggCount === 0) {
    try {
      await syncEggsFromPanel(db, { force: true });
    } catch (error) {
      console.error("Egg sync failed during init:", error);
    }
  }

  lastUpdatedAt = await db.get(SETTINGS_UPDATED_KEY);
  return settings;
}

async function save(db, nextSettings) {
  applySettings(nextSettings);
  await db.set(SETTINGS_KEY, settings);
  await db.set(SETTINGS_UPDATED_KEY, Date.now());
}

async function refreshIfUpdated(db) {
  const updatedAt = await db.get(SETTINGS_UPDATED_KEY);
  if (!updatedAt || updatedAt === lastUpdatedAt) return false;

  const storedSettings = await db.get(SETTINGS_KEY);
  if (storedSettings && typeof storedSettings === "object") {
    applySettings(storedSettings);
    lastUpdatedAt = updatedAt;
    return true;
  }

  return false;
}

function startAutoRefresh(db, intervalMs = 5000) {
  setInterval(() => {
    refreshIfUpdated(db).catch((error) => {
      console.error("Settings refresh failed:", error);
    });
  }, intervalMs).unref();
}

module.exports = {
  settings,
  init,
  save,
  refreshIfUpdated,
  startAutoRefresh,
  syncEggsFromPanel,
};
