// Sign-in, sessions and accounts.
//
// Passwords are scrypt-hashed (Node's built-in; never stored or logged in the
// clear). Sessions are HMAC-signed tokens in an HttpOnly cookie, so page
// scripts can't read them and nobody can forge one without the server secret.
// The secret is generated once on first boot and kept at data/session-secret
// so restarts don't log everyone out.
//
// Roles: "admin" (Stone — can create and manage customer accounts) and
// "customer" (sees only their own account's data).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const store = require("./store");
const tenant = require("./tenant");

const SESSION_HOURS = 24 * 14; // two weeks
const COOKIE = "hl_sess";

// ---- the signing secret ---------------------------------------------------
const SECRET_FILE = path.join(store.ROOT_DIR, "session-secret");
let SECRET = null;
function secret() {
  if (SECRET) return SECRET;
  try {
    SECRET = fs.readFileSync(SECRET_FILE);
    if (SECRET.length >= 32) return SECRET;
  } catch { /* first boot */ }
  SECRET = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
  return SECRET;
}

// ---- password hashing ------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}
function checkPassword(password, salt, hash) {
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const stored = Buffer.from(hash, "hex");
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

// ---- users (global file, never inside an account folder) -------------------
function getUsers() {
  return store.getGlobal("users", []);
}
function saveUsers(users) {
  return store.saveGlobal("users", users);
}
function findByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return getUsers().find((u) => u.email === e) || null;
}
function hasAdmin() {
  return getUsers().some((u) => u.role === "admin");
}

function createUser({ email, name, password, role, accountId }) {
  const users = getUsers();
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("That email doesn't look right.");
  if (users.some((u) => u.email === e)) throw new Error("There's already an account with that email.");
  if (String(password || "").length < 8) throw new Error("Password needs at least 8 characters.");
  if (!tenant.isValidId(accountId)) throw new Error("Bad account id.");
  const { salt, hash } = hashPassword(password);
  const user = {
    id: store.newId("usr"),
    email: e,
    name: String(name || "").trim() || e.split("@")[0],
    salt, hash,
    role: role === "admin" ? "admin" : "customer",
    accountId,
    disabled: false,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return publicUser(user);
}

function setPassword(userId, newPassword) {
  if (String(newPassword || "").length < 8) throw new Error("Password needs at least 8 characters.");
  const users = getUsers();
  const u = users.find((x) => x.id === userId);
  if (!u) throw new Error("No such user.");
  const { salt, hash } = hashPassword(newPassword);
  u.salt = salt; u.hash = hash;
  saveUsers(users);
}

function setDisabled(userId, disabled) {
  const users = getUsers();
  const u = users.find((x) => x.id === userId);
  if (!u) throw new Error("No such user.");
  if (u.role === "admin") throw new Error("Admins can't be disabled from here.");
  u.disabled = !!disabled;
  saveUsers(users);
  return publicUser(u);
}

// What the browser is allowed to know about a user — no salt, no hash.
function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, accountId: u.accountId,
    disabled: !!u.disabled, createdAt: u.createdAt,
    plan: u.plan || "professional", planStatus: u.planStatus || "trial",
  };
}

const PLANS = ["professional", "business", "enterprise"];
const PLAN_STATUSES = ["trial", "active", "paused", "cancelled"];
function setPlan(userId, { plan, planStatus }) {
  const users = getUsers();
  const u = users.find((x) => x.id === userId);
  if (!u) throw new Error("No such user.");
  if (u.role === "admin") throw new Error("Admins don't have subscriptions.");
  if (plan !== undefined) {
    if (!PLANS.includes(plan)) throw new Error("Plan must be professional, business or enterprise.");
    u.plan = plan;
  }
  if (planStatus !== undefined) {
    if (!PLAN_STATUSES.includes(planStatus)) throw new Error("Status must be trial, active, paused or cancelled.");
    u.planStatus = planStatus;
  }
  saveUsers(users);
  return publicUser(u);
}

// ---- sessions ---------------------------------------------------------------
function sign(data) {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}
function makeToken(userId, opts = {}) {
  const hours = opts.hours || SESSION_HOURS;
  const data = { uid: userId, exp: Date.now() + hours * 3600 * 1000 };
  // "act" = an admin working inside a customer's account. The admin stays the
  // authenticated principal; the customer id rides along in the signed token.
  if (opts.actAs) data.act = opts.actAs;
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function readToken(token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [payload, mac] = token.split(".");
  const expect = sign(payload);
  const got = Buffer.from(mac || "", "utf8");
  const want = Buffer.from(expect, "utf8");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.uid || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

// Secure flag goes on automatically when the request arrived over HTTPS
// (directly or via the host's proxy) — so cookies can't leak over plain http
// in production, while localhost development keeps working.
function isSecure(req) {
  return !!(req && (req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0] === "https"));
}
function cookieFor(token, req) {
  // HttpOnly: page scripts can't read it. SameSite=Lax: other sites can't ride it.
  const maxAge = SESSION_HOURS * 3600;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? "; Secure" : ""}`;
}
function clearCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? "; Secure" : ""}`;
}

// Who is this request? Returns { user, impersonator } — `user` is whose
// account context applies; `impersonator` is set when a HarperLinks admin is
// working inside a customer's account. The admin's role is re-checked on
// every request, so a demoted or disabled admin loses access instantly.
function contextFromRequest(req) {
  const raw = String(req.headers.cookie || "");
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  const data = m && readToken(m[1]);
  if (!data) return null;
  const users = getUsers();
  const u = users.find((x) => x.id === data.uid);
  if (!u || u.disabled) return null;
  if (data.act && u.role === "admin") {
    const target = users.find((x) => x.id === data.act);
    if (target && !target.disabled && target.role !== "admin") {
      return { user: target, impersonator: u };
    }
    // target vanished or got disabled mid-session — fall back to plain admin
  }
  return { user: u, impersonator: null };
}
function userFromRequest(req) {
  const ctx = contextFromRequest(req);
  return ctx ? ctx.user : null;
}

function login(email, password) {
  const u = findByEmail(email);
  // Hash something even when the user doesn't exist, so a wrong email and a
  // wrong password take the same time to answer.
  if (!u) { hashPassword(String(password || "x")); return null; }
  if (u.disabled) return null;
  if (!checkPassword(password, u.salt, u.hash)) return null;
  return u;
}

module.exports = {
  COOKIE,
  hasAdmin, createUser, setPassword, setDisabled, setPlan, publicUser,
  getUsers, findByEmail,
  login, makeToken, cookieFor, clearCookie, userFromRequest, contextFromRequest,
};
