// Nightly backups of everything that matters: every account's data, the
// user list and the session secret, tarred into data/backups/ (inside the
// same volume, so it survives wherever the data does). Keeps the last 14.
// A backup that fails says so in the activity feed — silence is never
// mistaken for safety.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const store = require("./store");
const tenant = require("./tenant");

const BACKUP_DIR = path.join(store.ROOT_DIR, "backups");
const KEEP = 14;

function stamp() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function run() {
  return new Promise((resolve) => {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const out = path.join(BACKUP_DIR, `harperlinks-${stamp()}.tgz`);
    // members that actually exist right now (fresh installs lack some)
    const members = ["accounts", "users.json", "session-secret"]
      .filter((m) => fs.existsSync(path.join(store.ROOT_DIR, m)));
    if (!members.length) return resolve({ ok: false, reason: "nothing to back up yet" });
    execFile("tar", ["-czf", out, "-C", store.ROOT_DIR, ...members], (err) => {
      if (err) return resolve({ ok: false, reason: err.message });
      // prune the old ones
      try {
        const all = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".tgz")).sort();
        all.slice(0, Math.max(0, all.length - KEEP)).forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
      } catch { /* pruning is best-effort */ }
      const size = Math.round(fs.statSync(out).size / 1024);
      resolve({ ok: true, file: path.basename(out), kb: size });
    });
  });
}

// One backup per calendar day, checked hourly — survives restarts because
// the marker is the file itself.
function todayDone() {
  return fs.existsSync(path.join(BACKUP_DIR, `harperlinks-${stamp()}.tgz`));
}

function start() {
  const tickMs = 60 * 60 * 1000;
  const tick = async () => {
    if (todayDone()) return;
    const out = await run();
    tenant.run(tenant.MAIN, () => {
      store.logActivity("system", out.ok
        ? `Nightly backup done — ${out.file} (${out.kb} KB), last ${KEEP} kept`
        : `Nightly backup FAILED — ${out.reason}`);
    });
  };
  setInterval(tick, tickMs);
  setTimeout(tick, 20 * 1000); // first check shortly after boot
}

module.exports = { start, run, BACKUP_DIR };
