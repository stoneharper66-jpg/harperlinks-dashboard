// Tool definitions for the content bot, plus the handlers that do the work.
// Handlers may be async (ingest_website fetches the web). Each returns
// { ok, content, action? } — content goes back to Claude, action drives the UI.

const dt = require("./datetime");
const store = require("./store");
const events = require("./events");
const employees = require("./employees");
const { ingestWebsite } = require("./ingest");

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
        isVideo: { type: "boolean", description: "True when the content is a video script/shot list rather than a text caption. Video RENDERING needs a video AI integration — write the full script yourself and be honest that footage isn't auto-generated yet." },
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
