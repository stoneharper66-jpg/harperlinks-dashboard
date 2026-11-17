// The publishing pipeline: every 30s, find scheduled posts that are due and
// publish them. v1 is an HONEST SIMULATION — the pipeline genuinely fires on
// time and logs it, but no real platform API is called yet (that's the v2
// seam: swap the body of publish() for real Instagram/Facebook/TikTok calls).

const store = require("./store");
const events = require("./events");
const employees = require("./employees");

const TICK_MS = 30 * 1000;
let pausedLogged = false;

function publish(post, note) {
  post.status = "published";
  post.publishedAt = new Date().toISOString();
  post.simulated = true;
  store.logActivity(
    "published",
    `Published ${post.platform} post (simulated)${note ? ` ${note}` : ""} — "${post.content.slice(0, 50)}${post.content.length > 50 ? "…" : ""}"`,
    post.id
  );
  events.emit("post.published", { postId: post.id, summary: post.content.slice(0, 60) });
}

function runDue(note) {
  const posts = store.getPosts();
  const now = new Date();
  let fired = 0;
  const due = posts.filter((p) => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt) <= now);
  // The publisher is Sage's job — if Sage is switched off, due posts wait.
  const sage = employees.getState("social");
  if (due.length && !sage.enabled) {
    if (!pausedLogged) {
      store.logActivity("paused", `${due.length} due post(s) are waiting — Sage is switched off. Enable Sage in AI Employees to resume publishing.`);
      pausedLogged = true;
    }
  } else {
    if (sage.enabled) pausedLogged = false;
    for (const post of due) {
      publish(post, note);
      fired++;
    }
  }
  if (fired) store.savePosts(posts);

  // tasks coming due → surface them once
  const tasks = store.getCol("tasks");
  let dued = 0;
  for (const t of tasks) {
    if (t.status === "open" && t.dueAt && new Date(t.dueAt) <= now) {
      t.status = "due";
      store.logActivity("task", `⏰ Task due: ${t.what}`, t.id);
      dued++;
    }
  }
  if (dued) store.saveCol("tasks", tasks);
  return fired + dued;
}

function start() {
  // Boot catch-up: anything that came due while the server was off
  const caught = runDue("(caught up on startup)");
  if (caught) console.log(`Scheduler: published ${caught} overdue post(s) on startup`);
  setInterval(() => {
    const fired = runDue();
    if (fired) console.log(`Scheduler: published ${fired} post(s)`);
  }, TICK_MS);
  console.log("Scheduler: running (30s tick, simulated publishing)");
}

module.exports = { start, runDue };
