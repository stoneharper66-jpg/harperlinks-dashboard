// Shared JSON-file store. Atomic temp-file-then-rename writes so a crash
// can't corrupt data.
//
// Multi-tenant: every account gets its own folder under data/accounts/<id>/,
// and which folder a call touches is decided by src/tenant.js — the account
// the current request authenticated into. Nothing here takes an account id
// as a parameter, so no caller can accidentally reach across accounts.
//
// Global files (the user list, the session secret) live at the data/ root,
// outside every account folder.

const fs = require("fs");
const path = require("path");
const tenant = require("./tenant");

const ROOT_DIR = process.env.HARPERLINKS_DATA_DIR || path.join(__dirname, "..", "data");
const ACCOUNTS_DIR = path.join(ROOT_DIR, "accounts");

// ---- one-time migration from the single-tenant layout --------------------
// Old installs kept *.json straight in data/. Move those into the founding
// account's folder so nothing is lost and nothing global mixes with tenant data.
(function migrateLegacyLayout() {
  let entries;
  try {
    entries = fs.readdirSync(ROOT_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return; // no data dir yet — fresh install
  }
  const GLOBAL = new Set(["users.json"]);
  const legacy = entries.filter((f) => !GLOBAL.has(f));
  if (!legacy.length) return;
  const mainDir = path.join(ACCOUNTS_DIR, tenant.MAIN);
  fs.mkdirSync(mainDir, { recursive: true });
  for (const f of legacy) {
    const dest = path.join(mainDir, f);
    if (fs.existsSync(dest)) continue; // never clobber migrated data
    fs.renameSync(path.join(ROOT_DIR, f), dest);
  }
  console.log(`Store: migrated ${legacy.length} data file(s) into accounts/${tenant.MAIN}/`);
})();

function accountDir() {
  const id = tenant.current();
  if (!tenant.isValidId(id)) throw new Error("Bad account id");
  return path.join(ACCOUNTS_DIR, id);
}

function fileFor(name) {
  return path.join(accountDir(), `${name}.json`);
}

// Accounts that exist on disk — the scheduler walks these.
function listAccountIds() {
  try {
    return fs.readdirSync(ACCOUNTS_DIR).filter((d) => tenant.isValidId(d));
  } catch {
    return [];
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ---- global (cross-account) files — the user list lives here -------------
function globalFile(name) {
  return path.join(ROOT_DIR, `${name}.json`);
}
function getGlobal(name, fallback) {
  return readJson(globalFile(name), fallback);
}
function saveGlobal(name, data) {
  writeJson(globalFile(name), data);
  return data;
}

// ---- generic collections (leads, appointments, workflows, team, …) ----
function getCol(name, fallback = []) {
  return readJson(fileFor(name), fallback);
}
function saveCol(name, data) {
  writeJson(fileFor(name), data);
  return data;
}

let idCounter = 0;
function newId(prefix) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// ---- profile ----
function getProfile() {
  return readJson(fileFor("business-profile"), { configured: false });
}
function saveProfile(profile) {
  writeJson(fileFor("business-profile"), profile);
  return profile;
}

// ---- knowledge base (hours, FAQs, policies, staff, voice — feeds the bots) ----
const KNOWLEDGE_DEFAULTS = {
  description: "",
  services: [],          // [{name, price}]
  hours: {},             // {"Mon-Fri": "9:00 AM - 5:00 PM"}
  faqs: [],              // [{q, a}]
  policies: "",
  locations: "",
  staff: [],             // [{name, role}]
  brandVoice: "",
  updatedAt: null,
};
function getKnowledge() {
  return Object.assign({}, KNOWLEDGE_DEFAULTS, readJson(fileFor("knowledge"), {}));
}
function saveKnowledge(kb) {
  kb.updatedAt = new Date().toISOString();
  writeJson(fileFor("knowledge"), kb);
  return kb;
}

// ---- posts ----
function getPosts() {
  return readJson(fileFor("posts"), []);
}
function savePosts(posts) {
  writeJson(fileFor("posts"), posts);
}
function newPostId() {
  return newId("post");
}

// ---- activity log (newest last on disk, capped) ----
function logActivity(type, message, refId) {
  const file = fileFor("activity-log");
  const log = readJson(file, []);
  log.push({ at: new Date().toISOString(), type, message, refId: refId || null });
  while (log.length > 500) log.shift();
  writeJson(file, log);
}
function getActivity() {
  return readJson(fileFor("activity-log"), []).slice().reverse(); // newest first
}

module.exports = {
  ROOT_DIR, ACCOUNTS_DIR,
  readJson, writeJson, fileFor, listAccountIds, accountDir,
  getGlobal, saveGlobal,
  getCol, saveCol, newId,
  getProfile, saveProfile,
  getKnowledge, saveKnowledge,
  getPosts, savePosts, newPostId,
  logActivity, getActivity,
};
