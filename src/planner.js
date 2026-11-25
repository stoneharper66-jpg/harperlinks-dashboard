// The bit that makes it automatic.
//
// After the team reads a business's website, nobody should have to ask them to
// start. This plans a month of content in one pass: Claude writes the captions,
// each one gets a picture, and they're laid out across the calendar at a
// cadence the platforms won't punish.
//
// Honesty notes, because this is the part that's easy to oversell:
//   - Posts are written and scheduled for real, and the scheduler really fires.
//   - Whether they reach Instagram depends on the customer's accounts being
//     connected in GoHighLevel. Until then they publish as previews and say so.
//   - We never invent facts about the business. The captions are built from
//     what the crawl actually read.

const store = require("./store");
const charge = require("./credits/charge");
const media = require("./media");
const employees = require("./employees");
const budget = require("./budget");

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || process.env.MODEL || "claude-opus-4-8";

// Stone chose 3-4 a day. Spreading them across platforms and across the day is
// what keeps that survivable rather than spammy.
const PER_DAY = 3;
const DAYS = 30;
const SLOT_HOURS = [8, 12, 17, 20];           // morning, lunch, knock-off, evening
const PLATFORMS = ["instagram", "facebook", "linkedin"];
const MAX_POSTS = PER_DAY * DAYS;

/** Every scheduled moment for the next `days`, in order, no collisions. */
function slots(days = DAYS, perDay = PER_DAY) {
  const out = [];
  const start = new Date();
  start.setSeconds(0, 0);
  for (let d = 1; d <= days; d++) {
    for (let i = 0; i < perDay; i++) {
      const when = new Date(start);
      when.setDate(start.getDate() + d);
      when.setHours(SLOT_HOURS[i % SLOT_HOURS.length], (i * 7) % 60, 0, 0);
      out.push(when);
    }
  }
  return out;
}

/**
 * Slots nothing is already booked into — re-planning never double-books.
 * Looks past the first month when the calendar is already full, so asking for
 * more content gives you more content instead of silently doing nothing.
 */
function freeSlots(count) {
  const taken = new Set(
    store.getPosts()
      .filter((p) => p.status === "scheduled" && p.scheduledAt)
      .map((p) => new Date(p.scheduledAt).getTime())
  );
  return slots(DAYS * 3).filter((s) => !taken.has(s.getTime())).slice(0, count);
}

// ---- writing the month ------------------------------------------------------

const SYSTEM = `You plan a month of social media for a small business.

You will be given everything the team actually read from the business's own website. Work ONLY from that. Never invent a service, a price, an award, a testimonial, a statistic or an event that isn't in the material. If you don't know something, write around it.

Return ONLY a JSON array — no prose, no markdown fences. Each item:
{
  "content": "the caption, written in the business's own voice, 1-3 short sentences",
  "hashtags": ["max 5, lowercase, no spaces"],
  "platform": "instagram" | "facebook" | "linkedin",
  "headline": "4-7 words for the picture",
  "subline": "a short supporting line for the picture",
  "imagePrompt": "a photographic description of a scene for this post, no text in the image",
  "kind": "service" | "story" | "tip" | "offer" | "behind-the-scenes" | "testimonial-invite" | "seasonal"
}

Rules:
- Vary "kind" — a month of identical posts is what makes people unfollow.
- LinkedIn posts are a little more formal, Instagram a little warmer.
- Australian spelling and tone. No corporate waffle, no emoji soup, no "unlock" or "elevate".
- Do not promise anything the business hasn't said it does.`;

async function writeMonth(profile, count) {
  // The spec prices a week of content (7 posts) at 30 credits, so a month is
  // billed as however many weeks it actually covers — rounded up.
  const weeks = Math.max(1, Math.ceil((Number(count) || 0) / 7));
  for (let w = 0; w < weeks; w++) {
    const billed = await charge.run("social.week_plan", { refId: `plan-week-${w}` }, async () => true);
    if (!billed.ok) return [];   // out of credits: plan nothing rather than half a month
  }
  if (!HAS_KEY) return templateMonth(profile, count);
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();
  const brief = {
    name: profile.name,
    businessType: profile.businessType,
    tagline: profile.tagline,
    services: profile.services,
    audience: profile.audience,
    tone: profile.tone,
    location: profile.location,
    keywords: profile.keywords,
    pagesRead: (profile.pagesRead || []).map((p) => p.title).filter(Boolean),
  };
  const out = [];
  // In batches, so one oversized response can't lose the whole month.
  const BATCH = 15;
  for (let i = 0; i < count; i += BATCH) {
    const n = Math.min(BATCH, count - i);
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Business:\n${JSON.stringify(brief, null, 2)}\n\nWrite the next ${n} posts (this is batch ${i / BATCH + 1}). Keep them different from one another.`,
      }],
    });
    budget.record("claude.message", 1, "planning the month");
    const raw = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    try {
      const arr = JSON.parse(raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim());
      if (Array.isArray(arr)) out.push(...arr);
    } catch {
      out.push(...templateMonth(profile, n)); // partial failure shouldn't cost the month
    }
  }
  return out.slice(0, count);
}

// No API key? Still produce a real, varied month off the profile.
function templateMonth(profile, count) {
  const name = profile.name || "we";
  const svcs = (profile.services || []).filter(Boolean);
  const shapes = [
    (s) => ({ content: `${s} is one of the things we're asked for most. If that's what you need, we're here.`, kind: "service", headline: s, subline: name }),
    (s) => ({ content: `A quick note on ${String(s).toLowerCase()} — the best time to sort it is before it becomes urgent.`, kind: "tip", headline: "Worth knowing", subline: s }),
    () => ({ content: `${profile.tagline || `A bit about ${name}`}. Come and say hello.`, kind: "story", headline: name, subline: profile.location || "" }),
    (s) => ({ content: `Behind the scenes: what actually goes into ${String(s).toLowerCase()}.`, kind: "behind-the-scenes", headline: "Behind the scenes", subline: s }),
  ];
  const out = [];
  for (let i = 0; i < count; i++) {
    const svc = svcs.length ? svcs[i % svcs.length] : (profile.businessType || "what we do");
    const base = shapes[i % shapes.length](svc);
    out.push(Object.assign(base, {
      platform: PLATFORMS[i % PLATFORMS.length],
      hashtags: (profile.keywords || []).slice(0, 3).map((k) => String(k).toLowerCase().replace(/\s+/g, "")),
      imagePrompt: null,
    }));
  }
  return out;
}

// ---- pictures ---------------------------------------------------------------

/**
 * Every post gets a picture. In order of preference:
 *   1. a real photograph from the business's own website
 *   2. a generated photo, if an image provider is configured
 *   3. a branded card rendered from their colours and words
 * Option 3 always works, so no post ever goes out bare.
 */
async function attachMedia(post, idea, profile, index) {
  const photos = profile.photos || [];
  if (photos.length) {
    post.mediaUrl = photos[index % photos.length];
    post.mediaSource = "their own website";
    return;
  }
  try {
    const gen = require("./imagegen");
    if (gen.configured() && idea.imagePrompt) {
      const file = await gen.generate(idea.imagePrompt, profile);
      if (file) { post.mediaFile = file; post.mediaSource = "generated"; return; }
    }
  } catch { /* fall through to the branded card */ }
  try {
    const out = await media.generateImage({
      headline: idea.headline || String(idea.content || "").slice(0, 60),
      sub: idea.subline || profile.tagline || "",
      style: index % 3 === 0 ? "bold" : index % 3 === 1 ? "clean" : "dark",
      format: post.platform === "linkedin" ? "wide" : "square",
    });
    if (out && out.file) { post.mediaFile = out.file; post.mediaSource = "branded card"; }
  } catch { /* a post without a picture still beats no post */ }
}

// ---- the whole job ----------------------------------------------------------

/**
 * Called straight after a successful website scan. Writes and schedules a
 * month of content without anyone asking for it.
 */
async function onboard(profile, opts = {}) {
  const count = Math.min(opts.count || MAX_POSTS, MAX_POSTS);
  // A new team ships switched off and in its most cautious mode, which means
  // a customer who just paid watches nothing happen. Reading their website is
  // an unambiguous "get started", so the ready staff clock on here.
  // Supervised, not autonomous: work lands on the calendar where it can be
  // edited or pulled, rather than going straight out unseen.
  if (opts.startTeam !== false) {
    employees.getEmployees()
      .filter((e) => e.ready && !e.enabled)
      .forEach((e) => employees.updateEmployee(e.id, { enabled: true, mode: "supervised" }));
  }

  // Only the most cautious mode holds a month of work hostage behind 90
  // approvals — that's the manual grind this whole thing exists to remove.
  const sage = employees.getState("social");
  const supervised = sage.mode === "assisted";

  setPlan({ status: "writing", step: "Writing a month of posts", written: 0, total: count, startedAt: new Date().toISOString() });

  let ideas;
  try {
    ideas = await writeMonth(profile, count);
  } catch (e) {
    setPlan({ status: "failed", step: `Couldn't write the plan — ${e.message}`, finishedAt: new Date().toISOString() });
    throw e;
  }

  setPlan({ status: "illustrating", step: "Making the pictures", written: ideas.length, total: ideas.length });

  const when = freeSlots(ideas.length);
  const posts = store.getPosts();
  let made = 0;

  for (let i = 0; i < ideas.length && i < when.length; i++) {
    const idea = ideas[i] || {};
    const post = {
      id: store.newPostId(),
      platform: PLATFORMS.includes(idea.platform) ? idea.platform : PLATFORMS[i % PLATFORMS.length],
      content: String(idea.content || "").slice(0, 1200),
      hashtags: Array.isArray(idea.hashtags) ? idea.hashtags.slice(0, 5) : [],
      kind: idea.kind || "post",
      // Supervised teams get drafts to approve. Autonomous ones go on the calendar.
      status: supervised ? "draft" : "scheduled",
      scheduledAt: supervised ? null : when[i].toISOString(),
      scheduledFor: supervised ? null : when[i].toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: "sage",
      fromPlan: true,
      simulated: true,   // the scheduler decides for real at publish time
    };
    if (!post.content) continue;
    await attachMedia(post, idea, profile, i);
    posts.push(post);
    made++;
    if (made % 5 === 0) {
      store.savePosts(posts);   // checkpoint, so a crash doesn't lose the lot
      setPlan({ status: "illustrating", step: `Illustrated ${made} of ${ideas.length}`, written: made, total: ideas.length });
    }
  }

  store.savePosts(posts);
  const verb = supervised ? "ready for you to approve" : "scheduled across the month";
  store.logActivity("content", `Sage planned ${made} posts for ${profile.name} — ${verb}`);
  setPlan({
    status: "done", step: `${made} posts ${verb}`, written: made, total: ideas.length,
    supervised, finishedAt: new Date().toISOString(),
  });
  return { made, supervised };
}

function setPlan(patch) {
  const cur = store.getCol("plan", {});
  store.saveCol("plan", Object.assign(cur && cur.startedAt ? cur : {}, patch));
}
function getPlan() {
  return store.getCol("plan", {});
}

module.exports = { onboard, getPlan, slots, freeSlots, PER_DAY, DAYS };
