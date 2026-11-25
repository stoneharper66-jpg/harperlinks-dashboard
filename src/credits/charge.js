// The one place an action gets priced and billed.
//
// Call sites don't talk to the ledger directly — they call run() with an
// action key and the work to do, and this decides whether it's affordable,
// holds the credits if it's expensive, runs the work, and settles up. The
// rule that matters most is at the bottom of this file: if the work throws,
// nothing is charged.

const ledger = require("./ledger");
const catalog = require("./catalog");
const store = require("./../store");

/** Which plan is this account on? Falls back to the cheapest. */
function planFor(accountId) {
  try {
    const auth = require("./../auth");
    const tenant = require("./../tenant");
    const id = accountId || tenant.current();
    const user = auth.getUsers().find((u) => u.accountId === id && u.role !== "admin");
    return (user && user.plan) || catalog.DEFAULT_PLAN;
  } catch {
    return catalog.DEFAULT_PLAN;
  }
}

/** Has this account's website ever been learned? First one is free. */
function isFirstIngest() {
  try {
    return !store.getProfile().configured;
  } catch {
    return true;
  }
}

/**
 * Price, authorise, run, settle.
 *
 *   const out = await charge.run("website.build", { refId: post.id }, async () => {
 *     return await doTheExpensiveThing();
 *   });
 *
 * Returns { ok, result, cost } or { ok:false, reason, cost, needsTopup }.
 * The work is only run if the credits are there. If the work throws, the
 * reservation is released and the error is re-thrown — the caller sees its
 * own failure, and the customer is not billed for it.
 */
async function run(actionKey, opts = {}, work) {
  const planId = opts.planId || planFor(opts.accountId);

  // Website learning is free the first time — that's onboarding, not usage.
  if (actionKey === "website.learn" && catalog.action(actionKey).freeAtOnboarding && isFirstIngest()) {
    const result = await work();
    return { ok: true, result, cost: 0, free: true };
  }

  const held = await ledger.reserve(actionKey, {
    planId, units: opts.units, refId: opts.refId,
  });

  if (!held.ok) {
    return {
      ok: false,
      cost: held.cost,
      reason: held.reason,
      needsTopup: true,
      essential: catalog.isEssential(actionKey),
    };
  }

  let result;
  try {
    result = await work();
  } catch (e) {
    await held.release(e && e.message);
    throw e;                       // the caller's own error, uncharged
  }

  // Some callers signal failure by returning rather than throwing.
  if (result && result.ok === false) {
    await held.release(result.content || result.reason);
    return { ok: false, result, cost: 0, released: true };
  }

  await held.commit();
  return { ok: true, result, cost: held.cost };
}

/**
 * A quote, for the confirm dialog the UI shows before anything expensive.
 * Returns null for actions that don't need confirming.
 */
function preview(actionKey, { planId, units, accountId } = {}) {
  const cost = catalog.cost(actionKey, units);
  if (cost === null) return null;
  if (cost < catalog.RESERVE_THRESHOLD) return null;
  const a = catalog.action(actionKey);
  const plan = planId || planFor(accountId);
  const balance = ledger.balance();
  return {
    actionKey, cost, balance, label: a.label,
    affordable: balance >= cost,
    message: `This ${a.label.toLowerCase()} uses ~${cost} credits (you have ${Math.max(0, balance)}). Continue?`,
    plan,
  };
}

/** Just the check, for callers that want to refuse early with a good message. */
function check(actionKey, { planId, units, accountId } = {}) {
  return ledger.check(actionKey, { planId: planId || planFor(accountId), units });
}

module.exports = { run, preview, check, planFor };
