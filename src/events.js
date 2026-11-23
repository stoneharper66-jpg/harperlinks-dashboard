// Automation engine: business events flow through here and matching enabled
// workflows execute. v1 actions are LOCAL and real (they create records,
// drafts and log entries in this app). Actions that need external services
// (SMS, email, live DMs) are marked needs_integration and are skipped with an
// honest log line instead of pretending to send anything.

const store = require("./store");
const employees = require("./employees");
const media = require("./media");
const connectors = require("./connectors");
const ghl = require("./ghl");

// Trigger types the engine can actually fire today.
const TRIGGERS = [
  { id: "lead.created", label: "New lead captured" },
  { id: "lead.won", label: "Lead marked as won" },
  { id: "appointment.booked", label: "Appointment booked" },
  { id: "appointment.cancelled", label: "Appointment cancelled" },
  { id: "post.published", label: "Social post published" },
  { id: "website.ingested", label: "Website ingested / knowledge updated" },
];

// Actions. `local: true` executes for real; others need an integration.
const ACTIONS = [
  { id: "log_note", label: "Add a note to the activity feed", local: true },
  { id: "create_followup", label: "Create a follow-up task on the lead", local: true },
  { id: "draft_social_post", label: "AI-draft a social post about it", local: true },
  { id: "draft_reply", label: "AI-draft an outreach message (saved to the lead)", local: true },
  { id: "generate_image", label: "AI-design a branded image for the post", local: true },
  { id: "publish_everywhere", label: "Publish the post to every connected social account", local: true },
  { id: "send_webhook", label: "Send the event to a connector (webhook)", local: true },
  { id: "send_sms", label: "Send an SMS (needs Twilio)", local: false, needs: "Twilio" },
  { id: "send_email", label: "Send an email (needs Gmail/SMTP)", local: false, needs: "Email" },
];

async function runAction(action, event, payload, workflow) {
  // AI-powered steps are staffed: Flynn handles lead outreach, Sage drafts content.
  // If that employee is switched off, the step waits honestly instead of running.
  const STAFF = { draft_reply: "sales", create_followup: "sales", draft_social_post: "social", generate_image: "social", publish_everywhere: "social" };
  const staffId = STAFF[action.type];
  if (staffId) {
    const emp = employees.getState(staffId);
    if (!emp.enabled) {
      store.logActivity("automation", `Workflow "${workflow.name}" skipped "${action.type}" — ${emp.name} (${emp.role}) is switched off`);
      return { ok: false, error: `${emp.name} is switched off` };
    }
  }
  const actionType = String(action.type || "").startsWith("send_webhook") ? "send_webhook" : action.type;
  switch (actionType) {
    case "log_note": {
      store.logActivity("automation", `Workflow "${workflow.name}": ${action.note || "step executed"} (${event})`);
      return { ok: true };
    }
    case "create_followup": {
      if (!payload || !payload.leadId) return { ok: false, error: "no lead in this event" };
      const leads = store.getCol("leads");
      const lead = leads.find((l) => l.id === payload.leadId);
      if (!lead) return { ok: false, error: "lead not found" };
      lead.followUps = lead.followUps || [];
      lead.followUps.push({
        id: store.newId("fu"),
        note: action.note || "Follow up with this lead",
        due: new Date(Date.now() + (action.delayHours || 24) * 3600e3).toISOString(),
        done: false,
        createdBy: `workflow:${workflow.name}`,
      });
      store.saveCol("leads", leads);
      store.logActivity("automation", `Workflow "${workflow.name}" added a follow-up for ${lead.name}`, lead.id);
      return { ok: true };
    }
    case "draft_social_post": {
      const profile = store.getProfile();
      const posts = store.getPosts();
      const subject = payload && payload.summary ? payload.summary : "some news from the business";
      const record = {
        id: store.newPostId(),
        platform: action.platform || "instagram",
        content: `📣 ${profile.configured ? profile.name : "We"}'ve got news — ${subject}. More soon!`,
        hashtags: (profile.keywords || []).slice(0, 4),
        status: "draft",
        scheduledAt: null,
        createdAt: new Date().toISOString(),
        publishedAt: null,
        simulated: true,
        createdBy: `workflow:${workflow.name}`,
      };
      posts.push(record);
      store.savePosts(posts);
      if (payload) payload.lastPostId = record.id; // later steps in this run pick it up
      store.logActivity("automation", `Workflow "${workflow.name}" drafted a ${record.platform} post (awaiting your review)`, record.id);
      return { ok: true };
    }
    case "draft_reply": {
      if (!payload || !payload.leadId) return { ok: false, error: "no lead in this event" };
      const leads = store.getCol("leads");
      const lead = leads.find((l) => l.id === payload.leadId);
      if (!lead) return { ok: false, error: "lead not found" };
      lead.notes = lead.notes || [];
      lead.notes.push({
        at: new Date().toISOString(),
        text: `[AI draft — review before sending] Hi ${lead.name.split(" ")[0]}, thanks for getting in touch! We'd love to help — when suits you for a quick chat?`,
        by: `workflow:${workflow.name}`,
      });
      store.saveCol("leads", leads);
      store.logActivity("automation", `Workflow "${workflow.name}" drafted an outreach message for ${lead.name} (in their notes)`, lead.id);
      return { ok: true };
    }
    case "generate_image": {
      const posts = store.getPosts();
      const pid = (payload && (payload.lastPostId || payload.postId)) || null;
      const post = pid ? posts.find((p) => p.id === pid) : null;
      const headline = post ? post.content.split(/[.!?\n]/)[0].slice(0, 90)
        : (payload && payload.summary ? String(payload.summary).slice(0, 90) : null);
      if (!headline) return { ok: false, error: "nothing to design an image from" };
      const img = await media.generateImage({ headline, sub: "", style: action.style || "bold", format: action.format || "square" });
      if (post) {
        post.mediaId = img.id;
        post.mediaFile = img.file;
        post.mediaUrl = require("./media").publicUrl(img.file);
        store.savePosts(posts);
      }
      store.logActivity("automation", `Workflow "${workflow.name}" designed an image${post ? " and attached it to the draft post" : ""}`, img.id);
      return { ok: true };
    }
    case "publish_everywhere": {
      const posts = store.getPosts();
      const pid = (payload && (payload.lastPostId || payload.postId)) || null;
      const post = pid ? posts.find((p) => p.id === pid) : null;
      if (!post) return { ok: false, error: "no post in this event to publish" };
      if (!ghl.isConfigured()) {
        store.logActivity("automation", `Workflow "${workflow.name}" skipped publish-everywhere — the publishing engine isn't connected yet`);
        return { ok: false, error: "publishing engine not connected" };
      }
      let accounts;
      try { accounts = await ghl.listAccounts(); }
      catch (e) { return { ok: false, error: `couldn't read connected accounts — ${e.message}` }; }
      const platforms = [...new Set(accounts.map((a) => String(a.platform || "").toLowerCase().replace("tiktok-business", "tiktok")))];
      if (!platforms.length) return { ok: false, error: "no social accounts connected in the publishing engine" };
      const sent = [], failed = [];
      for (const plat of platforms) {
        const out = await ghl.publishPost(Object.assign({}, post, { platform: plat }));
        if (out.ok) sent.push(plat); else failed.push(`${plat} (${out.reason})`);
      }
      if (sent.length) {
        post.status = "published";
        post.publishedAt = new Date().toISOString();
        post.simulated = false;
        store.savePosts(posts);
      }
      store.logActivity("automation",
        `Workflow "${workflow.name}" published to ${sent.length ? sent.join(", ") : "nothing"}${failed.length ? ` — failed: ${failed.join("; ")}` : ""}`, post.id);
      return sent.length ? { ok: true } : { ok: false, error: failed.join("; ") || "nothing connected" };
    }
    case "send_webhook": {
      // built from the UI as "send_webhook:<connectorId>", or by the AI with
      // an explicit connectorId — accept both
      const connId = action.connectorId || String(action.type).split(":")[1] || null;
      if (!connId) return { ok: false, error: "no connector chosen for this step" };
      const conn = connectors.get(connId);
      if (!conn) return { ok: false, error: "that connector no longer exists" };
      const out = await connectors.fire(connId, event, payload || {});
      store.logActivity("automation", out.ok
        ? `Workflow "${workflow.name}" delivered the event to connector "${conn.name}" (HTTP ${out.code})`
        : `Workflow "${workflow.name}" couldn't reach connector "${conn.name}" — ${out.error}`);
      return out.ok ? { ok: true } : { ok: false, error: out.error };
    }
    case "send_sms":
    case "send_email": {
      const needs = action.type === "send_sms" ? "Twilio" : "an email";
      store.logActivity("automation", `Workflow "${workflow.name}" skipped "${action.type}" — ${needs} integration isn't connected yet`);
      return { ok: false, error: `${needs} integration not connected` };
    }
    default:
      return { ok: false, error: `unknown action "${action.type}"` };
  }
}

// Fire an event through all enabled workflows. Never throws.
async function emit(event, payload) {
  let workflows;
  try {
    workflows = store.getCol("workflows");
  } catch {
    return;
  }
  for (const wf of workflows) {
    if (!wf.enabled || wf.trigger !== event) continue;
    const runs = wf.runs || (wf.runs = []);
    const run = { at: new Date().toISOString(), event, results: [] };
    for (const action of wf.actions || []) {
      try {
        const out = await runAction(action, event, payload, wf);
        run.results.push({ action: action.type, ok: out.ok, error: out.error || null });
      } catch (e) {
        run.results.push({ action: action.type, ok: false, error: e.message });
      }
    }
    runs.push(run);
    while (runs.length > 50) runs.shift();
  }
  store.saveCol("workflows", workflows);
}

module.exports = { emit, TRIGGERS, ACTIONS };
