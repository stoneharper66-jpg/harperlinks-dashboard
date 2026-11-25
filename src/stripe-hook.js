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
const claims = require("./claims");
const ledger = require("./credits/ledger");
const catalog = require("./credits/catalog");

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


// Readable but not guessable — the team shares it once, the customer changes it.

// Amounts in cents → plan. Derived from the catalog so a price change in one
// place can't leave this map lying.
const PLAN_BY_AMOUNT = Object.fromEntries(
  catalog.PLAN_IDS.map((id) => [catalog.PLANS[id].priceAUD * 100, id])
);
const PLANS = catalog.PLAN_IDS;

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
  // Whatever the business-name field ended up being called in the payment
  // link — business_name, business, company, "Business name" — take it.
  // Matching one exact key meant a renamed field silently fell through to the
  // buyer's personal name, and that name becomes their account id.
  const custom = session.custom_fields || [];
  const looksLikeBusiness = (f) => {
    const key = String(f.key || "").toLowerCase();
    const label = String((f.label && (f.label.custom || f.label)) || "").toLowerCase();
    return /business|company|trading|organisation|organization/.test(key + " " + label);
  };
  const bizField = custom.find(looksLikeBusiness);
  const business = (bizField && bizField.text && bizField.text.value)
    || (session.metadata && (session.metadata.business || session.metadata.business_name))
    || name || "";
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

  // Paying creates a CLAIM, not an account. The customer sets their own
  // password on the claim page and the account is built right then, with the
  // plan read straight off the purchase. Nobody gets a temporary password
  // emailed to them, and nobody waits on us.
  const { claim, token } = claims.create({
    email, name, phone, business, plan, trialing,
    sessionId: session.id,
    customerId: typeof session.customer === "string" ? session.customer : (session.customer && session.customer.id) || null,
  });
  const link = claims.linkFor(token);

  tenant.run(tenant.MAIN, () => {
    store.logActivity("auth", `Paid ${plan} checkout from ${email} — account-creation link issued`);
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
      notes: [{ at: new Date().toISOString(), text: `Sent their account-creation link. They pick their own password; the ${plan} plan is already attached to the link.`, by: "stripe" }],
      followUps: [],
      createdAt: new Date().toISOString(),
    });
    store.saveCol("leads", leads);
    store.logActivity("lead", `💰 New ${plan} customer: ${name || email}${business ? ` (${business})` : ""} — waiting on them to claim their account`);
  });

  // One email, one button: finish setting up.
  const welcome = await notify.sendTo(
    email,
    `Set up your HarperLinks account${business ? `, ${business}` : ""}`,
    `Hi${name ? ` ${name.split(" ")[0]}` : ""},

Your ${plan} plan is live${trialing ? " and your 7-day free trial has started" : ""}.

One step left — choose a password and your account is ready:
${link}

That link knows which plan you bought, so there's nothing to enter but your name and a password. Once you're in, paste your website address and your AI team will read it and learn your business.

Any trouble at all, just reply to this email.

— Stone and Terry
   HarperLinks`,
    notify.wrapHtml({
      title: `One step left${business ? `, ${business}` : ""} 🎉`,
      bodyHtml:
        `<p style="margin:0 0 14px">Hi${name ? ` ${name.split(" ")[0]}` : ""}, your <b>${plan}</b> plan is live` +
        `${trialing ? " and your 7-day free trial has started" : ""}.</p>` +
        `<p style="margin:0 0 14px">Choose a password and your dashboard is ready. The link already knows which plan you bought — there's nothing to enter but your name and a password.</p>` +
        `<p style="margin:0">Once you're in, paste your website address and your AI team will read it and learn your business.</p>`,
      buttonText: "Create my account",
      buttonUrl: link,
    })
  );

  const mail = await notify.sendToTeam(
    `💰 New HarperLinks customer: ${business || name || email}`,
    `A ${plan} subscription just started${trialing ? " (7-day free trial)" : ""}.

Name:     ${name || "—"}
Business: ${business || "—"}
Email:    ${email}
Phone:    ${phone || "—"}

They have NOT got an account yet — they create it themselves from the link,
which carries the ${plan} plan with it.

${welcome.sent
  ? `Their link has been emailed to them. Nothing for you to do unless they get stuck.`
  : `⚠️ Their email did NOT send (${welcome.reason}).
   Their link is in HQ → Customer Accounts → Waiting to claim. Send it to them today.`}

Once they're in:
  1. HQ → Customer Accounts → "Connect" to link their publishing.
  2. Say hello on WhatsApp.`
  );

  tenant.run(tenant.MAIN, () => {
    store.logActivity("auth", welcome.sent
      ? `Account-creation link emailed to ${email}`
      : `Couldn't email ${email} their account link — ${welcome.reason}. It's in HQ → Customer Accounts.`);
    store.logActivity("system", mail.sent
      ? `Handover details emailed to ${notify.NOTIFY_EMAIL}`
      : `Couldn't email you the handover — ${mail.reason}. It's all in your CRM and HQ.`);
  });

  return { ok: true, claimId: claim.id, plan, emailed: welcome.sent };
}


// ---- credits ----------------------------------------------------------------

/** Which account does this Stripe customer belong to? */
function accountForCustomer(customerId, email) {
  const users = auth.getUsers();
  const byEmail = email && users.find((u) => u.email === String(email).toLowerCase());
  if (byEmail) return byEmail;
  return users.find((u) => u.stripeCustomerId === customerId) || null;
}

/**
 * The monthly grant. Fires on invoice.paid, which is the only event that
 * means money actually arrived — checkout.session.completed fires on a $0
 * trial signup too, and granting there would hand out a free month.
 *
 * Idempotent on the invoice id, so Stripe retrying costs nothing.
 */
async function handleInvoicePaid(invoice) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer && invoice.customer.id);
  const email = invoice.customer_email || (invoice.customer_details && invoice.customer_details.email);
  const user = accountForCustomer(customerId, email);
  if (!user) {
    tenant.run(tenant.MAIN, () => store.logActivity("system",
      `invoice.paid for ${email || customerId} — no matching account yet, so no credits granted`));
    return { ok: false, reason: "no account for this customer" };
  }

  const planId = catalog.PLANS[user.plan] ? user.plan : catalog.DEFAULT_PLAN;
  const periodStart = invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : undefined;

  const out = await tenant.run(user.accountId, () =>
    ledger.grantPlanCredits({ planId, invoiceId: invoice.id, periodStart }));

  tenant.run(user.accountId, () => store.logActivity("system", out.duplicate
    ? `invoice.paid replayed — credits already granted for ${invoice.id}`
    : `${catalog.plan(planId).name}: ${catalog.plan(planId).monthlyCredits} credits granted`));

  return { ok: true, granted: !out.duplicate, plan: planId, accountId: user.accountId };
}

/**
 * A one-off purchase: a top-up pack, a Launch Pack or an add-on.
 * Which one is carried in the checkout session's metadata, so a single
 * webhook route handles all three.
 */
async function handleOneOffPurchase(session) {
  const meta = session.metadata || {};
  const kind = meta.credit_kind;                    // "topup" | "launch_pack" | "addon"
  if (!kind) return { ok: false, reason: "not a credit purchase" };

  const email = (session.customer_details && session.customer_details.email) || session.customer_email;
  const customerId = typeof session.customer === "string" ? session.customer : (session.customer && session.customer.id);
  const user = accountForCustomer(customerId, email);
  if (!user) return { ok: false, reason: "no account for this customer" };

  const packId = meta.pack_id;
  let out;
  if (kind === "topup") {
    out = await tenant.run(user.accountId, () =>
      ledger.grantTopup({ packId, sessionId: session.id }));
  } else {
    out = await tenant.run(user.accountId, () =>
      ledger.grantLaunchPack({ packId, sessionId: session.id }));
    // Setup work needs a human. Put it on the team's list.
    if (!out.duplicate) {
      tenant.run(tenant.MAIN, () => {
        const tasks = store.getCol("tasks");
        const pack = catalog.LAUNCH_PACKS[packId] || catalog.ADDONS[packId];
        tasks.push({
          id: store.newId("task"),
          what: `Onboarding: ${pack ? pack.name : packId} for ${user.email}`,
          detail: pack ? pack.includes.join(" · ") : "",
          accountId: user.accountId,
          status: "open",
          createdAt: new Date().toISOString(),
        });
        store.saveCol("tasks", tasks);
        store.logActivity("system", `🎁 ${pack ? pack.name : packId} bought by ${user.email} — onboarding task created`);
      });
    }
  }

  tenant.run(user.accountId, () => store.logActivity("system", out.duplicate
    ? `Purchase replayed — credits already granted for ${session.id}`
    : `${out.entry.delta} credits added (${out.entry.note})`));

  return { ok: true, granted: !out.duplicate, credits: out.entry.delta, accountId: user.accountId };
}

async function handle(rawBody, signature, secret) {
  const v = verify(rawBody, signature, secret);
  if (!v.ok) return { status: 400, body: { error: `Signature check failed: ${v.reason}` } };

  let event;
  try { event = JSON.parse(rawBody); } catch { return { status: 400, body: { error: "bad JSON" } }; }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    // A one-off purchase (top-up / Launch Pack) is tagged in its metadata;
    // anything else is a new subscription signup.
    if (session.metadata && session.metadata.credit_kind) {
      const out = await handleOneOffPurchase(session);
      return { status: 200, body: { received: true, result: out } };
    }
    const out = await handleCheckout(session);
    return { status: 200, body: { received: true, result: out } };
  }
  // Everything else is acknowledged so Stripe stops retrying it.
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const out = await handleInvoicePaid(event.data.object);
    return { status: 200, body: { received: true, result: out } };
  }

  // A subscription ending or failing changes what they're entitled to. Until
  // now these were acknowledged and thrown away, so a cancellation was
  // invisible to the app.
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const user = accountForCustomer(typeof sub.customer === "string" ? sub.customer : null);
    if (user) {
      auth.setPlan(user.id, { planStatus: "cancelled" });
      tenant.run(tenant.MAIN, () => store.logActivity("auth", `Subscription cancelled: ${user.email}`));
    }
    return { status: 200, body: { received: true, cancelled: !!user } };
  }
  if (event.type === "invoice.payment_failed") {
    const inv = event.data.object;
    const user = accountForCustomer(typeof inv.customer === "string" ? inv.customer : null, inv.customer_email);
    if (user) {
      tenant.run(tenant.MAIN, () => store.logActivity("system", `⚠️ Payment failed for ${user.email} — credits not granted`));
    }
    return { status: 200, body: { received: true, noted: !!user } };
  }

  return { status: 200, body: { received: true, ignored: event.type } };
}

module.exports = { handle, verify, handleInvoicePaid, handleOneOffPurchase };
