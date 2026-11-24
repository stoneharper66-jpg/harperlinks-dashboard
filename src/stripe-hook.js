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
const PLANS = ["professional", "business", "enterprise"];

// Every one of our links starts with a 7-day free trial, so the checkout that
// arrives charges $0 — the amount can't tell us which plan they picked. Ask
// Stripe what the subscription is actually for.
async function planFromStripe(session) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !session.subscription) return null;
  const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  try {
    const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const sub = await r.json();
    const item = sub.items && sub.items.data && sub.items.data[0];
    const unit = item && item.price && item.price.unit_amount;
    return PLAN_BY_AMOUNT[unit] || null;
  } catch {
    return null; // Stripe unreachable — fall back rather than fail the signup
  }
}

async function handleCheckout(session) {
  const email = (session.customer_details && session.customer_details.email) || session.customer_email;
  const name = (session.customer_details && session.customer_details.name) || "";
  const phone = (session.customer_details && session.customer_details.phone) || "";
  const custom = session.custom_fields || [];
  const bizField = custom.find((f) => f.key === "business_name");
  const business = (bizField && bizField.text && bizField.text.value) || name || "";
  const amount = session.amount_total || (session.amount_subtotal || 0);
  const trialing = amount === 0;
  const plan = PLAN_BY_AMOUNT[amount]
    || (session.metadata && PLANS.includes(session.metadata.plan) ? session.metadata.plan : null)
    || await planFromStripe(session)
    || "professional";

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

  // The customer hears from us first, in the same breath as the payment —
  // nobody should have to wait on a human to get into what they just bought.
  const signIn = `${process.env.PUBLIC_BASE_URL || "https://harperlinks-dashboard-production.up.railway.app"}/app`;
  const welcome = await notify.sendTo(
    email,
    `Your HarperLinks account is ready${business ? `, ${business}` : ""}`,
    `Hi${name ? ` ${name.split(" ")[0]}` : ""},

Your ${plan} plan is live${trialing ? " and your 7-day free trial has started" : ""}. Your AI team is already set up and waiting for you.

Sign in:   ${signIn}
Email:     ${email}
Password:  ${password}

Please change that password once you're in — Settings, then Password.

First thing to do: paste your website address into the Command Centre. Your team reads it and learns your business — what you sell, how you talk, who you serve — and then they can start writing your posts and handling your leads.

Any trouble at all, just reply to this email.

— Stone and Terry
   HarperLinks`,
    // The first thing a paying customer ever sees from us, so it gets the
    // branded shell and a button straight into the dashboard.
    notify.wrapHtml({
      title: `Your AI team is ready${business ? `, ${business}` : ""} 🎉`,
      bodyHtml:
        `<p style="margin:0 0 14px">Hi${name ? ` ${name.split(" ")[0]}` : ""}, your <b>${plan}</b> plan is live` +
        `${trialing ? " and your 7-day free trial has started" : ""}. Your AI team is set up and waiting.</p>` +
        `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;background:#F6F8FC;border-radius:12px;padding:14px 16px;margin:0 0 14px">` +
        `<tr><td style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13.5px;color:#55606E;line-height:1.9">` +
        `<b style="color:#0E1116">Email</b><br>${email}<br>` +
        `<b style="color:#0E1116">Temporary password</b><br><code style="font-size:14px;color:#0E1116">${password}</code>` +
        `</td></tr></table>` +
        `<p style="margin:0 0 14px">Please change that password once you're in — <b>Settings → Password</b>.</p>` +
        `<p style="margin:0"><b style="color:#0E1116">First thing to do:</b> paste your website address into the Command Centre. ` +
        `Your team reads it and learns your business — what you sell, how you talk, who you serve — then they can start ` +
        `writing your posts and handling your leads.</p>`,
      buttonText: "Sign in to HarperLinks",
      buttonUrl: signIn,
    })
  );

  const mail = await notify.sendToTeam(
    `💰 New HarperLinks customer: ${business || name || email}`,
    `A ${plan} subscription just started${trialing ? " (7-day free trial)" : ""}.

Name:     ${name || "—"}
Business: ${business || "—"}
Email:    ${email}
Phone:    ${phone || "—"}

Their account was created automatically:
  Account id:  ${accountId}
  Sign in:     ${signIn}
  Email:       ${email}
  Temp password: ${password}

${welcome.sent
  ? `They have ALREADY been emailed these sign-in details — they can get in on their own right now.`
  : `⚠️ Their welcome email did NOT send (${welcome.reason}) — send them the details above yourself, today.`}

Worth doing anyway:
  1. HQ → Customer Accounts → "Connect" to link their publishing.
  2. "Log in as" them, paste their website into the Command Centre, build their automations.
  3. Say hello on WhatsApp — a human within 7 days is the promise on the site.`
  );
  tenant.run(tenant.MAIN, () => {
    store.logActivity("auth", welcome.sent
      ? `Welcome email with sign-in details sent to ${email} — they can log in unaided`
      : `Couldn't send ${email} their welcome email — ${welcome.reason}. Details are in your CRM and in HQ.`);
    store.logActivity("system", mail.sent
      ? `Handover details emailed to ${notify.NOTIFY_EMAIL}`
      : `Couldn't email you the handover — ${mail.reason}. It's all in your CRM and HQ.`);
  });

  return { ok: true, accountId, plan, welcomed: welcome.sent };
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
