// Charging tests — these go through src/credits/charge.js, the layer the real
// call sites use, rather than poking the ledger directly. That's the point:
// they prove the rule "a failed call is never charged" at the place it matters.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hl-charge-"));
process.env.HARPERLINKS_DATA_DIR = TMP;

const tenant = require("../src/tenant");
const ledger = require("../src/credits/ledger");
const charge = require("../src/credits/charge");
const catalog = require("../src/credits/catalog");

// These test the RULES, so they run with enforcement on. The rollout switch
// ships OFF — that's covered by its own tests at the bottom of this file.
catalog.FLAGS.enforceCredits = true;

let seq = 0;
const freshAccount = () => `chargeco${++seq}`;
const as = (acc, fn) => tenant.run(acc, fn);

test("a successful action is charged exactly once", async () => {
  await as(freshAccount(), async () => {
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "i1" });
    const out = await charge.run("social.image", { planId: "business" }, async () => ({ ok: true }));
    assert.equal(out.ok, true);
    assert.equal(out.cost, 20);
    assert.equal(ledger.balance(), 9980);
  });
});

test("a THROWN failure charges nothing and re-throws", async () => {
  await as(freshAccount(), async () => {
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "i2" });
    await assert.rejects(
      () => charge.run("website.build", { planId: "business" }, async () => {
        throw new Error("model timed out");
      }),
      /model timed out/,
      "the caller must see its own error"
    );
    assert.equal(ledger.balance(), 10000, "not a credit charged for a failed call");
  });
});

test("a RETURNED failure ({ok:false}) charges nothing either", async () => {
  await as(freshAccount(), async () => {
    await ledger.grantPlanCredits({ planId: "business", invoiceId: "i3" });
    const out = await charge.run("website.build", { planId: "business" },
      async () => ({ ok: false, content: "Couldn't save that" }));
    assert.equal(out.ok, false);
    assert.equal(out.released, true);
    assert.equal(ledger.balance(), 10000);
  });
});

test("an unaffordable non-essential action never runs the work at all", async () => {
  await as(freshAccount(), async () => {
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "i4" });
    let ran = false;
    const out = await charge.run("website.build", { planId: "starter" }, async () => { ran = true; return true; });
    assert.equal(out.ok, false);
    assert.equal(out.needsTopup, true);
    assert.equal(ran, false, "we must not spend the model call we can't pay for");
    assert.equal(ledger.balance(), 1000);
  });
});

test("an essential action still runs with an empty balance", async () => {
  await as(freshAccount(), async () => {
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "i5" });
    for (let i = 0; i < 200; i++) await ledger.charge("social.post");
    assert.equal(ledger.balance(), 0);

    let ran = false;
    const out = await charge.run("crm.lead_capture", { planId: "starter" }, async () => { ran = true; return true; });
    assert.equal(out.ok, true, "a lead must never be turned away");
    assert.equal(ran, true);
    assert.equal(ledger.balance(), -1);
  });
});

test("the first website learn is free, the next one costs 50", async () => {
  await as(freshAccount(), async () => {
    const store = require("../src/store");
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "i6" });

    const first = await charge.run("website.learn", { planId: "starter" }, async () => true);
    assert.equal(first.free, true, "onboarding is free");
    assert.equal(ledger.balance(), 1000);

    // now the business is configured, so it's a re-learn
    store.saveProfile({ configured: true, name: "Test" });
    const second = await charge.run("website.learn", { planId: "starter" }, async () => true);
    assert.equal(second.ok, true);
    assert.equal(second.cost, 50);
    assert.equal(ledger.balance(), 950);
  });
});

test("the cost preview only appears for actions worth confirming", async () => {
  await as(freshAccount(), async () => {
    await ledger.grantPlanCredits({ planId: "professional", invoiceId: "i7" });
    assert.equal(charge.preview("social.post", { planId: "professional" }), null,
      "5 credits needs no confirm dialog");

    const p = charge.preview("social.video", { planId: "professional", units: 15 });
    assert.equal(p.cost, 400);
    assert.equal(p.balance, 3000);
    assert.equal(p.affordable, true);
    assert.match(p.message, /400 credits/);
    assert.match(p.message, /you have 3000/);
  });
});

test("the preview says so when they can't afford it", async () => {
  await as(freshAccount(), async () => {
    await ledger.grantPlanCredits({ planId: "starter", invoiceId: "i8" });
    const p = charge.preview("website.build", { planId: "starter" });
    assert.equal(p.affordable, false, "1500 against 1000");
  });
});

test("every essential action in the catalog is one of the four the spec names", async () => {
  const essential = Object.entries(catalog.ACTIONS)
    .filter(([, a]) => a.essential).map(([k]) => k).sort();
  assert.deepEqual(essential,
    ["booking.create", "crm.follow_up", "crm.lead_capture", "support.reply"]);
});

test("reserved credits are released if the work dies mid-flight", async () => {
  await as(freshAccount(), async () => {
    await ledger.grantPlanCredits({ planId: "enterprise", invoiceId: "i9" });
    const before = ledger.balance();
    await assert.rejects(() => charge.run("social.video", { planId: "enterprise", units: 60 },
      async () => { throw new Error("ffmpeg died"); }));
    assert.equal(ledger.balance(), before, "1600 credits returned in full");
  });
});

// ---- rollout safety ---------------------------------------------------------
// These exist because shipping the backend before the UI nearly broke the live
// product: nobody had a ledger, so enforcement would have refused every post,
// image and website edit for every existing customer.

test("with enforcement off, nothing is ever refused — but usage is still recorded", async () => {
  const original = catalog.FLAGS.enforceCredits;
  catalog.FLAGS.enforceCredits = false;      // the state it actually ships in
  try {
  await as(freshAccount(), async () => {
    // no grant at all: balance zero
    assert.equal(ledger.balance(), 0);
    let ran = false;
    const out = await charge.run("website.build", { planId: "starter" }, async () => { ran = true; return true; });
    assert.equal(out.ok, true, "a paying customer must not be blocked mid-rollout");
    assert.equal(ran, true);
    // and the spend is on the books, so the numbers are real when we switch on.
    // A big action lands as a `reserve` entry plus a commit marker, so look
    // for the money rather than the most recent row.
    const spend = ledger.history({ limit: 10 }).find((e) => e.delta === -1500);
    assert.ok(spend, "the 1500 must be recorded somewhere");
    assert.equal(spend.action_key, "website.build");
    assert.equal(spend.employee, "web");
    // and it must show in the breakdown, not just the raw ledger
    assert.equal(ledger.summary("starter").byEmployee.web, 1500);
  });
  } finally { catalog.FLAGS.enforceCredits = original; }
});

test("an account that has never been granted is in grace even once enforcement is on", async () => {
  const original = catalog.FLAGS.enforceCredits;
  catalog.FLAGS.enforceCredits = true;
  try {
    await as(freshAccount(), async () => {
      assert.equal(ledger.hasEverBeenGranted(), false);
      const v = ledger.check("social.post", { planId: "starter" });
      assert.equal(v.ok, true, "predates credits — not their fault");
      assert.equal(v.grace, true);
    });
  } finally {
    catalog.FLAGS.enforceCredits = original;
  }
});

test("once granted, enforcement bites properly", async () => {
  const original = catalog.FLAGS.enforceCredits;
  catalog.FLAGS.enforceCredits = true;
  try {
    await as(freshAccount(), async () => {
      await ledger.grantPlanCredits({ planId: "starter", invoiceId: "grace1" });
      for (let i = 0; i < 200; i++) await ledger.charge("social.post");
      assert.equal(ledger.balance(), 0);
      assert.equal(ledger.check("social.post", { planId: "starter" }).ok, false,
        "now it's real: no credits, no content");
      assert.equal(ledger.check("crm.lead_capture", { planId: "starter" }).ok, true,
        "but a lead still gets through");
    });
  } finally {
    catalog.FLAGS.enforceCredits = original;
  }
});
