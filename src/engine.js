// The engine: turns a chat message into work (posts, schedules, ingests).
// Two modes, chosen automatically:
//   LIVE — ANTHROPIC_API_KEY set: real Claude with a manual tool-use loop.
//   DEMO — no key: a keyword brain that runs the SAME tools, so the whole
//          pipeline (ingest → write → schedule → publish) works keyless.

const { toolSchemas, makeHandlers, PLATFORMS } = require("./tools");
const { buildSystemPrompt } = require("./prompt");
const store = require("./store");
const dt = require("./datetime");

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || process.env.MODEL || "claude-opus-4-8";
const EFFORT = process.env.EFFORT || "low";

let anthropic = null;
if (HAS_KEY) {
  const Anthropic = require("@anthropic-ai/sdk");
  anthropic = new Anthropic();
}

function mode() {
  return HAS_KEY ? "live" : "demo";
}

// Cap history without orphaning a tool_result from its tool_use.
function trimHistory(history, max = 24) {
  if (history.length <= max) return history;
  let start = history.length - max;
  while (start < history.length && !(history[start].role === "user" && typeof history[start].content === "string")) start++;
  if (start < history.length) history.splice(0, start);
  return history;
}

// ---- LIVE ------------------------------------------------------------------

async function respondLive(session, userMessage, employeeId) {
  const base = dt.now();
  const handlers = makeHandlers(base);
  let system = buildSystemPrompt(store.getProfile(), base);
  if (employeeId) {
    const emp = require("./employees").getState(employeeId);
    if (emp.role) system = `Right now the owner is talking to ${emp.name}, their ${emp.role} — answer in that role and lead with that specialty, while still able to use any tool.\n\n` + system;
  }

  session.history.push({ role: "user", content: userMessage });
  trimHistory(session.history);
  const actions = [];
  const steps = [];

  for (let i = 0; i < 10; i++) {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: EFFORT },
      system,
      tools: toolSchemas,
      messages: session.history,
    });

    session.history.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason === "tool_use") {
      const results = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        const handler = handlers[block.name];
        const out = handler ? await handler(block.input) : { ok: false, content: "Tool not found." };
        steps.push({ tool: block.name, ok: out.ok !== false });
        if (out.action) actions.push(out.action);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: out.content,
          is_error: out.ok === false,
        });
      }
      session.history.push({ role: "user", content: results });
      continue;
    }

    const reply = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return { reply, actions, steps };
  }

  return { reply: "That turned into a bigger job than expected — could you say it again, maybe in smaller steps?", actions, steps };
}

// ---- DEMO ------------------------------------------------------------------

const URL_RE = /\b((?:https?:\/\/)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/[^\s"']*)?)/i;
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function wantCount(text) {
  const digit = text.match(/\b(\d{1,2})\s*(posts?|captions?|pieces)\b/);
  if (digit) return Math.min(10, parseInt(digit[1], 10));
  const word = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*(posts?|captions?)\b/);
  if (word) return NUM_WORDS[word[1]];
  return /\bposts\b/.test(text) ? 3 : 1;
}

// Templated-but-plausible captions from the profile, so DEMO feels real.
function demoCaption(profile, platform, i) {
  const name = profile.name;
  const service = (profile.services || [])[i % Math.max(1, (profile.services || []).length)] || profile.tagline || "what we do";
  const tags = (profile.keywords || []).slice(0, platform === "facebook" ? 2 : 5).map((k) => k.replace(/\s+/g, ""));
  const shapes = [
    `${service} — it's what we do best at ${name}. Come see for yourself.`,
    `Did you know? ${profile.tagline || `${name} has you covered.`} Drop in or message us today.`,
    `Behind the scenes at ${name}: ${service}. This is why people keep coming back.`,
    `Your week just got easier — ${name} takes care of ${String(service).toLowerCase()}. Book today!`,
    `We love what we do at ${name}. ${service}. Tell us what you'd like to see next.`,
  ];
  return { content: shapes[i % shapes.length], hashtags: tags };
}

async function respondDemo(session, userMessage) {
  const base = dt.now();
  const handlers = makeHandlers(base);
  const text = userMessage.toLowerCase();
  const actions = [];
  const steps = [];
  const say = (reply) => ({ reply, actions, steps });
  const run = async (name, input) => {
    const out = await handlers[name](input);
    steps.push({ tool: name, ok: out.ok !== false });
    if (out.action) actions.push(out.action);
    return out;
  };

  // 1) A URL anywhere → ingest it
  const url = userMessage.match(URL_RE);
  if (url && !/\b(what|how|why)\b.*\?/.test(text)) {
    const out = await run("ingest_website", { url: url[1] });
    if (!out.ok) return say(`Hmm — ${out.content.replace(/^Ingest failed: /, "")} Double-check the address and try again?`);
    const p = store.getProfile();
    return say(`Got it! I've learned ${p.name} — ${p.tagline ? `"${p.tagline}"` : p.businessType}. Now ask me to write some posts and I'll do them in your voice.`);
  }

  // 2a) video request → write a real script, honest about rendering
  if (/\b(video|reel|clip)s?\b/.test(text) && /\b(make|create|generate|write|do|film)\b/.test(text)) {
    const profile = store.getProfile();
    if (!profile.configured) {
      return say(`I can script that — but first let me learn your business. What's your website address?`);
    }
    const service = (profile.services || [])[0] || profile.tagline || "what you do";
    const script =
      `VIDEO SCRIPT — ${profile.name}\n` +
      `HOOK (0-3s): "Stop scrolling — this is how ${profile.name} does ${String(service).toLowerCase().slice(0, 40)}."\n` +
      `SHOT 1: Quick cuts of the work happening, upbeat track.\n` +
      `SHOT 2: One real result or happy customer moment.\n` +
      `SHOT 3: You to camera: "${profile.tagline || "Here's why people choose us."}"\n` +
      `CTA: "DM us or hit the link — ${profile.name}."`;
    const timing = /\b(next week|this week|tomorrow|today|in \d+ (minutes?|mins?|hours?)|at \d)/.test(text) ? userMessage : null;
    const out = await run("create_post", {
      platform: "tiktok", content: script, hashtags: (profile.keywords || []).slice(0, 4),
      scheduledFor: timing || undefined, isVideo: true,
    });
    if (!out.ok) return say(`Couldn't save the video draft — ${out.content}`);
    return say(`Done — I've written the video script and shot list${timing ? " and scheduled it" : ""}. Rendering the actual footage needs a video AI connection (Integrations → Video AI), so for now you or your phone camera are the film crew — the script makes it a 10-minute job.`);
  }

  // 2b) reminders / tasks
  if (/\bremind me\b|\badd (a )?task\b|\bto-?do\b|\bdon'?t let me forget\b/.test(text)) {
    const what = userMessage.replace(/^.*?\b(remind me to|remind me|add a task to|add a task|to-do:?|don'?t let me forget to)\b/i, "").trim() || userMessage;
    const out = await run("add_task", { what, when: userMessage });
    if (!out.ok) return say(out.content);
    return say(`Got it — task added${out.action && out.action.record.dueAt ? " for " + new Date(out.action.record.dueAt).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}. It'll pop up in your activity feed when it's due.`);
  }

  // 2c) "what's my day / what's on"
  if (/\bwhat'?s? (my|on|happening|the plan|my day|today|tomorrow)\b|\bmy (day|schedule|week)\b/.test(text) && !/\bgoing out\b/.test(text)) {
    const appts = store.getCol("appointments").filter((a) => a.status === "booked" && new Date(a.startsAt) > base)
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)).slice(0, 4);
    const posts = store.getPosts().filter((p) => p.status === "scheduled").slice(0, 4);
    const tasks = store.getCol("tasks").filter((t) => t.status === "open").slice(0, 4);
    if (!appts.length && !posts.length && !tasks.length) {
      return say(`Clean slate — nothing booked, queued or due. Want me to write some content or line up your week?`);
    }
    const bits = [];
    if (appts.length) bits.push("Appointments: " + appts.map((a) => `${a.customer_name} (${a.service}) ${new Date(a.startsAt).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" })}`).join("; "));
    if (posts.length) bits.push(`Content: ${posts.length} post${posts.length > 1 ? "s" : ""} queued to publish`);
    if (tasks.length) bits.push("Tasks: " + tasks.map((t) => t.what).join("; "));
    return say(`Here's what's coming up:\n${bits.join("\n")}`);
  }

  // 2) "write/make/create N posts" → generate from the profile
  if (/\b(write|make|create|generate|draft|do)\b.*\b(post|caption|content)/.test(text) || /\bposts?\b.*\b(for|about)\b/.test(text)) {
    const profile = store.getProfile();
    if (!profile.configured) {
      return say(`First let me learn your business — what's your website address? Paste it here or use the Ingest box on the right.`);
    }
    const n = wantCount(text);
    const timing = /\b(next week|this week|tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in \d+ (minutes?|mins?|hours?|hrs?)|at \d)/.test(text)
      ? userMessage : null;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const platform = PLATFORMS[i % PLATFORMS.length];
      const cap = demoCaption(profile, platform, i);
      const out = await run("create_post", {
        platform, content: cap.content, hashtags: cap.hashtags,
        scheduledFor: timing || undefined, batchIndex: i,
      });
      if (out.ok) made++;
    }
    if (!made) return say(`I couldn't save those posts — try again?`);
    const held = actions.some((a) => a.heldForApproval);
    if (timing && held) {
      return say(`Done — ${made} post${made > 1 ? "s" : ""} written for ${profile.name} and held as drafts for your approval, since Sage is in Assisted mode. Approve them in the queue, or switch Sage to Supervised/Autonomous in AI Employees and I'll schedule straight in.`);
    }
    return say(timing
      ? `Done! I've written ${made} post${made > 1 ? "s" : ""} for ${profile.name} and scheduled them — check the calendar on the right.`
      : `Done! ${made} post${made > 1 ? "s" : ""} drafted for ${profile.name}. Say "schedule them for next week" and I'll spread them out for you.`);
  }

  // 3) "schedule ..." → schedule drafts (or everything mentioned)
  if (/\bschedule|queue|line (them |these )?up\b/.test(text)) {
    const posts = store.getPosts();
    const drafts = posts.filter((p) => p.status === "draft");
    if (!drafts.length) {
      const scheduled = posts.filter((p) => p.status === "scheduled");
      if (scheduled.length) return say(`Everything's already scheduled — ${scheduled.length} post${scheduled.length > 1 ? "s" : ""} in the queue. Want more content first?`);
      return say(`There's nothing to schedule yet — ask me to write some posts first!`);
    }
    const phrase = whenPhrase(userMessage) || "next week";
    let count = 0;
    for (let i = 0; i < drafts.length; i++) {
      const out = await run("schedule_post", { postId: drafts[i].id, when: phrase, batchIndex: i });
      if (out.ok) count++;
    }
    return say(`Scheduled ${count} post${count > 1 ? "s" : ""} — they're on the calendar now and will go out automatically.`);
  }

  // 4) "what's going out / scheduled"
  if (/\bwhat'?s? (going out|coming up|scheduled|in the queue|next)\b|\bshow me\b.*\b(queue|calendar|posts)\b/.test(text)) {
    const out = await run("list_scheduled_posts", { status: "scheduled" });
    if (out.content === "No posts match.") return say(`Nothing's scheduled yet. Ask me to write and schedule some posts — e.g. "write 5 posts for next week".`);
    return say(`Here's what's lined up:\n${out.content}`);
  }

  // 5) small talk / help
  if (/\b(hi|hello|hey|g'day|yo)\b/.test(text) && userMessage.length < 25) {
    return say(`G'day! Paste your website address and I'll learn your business, or ask me to write some posts.`);
  }
  if (/\b(thank|cheers|legend|awesome|perfect)\b/.test(text)) {
    return say(`Anytime! Want me to line up more content?`);
  }
  if (/\b(really post|actually post|live|for real|connected)\b/.test(text)) {
    return say(`Straight answer: the pipeline schedules and fires posts on time, but live connections to Instagram/Facebook/TikTok are still rolling out — right now publishes run in preview mode and show up in the activity log.`);
  }

  return say(`I can learn your website, write posts in your brand voice, and schedule them. Try: "Ingest mysite.com", "write 5 posts for next week", or "what's going out this week?"`);
}

// Pull the timing phrase out of a message for schedule_post's parser.
function whenPhrase(message) {
  const m = message.match(/\b(next week|this week|tomorrow( at [\w: ]+)?|today( at [\w: ]+)?|in \d+ (minutes?|mins?|hours?|hrs?)|(mon|tues|wednes|thurs|fri|satur|sun)day( at [\w: ]+| morning| afternoon| evening)?|at \d[\w: ]*(am|pm)?)\b/i);
  return m ? m[0] : null;
}

async function respond(session, userMessage, employeeId) {
  if (HAS_KEY) return respondLive(session, userMessage, employeeId);
  return respondDemo(session, userMessage);
}

module.exports = { respond, mode, MODEL };
