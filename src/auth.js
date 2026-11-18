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
  return { id: u.id, email: u.email, name: u.name, role: u.role, accountId: u.accountId, disabled: !!u.disabled, createdAt: u.createdAt };
}

// ---- sessions ---------------------------------------------------------------
function sign(data) {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}
function makeToken(userId) {
  const payload = Buffer.from(JSON.stringify({
    uid: userId,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000,
  })).toString("base64url");
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

function cookieFor(token) {
  // HttpOnly: page scripts can't read it. SameSite=Lax: other sites can't ride it.
  // Add `Secure` automatically once this runs behind HTTPS.
  const maxAge = SESSION_HOURS * 3600;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function userFromRequest(req) {
  const raw = String(req.headers.cookie || "");
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  const data = m && readToken(m[1]);
  if (!data) return null;
  const u = getUsers().find((x) => x.id === data.uid);
  if (!u || u.disabled) return null;
  return u;
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
  hasAdmin, createUser, setPassword, setDisabled, publicUser,
  getUsers, findByEmail,
  login, makeToken, cookieFor, clearCookie, userFromRequest,
};
