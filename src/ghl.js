// GoHighLevel publishing.
//
// This is how posts actually reach Instagram / Facebook / TikTok / LinkedIn /
// YouTube. Rather than getting each platform's publishing permission approved
// ourselves (Meta app review, TikTok content-posting audit — weeks of
// paperwork), we hand the post to GoHighLevel, which already holds those
// approvals, and let it publish.
//
// Setup, once:
//   1. Connect the social accounts in GHL → Marketing → Social Planner
//   2. Settings → Private Integrations → create a token with
//      scope `socialplanner/post.write` (and `socialplanner/account.readonly`)
//   3. Put GHL_TOKEN and GHL_LOCATION_ID in .env
//
// Until those exist this module reports "not configured" and the scheduler
// falls back to preview mode. It never pretends a post went out.

const API = "https://services.leadconnectorhq.com";
const TIMEOUT_MS = 20000;

const store = require("./store");
const tenant = require("./tenant");

// Each customer account carries its own GHL token + location (set by the
// admin during white-glove setup). The founding account can still fall back
// to .env so Stone's original single-tenant config keeps working.
function config() {
  const saved = store.getCol("ghl-config", {});
  const isMain = tenant.current() === tenant.MAIN;
  return {
    token: String(saved.token || (isMain ? process.env.GHL_TOKEN : "") || "").trim(),
    locationId: String(saved.locationId || (isMain ? process.env.GHL_LOCATION_ID : "") || "").trim(),
  };
}

function saveConfig({ token, locationId }) {
  const cfg = store.getCol("ghl-config", {});
  if (token !== undefined) cfg.token = String(token || "").trim();
  if (locationId !== undefined) cfg.locationId = String(locationId || "").trim();
  store.saveCol("ghl-config", cfg);
}

function isConfigured() {
  const c = config();
  return !!(c.token && c.locationId);
}

async function call(path, { method = "GET", body } = {}) {
  const { token } = config();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API + path, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "v3", // the social-planner endpoints use v3, not the dated header
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`GHL ${res.status}: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** Social accounts connected inside GHL's Social Planner. */
async function listAccounts() {
  const { locationId } = config();
  const out = await call(`/social-media-posting/${locationId}/accounts`);
  const accounts = (out && out.results && out.results.accounts) || [];
  return accounts.map((a) => ({ id: a.id, name: a.name, platform: a.platform }));
}

// Our platform names vs the ones GHL reports.
const PLATFORM_ALIASES = {
  instagram: ["instagram"],
  facebook: ["facebook"],
  tiktok: ["tiktok", "tiktok-business"],
  linkedin: ["linkedin"],
  youtube: ["youtube"],
};

function matchAccounts(accounts, platform) {
  const want = PLATFORM_ALIASES[platform] || [platform];
  return accounts.filter((a) => want.includes(String(a.platform || "").toLowerCase()));
}

/**
 * Publish (or schedule) one of our posts through GHL.
 *
 * Returns { ok, id?, accounts?, reason? }. Never throws — the scheduler needs
 * to keep running and log an honest failure rather than crash.
 */
async function publishPost(post, { scheduleAt } = {}) {
  if (!isConfigured()) {
    return { ok: false, reason: "GoHighLevel isn't connected (missing GHL_TOKEN / GHL_LOCATION_ID)." };
  }
  const { locationId } = config();

  let accounts;
  try {
    accounts = await listAccounts();
  } catch (e) {
    return { ok: false, reason: `Couldn't read connected accounts — ${e.message}` };
  }

  const targets = matchAccounts(accounts, post.platform);
  if (!targets.length) {
    return {
      ok: false,
      reason: `No ${post.platform} account connected in GHL's Social Planner. Connect one there and it'll publish next time.`,
    };
  }

  const caption = [post.content, (post.hashtags || []).map((h) => "#" + h).join(" ")]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  const body = {
    accountIds: targets.map((t) => t.id),
    summary: caption,
    // a video script with no rendered file is still just text
    type: post.isVideo && post.mediaUrl ? "reel" : "post",
    status: scheduleAt ? "scheduled" : "published",
  };
  if (scheduleAt) body.scheduleDate = new Date(scheduleAt).toISOString();
  if (post.mediaUrl) {
    body.media = [{
      url: post.mediaUrl,
      type: post.mediaType || (post.isVideo ? "video/mp4" : "image/jpeg"),
      caption: (post.content || "").slice(0, 120),
    }];
  }

  try {
    const out = await call(`/social-media-posting/${locationId}/posts`, { method: "POST", body });
    const id = (out && (out.id || (out.results && out.results.id))) || null;
    return { ok: true, id, accounts: targets.map((t) => `${t.platform}:${t.name}` ) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Connection check for the Integrations page. */
async function health() {
  if (!isConfigured()) return { connected: false, reason: "No token or location id set." };
  try {
    const accounts = await listAccounts();
    return { connected: true, accounts };
  } catch (e) {
    return { connected: false, reason: e.message };
  }
}

module.exports = { isConfigured, saveConfig, listAccounts, publishPost, health };
