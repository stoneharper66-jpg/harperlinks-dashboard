// Money arrives → the customer's account exists.
//
// Stripe calls this when someone completes checkout (which, with a trial, is
// the moment they sign up — exactly when the team wants to know). We create
// their isolated account, a login with a temporary password, a lead in the
// team's CRM, and email the team everything needed to start the setup.
//
// Security: every delivery is verified against Stripe's signature before we
// believe a word of it. Without that check, anyone who found this URL could
// POST a fake "payment" and mint themselves an account.

const crypto = require("crypto");
const auth = require("./auth");
const store = require("./store");
const tenant = require("./tenant");
const notify = require("./notify");

const TOLERANCE_S = 300; // reject replays older than 5 minutes

/** Stripe signs with HMAC-SHA256 over "timestamp.rawBody". */
function verify(rawBody, header, secret) {
  if (!secret) return { ok: false, reason: "no signing secret configured" };
  const parts = String(header || "").split(",").reduce((m, kv) => {
    const [k, v] = kv.split("=");
    if (k === "t") m.t = v;
    if (k === "v1") (m.v1 = m.v1 || []).push(v);
    return m;
  }, {});
  if (!parts.t || !parts.v1) return { ok: false, reason: "malformed signature header" };
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > TOLERANCE_S) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }
  const expect = crypto.createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expect, "utf8");
  const match = parts.v1.some((sig) => {
    const b = Buffer.from(sig, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

function slugFor(business, fallback) {
  const base = String(business || fallback || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  if (!tenant.isValidId(base)) return null;
  const taken = new Set([...store.listAccountIds(), ...auth.getUsers().map((u) => u.accountId)]);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

// Readable but not guessable — the team shares it once, the customer changes it.
function tempPassword() {
  const words = ["sunny", "harbour", "quokka", "jarrah", "swan", "coastal", "amber", "ridge"];
  const w = () => words[crypto.randomInt(words.length)];
  return `${w()}-${w()}-${crypto.randomInt(1000, 9999)}`;
}

const PLAN_BY_AMOUNT = { 24900: "professional", 49900: "business", 99900: "enterprise" };

async function handleCheckout(session) {
  const email = (session.customer_details && session.customer_details.email) || session.customer_email;
  const name = (session.customer_details && session.customer_details.name) || "";
  const phone = (session.customer_details && session.customer_details.phone) || "";
  const custom = session.custom_fields || [];
  const bizField = custom.find((f) => f.key === "business_name");
  const business = (bizField && bizField.text && bizField.text.value) || name || "";
  const amount = session.amount_total || (session.amount_subtotal || 0);
  const plan = PLAN_BY_AMOUNT[amount] || "professional";
  const trialing = (session.subscription && session.status === "complete" && amount === 0) || amount === 0;

  if (!email) {
    tenant.run(tenant.MAIN, () => store.logActivity("system", "Stripe checkout arrived with no email — couldn't create an account"));
    return { ok: false, reason: "no email on the session" };
  }

  // Already handled? Stripe retries deliveries, and we must not make two accounts.
  const existing = auth.findByEmail(email);
  if (existing) {
    tenant.run(tenant.MAIN, () => store.logActivity("auth", `Stripe checkout for ${email} — account already exists, nothing created`));
    return { ok: true, duplicate: true };
  }

  const accountId = slugFor(business, email.split("@")[0]);
  if (!accountId) {
    tenant.run(tenant.MAIN, () => store.logActivity("system", `Stripe checkout for ${email} — couldn't make a valid account id from "${business}"`));
    return { ok: false, reason: "bad account id" };
  }

  const password = tempPassword();
  const user = auth.createUser({ email, name: name || email.split("@")[0], password, role: "customer", accountId });
  auth.setPlan(user.id, { plan, planStatus: trialing ? "trial" : "active" });

  tenant.run(accountId, () => {
    store.logActivity("auth", `Account created automatically from a Stripe ${plan} subscription${trialing ? " (free trial)" : ""}`);
  });

  // The team's own CRM gets the lead, so it shows up on their Customers page
  tenant.run(tenant.MAIN, () => {
    const leads = store.getCol("leads");
    leads.push({
      id: store.newId("lead"),
      name: name || email, phone, email,
      interest: `PAID — ${plan} plan${business ? ` · ${business}` : ""}${trialing ? " · in 7-day trial" : ""}`,
      source: "stripe checkout",
      status: "won", score: 100,
      tags: ["customer", plan],
      notes: [{ at: new Date().toISOString(), text: `Account "${accountId}" created automatically. Share their temporary password and set them up within 7 days.`, by: "stripe" }],
      followUps: [],
      createdAt: new Date().toISOString(),
    });
    store.saveCol("leads", leads);
    store.logActivity("lead", `💰 New ${plan} customer: ${name || email}${business ? ` (${business})` : ""} — account "${accountId}" is ready`, user.id);
  });

  const mail = await notify.sendToTeam(
    `💰 New HarperLinks customer: ${business || name || email}`,
    `A ${plan} subscription just started${trialing ? " (7-day free trial)" : ""}.

Name:     ${name || "—"}
Business: ${business || "—"}
Email:    ${email}
Phone:    ${phone || "—"}

Their account is already created and waiting:
  Account id:  ${accountId}
  Sign in:     ${process.env.PUBLIC_BASE_URL || "your dashboard"}
  Email:       ${email}
  Temp password: ${password}

What to do now:
  1. Message them on WhatsApp or email today.
  2. In HQ → Customer Accounts, hit "Connect" to link their publishing.
  3. "Log in as" them, paste their website into the Command Centre, build their automations.
  4. Send them their sign-in details and the temporary password above.

You have 7 days — that's the promise on the site.`
  );
  tenant.run(tenant.MAIN, () => {
    store.logActivity("system", mail.sent
      ? `Customer welcome details emailed to ${notify.NOTIFY_EMAIL}`
      : `Couldn't email the new customer's details — ${mail.reason}. They're in your CRM and HQ.`);
  });

  return { ok: true, accountId, plan };
}

async function handle(rawBody, signature, secret) {
  const v = verify(rawBody, signature, secret);
  if (!v.ok) return { status: 400, body: { error: `Signature check failed: ${v.reason}` } };

  let event;
  try { event = JSON.parse(rawBody); } catch { return { status: 400, body: { error: "bad JSON" } }; }

  if (event.type === "checkout.session.completed") {
    const out = await handleCheckout(event.data.object);
    return { status: 200, body: { received: true, result: out } };
  }
  // Everything else is acknowledged so Stripe stops retrying it.
  return { status: 200, body: { received: true, ignored: event.type } };
}

module.exports = { handle, verify };
