// Shared JSON-file store. Atomic temp-file-then-rename writes so a crash
// can't corrupt data. One business per install (local, single-tenant).

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.HARPERLINKS_DATA_DIR || path.join(__dirname, "..", "data");
const PROFILE_FILE = path.join(DATA_DIR, "business-profile.json");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const ACTIVITY_FILE = path.join(DATA_DIR, "activity-log.json");

function fileFor(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
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
  return readJson(PROFILE_FILE, { configured: false });
}
function saveProfile(profile) {
  writeJson(PROFILE_FILE, profile);
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
  return readJson(POSTS_FILE, []);
}
function savePosts(posts) {
  writeJson(POSTS_FILE, posts);
}
function newPostId() {
  return newId("post");
}

// ---- activity log (newest last on disk, capped) ----
function logActivity(type, message, refId) {
  const log = readJson(ACTIVITY_FILE, []);
  log.push({ at: new Date().toISOString(), type, message, refId: refId || null });
  while (log.length > 500) log.shift();
  writeJson(ACTIVITY_FILE, log);
}
function getActivity() {
  return readJson(ACTIVITY_FILE, []).slice().reverse(); // newest first
}

module.exports = {
  DATA_DIR, PROFILE_FILE, POSTS_FILE, ACTIVITY_FILE,
  readJson, writeJson, fileFor,
  getCol, saveCol, newId,
  getProfile, saveProfile,
  getKnowledge, saveKnowledge,
  getPosts, savePosts, newPostId,
  logActivity, getActivity,
};
