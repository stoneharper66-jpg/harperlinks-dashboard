// Custom connectors: point HarperLinks at any webhook URL (Zapier, Make,
// n8n, GHL webhooks, a client's own site — anything that accepts a POST)
// and workflows can send real events to it. Honest by design: every delivery
// records what actually happened, and the Integrations page shows the last
// real result, never a hopeful green light.

const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const store = require("./store");

const TIMEOUT_MS = 10000;

function list() {
  return store.getCol("connectors", []);
}
function save(cols) {
  store.saveCol("connectors", cols);
}
function get(id) {
  return list().find((c) => c.id === id) || null;
}

// A webhook target must be a public http(s) address. Server-side requests to
// private ranges would let one tenant probe the machine or network this runs
// on (cloud metadata, localhost services) — so those are refused outright.
// Set ALLOW_LOCAL_WEBHOOKS=1 in dev to test against your own machine.
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return low === "::1" || low.startsWith("fe80:") || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("::ffff:127.") || low.startsWith("::ffff:10.") || low.startsWith("::ffff:192.168.");
  }
  const p = ip.split(".").map(Number);
  return p[0] === 127 || p[0] === 10 || p[0] === 0 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254);
}

async function assertSafeUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { throw new Error("That's not a valid URL."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) URLs work here.");
  if (u.username || u.password) throw new Error("Credentials don't belong in the URL.");
  if (process.env.ALLOW_LOCAL_WEBHOOKS === "1") return u;
  const host = u.hostname;
  if (/^(localhost|.*\.local)$/i.test(host)) throw new Error("That address points at this machine — connectors need a public URL.");
  let addrs = [];
  if (net.isIP(host)) addrs = [host];
  else {
    try { addrs = (await dns.lookup(host, { all: true })).map((a) => a.address); }
    catch { throw new Error("That domain doesn't resolve — check the URL."); }
  }
  if (addrs.some(isPrivateIp)) throw new Error("That address points inside a private network — connectors need a public URL.");
  return u;
}

async function create({ name, url, secret }) {
  const n = String(name || "").trim().slice(0, 60);
  if (!n) throw new Error("Give the connector a name.");
  await assertSafeUrl(url);
  const cols = list();
  if (cols.length >= 20) throw new Error("20 connectors is the cap — remove one first.");
  const record = {
    id: store.newId("conn"),
    name: n,
    url: String(url).trim(),
    secret: String(secret || "").trim() || null,
    addedAt: new Date().toISOString(),
    lastStatus: null, // filled by real deliveries only
  };
  cols.push(record);
  save(cols);
  store.logActivity("integration", `Connector "${n}" added`);
  return publicConnector(record);
}

function remove(id) {
  const cols = list();
  const c = cols.find((x) => x.id === id);
  if (!c) throw new Error("No such connector.");
  save(cols.filter((x) => x.id !== id));
  store.logActivity("integration", `Connector "${c.name}" removed`);
}

// What the browser sees — the URL's host (so you know which is which) but
// never the full URL or the signing secret.
function publicConnector(c) {
  let host = "";
  try { host = new URL(c.url).hostname; } catch { /* leave blank */ }
  return { id: c.id, name: c.name, host, hasSecret: !!c.secret, addedAt: c.addedAt, lastStatus: c.lastStatus };
}
function listPublic() {
  return list().map(publicConnector);
}

// POST the event for real. Returns { ok, code?, error? } and records it on
// the connector so the UI can show what genuinely happened last time.
async function fire(id, event, data) {
  const cols = list();
  const c = cols.find((x) => x.id === id);
  if (!c) return { ok: false, error: "connector not found" };
  const body = JSON.stringify({
    event,
    at: new Date().toISOString(),
    business: store.getProfile().name || null,
    data: data || {},
  });
  const headers = { "Content-Type": "application/json", "User-Agent": "HarperLinks-Connector/1.0" };
  if (c.secret) headers["X-HarperLinks-Signature"] = crypto.createHmac("sha256", c.secret).update(body).digest("hex");

  let out;
  try {
    await assertSafeUrl(c.url); // re-check every send — DNS can change
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(c.url, { method: "POST", headers, body, signal: ctrl.signal, redirect: "manual" });
      out = res.ok ? { ok: true, code: res.status } : { ok: false, code: res.status, error: `HTTP ${res.status}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    out = { ok: false, error: e.name === "AbortError" ? "timed out after 10s" : e.message };
  }
  c.lastStatus = Object.assign({ at: new Date().toISOString(), event }, out);
  save(cols);
  return out;
}

async function test(id) {
  const c = get(id);
  if (!c) throw new Error("No such connector.");
  const out = await fire(id, "connector.test", { note: "Test delivery from your HarperLinks dashboard" });
  store.logActivity("integration", out.ok
    ? `Connector "${c.name}" test delivery worked (HTTP ${out.code})`
    : `Connector "${c.name}" test delivery FAILED — ${out.error}`);
  return out;
}

module.exports = { list, listPublic, get, create, remove, fire, test, publicConnector };
