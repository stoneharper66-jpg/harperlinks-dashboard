// Tool definitions for the content bot, plus the handlers that do the work.
// Handlers may be async (ingest_website fetches the web). Each returns
// { ok, content, action? } — content goes back to Claude, action drives the UI.

const dt = require("./datetime");
const store = require("./store");
const events = require("./events");
const employees = require("./employees");
const budget = require("./budget");
const { ingestWebsite } = require("./ingest");
const media = require("./media");

const PLATFORMS = ["instagram", "facebook", "tiktok"];

// ---- natural-language scheduling ------------------------------------------
// Resolves "tomorrow 3pm", "next week", "in 2 minutes", "Friday morning".
// index/total spread a batch across weekdays and times instead of piling up.
function resolveWhen(text, base = dt.now(), index = 0) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return null;

  // "in N minutes/hours" — great for watching the pipeline fire in a demo
  const rel = t.match(/\bin\s+(\d+)\s*(minute|min|hour|hr)s?\b/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const ms = /min/.test(rel[2]) ? n * 60e3 : n * 3600e3;
    return new Date(base.getTime() + ms);
  }

  // "next week" → spread across Mon-Fri mornings of next week
  if (/\bnext week\b/.test(t)) {
    const monday = dt.addDays(dt.startOfDay(base), ((8 - base.getDay()) % 7) || 7);
    const day = dt.addDays(monday, index % 5);
    day.setHours(9 + (index % 3) * 2, 0, 0, 0); // 9am / 11am / 1pm rotation
    return day;
  }

  // "this week" → remaining weekdays from tomorrow
  if (/\bthis week\b/.test(t)) {
    const day = dt.addDays(dt.startOfDay(base), 1 + (index % 5));
    day.setHours(9 + (index % 3) * 2, 0, 0, 0);
    return day;
  }

  const parsed = dt.parse(t, base);
  if (!parsed.date && !parsed.time) return null;
  const day = parsed.date ? new Date(parsed.date) : dt.startOfDay(base);
  if (parsed.time) {
    const [h, m] = parsed.time.split(":").map(Number);
    day.setHours(h, m, 0, 0);
  } else {
    day.setHours(9 + (index % 3) * 2, 0, 0, 0);
  }
  // A date with no day given that's already past → assume tomorrow
  if (day <= base && !parsed.date) day.setDate(day.getDate() + 1);
  return day;
}

function findPost(posts, postId) {
  const id = String(postId || "").trim();
  return posts.find((p) => p.id === id) || posts.find((p) => p.id.endsWith(id)) || null;
}

function describePost(p) {
  const when = p.scheduledAt ? ` · ${formatWhen(p.scheduledAt)}` : "";
  return `[${p.id}] ${p.platform} · ${p.status}${when} — "${p.content.slice(0, 80)}${p.content.length > 80 ? "…" : ""}"`;
}

function formatWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// ---- tool schemas handed to Claude -----------------------------------------
const toolSchemas = [
  {
    name: "ingest_website",
    description:
      "Fetch and learn a business website. Reads the page, extracts the business profile (name, services, tone, audience) and saves it so every future post is written in that brand's voice. Call this whenever the user gives a website URL.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The website URL, e.g. https://example.com" },
      },
      required: ["url"],
    },
  },
  {
    name: "get_business_profile",
    description: "Read the saved business profile. Use it to check what you know before writing content.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_post",
    description:
      "Create one social media post (you write the content yourself, in the brand voice). Call once per post. If scheduledFor is given the post is scheduled, otherwise it is saved as a draft.",
    input_schema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: PLATFORMS, description: "Target platform" },
        content: { type: "string", description: "The full caption text" },
        hashtags: { type: "array", items: { type: "string" }, description: "Hashtags without the # sign" },
        scheduledFor: { type: "string", description: "Natural-language time, e.g. 'tomorrow 10am', 'next week'. Omit for a draft." },
        batchIndex: { type: "integer", description: "When creating several posts in one go, the 0-based index of this post — used to spread 'next week' across different days." },
        isVideo: { type: "boolean", description: "True when this post is a video. Pair it with generate_video (attach_to this post) to actually render the MP4." },
      },
      required: ["platform", "content"],
    },
  },
  {
    name: "schedule_post",
    description: "Schedule an existing draft (or move a scheduled post) to a time given in natural language.",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "The post id, e.g. post_abc123" },
        when: { type: "string", description: "Natural-language time, e.g. 'Friday 9am', 'in 2 minutes'" },
        batchIndex: { type: "integer", description: "When scheduling several posts to the same loose window (e.g. 'next week'), the 0-based index — spreads them across days/times." },
      },
      required: ["postId", "when"],
    },
  },
  {
    name: "list_scheduled_posts",
    description: "List posts, optionally filtered by status (draft, scheduled, published, cancelled). Use to answer 'what's going out this week'.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "scheduled", "published", "cancelled"] },
      },
    },
  },
  {
    name: "add_task",
    description: "Add a task or reminder for the business owner. If a time is given it becomes due then and surfaces in their activity feed; otherwise it sits on their list.",
    input_schema: {
      type: "object",
      properties: {
        what: { type: "string", description: "The task, in plain words" },
        when: { type: "string", description: "Natural-language due time, e.g. 'tomorrow 9am'. Optional." },
      },
      required: ["what"],
    },
  },
  {
    name: "get_knowledge",
    description: "Read the business knowledge base (hours, services & pricing, FAQs, policies, staff, brand voice). Use it to answer customer-facing questions accurately.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_lead",
    description: "Capture a new lead/enquiry into the CRM. Use when someone shows interest in the business.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The lead's name" },
        phone: { type: "string", description: "Phone number, if given" },
        email: { type: "string", description: "Email, if given" },
        interest: { type: "string", description: "What they're interested in" },
        source: { type: "string", description: "Where they came from, e.g. 'chat', 'website'" },
      },
      required: ["name"],
    },
  },
  {
    name: "book_appointment",
    description: "Book an appointment. Checks for clashes with existing bookings before confirming — never promise a time without calling this.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Customer's name" },
        phone: { type: "string", description: "Customer's phone" },
        service: { type: "string", description: "The service or reason" },
        when: { type: "string", description: "Natural-language time, e.g. 'Tuesday 2pm'" },
        durationMinutes: { type: "integer", description: "Duration, default 60" },
      },
      required: ["customer_name", "service", "when"],
    },
  },
  {
    name: "update_post",
    description: "Edit a post's content, move it to a new time, or cancel it.",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "The post id" },
        content: { type: "string", description: "New caption text, if editing" },
        when: { type: "string", description: "New natural-language time, if moving" },
        cancel: { type: "boolean", description: "True to cancel the post" },
      },
      required: ["postId"],
    },
  },

  // ---- building things: automations the owner can watch run ----
  {
    name: "list_automations",
    description:
      "List this business's automation workflows and what each one does, including whether it is switched on. Use before creating one so you don't duplicate an existing workflow, or when the user asks what's automated.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_automation",
    description:
      "Build a new automation: when TRIGGER happens, do these ACTIONS. Use the exact trigger and action ids from list_automation_options. Create it, then call test_automation so the user can see it actually run.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name, e.g. 'Welcome new leads'" },
        trigger: { type: "string", description: "Trigger id, e.g. lead.created" },
        actions: {
          type: "array",
          description: "The steps to run, in order",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "Action id, e.g. create_followup" },
              note: { type: "string", description: "Optional note or message for this step" },
            },
            required: ["type"],
          },
        },
      },
      required: ["name", "trigger", "actions"],
    },
  },
  {
    name: "list_automation_options",
    description: "List the exact trigger ids and action ids available for create_automation, and which actions run for real versus needing an integration.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "test_automation",
    description:
      "Fire a workflow once with sample data so the user can see what it does. Reports the real result of every step, including steps that were skipped because an integration isn't connected.",
    input_schema: {
      type: "object",
      properties: { workflowId: { type: "string", description: "The workflow id" } },
      required: ["workflowId"],
    },
  },

  // ---- building things: the customer's website ----
  {
    name: "get_website",
    description: "Check the state of the business's website — whether it's an external site we only link to, a site you built (which you can edit), or nothing yet.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "build_website",
    description:
      "Write a complete one-page website for this business and publish it. YOU write the full HTML yourself: a single self-contained file with inline <style>, no external files, no frameworks, no placeholder lorem ipsum. Use the real business profile and knowledge base. Make it genuinely attractive — a hero, what they do, why choose them, and contact details. This replaces the current built site (the previous version is kept and can be restored).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Page title" },
        html: { type: "string", description: "The complete HTML document, inline CSS included" },
        note: { type: "string", description: "One line on what this version is, e.g. 'first draft' or 'warmer colours'" },
      },
      required: ["title", "html"],
    },
  },
  {
    name: "edit_website",
    description:
      "Change the site you built. Pass the FULL new HTML (read it first with get_website_html, make your changes, send the whole document back). Only works on a site HarperLinks built — we can't edit someone else's hosted site without their CMS access.",
    input_schema: {
      type: "object",
      properties: {
        html: { type: "string", description: "The complete updated HTML document" },
        note: { type: "string", description: "What you changed, in one line" },
      },
      required: ["html", "note"],
    },
  },
  {
    name: "publish_website",
    description:
      "Publish the draft website to its public address. This runs the full security scan first and REFUSES if any security check fails — report the failures honestly and fix them with edit_website before trying again.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_website_html",
    description: "Read the current HTML of the site you built, so you can edit it precisely.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "generate_image",
    description:
      "REALLY design and render a branded social media image (PNG) — gradient/clean/dark layout with the business name, your headline and sub-line. Use for 'make me an image/graphic/post picture'. Optionally attach it straight onto an existing post with attach_to.",
    input_schema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "The big text on the image — short and punchy, under 12 words" },
        sub: { type: "string", description: "Smaller supporting line (optional)" },
        style: { type: "string", enum: ["bold", "clean", "dark"], description: "bold = brand gradient, clean = white, dark = charcoal" },
        format: { type: "string", enum: ["square", "story", "wide"], description: "square = feed, story = Stories/Reels/TikTok, wide = YouTube/link cards" },
        attach_to: { type: "string", description: "Optional post id — attaches the image to that post" },
      },
      required: ["headline"],
    },
  },
  {
    name: "generate_video",
    description:
      "REALLY produce an MP4 slideshow video (30fps, zoom + crossfades) from 2-8 branded slides you write. Use for 'make me a video/reel/TikTok'. Each slide: a headline + optional sub-line. Optionally attach to a post with attach_to.",
    input_schema: {
      type: "object",
      properties: {
        slides: {
          type: "array",
          description: "2-8 slides in order",
          items: {
            type: "object",
            properties: {
              headline: { type: "string", description: "Big text for this slide" },
              sub: { type: "string", description: "Smaller line (optional)" },
            },
            required: ["headline"],
          },
        },
        style: { type: "string", enum: ["bold", "clean", "dark"] },
        format: { type: "string", enum: ["story", "square", "wide"], description: "story (9:16) is right for Reels/TikTok" },
        attach_to: { type: "string", description: "Optional post id — attaches the video to that post" },
      },
      required: ["slides"],
    },
  },
  {
    name: "manage_employee",
    description:
      "Activate, pause, or change the operating mode of an AI employee. Employee ids: social (Sage, Social Media Manager), support (Riley, Customer Support), receptionist (Harper), sales (Flynn), web (Indi, Website Builder), manager (Darcy, Business Manager). Modes: assisted, supervised, autonomous.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Employee id, e.g. 'content' or 'manager'" },
        enabled: { type: "boolean", description: "true to activate, false to pause" },
        mode: { type: "string", enum: ["assisted", "supervised", "autonomous"] },
      },
      required: ["id"],
    },
  },
  {
    name: "get_usage",
    description: "Check this month's AI usage budget — cap, spent, remaining. Use when the user asks about usage, limits, or costs.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_tasks",
    description: "List the user's open tasks and reminders.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "complete_task",
    description: "Mark a task as done. Pass the task id from list_tasks, or part of its wording.",
    input_schema: {
      type: "object",
      properties: { task: { type: "string", description: "Task id or a distinctive part of its text" } },
      required: ["task"],
    },
  },
];

// ---- handlers ---------------------------------------------------------------
function makeHandlers(base = dt.now()) {
  return {
    async ingest_website(input) {
      try {
        const profile = await ingestWebsite(input.url);
        return {
          ok: true,
          content: `Learned the business: ${profile.name} (${profile.businessType}). Tagline: "${profile.tagline}". Services: ${(profile.services || []).join("; ") || "none found"}. Tone: ${profile.tone}.`,
          action: { type: "profile", profile },
        };
      } catch (e) {
        return { ok: false, content: `Ingest failed: ${e.message}` };
      }
    },

    get_business_profile() {
      const p = store.getProfile();
      if (!p.configured) return { ok: true, content: "No business profile yet — ask the user for their website URL and call ingest_website." };
      return { ok: true, content: JSON.stringify(p) };
    },

    // ---- automations ----
    list_automation_options() {
      const events = require("./events");
      return {
        ok: true,
        content:
          "TRIGGERS: " + events.TRIGGERS.map((t) => `${t.id} (${t.label})`).join("; ") +
          "\nACTIONS: " + events.ACTIONS.map((a) => `${a.id} (${a.label})${a.local ? " [runs for real]" : ` [needs ${a.needs}]`}`).join("; ") +
          "\nCONNECTORS (for send_webhook — set connectorId on the action): " +
          (require("./connectors").listPublic().map((c) => `${c.id} (${c.name})`).join("; ") || "none added yet"),
      };
    },

    list_automations() {
      const wfs = store.getCol("workflows");
      if (!wfs.length) return { ok: true, content: "No automations yet." };
      return {
        ok: true,
        content: wfs.map((w) =>
          `[${w.id}] "${w.name}" — when ${w.trigger} → ${w.actions.map((a) => a.type).join(" → ")} · ${w.enabled ? "ON" : "OFF"} · ${(w.runs || []).length} run(s)`
        ).join("\n"),
      };
    },

    create_automation(input) {
      const events = require("./events");
      const validTrigger = events.TRIGGERS.some((t) => t.id === input.trigger);
      if (!validTrigger) {
        return { ok: false, content: `"${input.trigger}" isn't a real trigger. Call list_automation_options first.` };
      }
      const actions = (input.actions || []).filter((a) => a && a.type);
      const bad = actions.find((a) => !events.ACTIONS.some((x) => x.id === a.type));
      if (!actions.length) return { ok: false, content: "A workflow needs at least one action." };
      if (bad) return { ok: false, content: `"${bad.type}" isn't a real action. Call list_automation_options first.` };

      const wfs = store.getCol("workflows");
      const record = {
        id: store.newId("wf"),
        name: String(input.name).trim().slice(0, 80),
        trigger: input.trigger,
        actions: actions.map((a) => ({ type: a.type, note: a.note || undefined })),
        enabled: true,
        runs: [],
        createdAt: new Date().toISOString(),
      };
      wfs.push(record);
      store.saveCol("workflows", wfs);
      store.logActivity("automation", `Workflow created by your AI team: "${record.name}"`);
      const needs = actions
        .map((a) => events.ACTIONS.find((x) => x.id === a.type))
        .filter((a) => a && !a.local)
        .map((a) => a.needs);
      return {
        ok: true,
        content: `Created [${record.id}] "${record.name}" and switched it on.` +
          (needs.length ? ` Heads up: ${[...new Set(needs)].join(" and ")} isn't connected, so those steps will skip with a logged reason until it is.` : ""),
        action: { type: "automation", record },
      };
    },

    async test_automation(input) {
      const events = require("./events");
      const wfs = store.getCol("workflows");
      const wf = wfs.find((w) => w.id === input.workflowId);
      if (!wf) return { ok: false, content: "No workflow with that id — call list_automations." };

      const before = (store.getCol("workflows").find((w) => w.id === wf.id) || {}).runs || [];
      const leads = store.getCol("leads");
      const payload = { leadId: leads.length ? leads[leads.length - 1].id : null, summary: "test run from your AI team" };

      const wasEnabled = wf.enabled;
      wf.enabled = true;
      store.saveCol("workflows", wfs);
      await events.emit(wf.trigger, payload);

      const after = store.getCol("workflows");
      const updated = after.find((w) => w.id === wf.id);
      updated.enabled = wasEnabled;
      store.saveCol("workflows", after);

      const runs = updated.runs || [];
      const fresh = runs.slice(before.length);
      if (!fresh.length) return { ok: true, content: "Fired it, but nothing was recorded — the trigger may need real data (e.g. an actual lead) to do anything." };
      const last = fresh[fresh.length - 1];
      // events.js records each step as { action, ok, error }
      const steps = (last.results || []).map((st) => `${st.action}: ${st.ok ? "ran" : "did not run"}${st.error ? ` — ${st.error}` : ""}`);
      return {
        ok: true,
        content: `Test fired "${updated.name}". ${steps.length ? steps.join(" | ") : "No steps recorded."}`,
        action: { type: "automation", record: updated },
      };
    },

    // ---- website ----
    get_website() {
      const website = require("./website");
      const w = website.get();
      if (w.mode === "external") return { ok: true, content: `They already have a site at ${w.externalUrl}. We can show it in a preview but can't edit it without their CMS access — offer to build a new HarperLinks page instead, or to write copy they can paste in.` };
      if (w.mode === "built") return { ok: true, content: `A HarperLinks-built site exists ("${w.title}"), last updated ${w.updatedAt}. You can edit it with edit_website. ${w.versions.length} earlier version(s) saved.` };
      return { ok: true, content: "No website yet. Offer to build one — you write the whole page." };
    },

    publish_website() {
      const website = require("./website");
      try {
        const out = website.publish();
        const r = out.report;
        return {
          ok: true,
          content: `Published — the page passed all ${r.checks.length - r.qualFails} blocking checks (overall score ${r.score}%).` +
            (r.qualFails ? ` ${r.qualFails} quality suggestion(s) remain: ` + r.checks.filter(c => !c.ok).map(c => c.label).join("; ") : " Every check passed."),
          action: { type: "website", record: { published: true } },
        };
      } catch (e) {
        let detail = "";
        try {
          const rep = website.scan();
          detail = rep.checks.filter(c => c.kind === "security" && !c.ok).map(c => `${c.label}: ${c.detail}`).join(" | ");
        } catch (_) { /* no draft */ }
        return { ok: false, content: `Couldn't publish — ${e.message}${detail ? " Details: " + detail : ""}` };
      }
    },

    get_website_html() {
      const website = require("./website");
      const w = website.get();
      if (w.mode !== "built" || !w.html) return { ok: false, content: "There's no HarperLinks-built site to read yet." };
      return { ok: true, content: w.html };
    },

    build_website(input) {
      const website = require("./website");
      try {
        const out = website.saveHtml(input.html, { title: input.title, note: input.note || "first draft" });
        return {
          ok: true,
          content: `Saved "${input.title}" as a draft. The preview on the Website page shows it now; it is NOT live yet — run publish_website (it security-scans first), or the owner can hit Publish on the Website page.`,
          action: { type: "website", record: { title: out.title, updatedAt: out.updatedAt, note: input.note || "first draft" } },
        };
      } catch (e) {
        return { ok: false, content: `Couldn't publish that page — ${e.message}` };
      }
    },

    edit_website(input) {
      const website = require("./website");
      const current = website.get();
      if (current.mode !== "built") {
        return { ok: false, content: "There's no HarperLinks-built site to edit. Use build_website to create one, or tell the user we can't edit an externally hosted site without CMS access." };
      }
      try {
        const out = website.saveHtml(input.html, { title: current.title, note: input.note });
        return {
          ok: true,
          content: `Saved the edit as a draft — ${input.note}. The Website page preview shows it; publish_website makes it live after the security scan passes.`,
          action: { type: "website", record: { title: out.title, updatedAt: out.updatedAt, note: input.note } },
        };
      } catch (e) {
        return { ok: false, content: `Couldn't save that edit — ${e.message}` };
      }
    },

    create_post(input) {
      if (!PLATFORMS.includes(input.platform)) {
        return { ok: false, content: `Unknown platform "${input.platform}". Use one of: ${PLATFORMS.join(", ")}.` };
      }
      if (!input.content || !input.content.trim()) {
        return { ok: false, content: "Post content is empty." };
      }
      const posts = store.getPosts();
      const idx = Number.isInteger(input.batchIndex) ? input.batchIndex : 0;
      let scheduledAt = null;
      let heldForApproval = false;
      if (input.scheduledFor) {
        const when = resolveWhen(input.scheduledFor, base, idx);
        if (!when) return { ok: false, content: `Couldn't understand the time "${input.scheduledFor}". Ask the user for a clearer time.` };
        if (when <= base) return { ok: false, content: `"${input.scheduledFor}" works out to a time that's already passed. Pick a future time.` };
        // Sage's operating mode is real: in Assisted mode nothing self-schedules —
        // content lands as a draft for the owner to approve.
        const sage = employees.getState("social");
        if (sage.mode === "assisted") {
          heldForApproval = true;
        } else {
          scheduledAt = when.toISOString();
        }
      }
      const record = {
        id: store.newPostId(),
        platform: input.platform,
        content: input.content.trim(),
        hashtags: Array.isArray(input.hashtags) ? input.hashtags.map((h) => h.replace(/^#/, "")) : [],
        isVideo: !!input.isVideo,
        status: scheduledAt ? "scheduled" : "draft",
        scheduledAt,
        createdAt: new Date().toISOString(),
        publishedAt: null,
        simulated: true,
        createdBy: "chat",
      };
      posts.push(record);
      store.savePosts(posts);
      store.logActivity(
        scheduledAt ? "scheduled" : "created",
        scheduledAt ? `Scheduled ${record.platform} post for ${formatWhen(scheduledAt)}`
          : heldForApproval ? `Drafted a ${record.platform} post (held for approval — Sage is in Assisted mode)`
          : `Drafted a ${record.platform} post`,
        record.id
      );
      return {
        ok: true,
        content: heldForApproval
          ? `Saved ${record.id} as a DRAFT — Sage is in Assisted mode, so scheduling needs the owner's approval. Tell the user it's held for their sign-off (they can approve in the queue, or switch Sage to Supervised/Autonomous).`
          : `Saved ${record.id} (${record.platform}, ${record.status}${scheduledAt ? ", " + formatWhen(scheduledAt) : ""}).`,
        action: { type: "post", record, heldForApproval },
      };
    },

    schedule_post(input) {
      const posts = store.getPosts();
      const post = findPost(posts, input.postId);
      if (!post) return { ok: false, content: `No post found with id "${input.postId}".` };
      const when = resolveWhen(input.when, base, Number.isInteger(input.batchIndex) ? input.batchIndex : 0);
      if (!when) return { ok: false, content: `Couldn't understand the time "${input.when}".` };
      if (when <= base) return { ok: false, content: `"${input.when}" is in the past. Pick a future time.` };
      post.scheduledAt = when.toISOString();
      post.status = "scheduled";
      store.savePosts(posts);
      store.logActivity("scheduled", `Scheduled ${post.platform} post for ${formatWhen(post.scheduledAt)}`, post.id);
      return { ok: true, content: `Scheduled ${post.id} for ${formatWhen(post.scheduledAt)}.`, action: { type: "post", record: post } };
    },

    list_scheduled_posts(input) {
      let posts = store.getPosts();
      if (input && input.status) posts = posts.filter((p) => p.status === input.status);
      if (!posts.length) return { ok: true, content: "No posts match." };
      return { ok: true, content: posts.map(describePost).join("\n") };
    },

    add_task(input) {
      if (!input.what || !input.what.trim()) return { ok: false, content: "What's the task?" };
      const tasks = store.getCol("tasks");
      let dueAt = null;
      if (input.when) {
        const when = resolveWhen(input.when, base);
        if (when && when > base) dueAt = when.toISOString();
      }
      const record = {
        id: store.newId("task"),
        what: input.what.trim().replace(/[.?!]$/, ""),
        dueAt,
        status: "open",
        createdAt: new Date().toISOString(),
      };
      tasks.push(record);
      store.saveCol("tasks", tasks);
      store.logActivity("task", `Task added: ${record.what}${dueAt ? ` (due ${formatWhen(dueAt)})` : ""}`, record.id);
      return { ok: true, content: `Task saved: "${record.what}"${dueAt ? ` due ${formatWhen(dueAt)}` : ""}.`, action: { type: "task", record } };
    },

    get_knowledge() {
      return { ok: true, content: JSON.stringify(store.getKnowledge()) };
    },

    async generate_image(input) {
      try {
        const img = await media.generateImage(input);
        let attached = "";
        if (input.attach_to) {
          const posts = store.getPosts();
          const post = findPost(posts, input.attach_to);
          if (post) {
            post.mediaId = img.id; post.mediaFile = img.file;
            if (process.env.PUBLIC_BASE_URL) post.mediaUrl = `${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/media/${require("./tenant").current()}/${img.file}`;
            store.savePosts(posts);
            attached = ` Attached to post ${post.id} — it'll upload with the post when it publishes.`;
          } else attached = ` (couldn't find post "${input.attach_to}" to attach it to)`;
        }
        return { ok: true, content: `Image rendered: ${img.format} ${img.w}x${img.h}, "${img.headline}".${attached} The owner can see it on the Social page.`, action: { type: "media", media: img } };
      } catch (e) {
        return { ok: false, content: `Image generation failed: ${e.message}` };
      }
    },

    async generate_video(input) {
      try {
        const vid = await media.generateVideo(input);
        let attached = "";
        if (input.attach_to) {
          const posts = store.getPosts();
          const post = findPost(posts, input.attach_to);
          if (post) {
            post.mediaId = vid.id; post.mediaFile = vid.file; post.isVideo = true;
            if (process.env.PUBLIC_BASE_URL) post.mediaUrl = `${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/media/${require("./tenant").current()}/${vid.file}`;
            store.savePosts(posts);
            attached = ` Attached to post ${post.id}.`;
          } else attached = ` (couldn't find post "${input.attach_to}" to attach it to)`;
        }
        return { ok: true, content: `Video produced: ${vid.seconds}s, ${vid.slides} slides, ${vid.format} ${vid.w}x${vid.h}.${attached} The owner can watch it on the Social page.`, action: { type: "media", media: vid } };
      } catch (e) {
        return { ok: false, content: `Video generation failed: ${e.message}` };
      }
    },

    manage_employee(input) {
      const patch = {};
      if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
      if (input.mode) patch.mode = input.mode;
      if (!Object.keys(patch).length) return { ok: false, content: "Say what to change: enabled true/false and/or a mode." };
      const emp = employees.updateEmployee(input.id, patch);
      if (!emp) {
        const ids = employees.getEmployees().map((e) => `${e.id} (${e.name}, ${e.role})`).join(", ");
        return { ok: false, content: `No employee called "${input.id}". The team: ${ids}.` };
      }
      return {
        ok: true,
        content: `${emp.name} (${emp.role}) is now ${emp.enabled ? "active" : "paused"} in ${emp.mode} mode.`,
        action: { type: "employee", employee: { id: emp.id, name: emp.name, enabled: emp.enabled, mode: emp.mode } },
      };
    },

    get_usage() {
      const s = budget.status();
      return {
        ok: true,
        content: `Usage for ${s.month}: A$${s.spent.toFixed(2)} spent of the A$${s.cap.toFixed(2)} monthly cap — A$${s.remaining.toFixed(2)} left (${s.percent}%).${s.exhausted ? " The cap is exhausted; raise it in Settings to keep going." : ""}`,
      };
    },

    list_tasks() {
      const open = store.getCol("tasks").filter((t) => t.status === "open");
      if (!open.length) return { ok: true, content: "No open tasks — all clear." };
      return {
        ok: true,
        content: open.map((t) => `${t.id}: ${t.what}${t.dueAt ? ` (due ${formatWhen(t.dueAt)})` : ""}`).join("\n"),
      };
    },

    complete_task(input) {
      const tasks = store.getCol("tasks");
      const q = String(input.task || "").toLowerCase().trim();
      if (!q) return { ok: false, content: "Which task?" };
      const t = tasks.find((x) => x.status === "open" && (x.id === input.task || x.what.toLowerCase().includes(q)));
      if (!t) return { ok: false, content: `Couldn't find an open task matching "${input.task}". Use list_tasks to see them.` };
      t.status = "done";
      t.completedAt = new Date().toISOString();
      store.saveCol("tasks", tasks);
      store.logActivity("task", `Task completed: ${t.what}`, t.id);
      return { ok: true, content: `Done: "${t.what}" ticked off.`, action: { type: "task", record: t } };
    },

    create_lead(input) {
      if (!input.name || !input.name.trim()) return { ok: false, content: "A lead needs at least a name." };
      const leads = store.getCol("leads");
      const record = {
        id: store.newId("lead"),
        name: input.name.trim(),
        phone: input.phone || "",
        email: input.email || "",
        interest: input.interest || "",
        source: input.source || "chat",
        status: "new",
        score: 50,
        tags: [],
        notes: [],
        followUps: [],
        createdAt: new Date().toISOString(),
      };
      leads.push(record);
      store.saveCol("leads", leads);
      store.logActivity("lead", `New lead captured: ${record.name}${record.interest ? ` — ${record.interest}` : ""}`, record.id);
      events.emit("lead.created", { leadId: record.id, summary: record.interest || record.name });
      return { ok: true, content: `Lead saved: ${record.name} (${record.id}).`, action: { type: "lead", record } };
    },

    book_appointment(input) {
      const when = resolveWhen(input.when, base);
      if (!when) return { ok: false, content: `Couldn't understand the time "${input.when}".` };
      if (when <= base) return { ok: false, content: `"${input.when}" is in the past. Pick a future time.` };
      const duration = input.durationMinutes || 60;
      const appts = store.getCol("appointments");
      const start = when.getTime(), end = start + duration * 60e3;
      const clash = appts.find((a) => {
        if (a.status === "cancelled") return false;
        const s = new Date(a.startsAt).getTime(), e = s + (a.durationMinutes || 60) * 60e3;
        return s < end && e > start;
      });
      if (clash) {
        return { ok: false, content: `That time clashes with an existing booking (${clash.customer_name}, ${formatWhen(clash.startsAt)}). Offer a different time — do NOT confirm this one.` };
      }
      const record = {
        id: store.newId("appt"),
        customer_name: input.customer_name,
        phone: input.phone || "",
        service: input.service,
        startsAt: when.toISOString(),
        durationMinutes: duration,
        status: "booked",
        createdAt: new Date().toISOString(),
        createdBy: "chat",
      };
      appts.push(record);
      store.saveCol("appointments", appts);
      store.logActivity("appointment", `Appointment booked: ${record.customer_name} — ${record.service}, ${formatWhen(record.startsAt)}`, record.id);
      events.emit("appointment.booked", { appointmentId: record.id, summary: `${record.service} for ${record.customer_name}` });
      return { ok: true, content: `Booked ${record.customer_name} — ${record.service} on ${formatWhen(record.startsAt)} (${record.id}).`, action: { type: "appointment", record } };
    },

    update_post(input) {
      const posts = store.getPosts();
      const post = findPost(posts, input.postId);
      if (!post) return { ok: false, content: `No post found with id "${input.postId}".` };
      if (input.cancel) {
        post.status = "cancelled";
        store.savePosts(posts);
        store.logActivity("cancelled", `Cancelled a ${post.platform} post`, post.id);
        return { ok: true, content: `Cancelled ${post.id}.`, action: { type: "post", record: post } };
      }
      if (input.content) post.content = input.content.trim();
      if (input.when) {
        const when = resolveWhen(input.when, base);
        if (!when) return { ok: false, content: `Couldn't understand the time "${input.when}".` };
        if (when <= base) return { ok: false, content: `"${input.when}" is in the past.` };
        post.scheduledAt = when.toISOString();
        post.status = "scheduled";
      }
      store.savePosts(posts);
      store.logActivity("updated", `Updated a ${post.platform} post`, post.id);
      return { ok: true, content: `Updated ${post.id}: ${describePost(post)}`, action: { type: "post", record: post } };
    },
  };
}

module.exports = { toolSchemas, makeHandlers, resolveWhen, findPost, formatWhen, PLATFORMS };
