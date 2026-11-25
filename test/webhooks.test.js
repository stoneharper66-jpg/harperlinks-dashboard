// Stripe webhook tests. The thing these are really protecting is money:
// a retried delivery must never grant credits twice, and a $0 trial signup
// must never be mistaken for a paid month.

const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hl-hooks-"));
process.env.HARPERLINKS_DATA_DIR = TMP;

const tenant = require("../src/tenant");
const auth = require("../src/auth");
const ledger = require("../src/credits/ledger");
const hook = require("../src/stripe-hook");

const SECRET = "whsec_test_secret";

/** Sign a payload exactly the way Stripe does. */
function signed(body, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${sig}`;
}
function evt(type, object) {
  return JSON.stringify({ type, data: { object } });
}

let n = 0;
function makeCustomer(plan = "business") {
  const email = `cust${++n}@example.test`;
  const accountId = `cust${n}`;
  const user = auth.createUser({ email, name: `Cust ${n}`, password: "password123", role: "customer", accountId });
  auth.setPlan(user.id, { plan, planStatus: "active" });
  return { user, email, accountId };
}

// ---------------------------------------------------------- signatures ----

test("an unsigned delivery is refused", async () => {
  const out = await hook.handle(evt("invoice.paid", {}), "", SECRET);
  assert.equal(out.status, 400);
});

test("a delivery signed with the wrong secret is refused", async () => {
  const body = evt("invoice.paid", {});
  const out = await hook.handle(body, signed(body, "whsec_wrong"), SECRET);
  assert.equal(out.status, 400);
  assert.match(out.body.error, /Signature check failed/);
});

test("a replayed old delivery is refused on timestamp", async () => {
  const body = evt("invoice.paid", {});
  const old = Math.floor(Date.now() / 1000) - 3600;
  const out = await hook.handle(body, signed(body, SECRET, old), SECRET);
  assert.equal(out.status, 400);
  assert.match(out.body.error, /tolerance/);
});

// ------------------------------------------------------- the plan grant ----

test("invoice.paid grants that plan's monthly credits", async () => {
  const { email, accountId } = makeCustomer("business");
  const body = evt("invoice.paid", { id: "in_aaa", customer: "cus_aaa", customer_email: email });
  const out = await hook.handle(body, signed(body), SECRET);
  assert.equal(out.status, 200);
  assert.equal(out.body.result.granted, true);
  await tenant.run(accountId, async () => {
    assert.equal(ledger.balance(), 10000);
  });
});

test("a retried invoice.paid does NOT grant twice", async () => {
  const { email, accountId } = makeCustomer("professional");
  const body = evt("invoice.paid", { id: "in_bbb", customer: "cus_bbb", customer_email: email });
  await hook.handle(body, signed(body), SECRET);
  await hook.handle(body, signed(body), SECRET);
  const third = await hook.handle(body, signed(body), SECRET);
  assert.equal(third.body.result.granted, false, "the retry must be a no-op");
  await tenant.run(accountId, async () => {
    assert.equal(ledger.balance(), 3000, "granted exactly once");
  });
});

test("each plan grants its own allowance", async () => {
  const expected = { starter: 1000, professional: 3000, business: 10000, enterprise: 30000 };
  for (const [plan, credits] of Object.entries(expected)) {
    const { email, accountId } = makeCustomer(plan);
    const body = evt("invoice.paid", { id: `in_${plan}`, customer: `cus_${plan}`, customer_email: email });
    await hook.handle(body, signed(body), SECRET);
    await tenant.run(accountId, async () => {
      assert.equal(ledger.balance(), credits, `${plan} should grant ${credits}`);
    });
  }
});

test("invoice.paid for an unknown customer grants nothing and says so", async () => {
  const body = evt("invoice.paid", { id: "in_ghost", customer: "cus_ghost", customer_email: "nobody@example.test" });
  const out = await hook.handle(body, signed(body), SECRET);
  assert.equal(out.status, 200, "still acknowledged so Stripe stops retrying");
  assert.equal(out.body.result.ok, false);
});

test("a $0 trial signup does not grant a month of credits", async () => {
  // checkout.session.completed with no credit_kind is a new signup. It must
  // create a claim, not credits — otherwise a 7-day trial hands out a free month.
  const body = evt("checkout.session.completed", {
    id: "cs_trial", customer: "cus_trial", amount_total: 0,
    customer_details: { email: "trial@example.test", name: "Trial User" },
  });
  const out = await hook.handle(body, signed(body), SECRET);
  assert.equal(out.status, 200);
  assert.ok(out.body.result.claimId, "a claim, not a grant");
});

// ------------------------------------------------------------- top-ups ----

test("a top-up grants its pack's credits, exactly once", async () => {
  const { email, accountId } = makeCustomer("business");
  const body = evt("checkout.session.completed", {
    id: "cs_top1", customer: "cus_top1",
    customer_details: { email },
    metadata: { credit_kind: "topup", pack_id: "medium" },
  });
  const first = await hook.handle(body, signed(body), SECRET);
  assert.equal(first.body.result.credits, 5000);

  const retry = await hook.handle(body, signed(body), SECRET);
  assert.equal(retry.body.result.granted, false);

  await tenant.run(accountId, async () => {
    assert.equal(ledger.balance(), 5000, "one pack, not two");
  });
});

test("all three top-up packs grant the right amount", async () => {
  for (const [pack, credits] of Object.entries({ small: 1000, medium: 5000, large: 15000 })) {
    const { email, accountId } = makeCustomer("starter");
    const body = evt("checkout.session.completed", {
      id: `cs_${pack}`, customer: `cus_${pack}`,
      customer_details: { email },
      metadata: { credit_kind: "topup", pack_id: pack },
    });
    await hook.handle(body, signed(body), SECRET);
    await tenant.run(accountId, async () => {
      assert.equal(ledger.balance(), credits);
    });
  }
});

// -------------------------------------------------------- Launch Packs ----

test("a Launch Pack grants launch_pack credits and raises an onboarding task", async () => {
  const { email, accountId } = makeCustomer("professional");
  const body = evt("checkout.session.completed", {
    id: "cs_lp1", customer: "cus_lp1",
    customer_details: { email },
    metadata: { credit_kind: "launch_pack", pack_id: "business" },
  });
  const out = await hook.handle(body, signed(body), SECRET);
  assert.equal(out.body.result.credits, 4500);

  await tenant.run(accountId, async () => {
    const entry = ledger.history({ limit: 1 })[0];
    assert.equal(entry.type, "launch_pack", "must not come out of the monthly allowance");
  });

  const store = require("../src/store");
  await tenant.run(tenant.MAIN, async () => {
    const tasks = store.getCol("tasks").filter((t) => /Onboarding/.test(t.what || ""));
    assert.ok(tasks.length >= 1, "the team gets a task to actually do the setup");
  });
});

test("a retried Launch Pack grants once and raises one task", async () => {
  const { email, accountId } = makeCustomer("starter");
  const body = evt("checkout.session.completed", {
    id: "cs_lp2", customer: "cus_lp2",
    customer_details: { email },
    metadata: { credit_kind: "launch_pack", pack_id: "starter" },
  });
  const store = require("../src/store");
  const before = await tenant.run(tenant.MAIN, async () => store.getCol("tasks").length);

  await hook.handle(body, signed(body), SECRET);
  await hook.handle(body, signed(body), SECRET);

  await tenant.run(accountId, async () => assert.equal(ledger.balance(), 2000));
  const after = await tenant.run(tenant.MAIN, async () => store.getCol("tasks").length);
  assert.equal(after - before, 1, "one purchase, one task");
});

test("add-ons grant their credits too", async () => {
  const { email, accountId } = makeCustomer("business");
  const body = evt("checkout.session.completed", {
    id: "cs_addon", customer: "cus_addon",
    customer_details: { email },
    metadata: { credit_kind: "addon", pack_id: "social_kickstart" },
  });
  await hook.handle(body, signed(body), SECRET);
  await tenant.run(accountId, async () => assert.equal(ledger.balance(), 550));
});

// ------------------------------------------------- lifecycle events ----

test("a cancelled subscription is recorded instead of being thrown away", async () => {
  const { user } = makeCustomer("business");
  const users = auth.getUsers();
  const u = users.find((x) => x.id === user.id);
  u.stripeCustomerId = "cus_cancel";
  require("../src/store").saveGlobal("users", users);

  const body = evt("customer.subscription.deleted", { id: "sub_x", customer: "cus_cancel" });
  const out = await hook.handle(body, signed(body), SECRET);
  assert.equal(out.status, 200);
  assert.equal(out.body.cancelled, true);
  assert.equal(auth.getUsers().find((x) => x.id === user.id).planStatus, "cancelled");
});

test("an unrelated event is acknowledged, not errored", async () => {
  const body = evt("customer.updated", { id: "cus_zzz" });
  const out = await hook.handle(body, signed(body), SECRET);
  assert.equal(out.status, 200);
  assert.equal(out.body.ignored, "customer.updated");
});
