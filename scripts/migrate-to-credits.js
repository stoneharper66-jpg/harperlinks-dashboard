#!/usr/bin/env node
// One-off migration onto credit-based plans.
//
//   node scripts/migrate-to-credits.js --dry     see what would happen
//   node scripts/migrate-to-credits.js           do it
//
// Founding members keep the price they signed up at — that was the promise and
// it is not ours to break. This only records which NEW plan each existing
// subscriber maps to, grants their first month of credits, and adds the
// one-time 1,000-credit welcome bonus. It never touches Stripe, so nobody's
// billing changes.
//
// Safe to run twice: every grant is keyed, so a second run grants nothing.

const auth = require("../src/auth");
const store = require("../src/store");
const tenant = require("../src/tenant");
const catalog = require("../src/credits/catalog");
const ledger = require("../src/credits/ledger");

const DRY = process.argv.includes("--dry");

// Old plan → new plan. The three old tiers keep their names and their prices;
// Starter is new and nobody is on it yet.
const MAP = {
  professional: "professional",
  business: "business",
  enterprise: "enterprise",
};

// Some existing accounts never had a plan written to them at all — the field
// was only ever set by a Stripe purchase, and these predate that. The app's
// implicit default has always been Professional (publicUser filled it in), so
// that is what an unrecorded plan maps to. NOT Starter: quietly moving a
// founding member onto the cheapest tier would be a downgrade nobody agreed
// to. Override per account with --assume=<plan> if any of them is wrong.
const ASSUMED = (process.argv.find((a) => a.startsWith("--assume=")) || "").split("=")[1]
  || "professional";

async function main() {
  const users = auth.getUsers().filter((u) => u.role !== "admin");
  if (!users.length) {
    console.log("No customer accounts — nothing to migrate.");
    return;
  }

  console.log(`${DRY ? "DRY RUN — " : ""}migrating ${users.length} customer account(s)\n`);

  for (const u of users) {
    const oldPlan = u.plan || null;
    const newPlan = MAP[oldPlan] || ASSUMED;
    const plan = catalog.plan(newPlan);

    console.log(`  ${u.email}`);
    console.log(`    account:   ${u.accountId}`);
    console.log(`    plan:      ${oldPlan || "(none recorded — assuming " + ASSUMED + ")"} → ${plan.name} @ A$${plan.priceAUD}/mo`);
    console.log(`    credits:   ${plan.monthlyCredits}/month + 1,000 founding bonus`);

    if (DRY) { console.log(""); continue; }

    // Record the plan. The PRICE is untouched — their Stripe subscription
    // keeps billing whatever it already bills.
    if (u.plan !== newPlan) {
      auth.setPlan(u.id, { plan: newPlan, planStatus: u.planStatus || "active" });
    }

    await tenant.run(u.accountId, async () => {
      // First cycle of credits, keyed so a re-run is a no-op.
      const grant = await ledger.append({
        delta: plan.monthlyCredits,
        type: "plan_grant",
        expires_at: expiryFor(plan),
        idempotency_key: `migration:grant:${u.id}`,
        note: `${plan.name} — first credit cycle (migration)`,
      });

      // The thank-you for being here first.
      const bonus = await ledger.grantBonus({
        credits: 1000,
        reason: "Founding member — thank you",
        key: `migration:bonus:${u.id}`,
      });

      store.logActivity("system",
        `Moved to credit-based billing on the ${plan.name} plan. ` +
        `${plan.monthlyCredits} credits a month, plus 1,000 founding-member credits. ` +
        `Your price has not changed.`);

      const balance = ledger.balance();
      console.log(`    granted:   ${grant.duplicate ? "already done" : "yes"} / bonus ${bonus.duplicate ? "already done" : "yes"}`);
      console.log(`    balance:   ${balance}`);
    });
    console.log("");
  }

  console.log(DRY ? "Nothing was written." : "Done. Nobody's price changed.");
}

function expiryFor(plan) {
  const d = new Date();
  d.setMonth(d.getMonth() + 1 + (plan.rolloverMonths || 0));
  return d.toISOString();
}

main().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});
