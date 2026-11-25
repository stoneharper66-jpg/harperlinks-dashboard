// What happens between paying and having an account.
//
// The old flow made the account for them and emailed a temporary password.
// Two problems with that: the customer never chose their own password, and
// if email wasn't sending they were simply locked out of the thing they had
// just paid for.
//
// Now the payment creates a CLAIM, not an account. The claim knows which
// plan was bought and who bought it. The customer opens their claim link,
// sets their own password, and the account is created on the spot with the
// right plan — then they're signed in and dropped straight into the
// dashboard. One form, no waiting on a human.
//
// A claim can be opened two ways, so email being down can't strand anyone:
//   ?token=...    the signed link we email them
//   ?session=...  the Stripe checkout session id, which Stripe itself puts
//                 on the success URL — no email needed at all
//
// Only the hash of the token is stored, the same as password resets.

const crypto = require("crypto");
const store = require("./store");

const COL = "claims";             // a global file — claims aren't tenant data
const TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days; they've paid, don't rush them

function all() {
  return store.getGlobal(COL, []);
}
function save(list) {
  return store.saveGlobal(COL, list);
}
function hash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Record a paid-but-unclaimed purchase. Returns { claim, token } — the raw
 * token is returned once and never stored, so it only ever exists in the
 * link we hand the customer.
 */
function create({ email, name, phone, business, plan, trialing, sessionId, customerId }) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) throw new Error("A claim needs an email.");

  const list = all().filter((c) => !(c.email === e && !c.usedAt));  // one open claim per buyer
  const token = crypto.randomBytes(32).toString("base64url");
  const claim = {
    id: store.newId("claim"),
    email: e,
    name: String(name || "").trim(),
    phone: String(phone || "").trim(),
    business: String(business || "").trim(),
    plan,
    trialing: !!trialing,
    sessionId: sessionId || null,
    customerId: customerId || null,
    tokenHash: hash(token),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    usedAt: null,
  };
  list.unshift(claim);
  save(list.slice(0, 500));
  return { claim, token };
}

/** Look a claim up by its link token or by the Stripe session id. */
function find({ token, sessionId }) {
  const list = all();
  let c = null;
  if (token) c = list.find((x) => x.tokenHash === hash(token)) || null;
  else if (sessionId) c = list.find((x) => x.sessionId === sessionId) || null;
  if (!c) return { ok: false, reason: "We couldn't find that link. Check it's the whole link, or ask us to resend it." };
  if (c.usedAt) return { ok: false, reason: "That link has already been used — try signing in instead.", claimed: true };
  if (new Date(c.expiresAt) < new Date()) return { ok: false, reason: "That link has expired. Message us and we'll send a fresh one." };
  return { ok: true, claim: c };
}

/** What the claim page may show: enough to greet them, nothing sensitive. */
function publicView(c) {
  return { email: c.email, name: c.name, business: c.business, plan: c.plan, trialing: c.trialing };
}

function markUsed(id, userId, accountId) {
  const list = all();
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  c.usedAt = new Date().toISOString();
  c.userId = userId;
  c.accountId = accountId;
  save(list);
  return c;
}

/** Still-open claims, for the team's own page. */
function pending() {
  const now = new Date();
  return all()
    .filter((c) => !c.usedAt && new Date(c.expiresAt) > now)
    .map((c) => ({ id: c.id, email: c.email, name: c.name, business: c.business, plan: c.plan, createdAt: c.createdAt }));
}

/** Issue a fresh token for an existing claim, for "resend my link". */
function reissue(id) {
  const list = all();
  const c = list.find((x) => x.id === id);
  if (!c || c.usedAt) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  c.tokenHash = hash(token);
  c.expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  save(list);
  return { claim: c, token };
}

// A readable, unique account folder name. Taken from the business name they
// gave Stripe, falling back to the local part of their email.
function slugFor(business, fallback) {
  const auth = require("./auth");
  const tenant = require("./tenant");
  const base = String(business || fallback || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  if (!tenant.isValidId(base)) return null;
  const taken = new Set([...store.listAccountIds(), ...auth.getUsers().map((u) => u.accountId)]);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/**
 * Turn a claim into a real account. The plan comes from the claim — which
 * came from the purchase — so the customer can't pick their own tier and a
 * typo can't land them on the wrong one.
 *
 * Returns { ok, user } or { ok:false, reason }.
 */
function redeem({ token, sessionId, name, password, business }) {
  const auth = require("./auth");
  const found = find({ token, sessionId });
  if (!found.ok) return found;
  const c = found.claim;

  if (auth.findByEmail(c.email)) {
    return { ok: false, reason: "There's already an account with that email — try signing in instead.", claimed: true };
  }
  const displayBusiness = String(business || c.business || "").trim();
  const accountId = slugFor(displayBusiness, c.email.split("@")[0]);
  if (!accountId) return { ok: false, reason: "We couldn't make an account name from that business name — try a simpler one." };

  let user;
  try {
    user = auth.createUser({
      email: c.email,
      name: String(name || c.name || "").trim() || c.email.split("@")[0],
      password,
      role: "customer",
      accountId,
    });
  } catch (e) {
    return { ok: false, reason: e.message };   // e.g. the password is too short
  }
  auth.setPlan(user.id, { plan: c.plan, planStatus: c.trialing ? "trial" : "active" });
  markUsed(c.id, user.id, accountId);
  // Re-read: createUser handed back the record as it was BEFORE the plan was
  // attached, so returning that object told the caller "professional" for a
  // customer who had just bought Business.
  const fresh = auth.findByEmail(c.email) || user;
  return { ok: true, user: fresh, accountId, plan: c.plan, business: displayBusiness };
}

function linkFor(token, base) {
  const root = (base || process.env.PUBLIC_BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
    || "").replace(/\/$/, "");
  return `${root}/claim.html?token=${encodeURIComponent(token)}`;
}

module.exports = { create, find, publicView, markUsed, pending, reissue, redeem, slugFor, linkFor, TTL_MS };
