/**
 * 
 *     Zypherous 11 (Cactus)
 * 
 */

const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.yaml");
const crypto = require("crypto");

const defaultReferralSettings = {
  creator_reward: 100,
  referee_reward: 250,
  link: "",
  path: "ref",
  max_codes: 5,
  max_uses_per_code: 0,
};

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const referralOverrides =
  (settings.api && settings.api.client && settings.api.client.referrals) || {};

const referralSettings = {
  creator_reward:
    referralOverrides.creator_reward !== undefined
      ? toNumber(referralOverrides.creator_reward, defaultReferralSettings.creator_reward)
      : defaultReferralSettings.creator_reward,
  referee_reward:
    referralOverrides.referee_reward !== undefined
      ? toNumber(referralOverrides.referee_reward, defaultReferralSettings.referee_reward)
      : defaultReferralSettings.referee_reward,
  max_codes:
    referralOverrides.max_codes !== undefined
      ? toNumber(referralOverrides.max_codes, defaultReferralSettings.max_codes)
      : defaultReferralSettings.max_codes,
  max_uses_per_code:
    referralOverrides.max_uses_per_code !== undefined
      ? toNumber(referralOverrides.max_uses_per_code, defaultReferralSettings.max_uses_per_code)
      : defaultReferralSettings.max_uses_per_code,
  link: referralOverrides.link || defaultReferralSettings.link,
  path: referralOverrides.path || defaultReferralSettings.path,
};

const oauth2Link =
  (settings.api &&
    settings.api.client &&
    settings.api.client.oauth2 &&
    settings.api.client.oauth2.link) ||
  "";
const websiteUrl = settings.website && settings.website.url ? settings.website.url : "";
const referralBaseUrl = (
  (referralSettings.link || websiteUrl || oauth2Link || "").replace(/\/$/, "")
);
const referralLandingPath = (referralSettings.path || "ref").replace(/^\/+|\/+$/g, "");

function buildReferralLink(code) {
  if (!code) return null;
  if (referralBaseUrl.length === 0) {
    return `/${referralLandingPath}/${code}`;
  }
  return `${referralBaseUrl}/${referralLandingPath}/${code}`;
}

async function syncCreatorReferralStats(creatorId, code, uses, db) {
  const referrals = (await db.get(`referrals-${creatorId}`)) || [];
  const existing = referrals.find((entry) => entry.code === code);
  if (existing) {
    existing.uses = uses;
  } else {
    referrals.push({
      code,
      uses,
      created_at: Date.now(),
    });
  }
  await db.set(`referrals-${creatorId}`, referrals);
}

async function processReferralClaim(code, claimerId, db) {
  if (!code || !claimerId) {
    return { error: "Invalid claim data" };
  }
  const referralKey = `referral-code-${code}`;
  const referralData = await db.get(referralKey);
  if (!referralData) return { error: "Invalid code" };
  if (referralData.creator == claimerId)
    return { error: "You cannot claim your own referral code" };
  const alreadyClaimed = await db.get(`referral-claimed-${claimerId}`);
  if (alreadyClaimed) return { error: "Already claimed a referral code" };

  if (
    referralSettings.max_uses_per_code > 0 &&
    referralData.uses >= referralSettings.max_uses_per_code
  ) {
    return { error: "Referral code cannot be used anymore" };
  }

  const newUses = referralData.uses + 1;
  await db.set(referralKey, {
    ...referralData,
    uses: newUses,
    last_used: Date.now(),
  });
  await syncCreatorReferralStats(referralData.creator, code, newUses, db);
  await db.set(`referral-claimed-${claimerId}`, code);

  const creatorCoins = (await db.get(`coins-${referralData.creator}`)) || 0;
  await db.set(
    `coins-${referralData.creator}`,
    creatorCoins + referralSettings.creator_reward
  );

  const claimerCoins = (await db.get(`coins-${claimerId}`)) || 0;
  await db.set(
    `coins-${claimerId}`,
    claimerCoins + referralSettings.referee_reward
  );

  return { success: true, referral: referralData, uses: newUses };
}

const zypherousModule = { name: "UI10 Addon", target_platform: "10.0.0" };

module.exports.ZypherousModule = zypherousModule;
module.exports.buildReferralLink = buildReferralLink;
module.exports.processReferralClaim = processReferralClaim;
module.exports.referralSettings = referralSettings;

module.exports.load = async function (app, db) {
  app.get(`/${referralLandingPath}/:code`, async (req, res) => {
    const code = req.params.code;
    if (!code) return res.status(400).send("Missing referral code.");
    const referralData = await db.get(`referral-code-${code}`);
    if (referralData) {
      req.session.pendingReferral = code;
    }
    res.render("ref", {
      settings,
      code,
      referral: referralData,
      referralLink: buildReferralLink(code),
      referralRewards: {
        creator: referralSettings.creator_reward,
        referee: referralSettings.referee_reward,
      },
    });
  });

  app.get("/referral/:code", async (req, res) => {
    const code = req.params.code;
    if (!code) return res.json({ error: "Missing referral code" });
    const referralData = await db.get(`referral-code-${code}`);
    if (!referralData) return res.json({ error: "Invalid code" });
    res.json({
      code,
      uses: referralData.uses,
      creator: referralData.creator,
      created_at: referralData.created_at,
      link: buildReferralLink(code),
    });
  });

  app.post("/referral/create", async (req, res) => {
    if (!req.session.pterodactyl || !req.session.userinfo)
      return res.redirect("/login");
    const userId = req.session.userinfo.id;
    const referrals = (await db.get(`referrals-${userId}`)) || [];
    if (
      referralSettings.max_codes > 0 &&
      referrals.length >= referralSettings.max_codes
    ) {
      return res
        .status(400)
        .json({ error: "You reached the maximum number of referral codes." });
    }

    let code;
    while (true) {
      code = crypto.randomBytes(5).toString("hex");
      const existing = await db.get(`referral-code-${code}`);
      if (!existing) break;
    }

    const createdAt = Date.now();
    referrals.push({
      code,
      uses: 0,
      created_at: createdAt,
    });
    await db.set(`referrals-${userId}`, referrals);
    await db.set(`referral-code-${code}`, {
      creator: userId,
      uses: 0,
      created_at: createdAt,
    });

    res.json({
      code,
      link: buildReferralLink(code),
    });
  });

  app.post("/referral/claim", async (req, res) => {
    if (!req.session.pterodactyl || !req.session.userinfo)
      return res.redirect("/login");
    const code = req.body.code;
    const result = await processReferralClaim(code, req.session.userinfo.id, db);
    if (result.success) {
      return res.json({ success: true });
    }
    return res.json({ error: result.error });
  });

  app.get("/referral/list", async (req, res) => {
    if (!req.session.pterodactyl || !req.session.userinfo)
      return res.redirect("/login");
    const userId = req.session.userinfo.id;
    const referrals = (await db.get(`referrals-${userId}`)) || [];
    const list = [];
    for (const entry of referrals) {
      const code = entry.code;
      const codeData = await db.get(`referral-code-${code}`);
      if (!codeData) continue;
      list.push({
        code,
        uses: codeData.uses ?? entry.uses ?? 0,
        created_at: codeData.created_at ?? entry.created_at ?? Date.now(),
        link: buildReferralLink(code),
      });
    }
    list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    res.json({ referrals: list });
  });
};
