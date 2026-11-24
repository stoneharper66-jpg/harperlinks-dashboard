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
  const mapped = accounts.map((a) => ({ id: a.id, name: a.name, platform: a.platform }));
  // Remembered so chat and the home page can tell the truth about what's
  // connected without a network round-trip on every turn.
  store.saveCol("linked-accounts", { accounts: mapped, checkedAt: new Date().toISOString() });
  return mapped;
}

/** Last-known connection state — cheap, honest about its age. */
function linkedPlatforms() {
  const cache = store.getCol("linked-accounts", {});
  return {
    configured: isConfigured(),
    platforms: [...new Set((cache.accounts || []).map((a) => String(a.platform || "").toLowerCase()))],
    checkedAt: cache.checkedAt || null,
  };
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

// ---- one-click social connect ----------------------------------------------
//
// The customer clicks Connect, logs in to Instagram (or wherever) in a popup,
// taps Authorise, picks which page, and they're live. No API keys, no tokens,
// no developer account — because the OAuth app on the other end is GHL's,
// and GHL already holds the publishing approvals from Meta/TikTok/LinkedIn
// that would otherwise take us weeks of app review to get.
//
// GHL's flow is three steps:
//   1. /oauth/:platform/start  → 302 to the platform's own consent screen.
//      The redirect needs an Authorization header, which a browser popup
//      can't send — so we make that call here, server-side, and hand the
//      browser only the final consent URL.
//   2. /oauth/:locationId/:platform/accounts/:accountId → the pages/channels
//      that login can post to.
//   3. POST the same path → attach the chosen one to this account.
//
// Platforms GHL can genuinely connect. X/Twitter is deliberately absent:
// GHL dropped support on 2024-12-04 and the endpoint returns a 500 saying so.
const OAUTH_PLATFORMS = {
  instagram: { label: "Instagram", note: "Business or Creator account linked to a Facebook Page" },
  facebook: { label: "Facebook", note: "Posts to a Page you manage" },
  tiktok: { label: "TikTok", note: "Personal account" },
  "tiktok-business": { label: "TikTok Business", note: "Business account" },
  linkedin: { label: "LinkedIn", note: "Profile or Company Page" },
  youtube: { label: "YouTube", note: "Channel — for video posts" },
  pinterest: { label: "Pinterest", note: "Boards on a business account" },
  threads: { label: "Threads", note: "Linked to your Instagram login" },
  google: { label: "Google Business", note: "Your Google Business Profile" },
};

function oauthPlatforms() {
  return OAUTH_PLATFORMS;
}

/**
 * Step 1. Returns the platform's real consent URL for the browser to open.
 * We follow nothing — we read the Location header and hand it over.
 */
async function oauthStart(platform, userId) {
  if (!OAUTH_PLATFORMS[platform]) throw new Error(`${platform} can't be connected this way.`);
  if (!isConfigured()) throw new Error("The publishing engine isn't set up for this account yet.");
  const { token, locationId } = config();
  const url = `${API}/social-media-posting/oauth/${platform}/start` +
    `?locationId=${encodeURIComponent(locationId)}&userId=${encodeURIComponent(userId || locationId)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      redirect: "manual",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
  const location = res.headers.get("location");
  if (!location) {
    const body = await res.text();
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(body).message || msg; } catch { /* keep the status */ }
    throw new Error(msg);
  }
  return { url: location, platform };
}

/** Step 2. Which pages / channels that login can actually post to. */
async function oauthAccounts(platform, accountId) {
  const { locationId } = config();
  const out = await call(`/social-media-posting/oauth/${locationId}/${platform}/accounts/${encodeURIComponent(accountId)}`);
  const r = (out && out.results) || {};
  if (r.error && r.error.code) throw new Error(`${platform} refused the connection (${r.error.code}).`);
  // GHL names this list differently per platform; take whichever came back.
  const raw = r.pages || r.accounts || r.channels || r.boards || r.locations || [];
  return raw.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar || null,
    alreadyConnected: !!p.isConnected,
    type: p.type || null,
  }));
}

/** Step 3. Attach the chosen page — after this it's genuinely live. */
async function oauthAttach(platform, accountId, page) {
  const { locationId } = config();
  const body = {
    type: page.type || (platform === "facebook" || platform === "instagram" ? "page" : "profile"),
    originId: page.id,
    name: page.name,
  };
  if (page.avatar) body.avatar = page.avatar;
  await call(`/social-media-posting/oauth/${locationId}/${platform}/accounts/${encodeURIComponent(accountId)}`, {
    method: "POST",
    body,
  });
  // Re-read from GHL so what we report is what GHL actually holds, not what
  // we hoped the POST did.
  const accounts = await listAccounts();
  // Only call it connected if GHL now lists an account for that platform.
  // Trusting the POST's own 200 would let a silently-dropped attach show a
  // green light on a dead connection.
  const live = matchAccounts(accounts, platform).length > 0;
  store.logActivity("integration", live
    ? `${OAUTH_PLATFORMS[platform].label} connected — ${page.name}`
    : `${OAUTH_PLATFORMS[platform].label} authorised but didn't attach — ${page.name}`);
  return { ok: true, connected: live, accounts };
}

/** Disconnect a connected account. */
async function removeAccount(id) {
  const { locationId } = config();
  await call(`/social-media-posting/${locationId}/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  const accounts = await listAccounts();
  store.logActivity("integration", "A social account was disconnected");
  return accounts;
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

// For the admin's fast-connect button only — never sent to customers.
function connectInfo() {
  const { locationId } = config();
  return { locationId };
}

module.exports = {
  isConfigured, saveConfig, listAccounts, linkedPlatforms, publishPost, health, connectInfo,
  oauthPlatforms, oauthStart, oauthAccounts, oauthAttach, removeAccount,
};
