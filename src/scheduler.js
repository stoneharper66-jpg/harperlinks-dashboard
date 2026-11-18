// The publishing pipeline: every 30s, find scheduled posts that are due and
// publish them.
//
// If GoHighLevel is connected, posts go out for real through its Social
// Planner (which holds the Instagram/Facebook/TikTok publishing approvals).
// If it isn't, the pipeline still fires exactly on time but the post is
// marked `simulated` and labelled as preview — we never claim it was posted.

const store = require("./store");
const tenant = require("./tenant");
const events = require("./events");
const employees = require("./employees");
const ghl = require("./ghl");

const TICK_MS = 30 * 1000;
const pausedLogged = new Set(); // account ids we've already warned for

function snippet(post) {
  return `"${post.content.slice(0, 50)}${post.content.length > 50 ? "…" : ""}"`;
}

function markPublished(post, { live, detail, note }) {
  post.status = "published";
  post.publishedAt = new Date().toISOString();
  post.simulated = !live;
  store.logActivity(
    "published",
    live
      ? `Published ${post.platform} post via GoHighLevel${detail ? ` → ${detail}` : ""} — ${snippet(post)}`
      : `Published ${post.platform} post (preview — no platform connected)${note ? ` ${note}` : ""} — ${snippet(post)}`,
    post.id
  );
  events.emit("post.published", { postId: post.id, summary: post.content.slice(0, 60) });
}

function markFailed(post, reason) {
  post.status = "failed";
  post.failedAt = new Date().toISOString();
  post.failureReason = reason;
  store.logActivity("failed", `Couldn't publish ${post.platform} post — ${reason}`, post.id);
}

// Returns true if the post was dealt with (published or failed).
async function publish(post, note) {
  if (!ghl.isConfigured()) {
    markPublished(post, { live: false, note });
    return;
  }
  const out = await ghl.publishPost(post);
  if (out.ok) {
    post.ghlPostId = out.id || null;
    markPublished(post, { live: true, detail: (out.accounts || []).join(", ") });
  } else {
    // A real failure is worth surfacing — don't quietly pretend it published.
    markFailed(post, out.reason);
  }
}

async function runDue(note) {
  const posts = store.getPosts();
  const now = new Date();
  let fired = 0;
  const due = posts.filter((p) => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt) <= now);
  // The publisher is Sage's job — if Sage is switched off, due posts wait.
  const acct = tenant.current();
  const sage = employees.getState("social");
  if (due.length && !sage.enabled) {
    if (!pausedLogged.has(acct)) {
      store.logActivity("paused", `${due.length} due post(s) are waiting — Sage is switched off. Enable Sage in AI Employees to resume publishing.`);
      pausedLogged.add(acct);
    }
  } else {
    if (sage.enabled) pausedLogged.delete(acct);
    // sequential on purpose: GHL rate-limits, and a burst of posts going out
    // at once is rarely what anyone wants anyway
    for (const post of due) {
      await publish(post, note);
      fired++;
    }
  }
  // written after the awaits so the saved state reflects what actually happened
  if (fired) store.savePosts(posts);

  // tasks coming due → surface them once
  const tasks = store.getCol("tasks");
  let dued = 0;
  for (const t of tasks) {
    if (t.status === "open" && t.dueAt && new Date(t.dueAt) <= now) {
      t.status = "due";
      store.logActivity("task", `Task due: ${t.what}`, t.id);
      dued++;
    }
  }
  if (dued) store.saveCol("tasks", tasks);
  return fired + dued;
}

function start() {
  let running = false;
  // a slow GHL call must not let the next tick start a second pass over the
  // same due posts and publish them twice
  async function tick(note) {
    if (running) return;
    running = true;
    try {
      // every customer's queue gets a pass, each inside its own account
      // context so posts, logs and GHL credentials never cross accounts
      for (const id of store.listAccountIds()) {
        const fired = await tenant.run(id, () => runDue(note));
        if (fired) console.log(`Scheduler [${id}]: handled ${fired} item(s)`);
      }
    } catch (e) {
      console.error("Scheduler tick failed:", e.message);
    } finally {
      running = false;
    }
  }

  // Boot catch-up: anything that came due while the server was off
  tick("(caught up on startup)");
  setInterval(tick, TICK_MS);
  console.log("Scheduler: running (30s tick across all accounts; live publishing per account once its GoHighLevel is connected)");
}

module.exports = { start, runDue };
