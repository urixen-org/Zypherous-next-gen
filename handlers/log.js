const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const fetch = require("node-fetch");
const loadConfig = require("./config");
const settingsStore = require("./settings-store");

// Use the same settings object that settings-store mutates so changes are live.
const settings = settingsStore.settings || loadConfig("../config.yaml");

const DEFAULT_MAX_LOG_KB = 512;
const DEFAULT_TIMEOUT_MS = 5000;
const WEBHOOK_COLORS = {
  info: 0x38bdf8,
  warn: 0xf59e0b,
  error: 0xef4444,
  success: 0x22c55e,
};

let webhookQueue = [];
let flushing = false;

function normalizeAction(action) {
  return (action || "event").toString().trim();
}

function normalizeSeverity(severity) {
  const level = (severity || "info").toString().toLowerCase();
  if (["info", "warn", "error", "success"].includes(level)) return level;
  return "info";
}

function resolveLogFilePath() {
  const configuredPath =
    (settings.logging &&
      settings.logging.local &&
      typeof settings.logging.local.file === "string" &&
      settings.logging.local.file.trim()) ||
    path.join("logs", "transactions.log");

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(__dirname, "..", configuredPath);
}

function ensureLogFile() {
  const logFilePath = resolveLogFilePath();
  const dir = path.dirname(logFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, "", "utf8");
  }
}

function rotateLogIfNeeded() {
  const logFilePath = resolveLogFilePath();
  const maxBytes =
    Math.max(
      64,
      (settings.logging &&
        settings.logging.local &&
        Number(settings.logging.local.max_size_kb)) ||
        DEFAULT_MAX_LOG_KB
    ) * 1024;

  try {
    const stats = fs.statSync(logFilePath);
    if (stats.size < maxBytes) return;

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");
    const rotatedPath = `${logFilePath}.${timestamp}.bak`;
    fs.renameSync(logFilePath, rotatedPath);
    fs.writeFileSync(logFilePath, "", "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Logging rotation failed:", error);
    }
  }
}

function persistEntry(entry) {
  try {
    ensureLogFile();
    rotateLogIfNeeded();
    const payload = JSON.stringify(entry);
    fs.appendFile(resolveLogFilePath(), `${payload}\n`, (error) => {
      if (error) {
        console.error("Failed to write log entry:", error);
      }
    });
  } catch (error) {
    console.error("Unexpected logging failure:", error);
  }
}

function getAllowedActions() {
  return (settings.logging && settings.logging.actions) || {};
}

function actionAllowed(action, force, scope) {
  if (force === true) return true;

  const normalized = action.toLowerCase();
  const actions = getAllowedActions();
  const groups = ["user", "admin", "system"];

  const hasConfig =
    actions &&
    groups.some(
      (group) =>
        actions[group] && Object.keys(actions[group] || {}).length > 0
    );

  if (!hasConfig) return true;

  if (scope && (!actions[scope] || Object.keys(actions[scope] || {}).length === 0)) {
    return true;
  }

  if (scope && actions[scope]) {
    const scoped = actions[scope] || {};
    for (const [key, enabled] of Object.entries(scoped)) {
      if (enabled === true && key.toLowerCase() === normalized) {
        return true;
      }
    }
    return false;
  }

  for (const group of groups) {
    const entries = actions[group] || {};
    for (const [key, enabled] of Object.entries(entries)) {
      if (enabled === true && key.toLowerCase() === normalized) {
        return true;
      }
    }
  }

  return false;
}

function shouldLog(force) {
  if (force === true) return true;
  return settings.logging && settings.logging.status !== false;
}

function webhookEnabled() {
  return (
    settings.logging &&
    settings.logging.status !== false &&
    typeof settings.logging.webhook === "string" &&
    settings.logging.webhook.trim().length > 0
  );
}

function localLoggingEnabled() {
  if (!settings.logging) return true;
  if (!settings.logging.local) return true;
  return settings.logging.local.enabled !== false;
}

function buildWebhookPayload(entry) {
  const fields = [];

  if (entry.scope) {
    fields.push({
      name: "Scope",
      value: entry.scope,
      inline: true,
    });
  }
  if (entry.actorId) {
    fields.push({
      name: "Actor",
      value: `\`${entry.actorId}\``,
      inline: true,
    });
  }
  if (entry.targetId) {
    fields.push({
      name: "Target",
      value: `\`${entry.targetId}\``,
      inline: true,
    });
  }
  if (entry.tags && entry.tags.length) {
    fields.push({
      name: "Tags",
      value: entry.tags.map((tag) => `\`${tag}\``).join(" "),
      inline: true,
    });
  }
  fields.push({
    name: "Host",
    value: `${os.hostname()} • pid ${entry.workerId || process.pid}`,
    inline: false,
  });

  return {
    embeds: [
      {
        title: `Event: ${entry.action}`,
        description: entry.message,
        color: WEBHOOK_COLORS[entry.severity] || WEBHOOK_COLORS.info,
        timestamp: entry.timestamp,
        author: {
          name: settings.name || "Zypherous Logging",
        },
        fields,
        footer: {
          text: `${entry.scope || "system"} • ${entry.id}`,
        },
      },
    ],
  };
}

async function sendWebhook(entry) {
  const controller = new AbortController();
  const timeout =
    (settings.logging && Number(settings.logging.timeout_ms)) ||
    DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(settings.logging.webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(buildWebhookPayload(entry)),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!response.ok) {
      return { status: "failed", code: response.status };
    }
    return { status: "sent", code: response.status };
  } catch (error) {
    clearTimeout(timer);
    return { status: "failed", error: error.message };
  }
}

async function flushQueue() {
  if (flushing) return;
  flushing = true;

  while (webhookQueue.length > 0) {
    const entry = webhookQueue.shift();
    const delivery = await sendWebhook(entry);
    const deliveryEntry = {
      ...entry,
      kind: "delivery",
      webhookStatus: delivery.status,
      webhookCode: delivery.code || null,
      webhookError: delivery.error || null,
      deliveredAt: new Date().toISOString(),
    };
    if (localLoggingEnabled()) {
      persistEntry(deliveryEntry);
    }
  }

  flushing = false;
}

function enqueueWebhook(entry) {
  webhookQueue.push(entry);
  if (webhookQueue.length > 50) {
    webhookQueue = webhookQueue.slice(-50);
  }
  flushQueue().catch((error) => {
    console.error("Webhook queue flush failed:", error);
  });
}

/**
 * Log an action to both the local log file and (optionally) the Discord webhook.
 * @param {string} action
 * @param {string} message
 * @param {object} [context]
 * @param {string} [context.scope] user | admin | system
 * @param {string} [context.severity] info | warn | error | success
 * @param {string} [context.actorId] Who performed the action
 * @param {string} [context.targetId] The target of the action
 * @param {string[]} [context.tags] Optional tags for quick filtering
 * @param {boolean} [context.force] Force logging even if disabled
 */
function log(action, message, context = {}) {
  if (!shouldLog(context.force)) return null;

  const entry = {
    id: crypto.randomBytes(6).toString("hex"),
    timestamp: new Date().toISOString(),
    action: normalizeAction(action),
    message: typeof message === "string" ? message : JSON.stringify(message),
    scope: context.scope || (context.admin === true ? "admin" : "user"),
    severity: normalizeSeverity(
      context.severity || (context.error ? "error" : "info")
    ),
    actorId: context.actorId || context.userId || null,
    targetId: context.targetId || null,
    tags: Array.isArray(context.tags) ? context.tags.slice(0, 6) : [],
    workerId: context.workerId || process.pid,
    kind: "event",
    webhookStatus: "skipped",
  };

  if (!actionAllowed(entry.action, context.force, entry.scope)) return null;

  if (webhookEnabled()) {
    entry.webhookStatus = "queued";
    if (localLoggingEnabled()) {
      persistEntry(entry);
    }
    enqueueWebhook(entry);
  } else {
    if (localLoggingEnabled()) {
      persistEntry(entry);
    }
  }

  return entry.id;
}

function parseLogEntries(content, limit = 200) {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return {
          id: crypto.randomBytes(6).toString("hex"),
          timestamp: "",
          action: "unparsed",
          message: line,
          scope: "system",
          severity: "warn",
          webhookStatus: "skipped",
          kind: "event",
        };
      }
    });
}

async function readLogEntries(limit = 200) {
  try {
    const filePath = resolveLogFilePath();
    if (!fs.existsSync(filePath)) return [];
    const content = await fs.promises.readFile(filePath, "utf8");
    return parseLogEntries(content, limit);
  } catch (error) {
    console.error("Failed to read logs:", error);
    return [];
  }
}

module.exports = log;
module.exports.resolveLogFilePath = resolveLogFilePath;
module.exports.readLogEntries = readLogEntries;
module.exports.parseLogEntries = parseLogEntries;
