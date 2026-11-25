// Credit ledger tests. node:test, no new dependencies.
//   node --test test/
//
// Each test runs against a throwaway data directory so nothing touches real
// accounts, and uses a fake clock so rollover and expiry can be tested without
// waiting a month.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// point the store at a temp dir BEFORE anything requires it
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hl-ledger-"));
process.env.HARPERLINKS_DATA_DIR = TMP;

const tenant = require("../src/tenant");
const store = require("../src/store");
const catalog = require("../src/credits/catalog");
const ledger = require("../src/credits/ledger");

// These test the RULES, so they run with enforcement on. The rollout switch
// ships off — that's covered by its own tests at the bottom of charge.test.js.
require("../src/credits/catalog").FLAGS.enforceCredits = true;

const ACCOUNT = "testco";
let seq = 0;
function freshAccount() {
  const id = `testco${++seq}`;
  return id;
}

// run a function inside a tenant, like a real request does
function as(account, fn) {
  return tenant.run(account, fn);
}

// a clock we control
function clockAt(iso) {
  return () => new Date(iso).getTime();
}

// ---------------------------------------------------------------- basics ----

test("a new account starts at zero", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    assert.equal(ledger.balance(), 0);
  });
});

test("a plan grant lands the plan's monthly credits", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "in_1" });
    assert.equal(ledger.balance(), 10000);
  });
});

test("usage comes off the balance, and carries employee + action_key", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "in_2" });
    await ledger.charge("social.post");
    assert.equal(ledger.balance(), 995);
    const h = ledger.history({ limit: 1 });
    assert.equal(h[0].action_key, "social.post");
    assert.equal(h[0].employee, "social");
    assert.equal(h[0].delta, -5);
    assert.equal(h[0].type, "usage");
  });
});

test("every action in the catalog debits exactly what the table says", async () => {
  const expected = {
    "social.post": 5, "social.week_plan": 30, "social.image": 20,
    "crm.lead_capture": 1, "crm.follow_up": 3, "support.reply": 2,
    "booking.create": 2, "workflow.run": 2, "report.generate": 10,
    "website.learn": 50, "website.build": 1500,
    "website.edit_small": 50, "website.edit_large": 100,
  };
  for (const [key, credits] of Object.entries(expected)) {
    const acc = freshAccount();
    await as(acc, async () => {
      await ledger.grantPlanCredits({ planId: "enterprise", invoiceId: "in_x" });
      const before = ledger.balance();
      await ledger.charge(key);
      assert.equal(before - ledger.balance(), credits, `${key} should cost ${credits}`);
    });
  }
});

test("video rounds up to whole 15-second blocks", async () => {
  assert.equal(catalog.cost("social.video", 1), 400);
  assert.equal(catalog.cost("social.video", 15), 400);
  assert.equal(catalog.cost("social.video", 16), 800);
  assert.equal(catalog.cost("social.video", 45), 1200);
});

test("the phone receptionist cannot be charged while its flag is off", async () => {
  assert.equal(catalog.FLAGS.phoneReceptionist, false);
  assert.equal(catalog.cost("phone.minute", 10), null);
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "enterprise", invoiceId: "in_p" });
    const before = ledger.balance();
    const out = await ledger.charge("phone.minute", { units: 10 });
    assert.equal(out.ok, false);
    assert.equal(ledger.balance(), before, "nothing should have been charged");
  });
});

// ------------------------------------------------- reserve / commit / release ----

test("a big action reserves up front and commits on success", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "in_3" });
    const r = await ledger.reserve("website.build", { planId: "business" });
    assert.equal(r.ok, true);
    assert.equal(r.held, true, "1500 is over the threshold so it must hold");
    assert.equal(ledger.balance(), 8500, "held while the work runs");
    await r.commit();
    assert.equal(ledger.balance(), 8500, "commit keeps the charge");
  });
});

test("a failed call is never charged — the reservation is released in full", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "in_4" });
    const r = await ledger.reserve("website.build", { planId: "business" });
    assert.equal(ledger.balance(), 8500);
    await r.release("model timed out");
    assert.equal(ledger.balance(), 10000, "every credit back");
  });
});

test("small actions don't hold anything, they charge on success", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "in_5" });
    const r = await ledger.reserve("social.post", { planId: "starter" });
    assert.equal(r.held, false);
    assert.equal(ledger.balance(), 1000, "nothing held yet");
    await r.commit();
    assert.equal(ledger.balance(), 995);
  });
});

test("committing or releasing twice does nothing the second time", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "in_6" });
    const r = await ledger.reserve("website.build", { planId: "business" });
    await r.commit();
    await r.commit();
    assert.equal(ledger.balance(), 8500);

    const r2 = await ledger.reserve("website.build", { planId: "business" });
    await r2.release();
    await r2.release();
    assert.equal(ledger.balance(), 8500, "released once, not twice");
  });
});

// ------------------------------------------------------- running out ----

test("at zero, non-essential work is blocked with a top-up message", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "in_7" });
    await ledger.charge("website.build");            // 1500 against 1000
    const v = ledger.check("social.post", { planId: "starter" });
    assert.equal(v.ok, false);
    assert.match(v.reason, /top up/i);
  });
});

test("essential work keeps running on the 5% buffer", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "in_8" });
    // burn the lot
    for (let i = 0; i < 200; i++) await ledger.charge("social.post");
    assert.equal(ledger.balance(), 0);

    assert.equal(ledger.check("social.post", { planId: "starter" }).ok, false,
      "content must stop");
    const lead = ledger.check("crm.lead_capture", { planId: "starter" });
    assert.equal(lead.ok, true, "a lead must never be lost");
    assert.equal(lead.usingOverdraft, true);

    await ledger.charge("crm.lead_capture");
    assert.equal(ledger.balance(), -1, "the buffer is real, and visible");
  });
});

test("the buffer has a floor — 5% of the allowance and no further", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "in_9" });
    for (let i = 0; i < 200; i++) await ledger.charge("social.post");
    // starter buffer = 5% of 1000 = 50 credits
    for (let i = 0; i < 50; i++) await ledger.charge("crm.lead_capture");
    assert.equal(ledger.balance(), -50);
    const v = ledger.check("crm.lead_capture", { planId: "starter" });
    assert.equal(v.ok, false, "past the buffer, even essential work stops");
    assert.match(v.reason, /buffer/i);
  });
});

test("the next grant pays off the overdraft first", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "in_10" });
    for (let i = 0; i < 200; i++) await ledger.charge("social.post");
    for (let i = 0; i < 30; i++) await ledger.charge("crm.lead_capture");
    assert.equal(ledger.balance(), -30);

    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "in_11" });
    assert.equal(ledger.balance(), 970, "1000 granted, 30 owed");
  });
});

// ----------------------------------------------------- rollover & expiry ----

test("Starter does not roll over — last cycle's leftovers expire", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "in_12", periodStart: "2026-01-01T00:00:00Z" });
    await ledger.charge("social.post", {}, { clock: clockAt("2026-01-02T00:00:00Z") }); // 995 left
    // a month later, the old grant is dead
    const after = ledger.replay(ledger.history({ limit: 999 }).reverse(), new Date("2026-02-02T00:00:00Z"));
    assert.equal(after.balance, 0, "Starter resets each cycle");
    assert.equal(after.expired, 995);
  });
});

test("Professional rolls over for one month, then expires", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "professional", invoiceId: "in_13", periodStart: "2026-01-01T00:00:00Z" });
    const entries = ledger.history({ limit: 999 }).reverse();
    // still alive inside the rollover month
    assert.equal(ledger.replay(entries, new Date("2026-02-15T00:00:00Z")).balance, 3000);
    // dead once the rollover month has passed (grant + 1 month rollover = 2 months)
    assert.equal(ledger.replay(entries, new Date("2026-03-02T00:00:00Z")).balance, 0);
  });
});

test("Enterprise rolls over for two months", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "enterprise", invoiceId: "in_14", periodStart: "2026-01-01T00:00:00Z" });
    const entries = ledger.history({ limit: 999 }).reverse();
    assert.equal(ledger.replay(entries, new Date("2026-03-15T00:00:00Z")).balance, 30000, "still alive at 2.5 months");
    assert.equal(ledger.replay(entries, new Date("2026-04-05T00:00:00Z")).balance, 0, "gone after three");
  });
});

test("the oldest credits are spent first", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    // an old grant that dies soon, and a top-up that never dies
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "in_15", periodStart: "2026-01-01T00:00:00Z" });
    await ledger.grantTopup({ packId: "small", sessionId: "cs_1" }, { clock: clockAt("2026-01-05T00:00:00Z") });
    assert.equal(ledger.balance({ clock: clockAt("2026-01-06T00:00:00Z") }), 2000);

    // spend 1000 — it should come out of the expiring grant, not the top-up
    for (let i = 0; i < 200; i++) {
      await ledger.charge("social.post", {}, { clock: clockAt("2026-01-06T00:00:00Z") });
    }
    // after the grant would have expired, the top-up survives intact
    const entries = ledger.history({ limit: 9999 }).reverse();
    assert.equal(ledger.replay(entries, new Date("2026-03-01T00:00:00Z")).balance, 1000,
      "the top-up should be untouched and still alive");
  });
});

test("top-up credits don't expire", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantTopup({ packId: "large", sessionId: "cs_2" }, { clock: clockAt("2026-01-01T00:00:00Z") });
    const entries = ledger.history({ limit: 999 }).reverse();
    assert.equal(ledger.replay(entries, new Date("2027-06-01T00:00:00Z")).balance, 15000);
  });
});

// ------------------------------------------------------------ idempotency ----

test("a replayed plan grant does not grant twice", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "in_dup" });
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "in_dup" });
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "in_dup" });
    assert.equal(ledger.balance(), 10000, "granted exactly once");
  });
});

test("a replayed top-up and Launch Pack each grant once", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantTopup({ packId: "medium", sessionId: "cs_same" });
    await ledger.grantTopup({ packId: "medium", sessionId: "cs_same" });
    assert.equal(ledger.balance(), 5000);

    await ledger.grantLaunchPack({ packId: "business", sessionId: "cs_lp" });
    await ledger.grantLaunchPack({ packId: "business", sessionId: "cs_lp" });
    assert.equal(ledger.balance(), 9500, "5000 + 4500, each once");
  });
});

test("Launch Pack credits are their own type, so setup doesn't eat the allowance", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantLaunchPack({ packId: "starter", sessionId: "cs_lp2" });
    const h = ledger.history({ limit: 1 });
    assert.equal(h[0].type, "launch_pack");
    assert.equal(h[0].delta, 2000);
  });
});

// ------------------------------------------------------------- summary ----

test("the summary reports usage per employee for the cycle", async () => {
  const acc = freshAccount();
  await as(acc, async () => {
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "in_16" });
    await ledger.charge("social.post");       // social 5
    await ledger.charge("social.image");      // social 20
    await ledger.charge("support.reply");     // support 2
    await ledger.charge("crm.lead_capture");  // sales 1
    const s = ledger.summary("business");
    assert.equal(s.used, 28);
    assert.equal(s.byEmployee.social, 25);
    assert.equal(s.byEmployee.support, 2);
    assert.equal(s.byEmployee.sales, 1);
    assert.equal(s.balance, 10000 - 28);
    assert.equal(s.allowance, 10000);
    assert.ok(s.resetsAt, "a reset date is reported");
  });
});
