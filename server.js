// HarperLinks Automation — Express server
// Marketing site at /, business OS dashboard at /app, JSON API under /api/*.
require("dotenv").config();
const path = require("path");
const express = require("express");

const engine = require("./src/engine");
const store = require("./src/store");
const scheduler = require("./src/scheduler");
const employees = require("./src/employees");
const events = require("./src/events");
const { ingestWebsite } = require("./src/ingest");
const budget = require("./src/budget");
const ghl = require("./src/ghl");
const { resolveWhen, formatWhen } = require("./src/tools");

const app = express();
const PORT = process.env.PORT || 4700;
const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// The dashboard is its own application now — it lives at the root.
// /app is kept as a redirect so old links still land somewhere sensible.
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "app.html"));
});
app.get("/app", (_req, res) => res.redirect(301, "/"));

// ---- chat sessions (in-memory, 30 min TTL) ---------------------------------
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function getSession(id) {
  const key = String(id || "default");
  let s = sessions.get(key);
  if (!s) {
    s = { history: [], last: Date.now() };
    sessions.set(key, s);
  }
  s.last = Date.now();
  return s;
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
  const { sessionId, message } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: "Message is empty." });
  try {
    const session = getSession(sessionId);
    const out = await engine.respond(session, String(message).slice(0, 4000), (req.body || {}).employee);
    res.json({ reply: out.reply, actions: out.actions, steps: out.steps || [], mode: engine.mode() });
  } catch (e) {
    console.error("chat error:", e.message);
    res.status(500).json({ error: "The bot hit a snag — try that again." });
  }
});

app.post("/api/reset", (req, res) => {
  sessions.delete(String((req.body || {}).sessionId || "default"));
  res.json({ ok: true });
});

// ---- profile / knowledge ------------------------------------------------------

app.post("/api/ingest", async (req, res) => {
  try {
    const profile = await ingestWebsite((req.body || {}).url);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
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
  const { content, hashtags, scheduledFor, status } = req.body || {};
  if (content) post.content = String(content).trim();
  if (Array.isArray(hashtags)) post.hashtags = hashtags;
  if (scheduledFor) {
    const when = resolveWhen(scheduledFor, new Date());
    if (!when || when <= new Date()) return res.status(400).json({ error: `Couldn't use the time "${scheduledFor}".` });
    post.scheduledAt = when.toISOString();
    post.status = "scheduled";
  }
  if (status === "cancelled" || status === "draft") post.status = status;
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
app.get("/api/workflow-options", (_req, res) => res.json({ triggers: events.TRIGGERS, actions: events.ACTIONS }));

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
app.post("/api/workflows/:id/test", (req, res) => {
  const workflows = store.getCol("workflows");
  const wf = workflows.find((w) => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: "Workflow not found." });
  const leads = store.getCol("leads");
  const payload = { leadId: leads.length ? leads[leads.length - 1].id : null, summary: "test run" };
  const wasEnabled = wf.enabled;
  wf.enabled = true;
  store.saveCol("workflows", workflows);
  events.emit(wf.trigger, payload);
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

app.get("/api/integrations", (_req, res) => {
  res.json([
    { id: "anthropic", name: "Claude (Anthropic)", desc: "Powers live AI writing and chat.", connected: HAS_KEY, how: "Add ANTHROPIC_API_KEY to .env and restart." },
    { id: "gohighlevel", name: "GoHighLevel", desc: "Publishes to Instagram, Facebook, TikTok, LinkedIn & YouTube.", connected: ghl.isConfigured(), how: "Connect your socials in GHL Social Planner, then add GHL_TOKEN (scope socialplanner/post.write) and GHL_LOCATION_ID to .env." },
    { id: "instagram", name: "Instagram", desc: "Live publishing & DMs.", connected: false, how: "Requires a Meta developer app + Instagram Graph API approval." },
    { id: "facebook", name: "Facebook", desc: "Page posts & Messenger.", connected: false, how: "Requires a Meta developer app + Pages API access." },
    { id: "tiktok", name: "TikTok", desc: "Video publishing.", connected: false, how: "Requires TikTok Content Posting API approval." },
    { id: "gcal", name: "Google Calendar", desc: "Two-way appointment sync.", connected: false, how: "Requires a Google Cloud OAuth app." },
    { id: "gmail", name: "Gmail", desc: "Email sending & sequences.", connected: false, how: "Requires a Google Cloud OAuth app." },
    { id: "stripe", name: "Stripe", desc: "Subscriptions & billing.", connected: false, how: "Requires a Stripe account + API keys." },
    { id: "twilio", name: "Twilio", desc: "AI phone calls & SMS.", connected: false, how: "Requires a Twilio account, number and voice webhooks." },
    { id: "videoai", name: "Video AI (Sora / Veo)", desc: "Turns the bot's video scripts into rendered footage.", connected: false, how: "Requires an OpenAI Sora or Google Veo API key. Scripts & shot lists already work today." },
    { id: "whatsapp", name: "WhatsApp Business", desc: "Customer messaging.", connected: false, how: "Requires Meta WhatsApp Business API access." },
    { id: "shopify", name: "Shopify", desc: "Store data & customers.", connected: false, how: "Requires a Shopify app + store token." },
    { id: "wordpress", name: "WordPress", desc: "Push website edits live.", connected: false, how: "Requires your WP site URL + application password." },
  ]);
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
app.get("/api/report", async (_req, res) => {
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

  if (engine.mode() === "live") {
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
app.listen(PORT, () => {
  console.log(`HarperLinks Automation running at http://localhost:${PORT}`);
  console.log(`Mode: ${engine.mode() === "live" ? "LIVE (Claude)" : "DEMO (no API key — demo brain active)"}`);
});
