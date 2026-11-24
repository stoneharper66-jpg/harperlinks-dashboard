// HarperLinks Automation — Express server
// Marketing site at /, business OS dashboard at /app, JSON API under /api/*.
require("dotenv").config();
const path = require("path");
const express = require("express");

const engine = require("./src/engine");
const memory = require("./src/memory");
const notify = require("./src/notify");
const auth = require("./src/auth");
const tenant = require("./src/tenant");
const siteAgent = require("./src/site-agent");
const store = require("./src/store");
const scheduler = require("./src/scheduler");
const employees = require("./src/employees");
const events = require("./src/events");
const ingest = require("./src/ingest");
const { ingestWebsite } = ingest;
const planner = require("./src/planner");
const budget = require("./src/budget");
const ghl = require("./src/ghl");
const website = require("./src/website");
const { resolveWhen, formatWhen } = require("./src/tools");

const app = express();
// Behind Railway/Render/Fly the real client sits past one proxy hop — trust it
// so HTTPS detection and the rate-limiter's client IP are right in production.
app.set("trust proxy", 1);
const PORT = process.env.PORT || 4700;
const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

// Stripe signs the exact bytes it sent, so this one route gets the raw body
// and must be mounted before the JSON parser consumes it.
app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  const stripeHook = require("./src/stripe-hook");
  try {
    const out = await stripeHook.handle(
      req.body.toString("utf8"),
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
    res.status(out.status).json(out.body);
  } catch (e) {
    console.error("stripe webhook error:", e.message);
    // 500 tells Stripe to retry — better than silently losing a customer
    res.status(500).json({ error: "handler failed" });
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Public liveness probe for the host's health checks — no auth, no data.
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- CORS for the marketing site -------------------------------------------
// The site's robot can act as the signed-in owner: when the owner's browser
// already holds a dashboard session, the site may call the real API with
// credentials. That only works for origins on this allowlist — never "*",
// because credentialed CORS with a wildcard is exactly how cookies leak.
// Anonymous visitors never pass the auth gate regardless.
const SITE_ORIGINS = new Set(
  String(process.env.SITE_ORIGINS || "http://localhost:4870,http://127.0.0.1:4870")
    .split(",").map((o) => o.trim()).filter(Boolean)
);
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && SITE_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE");
      return res.status(204).end();
    }
  }
  next();
});

// The dashboard is its own application now — it lives at the root.
// /app is kept as a redirect so old links still land somewhere sensible.
app.get("/", (req, res) => {
  // No one signed in → the sign-in page (or first-boot setup) instead of the app.
  if (!auth.userFromRequest(req)) return res.redirect("/login.html");
  res.sendFile(path.join(__dirname, "public", "app.html"));
});
app.get("/app", (_req, res) => res.redirect(301, "/"));

// ============================= sign in / accounts =============================

// Create the very first admin account — only ever works once, on a fresh
// install, so an attacker can't "set up" an already-running system.
app.post("/api/auth/setup", (req, res) => {
  if (auth.hasAdmin()) return res.status(403).json({ error: "Already set up — sign in instead." });
  try {
    const { name, email, password } = req.body || {};
    const user = auth.createUser({ name, email, password, role: "admin", accountId: tenant.MAIN });
    res.setHeader("Set-Cookie", auth.cookieFor(auth.makeToken(user.id), req));
    tenant.run(tenant.MAIN, () => store.logActivity("auth", `Admin account created for ${user.email}`));
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const u = auth.login(email, password);
  if (!u) return res.status(401).json({ error: "Wrong email or password." });
  res.setHeader("Set-Cookie", auth.cookieFor(auth.makeToken(u.id), req));
  res.json({ ok: true, user: auth.publicUser(u) });
});

app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", auth.clearCookie(req));
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const ctx = auth.contextFromRequest(req);
  if (!ctx) return res.status(401).json({ error: "Not signed in.", needsSetup: !auth.hasAdmin() });
  const out = { user: auth.publicUser(ctx.user) };
  if (ctx.impersonator) out.impersonating = { admin: ctx.impersonator.name };
  res.json(out);
});

// ---- forgot password (public — you can't be signed in to use these) --------
// Always answers the same whether the email exists or not, so nobody can use
// it to find out who has an account. The reset link is emailed when email is
// set up; otherwise it's written to the server log for the team to hand over.
app.post("/api/auth/forgot", async (req, res) => {
  const email = (req.body || {}).email;
  const same = { ok: true, message: "If that email has an account, a reset link is on its way." };
  try {
    const started = auth.startReset(email);
    if (!started) return res.json(same); // no such account — identical answer
    const base = process.env.PUBLIC_BASE_URL
      || `${req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http"}://${req.headers.host}`;
    const link = `${base.replace(/\/$/, "")}/reset.html?token=${started.token}`;

      let out = { sent: false };
    if (notify.configured()) {
      out = await notify.sendTo(started.user.email, "Reset your HarperLinks password",
        `Someone asked to reset the password for your HarperLinks account.\n\nSet a new one here (the link lasts one hour):\n${link}\n\nIf this wasn't you, ignore this email — your password hasn't changed.`,
        notify.wrapHtml({
          title: "Reset your password",
          bodyHtml: `Someone asked to reset the password for your HarperLinks account.<br><br>` +
            `The button below takes you to a page where you choose a new one. The link lasts <b>one hour</b> and works once.<br><br>` +
            `If this wasn't you, just ignore this email — your password hasn't changed.`,
          buttonText: "Choose a new password",
          buttonUrl: link,
        }));
    }
    if (!out.sent) {
      // Email isn't configured (or failed). The operator can retrieve the link
      // from the server log and hand it to the person. Never a public response.
      console.log(`[password reset] ${started.user.email} → ${link}`);
      tenant.run(tenant.MAIN, () => store.logActivity("auth", `Password reset requested for ${started.user.email} — link is in the server log (email not configured)`));
    }
    res.json(same);
  } catch (e) {
    console.error("forgot error:", e.message);
    res.json(same); // never leak whether it worked
  }
});

app.post("/api/auth/reset", (req, res) => {
  const { token, password } = req.body || {};
  try {
    const user = auth.completeReset(token, password);
    tenant.run(tenant.MAIN, () => store.logActivity("auth", `Password reset completed for ${user.email}`));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ========================= public website endpoints ==========================
// Used by the marketing site's chat widget. No sign-in, no cookies, no tenant
// data — just the sales agent. CORS is wide open because nothing here is
// credentialed; the dashboard APIs below are NOT CORS-enabled.

const askBuckets = new Map(); // ip → timestamps this minute
function rateLimited(ip) {
  const now = Date.now();
  const hits = (askBuckets.get(ip) || []).filter((t) => now - t < 60_000);
  hits.push(now);
  askBuckets.set(ip, hits);
  if (askBuckets.size > 5000) askBuckets.clear();
  return hits.length > 10;
}

app.options("/api/public/ask", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.status(204).end();
});
app.post("/api/public/ask", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: "Easy on! Give it a few seconds and ask again." });
  try {
    const out = await tenant.run(tenant.MAIN, () =>
      siteAgent.ask((req.body || {}).visitorId, (req.body || {}).message, (req.body || {}).persona)
    );
    res.json(out);
  } catch (e) {
    console.error("site agent error:", e.message);
    res.status(500).json({ error: "The assistant hit a snag — try again in a moment." });
  }
});

// Anonymous pageview beacon from the marketing site. Stores one counter per
// day per page in the main account — no IPs, no cookies, nothing personal,
// which is why there's no consent banner to go with it.
app.options("/api/public/ping", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.status(204).end();
});
app.post("/api/public/ping", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
  if (rateLimited(ip)) return res.status(204).end();
  const page = String((req.body || {}).page || "/").slice(0, 80);
  const day = new Date().toISOString().slice(0, 10);
  tenant.run(tenant.MAIN, () => {
    const stats = store.getCol("site-stats", {});
    stats[day] = stats[day] || {};
    stats[day][page] = (stats[day][page] || 0) + 1;
    // keep 90 days
    Object.keys(stats).sort().slice(0, -90).forEach((k) => delete stats[k]);
    store.saveCol("site-stats", stats);
  });
  res.status(204).end();
});

// New sign-ups from the marketing site land straight in Stone's dashboard
// (the main account's CRM) and try to email the team. Public endpoint:
// rate-limited, validated, and it never reveals whether the email worked.
app.options("/api/public/signup", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.status(204).end();
});
app.post("/api/public/signup", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: "Easy on! Give it a few seconds and try again." });
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 80);
  const email = String(b.email || "").trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "What's your name?" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "That email doesn't look right." });
  const phone = String(b.phone || "").trim().slice(0, 40);
  const business = String(b.business || "").trim().slice(0, 80);
  const plan = ["professional", "business", "enterprise", "not sure"].includes(b.plan) ? b.plan : "not sure";
  const message = String(b.message || "").trim().slice(0, 500);

  await tenant.run(tenant.MAIN, async () => {
    const leads = store.getCol("leads");
    const record = {
      id: store.newId("lead"),
      name, phone, email,
      interest: `${business ? business + " — " : ""}${plan} plan${message ? ` · "${message}"` : ""}`,
      source: "website signup",
      status: "new", score: 80,
      tags: ["signup", plan.replace(" ", "-")],
      notes: [], followUps: [],
      createdAt: new Date().toISOString(),
    };
    leads.push(record);
    store.saveCol("leads", leads);
    store.logActivity("lead", `Website sign-up: ${name}${business ? ` (${business})` : ""} wants the ${plan} plan`, record.id);
    events.emit("lead.created", { leadId: record.id, summary: record.interest });

    const mail = await notify.sendToTeam(
      `HarperLinks sign-up: ${name}${business ? ` — ${business}` : ""}`,
      `New sign-up from the website\n\nName: ${name}\nBusiness: ${business || "—"}\nEmail: ${email}\nPhone: ${phone || "—"}\nPlan: ${plan}\nMessage: ${message || "—"}\n\nThey're in your CRM (Customers page) as a new lead. Reach out within a day — that's the promise on the site.`
    );
    store.logActivity("lead", mail.sent
      ? `Sign-up email sent to ${notify.NOTIFY_EMAIL}`
      : `Sign-up email NOT sent — ${mail.reason}. The lead is safe in the CRM.`, record.id);
  });
  res.json({ ok: true });
});

// ---------------- the customer's built website, served publicly ----------------
// A site the AI built for an account is a real public page: /site/<accountId>.
// It's their content, served as-is. No session needed — that's the point.
app.get("/site/:accountId", (req, res) => {
  const id = req.params.accountId;
  if (!tenant.isValidId(id)) return res.status(404).send("Not found");
  tenant.run(id, () => {
    const w = website.get();
    if (w.mode !== "built" || !w.html) return res.status(404).send("No site here yet.");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // the page is authored by the AI for this account; stop it pulling in
    // anything remote and stop it being framed by other sites
    res.setHeader("Content-Security-Policy", "default-src 'self' data:; style-src 'unsafe-inline' 'self'; img-src 'self' data:; script-src 'none'; frame-ancestors 'self'");
    res.send(w.html);
  });
});

// Generated media, served publicly — these files exist to be uploaded to
// social platforms, and GHL fetches them by URL when the dashboard is hosted.
// Filenames are unguessable generated ids and the pattern is strictly checked.
app.get("/media/:accountId/:name", (req, res) => {
  const id = req.params.accountId;
  if (!tenant.isValidId(id)) return res.status(404).end();
  tenant.run(id, () => {
    const media = require("./src/media");
    const p = media.filePath(req.params.name);
    if (!p) return res.status(404).end();
    res.setHeader("Content-Type", p.endsWith(".mp4") ? "video/mp4" : "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(p);
  });
});

// ============================== the sign-in gate =============================
// Everything under /api from here on requires a signed-in user, and runs
// inside that user's account context — the store physically can't read
// another customer's folder for the rest of the request.

app.use("/api", (req, res, next) => {
  const ctx = auth.contextFromRequest(req);
  if (!ctx) return res.status(401).json({ error: "Please sign in.", authRequired: true });
  req.user = ctx.user;
  req.impersonator = ctx.impersonator;
  tenant.run(ctx.user.accountId, next);
});

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Only the HarperLinks team can do that." });
  next();
}

// Change your own password (any signed-in user).
app.post("/api/auth/password", (req, res) => {
  const { current, next: newPass } = req.body || {};
  if (!auth.login(req.user.email, current)) return res.status(400).json({ error: "Current password is wrong." });
  try {
    auth.setPassword(req.user.id, newPass);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- admin: email (SMTP) setup ----------------------------------------------
// So Stone can finish email from the Settings page instead of editing .env.
// The password is write-only: the GET never returns it, only whether one is set.

app.get("/api/settings/email", adminOnly, (_req, res) => {
  const c = notify.smtpConfig();
  res.json({
    configured: notify.configured(),
    host: c.host, port: c.port, user: c.user, hasPass: !!c.pass,
    // What really happened on the last few sends. A send that failed used to
    // fail silently; now it's on screen.
    recent: notify.recentSends().slice(0, 6),
  });
});

app.post("/api/settings/email", adminOnly, async (req, res) => {
  const { host, port, user, pass } = req.body || {};
  const saved = store.getGlobal("smtp", {});
  const next = {
    host: String(host || saved.host || "").trim(),
    port: String(port || saved.port || "465").trim(),
    user: String(user || saved.user || "").trim(),
    pass: pass ? String(pass) : saved.pass || "", // blank = keep the old one
  };
  if (!next.host || !next.user) return res.status(400).json({ error: "Host and email are both needed." });
  store.saveGlobal("smtp", next);
  tenant.run(tenant.MAIN, () => store.logActivity("system", "Email (SMTP) settings updated"));

  // Actually log in to the mail server before calling it saved. Catching a
  // wrong App Password here beats discovering it when a paying customer
  // never receives their welcome email.
  const check = await notify.verify();
  tenant.run(tenant.MAIN, () => store.logActivity("system",
    check.ok ? "Email credentials verified — sending is live" : `Email credentials REJECTED — ${check.reason}`));
  res.json({ ok: true, configured: !!(next.host && next.user && next.pass), verified: check.ok, reason: check.reason });
});

// Prove it works: send a real test email to the team address, report honestly.
app.post("/api/settings/email/test", adminOnly, async (_req, res) => {
  const out = await notify.sendTo(notify.NOTIFY_EMAIL, "HarperLinks test email",
    "This is the test email from your HarperLinks dashboard. If you're reading it, email is working.",
    notify.wrapHtml({
      title: "Email is working 🎉",
      bodyHtml: "This is the test email from your HarperLinks dashboard.<br><br>Password resets, customer welcome emails and your daily handovers will all send from here now.",
    }));
  res.status(out.sent ? 200 : 400).json(out);
});

// ---- admin: customer accounts ----------------------------------------------

app.get("/api/accounts", adminOnly, (_req, res) => {
  // each customer row carries whether their publishing engine is connected —
  // a yes/no only, never the credentials themselves
  const users = auth.getUsers().map(auth.publicUser);
  users.forEach((u) => {
    if (u.role === "admin") return;
    try {
      const s = tenant.run(u.accountId, () => ({
        configured: ghl.isConfigured(),
        status: store.getCol("ghl-status", null),
      }));
      u.ghlConfigured = s.configured;
      u.ghlConnected = !!(s.configured && s.status && s.status.connected);
    } catch { u.ghlConfigured = false; u.ghlConnected = false; }
  });
  res.json(users);
});

// Where to link this customer's socials (their engine's Social Planner).
app.get("/api/accounts/:accountId/connect-info", adminOnly, (req, res) => {
  const id = req.params.accountId;
  if (!tenant.isValidId(id)) return res.status(400).json({ error: "Bad account id." });
  const info = tenant.run(id, () => ghl.connectInfo());
  if (!info.locationId) return res.json({ configured: false });
  res.json({ configured: true, url: `https://app.gohighlevel.com/v2/location/${info.locationId}/marketing/social-planner/` });
});

// Step into a customer's account: same browser, new signed session that says
// "admin X acting as customer Y". Capped at 4 hours, audited in the
// customer's own activity feed, and the admin's role is re-checked on every
// request while it lasts.
app.post("/api/accounts/:userId/impersonate", adminOnly, (req, res) => {
  const target = auth.getUsers().find((x) => x.id === req.params.userId);
  if (!target) return res.status(404).json({ error: "No such user." });
  if (target.role === "admin") return res.status(400).json({ error: "You can't impersonate another admin." });
  if (target.disabled) return res.status(400).json({ error: "That account is disabled — re-enable it first." });
  tenant.run(target.accountId, () =>
    store.logActivity("auth", `${req.user.name} (HarperLinks team) signed into this account to help out`)
  );
  res.setHeader("Set-Cookie", auth.cookieFor(auth.makeToken(req.user.id, { actAs: target.id, hours: 4 }), req));
  res.json({ ok: true, user: auth.publicUser(target) });
});

// Step back out to HQ. Only means anything while impersonating.
app.post("/api/auth/return", (req, res) => {
  if (!req.impersonator) return res.status(400).json({ error: "You're not inside a customer account." });
  store.logActivity("auth", `${req.impersonator.name} (HarperLinks team) signed back out of this account`);
  res.setHeader("Set-Cookie", auth.cookieFor(auth.makeToken(req.impersonator.id), req));
  res.json({ ok: true, user: auth.publicUser(req.impersonator) });
});

app.post("/api/accounts", adminOnly, (req, res) => {
  try {
    const { name, email, password, business } = req.body || {};
    // the account id comes from the business name: "Bella's Cafe" → bellas-cafe
    let slug = String(business || name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
    if (!tenant.isValidId(slug)) return res.status(400).json({ error: "Give the business a simple name (letters and numbers)." });
    const taken = new Set([...store.listAccountIds(), ...auth.getUsers().map((u) => u.accountId)]);
    let id = slug, n = 2;
    while (taken.has(id)) id = `${slug}-${n++}`;
    const user = auth.createUser({ name, email, password, role: "customer", accountId: id });
    // touch the account folder so the scheduler picks it up straight away
    tenant.run(id, () => store.logActivity("auth", `Account created for ${business || user.name} by the HarperLinks team`));
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/accounts/:userId", adminOnly, (req, res) => {
  try {
    const body = req.body || {};
    if (body.password !== undefined) auth.setPassword(req.params.userId, body.password);
    if (body.disabled !== undefined) auth.setDisabled(req.params.userId, body.disabled);
    if (body.plan !== undefined || body.planStatus !== undefined) {
      auth.setPlan(req.params.userId, { plan: body.plan, planStatus: body.planStatus });
    }
    const u = auth.getUsers().find((x) => x.id === req.params.userId);
    if (!u) return res.status(404).json({ error: "No such user." });
    res.json({ ok: true, user: auth.publicUser(u) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Admin drops a customer's GoHighLevel credentials in during white-glove
// setup. Written into THAT account's folder; never echoed back.
app.post("/api/accounts/:accountId/ghl", adminOnly, async (req, res) => {
  const id = req.params.accountId;
  if (!tenant.isValidId(id)) return res.status(400).json({ error: "Bad account id." });
  await tenant.run(id, async () => {
    ghl.saveConfig({ token: (req.body || {}).token, locationId: (req.body || {}).locationId });
    const status = await ghl.health();
    // remember the verified outcome so account lists can show honest state
    // ("working" vs "saved but broken") without re-hitting GHL every time
    store.saveCol("ghl-status", { connected: !!status.connected, reason: status.reason || null, at: new Date().toISOString() });
    store.logActivity("integration", status.connected
      ? "GoHighLevel connected by the HarperLinks team"
      : `GoHighLevel details saved but not working yet — ${status.reason}`);
    res.json({ ok: true, connected: status.connected, detail: status.connected ? (status.accounts || []).map((a) => a.platform).join(", ") : status.reason });
  });
});

// ---- chat sessions ----------------------------------------------------------
// The Map is only a cache now; the conversation itself lives on disk (see
// src/chatlog.js). That's the difference between "the bot forgot because the
// page reloaded" and a thread you can come back to tomorrow.
//
// One thread per employee rather than per browser tab: Sage's conversation
// and Indi's stay separate, and both survive a restart.
const chatlog = require("./src/chatlog");
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // how long we keep it hot in memory

function threadFor(req) {
  const body = req.body || {};
  const raw = body.thread || body.employee || "main";
  return String(raw).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "main";
}

function getSession(accountId, thread) {
  const key = accountId + ":" + thread;
  let s = sessions.get(key);
  if (!s) {
    const saved = chatlog.load(thread);
    s = { history: saved.history, transcript: saved.transcript, last: Date.now() };
    sessions.set(key, s);
  }
  s.last = Date.now();
  return s;
}

// Persist the finished exchange. Wrapped because a write failure must not
// lose the answer the owner is already reading.
function keepTurn(thread, session, message, out) {
  try {
    chatlog.record(session, message, out);
    chatlog.save(thread, session);
  } catch (e) {
    console.error("chat save failed:", e.message);
  }
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL;
  for (const [k, s] of sessions) if (s.last < cutoff) sessions.delete(k);
}, 5 * 60 * 1000);

// ---- core -------------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: engine.mode(),
    activeSessions: sessions.size,
    scheduledCount: store.getPosts().filter((p) => p.status === "scheduled").length,
  });
});

app.post("/api/chat", async (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: "Message is empty." });
  try {
    const thread = threadFor(req);
    const session = getSession(req.user.accountId, thread);
    const text = String(message).slice(0, 4000);
    const out = await engine.respond(session, text, (req.body || {}).employee);
    keepTurn(thread, session, text, out);
    res.json({ reply: out.reply, actions: out.actions, steps: out.steps || [], mode: engine.mode() });
  } catch (e) {
    console.error("chat error:", e.message);
    res.status(500).json({ error: "The bot hit a snag — try that again." });
  }
});

// Same work as /api/chat, but the thinking is reported while it happens rather
// than summarised once it's over. Server-sent events over a POST, so the chat
// can show real progress during the wait instead of a spinner.
app.post("/api/chat/stream", async (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: "Message is empty." });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // don't let a proxy sit on the chunks
  });
  const send = (obj) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  // If the user closes the tab mid-turn, stop writing — the work itself still
  // finishes, so nothing is left half-done in the datastore.
  // Listen on the RESPONSE, not the request: for a POST, `req` emits "close"
  // as soon as the body has been read, which would mute every event.
  let gone = false;
  res.on("close", () => { gone = true; });

  try {
    const thread = threadFor(req);
    const session = getSession(req.user.accountId, thread);
    const text = String(message).slice(0, 4000);
    const out = await engine.respond(
      session,
      text,
      (req.body || {}).employee,
      (ev) => { if (!gone) send(ev); }
    );
    keepTurn(thread, session, text, out);
    send({ phase: "done", reply: out.reply, actions: out.actions, steps: out.steps || [], mode: engine.mode() });
  } catch (e) {
    console.error("chat stream error:", e.message);
    send({ phase: "error", error: "The bot hit a snag — try that again." });
  }
  if (!res.writableEnded) res.end();
});

// The conversation so far, so a reloaded page draws the thread back instead
// of greeting the owner as a stranger.
app.get("/api/chat/history", (req, res) => {
  const thread = String(req.query.thread || req.query.employee || "main")
    .toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "main";
  res.json({ ok: true, thread, transcript: chatlog.transcript(thread) });
});

// Start fresh — clears both the model's history and what's drawn on screen.
// Deliberately does NOT touch memory: forgetting the chat is not the same as
// forgetting the business, and conflating them would lose real facts.
app.post("/api/chat/clear", (req, res) => {
  const thread = threadFor(req);
  chatlog.clear(thread);
  sessions.delete(req.user.accountId + ":" + thread);
  res.json({ ok: true, thread });
});

app.post("/api/reset", (req, res) => {
  const thread = threadFor(req);
  chatlog.clear(thread);
  sessions.delete(req.user.accountId + ":" + thread);
  res.json({ ok: true });
});

// ---- memory -----------------------------------------------------------------
// Everything the AI has saved, visible and deletable by the owner. A memory
// the owner can't see is a memory they can't correct.
app.get("/api/memory", (_req, res) => {
  res.json({ ok: true, items: memory.all(), max: memory.MAX });
});

app.post("/api/memory", (req, res) => {
  const { fact, category } = req.body || {};
  const out = memory.remember(fact, { category, employee: "owner", pinned: true });
  if (!out.saved) return res.status(400).json({ error: out.reason || "Couldn't save that." });
  res.json({ ok: true, record: out.record, duplicate: !!out.duplicate });
});

app.delete("/api/memory/:id", (req, res) => {
  const out = memory.forget(req.params.id);
  if (!out.removed) return res.status(404).json({ error: "Not found." });
  res.json({ ok: true, removed: out.removed });
});

app.patch("/api/memory/:id", (req, res) => {
  const m = memory.pin(req.params.id, !!(req.body || {}).pinned);
  if (!m) return res.status(404).json({ error: "Not found." });
  res.json({ ok: true, record: m });
});

// ---- profile / knowledge ------------------------------------------------------

// Reading a whole site takes a minute, so this answers straight away and the
// dashboard watches /api/scan. Holding the request open just means a spinner
// that can't say anything useful — and a gateway timeout on a slow site.
app.post("/api/ingest", async (req, res) => {
  const url = (req.body || {}).url;
  const accountId = tenant.current();
  const scan = ingest.getScan();
  if (scan.status === "crawling" || scan.status === "thinking") {
    return res.status(409).json({ ok: false, error: "A scan is already running." });
  }
  if ((req.body || {}).wait) {
    try { return res.json({ ok: true, profile: await ingestWebsite(url) }); }
    catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  }
  res.json({ ok: true, started: true });
  tenant.run(accountId, () => {
    ingestWebsite(url)
      .then((profile) => planner.onboard(profile).catch((e) => console.error("auto-plan:", e.message)))
      .catch((e) => console.error("ingest:", e.message));
  });
});

// What the scan is doing right now — polled by the dashboard while it runs.
app.get("/api/scan", (_req, res) => res.json({ scan: ingest.getScan(), plan: planner.getPlan() }));

// Plan (or re-plan) a month of content on demand, without re-reading the site.
app.post("/api/plan", (req, res) => {
  const profile = store.getProfile();
  if (!profile.configured) return res.status(400).json({ error: "Read the business's website first." });
  const accountId = tenant.current();
  res.json({ ok: true, started: true });
  tenant.run(accountId, () => {
    planner.onboard(profile, { count: Number((req.body || {}).count) || undefined })
      .catch((e) => console.error("plan:", e.message));
  });
});

app.get("/api/profile", (_req, res) => res.json(store.getProfile()));

app.get("/api/knowledge", (_req, res) => res.json(store.getKnowledge()));
app.put("/api/knowledge", (req, res) => {
  const kb = Object.assign(store.getKnowledge(), req.body || {});
  store.saveKnowledge(kb);
  store.logActivity("knowledge", "Business knowledge base updated");
  events.emit("website.ingested", { summary: "knowledge base updated" });
  res.json(kb);
});

// ---- posts --------------------------------------------------------------------

app.get("/api/posts", (req, res) => {
  let posts = store.getPosts();
  if (req.query.status) posts = posts.filter((p) => p.status === req.query.status);
  res.json(posts);
});

app.post("/api/posts", (req, res) => {
  const { platform, content, hashtags, scheduledFor } = req.body || {};
  if (!platform || !content) return res.status(400).json({ error: "platform and content are required." });
  const posts = store.getPosts();
  let scheduledAt = null;
  if (scheduledFor) {
    const when = resolveWhen(scheduledFor, new Date());
    if (!when || when <= new Date()) return res.status(400).json({ error: `Couldn't use the time "${scheduledFor}".` });
    scheduledAt = when.toISOString();
  }
  const record = {
    id: store.newPostId(),
    platform,
    content: String(content).trim(),
    hashtags: Array.isArray(hashtags) ? hashtags : [],
    status: scheduledAt ? "scheduled" : "draft",
    scheduledAt,
    createdAt: new Date().toISOString(),
    publishedAt: null,
    simulated: true,
    createdBy: "manual",
  };
  posts.push(record);
  store.savePosts(posts);
  store.logActivity(scheduledAt ? "scheduled" : "created", `${scheduledAt ? "Scheduled" : "Drafted"} a ${platform} post (manual)`, record.id);
  res.json(record);
});

app.patch("/api/posts/:id", (req, res) => {
  const posts = store.getPosts();
  const post = posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found." });
  const { content, hashtags, scheduledFor, scheduledAt, status, platform, kind, engagement } = req.body || {};
  if (content) post.content = String(content).trim();
  if (Array.isArray(hashtags)) post.hashtags = hashtags.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 8);
  if (platform && ["instagram", "facebook", "linkedin", "tiktok", "youtube"].includes(platform)) post.platform = platform;
  if (kind) post.kind = String(kind).slice(0, 30);
  if (scheduledFor || scheduledAt) {
    // scheduledAt comes from the editor's date picker (exact ISO);
    // scheduledFor is natural language from chat ("tomorrow 9am").
    const when = scheduledAt ? new Date(scheduledAt) : resolveWhen(scheduledFor, new Date());
    if (!when || isNaN(when) || when <= new Date()) {
      return res.status(400).json({ error: `That time needs to be in the future.` });
    }
    post.scheduledAt = when.toISOString();
    post.status = "scheduled";
  }
  if (status === "cancelled" || status === "draft") {
    post.status = status;
    if (status === "draft") post.scheduledAt = null;   // "unschedule" means it
  }
  // Real numbers only — this is what the learning loop feeds on.
  if (engagement && typeof engagement === "object") {
    const clean = {};
    ["likes", "comments", "shares", "clicks", "reach"].forEach((k) => {
      const n = Number(engagement[k]);
      if (Number.isFinite(n) && n >= 0) clean[k] = Math.round(n);
    });
    if (Object.keys(clean).length) post.engagement = Object.assign(post.engagement || {}, clean);
  }
  store.savePosts(posts);
  res.json(post);
});

app.delete("/api/posts/:id", (req, res) => {
  const posts = store.getPosts();
  const idx = posts.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Post not found." });
  const [removed] = posts.splice(idx, 1);
  store.savePosts(posts);
  store.logActivity("deleted", `Deleted a ${removed.platform} post`, removed.id);
  res.json({ ok: true });
});

// ---- CRM / leads ----------------------------------------------------------------

const LEAD_STATUSES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];

app.get("/api/leads", (_req, res) => res.json(store.getCol("leads")));

app.post("/api/leads", (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: "Name is required." });
  const leads = store.getCol("leads");
  const record = {
    id: store.newId("lead"),
    name: String(b.name).trim(),
    phone: b.phone || "",
    email: b.email || "",
    interest: b.interest || "",
    source: b.source || "manual",
    status: LEAD_STATUSES.includes(b.status) ? b.status : "new",
    score: typeof b.score === "number" ? b.score : 50,
    tags: Array.isArray(b.tags) ? b.tags : [],
    notes: [],
    followUps: [],
    createdAt: new Date().toISOString(),
  };
  leads.push(record);
  store.saveCol("leads", leads);
  store.logActivity("lead", `New lead captured: ${record.name}`, record.id);
  events.emit("lead.created", { leadId: record.id, summary: record.interest || record.name });
  res.json(record);
});

app.patch("/api/leads/:id", (req, res) => {
  const leads = store.getCol("leads");
  const lead = leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found." });
  const b = req.body || {};
  ["name", "phone", "email", "interest", "source"].forEach((k) => { if (b[k] !== undefined) lead[k] = b[k]; });
  if (typeof b.score === "number") lead.score = Math.max(0, Math.min(100, b.score));
  if (Array.isArray(b.tags)) lead.tags = b.tags;
  if (b.status && LEAD_STATUSES.includes(b.status) && b.status !== lead.status) {
    lead.status = b.status;
    store.logActivity("lead", `${lead.name} moved to ${b.status}`, lead.id);
    if (b.status === "won") events.emit("lead.won", { leadId: lead.id, summary: lead.name });
  }
  if (b.note) {
    lead.notes = lead.notes || [];
    lead.notes.push({ at: new Date().toISOString(), text: String(b.note), by: "you" });
  }
  if (b.followUpDone) {
    (lead.followUps || []).forEach((f) => { if (f.id === b.followUpDone) f.done = true; });
  }
  store.saveCol("leads", leads);
  res.json(lead);
});

app.delete("/api/leads/:id", (req, res) => {
  const leads = store.getCol("leads");
  const idx = leads.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Lead not found." });
  leads.splice(idx, 1);
  store.saveCol("leads", leads);
  res.json({ ok: true });
});

// ---- appointments ------------------------------------------------------------------

app.get("/api/appointments", (_req, res) => res.json(store.getCol("appointments")));

app.post("/api/appointments", (req, res) => {
  const b = req.body || {};
  if (!b.customer_name || !b.service || !b.when) return res.status(400).json({ error: "customer_name, service and when are required." });
  const when = b.when.match(/^\d{4}-\d{2}-\d{2}T/) ? new Date(b.when) : resolveWhen(b.when, new Date());
  if (!when || isNaN(when) || when <= new Date()) return res.status(400).json({ error: `Couldn't use the time "${b.when}".` });
  const duration = b.durationMinutes || 60;
  const appts = store.getCol("appointments");
  const start = when.getTime(), end = start + duration * 60e3;
  const clash = appts.find((a) => {
    if (a.status === "cancelled") return false;
    const s = new Date(a.startsAt).getTime(), e = s + (a.durationMinutes || 60) * 60e3;
    return s < end && e > start;
  });
  if (clash) return res.status(409).json({ error: `Clashes with ${clash.customer_name} at ${formatWhen(clash.startsAt)}.` });
  const record = {
    id: store.newId("appt"),
    customer_name: b.customer_name,
    phone: b.phone || "",
    service: b.service,
    startsAt: when.toISOString(),
    durationMinutes: duration,
    status: "booked",
    createdAt: new Date().toISOString(),
    createdBy: "manual",
  };
  appts.push(record);
  store.saveCol("appointments", appts);
  store.logActivity("appointment", `Appointment booked: ${record.customer_name} — ${record.service}, ${formatWhen(record.startsAt)}`, record.id);
  events.emit("appointment.booked", { appointmentId: record.id, summary: `${record.service} for ${record.customer_name}` });
  res.json(record);
});

app.patch("/api/appointments/:id", (req, res) => {
  const appts = store.getCol("appointments");
  const appt = appts.find((a) => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: "Appointment not found." });
  const b = req.body || {};
  if (b.when) {
    const when = b.when.match(/^\d{4}-\d{2}-\d{2}T/) ? new Date(b.when) : resolveWhen(b.when, new Date());
    if (!when || isNaN(when) || when <= new Date()) return res.status(400).json({ error: `Couldn't use the time "${b.when}".` });
    appt.startsAt = when.toISOString();
    appt.status = "booked";
    store.logActivity("appointment", `Rescheduled ${appt.customer_name} to ${formatWhen(appt.startsAt)}`, appt.id);
  }
  if (b.status === "cancelled") {
    appt.status = "cancelled";
    store.logActivity("appointment", `Cancelled ${appt.customer_name}'s ${appt.service}`, appt.id);
    events.emit("appointment.cancelled", { appointmentId: appt.id, summary: appt.customer_name });
  }
  if (b.status === "completed") appt.status = "completed";
  store.saveCol("appointments", appts);
  res.json(appt);
});

// ---- AI employees --------------------------------------------------------------------

app.get("/api/employees", (_req, res) => res.json(employees.getEmployees()));
app.patch("/api/employees/:id", (req, res) => {
  const out = employees.updateEmployee(req.params.id, req.body || {});
  if (!out) return res.status(404).json({ error: "Unknown employee." });
  res.json(out);
});

// ---- automations ------------------------------------------------------------------------

app.get("/api/workflows", (_req, res) => res.json(store.getCol("workflows")));
app.get("/api/workflow-options", (_req, res) => {
  const connectors = require("./src/connectors");
  // the generic send_webhook entry is replaced by one concrete entry per
  // connector, so the builder reads "Send the event to Zapier" not jargon
  const actions = events.ACTIONS.filter((a) => a.id !== "send_webhook")
    .concat(connectors.listPublic().map((c) => ({ id: `send_webhook:${c.id}`, label: `Send the event to ${c.name}`, local: true })));
  res.json({ triggers: events.TRIGGERS, actions });
});

// ---- custom connectors (webhooks) -------------------------------------------
const connectorsMod = require("./src/connectors");
app.get("/api/connectors", (_req, res) => res.json(connectorsMod.listPublic()));
app.post("/api/connectors", async (req, res) => {
  try { res.json(await connectorsMod.create(req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/connectors/:id", (req, res) => {
  try { connectorsMod.remove(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/connectors/:id/test", async (req, res) => {
  try { res.json(await connectorsMod.test(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/workflows", (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.trigger || !Array.isArray(b.actions) || !b.actions.length) {
    return res.status(400).json({ error: "A workflow needs a name, a trigger and at least one action." });
  }
  const workflows = store.getCol("workflows");
  const record = {
    id: store.newId("wf"),
    name: String(b.name).trim(),
    trigger: b.trigger,
    actions: b.actions,
    enabled: b.enabled !== false,
    runs: [],
    createdAt: new Date().toISOString(),
  };
  workflows.push(record);
  store.saveCol("workflows", workflows);
  store.logActivity("automation", `Workflow created: "${record.name}"`);
  res.json(record);
});

app.patch("/api/workflows/:id", (req, res) => {
  const workflows = store.getCol("workflows");
  const wf = workflows.find((w) => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: "Workflow not found." });
  const b = req.body || {};
  if (typeof b.enabled === "boolean") wf.enabled = b.enabled;
  if (b.name) wf.name = b.name;
  if (b.trigger) wf.trigger = b.trigger;
  if (Array.isArray(b.actions) && b.actions.length) wf.actions = b.actions;
  store.saveCol("workflows", workflows);
  res.json(wf);
});

app.delete("/api/workflows/:id", (req, res) => {
  const workflows = store.getCol("workflows");
  const idx = workflows.findIndex((w) => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Workflow not found." });
  workflows.splice(idx, 1);
  store.saveCol("workflows", workflows);
  res.json({ ok: true });
});

// Test-fire a workflow with a sample payload (clearly labelled in the log).
app.post("/api/workflows/:id/test", async (req, res) => {
  const workflows = store.getCol("workflows");
  const wf = workflows.find((w) => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: "Workflow not found." });
  const leads = store.getCol("leads");
  const payload = { leadId: leads.length ? leads[leads.length - 1].id : null, summary: "test run" };
  const wasEnabled = wf.enabled;
  wf.enabled = true;
  store.saveCol("workflows", workflows);
  await events.emit(wf.trigger, payload);
  const after = store.getCol("workflows");
  const updated = after.find((w) => w.id === wf.id);
  updated.enabled = wasEnabled;
  store.saveCol("workflows", after);
  res.json(updated);
});

// ---- team (local roster — no multi-user login in this build) ------------------------------

app.get("/api/team", (_req, res) => res.json(store.getCol("team")));
app.post("/api/team", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Name required." });
  const team = store.getCol("team");
  const record = {
    id: store.newId("tm"),
    name: b.name, email: b.email || "", role: b.role || "member",
    permissions: Array.isArray(b.permissions) ? b.permissions : [],
    addedAt: new Date().toISOString(),
  };
  team.push(record);
  store.saveCol("team", team);
  res.json(record);
});
app.delete("/api/team/:id", (req, res) => {
  const team = store.getCol("team").filter((t) => t.id !== req.params.id);
  store.saveCol("team", team);
  res.json({ ok: true });
});

// ---- integrations (honest status only) ------------------------------------------------------

app.get("/api/integrations", async (_req, res) => {
  // White-label rule: customers see the apps they care about, never the
  // plumbing. GoHighLevel does the publishing and holds the platform
  // approvals, but it has no row of its own — the Instagram/Facebook/TikTok
  // rows show the REAL connection state of this account's hidden engine, and
  // "Connect" runs the platform's own OAuth through it.
  //
  // Three honest states, and nothing in between:
  //   connectable + connected      — authorised, and GHL lists the account
  //   connectable + not connected  — one click away, nothing faked
  //   soon                         — no working integration exists yet, so
  //                                  there is no button to press
  const engineStatus = await ghl.health();
  const linked = (engineStatus.connected ? engineStatus.accounts || [] : []);
  const byPlatform = {};
  linked.forEach((a) => {
    const k = String(a.platform || "").toLowerCase();
    (byPlatform[k] = byPlatform[k] || []).push({ id: a.id, name: a.name });
  });

  const platforms = ghl.oauthPlatforms();
  const social = (id, desc, ...ghlNames) => {
    const accounts = ghlNames.flatMap((n) => byPlatform[n] || []);
    return {
      id,
      name: platforms[id] ? platforms[id].label : id,
      desc,
      group: "social",
      connectable: engineStatus.connected, // the engine has to be up to start OAuth
      connected: accounts.length > 0,
      accounts,
      detail: accounts.length
        ? `Posting to ${accounts.map((a) => a.name).join(", ")}`
        : platforms[id] && platforms[id].note,
      how: engineStatus.connected
        ? "Click Connect, sign in, tap Authorise. No passwords are shared with HarperLinks and no API keys are needed."
        : "Your publishing engine isn't set up yet — the HarperLinks team switches it on during setup.",
    };
  };

  const soon = (id, name, desc, note, group) => ({
    id, name, desc, group: group || "other", connectable: false, connected: false, soon: true, how: note,
  });

  res.json([
    social("instagram", "Posts, reels and carousels to your feed.", "instagram"),
    social("facebook", "Page posts and updates.", "facebook"),
    social("tiktok", "Short-form video.", "tiktok", "tiktok-business"),
    social("linkedin", "Profile and company page posts.", "linkedin"),
    social("youtube", "Video uploads to your channel.", "youtube"),
    social("pinterest", "Pins to your boards.", "pinterest"),
    social("threads", "Posts to Threads.", "threads"),
    social("google", "Google Business Profile posts.", "google"),
    {
      id: "anthropic", name: "Claude (Anthropic)", desc: "Powers your AI team's writing and thinking.",
      group: "engine", connectable: false, connected: HAS_KEY,
      detail: HAS_KEY ? "Live — your AI team is thinking with it right now." : undefined,
      how: "Connected and paid for by HarperLinks — nothing for you to set up.",
    },
    {
      id: "email", name: "Email", desc: "Password resets, welcomes and your daily handover.",
      group: "engine", connectable: false, connected: notify.configured(),
      detail: notify.configured() ? "Sending" : undefined,
      how: "Set up in Settings → Email.",
    },
    soon("twitter", "X (Twitter)", "Posts to X.", "Not available at all — our publishing engine dropped X support in December 2024. We won't pretend otherwise."),
    soon("gcal", "Google Calendar", "Two-way appointment sync.", "Coming soon — appointments work inside HarperLinks today."),
    soon("stripe", "Stripe", "Subscriptions & billing.", "Coming soon."),
    soon("twilio", "Twilio", "AI phone calls & SMS.", "Coming soon — powers Harper, your AI receptionist."),
    soon("videoai", "Video AI", "Turns video scripts into filmed footage.", "Coming soon — scripts, shot lists and slideshow videos already work today."),
    soon("whatsapp", "WhatsApp Business", "Customer messaging.", "Coming soon."),
    soon("shopify", "Shopify", "Store data & customers.", "Coming soon."),
    soon("wordpress", "WordPress", "Push website edits live.", "Coming soon."),
  ]);
});

// ---- one-click social connect ----------------------------------------------
// Three calls mirroring the three real OAuth steps. Nothing here reports a
// connection it hasn't re-read back from the publishing engine.

app.get("/api/connect/:platform/start", async (req, res) => {
  try {
    const out = await ghl.oauthStart(req.params.platform, req.user.id);
    res.json({ ok: true, url: out.url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// After the popup comes back with an accountId: what can that login post to?
app.get("/api/connect/:platform/accounts/:accountId", async (req, res) => {
  try {
    const pages = await ghl.oauthAccounts(req.params.platform, req.params.accountId);
    res.json({ ok: true, pages });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/connect/:platform/attach", async (req, res) => {
  const { accountId, page } = req.body || {};
  if (!accountId || !page || !page.id) return res.status(400).json({ error: "Pick which page to post to." });
  try {
    const out = await ghl.oauthAttach(req.params.platform, accountId, page);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/connect/account/:id", async (req, res) => {
  try {
    res.json({ ok: true, accounts: await ghl.removeAccount(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- insights & competitors --------------------------------------------------

// Cheap, cached connection state — the home page and chat read this instead of
// hitting the publishing engine's API on every load.
app.get("/api/connections", (_req, res) => res.json(ghl.linkedPlatforms()));

app.get("/api/insights", (_req, res) => {
  const insights = require("./src/insights");
  res.json({ insights: insights.computeInsights(), competitors: insights.listCompetitors() });
});

// "Who's my competition?" — proposes rivals, then verifies each by actually
// crawling their site; only survivors are saved. Slow (real fetches), so the
// UI gets an immediate ack and polls /api/insights.
app.post("/api/competitors/find", (req, res) => {
  const accountId = tenant.current();
  res.json({ ok: true, started: true });
  tenant.run(accountId, () => {
    require("./src/insights").findCompetitors()
      .then((out) => tenant.run(accountId, () => store.logActivity("research", `Competitor hunt finished — ${out.verified.length} verified of ${out.suggested} suggested`)))
      .catch((e) => console.error("find competitors:", e.message));
  });
});

app.post("/api/competitors", async (req, res) => {
  try {
    res.json({ ok: true, competitor: await require("./src/insights").researchCompetitor((req.body || {}).url) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- website ---------------------------------------------------------------
app.get("/api/website", (req, res) => {
  const w = website.get();
  res.json(Object.assign({}, w, { publicPath: w.mode === "built" ? "/site/" + req.user.accountId : null }));
});

app.post("/api/website/link", (req, res) => {
  try {
    res.json(website.setExternal((req.body || {}).url));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/website/scan", (_req, res) => {
  try {
    res.json(website.scan());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/website/publish", (_req, res) => {
  try {
    res.json(website.publish());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// The DRAFT, visible only to the signed-in account — the public /site/<id>
// address never shows unpublished work.
app.get("/api/website/draft", (req, res) => {
  const html = website.draftHtml();
  if (!html) return res.status(404).send("No draft yet.");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'self' data:; style-src 'unsafe-inline' 'self'; img-src 'self' data:; script-src 'none'; frame-ancestors 'self'");
  res.send(html);
});

app.post("/api/website/restore", (req, res) => {
  try {
    res.json(website.restore((req.body || {}).index));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- activity / stats / report ---------------------------------------------------------------

app.get("/api/activity", (_req, res) => res.json(store.getActivity()));

// ---- spend cap ---------------------------------------------------------------
app.get("/api/budget", (_req, res) => {
  res.json(Object.assign(budget.status(), { config: budget.getConfig(), prices: budget.PRICES }));
});
app.put("/api/budget", (req, res) => {
  const cap = Number((req.body || {}).monthlyCapAUD);
  if (!Number.isFinite(cap) || cap < 0) return res.status(400).json({ error: "monthlyCapAUD must be a positive number." });
  budget.setConfig({ monthlyCapAUD: cap });
  res.json(Object.assign(budget.status(), { config: budget.getConfig() }));
});

// ---- GoHighLevel publishing ---------------------------------------------------
// ---- media studio ------------------------------------------------------------

const media = require("./src/media");

app.get("/api/media", (_req, res) => res.json(media.list()));

// Stream a generated file to the signed-in owner (thumbnails, previews).
app.get("/api/media/file/:name", (req, res) => {
  const p = media.filePath(req.params.name);
  if (!p) return res.status(404).json({ error: "No such file." });
  res.setHeader("Content-Type", p.endsWith(".mp4") ? "video/mp4" : "image/png");
  res.sendFile(p);
});

// Make an image or video by hand from the dashboard (the AI uses its tools).
app.post("/api/media/image", async (req, res) => {
  try { res.json(await media.generateImage(req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/media/video", async (req, res) => {
  try { res.json(await media.generateVideo(req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// The one fast path for Stone: where to open this account's publishing engine
// to link socials. Admin-only — customers never see the engine.
app.get("/api/ghl/connect-info", adminOnly, (req, res) => {
  const info = ghl.connectInfo();
  if (!info.locationId) return res.json({ configured: false });
  res.json({
    configured: true,
    url: `https://app.gohighlevel.com/v2/location/${info.locationId}/marketing/social-planner/`,
  });
});

app.get("/api/ghl/health", async (_req, res) => {
  res.json(await ghl.health());
});
app.post("/api/ghl/publish/:id", async (req, res) => {
  const posts = store.getPosts();
  const post = posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found." });
  if (!ghl.isConfigured()) return res.status(400).json({ error: "GoHighLevel isn't connected." });
  const out = await ghl.publishPost(post);
  if (!out.ok) return res.status(502).json({ error: out.reason });
  post.status = "published";
  post.publishedAt = new Date().toISOString();
  post.simulated = false;
  post.ghlPostId = out.id || null;
  store.savePosts(posts);
  store.logActivity("published", `Published ${post.platform} post via GoHighLevel (manual) — ${(out.accounts||[]).join(", ")}`, post.id);
  res.json(post);
});

app.get("/api/tasks", (_req, res) => res.json(store.getCol("tasks")));
app.patch("/api/tasks/:id", (req, res) => {
  const tasks = store.getCol("tasks");
  const t = tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Task not found." });
  if ((req.body || {}).done) {
    t.status = "done";
    store.logActivity("task", `Task done: ${t.what}`, t.id);
  }
  store.saveCol("tasks", tasks);
  res.json(t);
});

app.get("/api/stats", (req, res) => {
  const days = Math.max(7, Math.min(90, parseInt(req.query.days, 10) || 30));
  const now = new Date();
  const dayKey = (d) => d.toISOString().slice(0, 10);
  const series = [];
  const idx = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400e3);
    const k = dayKey(d);
    idx[k] = series.length;
    series.push({ day: k, published: 0, scheduled: 0, leads: 0, appointments: 0, automations: 0 });
  }
  const posts = store.getPosts();
  posts.forEach((p) => {
    if (p.publishedAt && idx[dayKey(new Date(p.publishedAt))] !== undefined) series[idx[dayKey(new Date(p.publishedAt))]].published++;
    if (p.createdAt && idx[dayKey(new Date(p.createdAt))] !== undefined && p.status === "scheduled") series[idx[dayKey(new Date(p.createdAt))]].scheduled++;
  });
  const leads = store.getCol("leads");
  leads.forEach((l) => {
    if (idx[dayKey(new Date(l.createdAt))] !== undefined) series[idx[dayKey(new Date(l.createdAt))]].leads++;
  });
  const appts = store.getCol("appointments");
  appts.forEach((a) => {
    if (idx[dayKey(new Date(a.createdAt))] !== undefined) series[idx[dayKey(new Date(a.createdAt))]].appointments++;
  });
  store.getActivity().forEach((a) => {
    if (a.type === "automation" && idx[dayKey(new Date(a.at))] !== undefined) series[idx[dayKey(new Date(a.at))]].automations++;
  });

  const won = leads.filter((l) => l.status === "won").length;
  const activeEmployees = employees.getEmployees().filter((e) => e.enabled).length;
  res.json({
    series,
    totals: {
      leads: leads.length,
      leadsNew: leads.filter((l) => l.status === "new").length,
      won,
      conversion: leads.length ? Math.round((won / leads.length) * 100) : null,
      appointments: appts.filter((a) => a.status !== "cancelled").length,
      upcoming: appts.filter((a) => a.status === "booked" && new Date(a.startsAt) > now).length,
      postsPublished: posts.filter((p) => p.status === "published").length,
      postsScheduled: posts.filter((p) => p.status === "scheduled").length,
      drafts: posts.filter((p) => p.status === "draft").length,
      activeEmployees,
      workflows: store.getCol("workflows").filter((w) => w.enabled).length,
      callsHandled: 0, // honest: no phone integration yet
      revenue: null,   // honest: no payments integration yet
    },
  });
});

// Daily report: written by Claude in live mode, deterministic from real data otherwise.
// This is Darcy's job — switched off means no report.
// Darcy's prose comes from Claude, which takes seconds. The Command Centre asks
// for ?quick=1 first so the page can paint immediately off the same facts, then
// asks again without it and swaps the prose in when it lands.
app.get("/api/report", async (req, res) => {
  const darcy = employees.getState("manager");
  if (!darcy.enabled) {
    return res.json({ report: "Darcy (your Business Manager) is switched off — enable them in AI Employees and the daily report comes back.", facts: null, by: "off" });
  }
  const posts = store.getPosts();
  const leads = store.getCol("leads");
  const appts = store.getCol("appointments");
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86400e3);
  const facts = {
    business: store.getProfile().configured ? store.getProfile().name : null,
    publishedToday: posts.filter((p) => p.publishedAt && new Date(p.publishedAt) > dayAgo).length,
    scheduledAhead: posts.filter((p) => p.status === "scheduled").length,
    drafts: posts.filter((p) => p.status === "draft").length,
    newLeads: leads.filter((l) => new Date(l.createdAt) > dayAgo).length,
    staleLeads: leads.filter((l) => ["new", "contacted"].includes(l.status) && new Date(l.createdAt) < new Date(now - 3 * 86400e3)).length,
    overdueFollowUps: leads.reduce((n, l) => n + (l.followUps || []).filter((f) => !f.done && new Date(f.due) < now).length, 0),
    upcomingAppts: appts.filter((a) => a.status === "booked" && new Date(a.startsAt) > now && new Date(a.startsAt) < new Date(now.getTime() + 7 * 86400e3)).length,
  };

  if (engine.mode() === "live" && !req.query.quick) {
    try {
      const Anthropic = require("@anthropic-ai/sdk");
      const client = new Anthropic();
      const resp = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
        max_tokens: 400,
        output_config: { effort: "low" },
        system: "You write a short, friendly daily report for a small-business owner. 3 short paragraphs max: what happened, what needs attention, one opportunity. Use ONLY the facts given — never invent numbers. Australian tone, no fluff.",
        messages: [{ role: "user", content: JSON.stringify(facts) }],
      });
      return res.json({ report: resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"), facts, by: "claude" });
    } catch (e) {
      console.error("report error:", e.message);
    }
  }

  const lines = [];
  lines.push(facts.business ? `Here's where ${facts.business} stands today.` : `Here's where things stand today. (Tip: ingest your website so I can personalise this.)`);
  lines.push(`Last 24h: ${facts.publishedToday} post${facts.publishedToday === 1 ? "" : "s"} published, ${facts.newLeads} new lead${facts.newLeads === 1 ? "" : "s"}. You have ${facts.scheduledAhead} post${facts.scheduledAhead === 1 ? "" : "s"} queued and ${facts.upcomingAppts} appointment${facts.upcomingAppts === 1 ? "" : "s"} in the next 7 days.`);
  const attention = [];
  if (facts.overdueFollowUps) attention.push(`${facts.overdueFollowUps} overdue follow-up${facts.overdueFollowUps === 1 ? "" : "s"}`);
  if (facts.staleLeads) attention.push(`${facts.staleLeads} lead${facts.staleLeads === 1 ? "" : "s"} sitting untouched 3+ days`);
  if (facts.drafts) attention.push(`${facts.drafts} draft post${facts.drafts === 1 ? "" : "s"} awaiting review`);
  lines.push(attention.length ? `Needs attention: ${attention.join(", ")}.` : `Nothing overdue — pipeline and calendar are clean.`);
  if (!facts.scheduledAhead) lines.push(`Opportunity: the posting queue is empty — ask Sage to write next week's content.`);
  else if (facts.newLeads === 0) lines.push(`Opportunity: no new leads in 24h — a fresh post or a follow-up round usually shakes some loose.`);
  res.json({ report: lines.join("\n\n"), facts, by: "rules" });
});

// ---- start -------------------------------------------------------------------

scheduler.start();
require("./src/backup").start();

// ---- crash alerting ----------------------------------------------------------
// A crash gets logged, and (when SMTP is set up) emailed to the team — at
// most one email per 10 minutes so a crash-loop doesn't flood the inbox.
let lastAlert = 0;
function alertError(kind, err) {
  const msg = `${kind}: ${err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n") : err}`;
  console.error(msg);
  try {
    tenant.run(tenant.MAIN, () => store.logActivity("system", `Server error — ${String(err && err.message || err).slice(0, 140)}`));
    if (Date.now() - lastAlert > 10 * 60 * 1000) {
      lastAlert = Date.now();
      require("./src/notify").sendToTeam("HarperLinks server error", msg).catch(() => {});
    }
  } catch { /* alerting must never crash the crash handler */ }
}
process.on("uncaughtException", (e) => alertError("uncaughtException", e));
process.on("unhandledRejection", (e) => alertError("unhandledRejection", e));

app.listen(PORT, () => {
  console.log(`HarperLinks Automation running at http://localhost:${PORT}`);
  console.log(`Mode: ${engine.mode() === "live" ? "LIVE (Claude)" : "DEMO (no API key — demo brain active)"}`);
});
