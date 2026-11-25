// The credit ledger. Append-only, and the balance is derived from it.
//
// There is no SQL here — this product stores everything as JSON files — so the
// guarantees a database would give us are built explicitly:
//
//   · Append-only. Nothing is ever edited or deleted. A release is a new
//     compensating entry, not an undo.
//   · Idempotency. Every entry may carry an idempotency_key; appending the
//     same key twice returns the first entry and writes nothing. That is what
//     makes a retried Stripe webhook safe.
//   · Balance by replay. Credits arrive in LOTS (a plan grant, a top-up, a
//     Launch Pack), each with its own expiry. Usage consumes the oldest
//     non-expired lot first. The balance is what's left in unexpired lots.
//     Replaying is how we know which lots expired *unused*, which a running
//     total could never tell us.
//   · Read-modify-write under a per-account lock, so two requests landing
//     together can't both read 500 and both spend it.
//
// Money rules this implements, from the spec:
//   · Plan grants on invoice.paid; rollover per plan; Starter resets.
//   · Actions >= 100 credits are RESERVED first and committed on success or
//     released on failure. Small actions debit after success. A failed call is
//     never charged.
//   · At zero, non-essential work stops; essential work (leads, follow-ups,
//     bookings, support replies) continues into a 5% overdraft so a customer
//     never loses a lead. The overdraft comes out of the next grant.

const crypto = require("crypto");
const store = require("./../store");
const catalog = require("./catalog");

const COL = "credit-ledger";
const MAX_ENTRIES = 20000;        // ~ years of history; trimmed oldest-first

// ---- per-account write lock -------------------------------------------------
// Node is single-threaded, but an await inside a read-modify-write is a gap
// another request can slip through. Every mutation serialises on this.
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

function now(clock) {
  return clock ? new Date(clock()) : new Date();
}

function read() {
  const data = store.getCol(COL, null);
  if (data && Array.isArray(data.entries)) return data;
  return { entries: [], cachedBalance: 0, cachedAt: null };
}
function write(data) {
  if (data.entries.length > MAX_ENTRIES) {
    data.entries = data.entries.slice(data.entries.length - MAX_ENTRIES);
  }
  store.saveCol(COL, data);
  return data;
}

const TYPES = ["plan_grant", "rollover", "topup", "bonus", "launch_pack",
               "usage", "refund", "expiry", "adjustment", "reserve"];

/**
 * Replay the ledger into lots and a balance, as at `at`.
 *
 * Returns { balance, lots, used, expired, reserved, byEmployee }.
 * `lots` are the open credit parcels, oldest first, each with what's left.
 */
function replay(entries, at) {
  const when = at instanceof Date ? at : new Date(at || Date.now());
  const lots = [];          // { id, remaining, expiresAt, type, createdAt }
  const released = new Set();
  let overdraft = 0;        // negative balance carried by essential work
  let expired = 0;

  // A release refunds a specific reservation; collect those first so the
  // reservation can be skipped entirely rather than double-counted.
  for (const e of entries) {
    if (e.type === "refund" && e.ref_id) released.add(e.ref_id);
  }

  // `asOf` is the moment the spend happened, NOT the moment we're asking.
  // Getting that wrong meant a post bought in January failed to consume the
  // January grant once we replayed in March — the grant expired "unused" and
  // the spend silently fell through onto a later, still-live lot.
  const take = (amount, allowOverdraft, asOf) => {
    let need = amount;
    for (const lot of lots) {
      if (need <= 0) break;
      if (lot.remaining <= 0) continue;
      if (lot.expiresAt && new Date(lot.expiresAt) <= asOf) continue; // dead when spent
      const spend = Math.min(lot.remaining, need);
      lot.remaining -= spend;
      need -= spend;
    }
    if (need > 0) {
      // nothing left — essential work is allowed to go under
      if (allowOverdraft) overdraft += need;
      else return need;         // unfunded; caller decides
    }
    return 0;
  };

  for (const e of entries) {
    if (e.type === "refund") continue;                 // handled via `released`
    if (e.type === "reserve" && released.has(e.id)) continue; // released: never happened
    if (e.delta > 0) {
      lots.push({
        id: e.id, remaining: e.delta, expiresAt: e.expires_at || null,
        type: e.type, createdAt: e.created_at,
      });
      // a grant first pays off any overdraft carried from last cycle
      if (overdraft > 0) {
        const pay = Math.min(overdraft, e.delta);
        lots[lots.length - 1].remaining -= pay;
        overdraft -= pay;
      }
    } else if (e.delta < 0) {
      take(-e.delta, !!e.essential, new Date(e.created_at));
    }
  }

  // Anything still sitting in a lot whose expiry has passed is gone.
  for (const lot of lots) {
    if (lot.expiresAt && new Date(lot.expiresAt) <= when && lot.remaining > 0) {
      expired += lot.remaining;
      lot.remaining = 0;
    }
  }

  const live = lots.filter((l) => l.remaining > 0);
  const balance = live.reduce((s, l) => s + l.remaining, 0) - overdraft;

  return { balance, lots: live, overdraft, expired };
}

/** Everything the UI needs, computed once. */
function summary(planId, opts = {}) {
  const data = read();
  const at = now(opts.clock);
  const r = replay(data.entries, at);
  const plan = catalog.plan(planId);
  const cycle = cycleWindow(data.entries, at);

  const used = data.entries
    .filter((e) => e.delta < 0 && e.type === "usage" && new Date(e.created_at) >= cycle.start)
    .reduce((s, e) => s + -e.delta, 0);

  const byEmployee = {};
  data.entries
    .filter((e) => e.delta < 0 && e.type === "usage" && new Date(e.created_at) >= cycle.start)
    .forEach((e) => {
      const k = e.employee || "system";
      byEmployee[k] = (byEmployee[k] || 0) + -e.delta;
    });

  return {
    balance: r.balance,
    overdraft: r.overdraft,
    allowance: plan.monthlyCredits,
    used,
    percentUsed: plan.monthlyCredits ? Math.min(100, Math.round((used / plan.monthlyCredits) * 100)) : 0,
    resetsAt: cycle.end ? cycle.end.toISOString() : null,
    cycleStart: cycle.start.toISOString(),
    byEmployee,
    plan: plan.id,
    overdraftLimit: catalog.overdraftFor(plan.id),
  };
}

/** The current billing cycle: from the most recent plan grant, for a month. */
function cycleWindow(entries, at) {
  const grants = entries.filter((e) => e.type === "plan_grant");
  const last = grants[grants.length - 1];
  const start = last ? new Date(last.created_at) : startOfMonth(at);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}
function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1); x.setHours(0, 0, 0, 0);
  return x;
}

// ---- appending --------------------------------------------------------------

function makeEntry(fields, at) {
  return {
    id: fields.id || `cl_${crypto.randomBytes(9).toString("base64url")}`,
    delta: Math.round(Number(fields.delta) || 0),
    type: TYPES.includes(fields.type) ? fields.type : "adjustment",
    action_key: fields.action_key || null,
    employee: fields.employee || null,
    ref_id: fields.ref_id || null,
    expires_at: fields.expires_at || null,
    idempotency_key: fields.idempotency_key || null,
    essential: !!fields.essential,
    note: fields.note ? String(fields.note).slice(0, 160) : null,
    created_at: (at || new Date()).toISOString(),
  };
}

/**
 * Append one entry. If its idempotency_key has been seen, nothing is written
 * and the original entry comes back — which is what makes a replayed webhook
 * harmless.
 */
function append(fields, opts = {}) {
  return withLock(store.accountDir(), () => {
    const data = read();
    if (fields.idempotency_key) {
      const seen = data.entries.find((e) => e.idempotency_key === fields.idempotency_key);
      if (seen) return { entry: seen, duplicate: true };
    }
    const entry = makeEntry(fields, now(opts.clock));
    data.entries.push(entry);
    data.cachedBalance = replay(data.entries, now(opts.clock)).balance;
    data.cachedAt = entry.created_at;
    write(data);
    return { entry, duplicate: false };
  });
}

function balance(opts = {}) {
  return replay(read().entries, now(opts.clock)).balance;
}

// ---- granting ---------------------------------------------------------------

/**
 * The monthly plan grant. Unused credits from previous grants live for
 * `rolloverMonths` months; Starter (0 months) expires its old grant outright.
 * Idempotent on the invoice id.
 */
function grantPlanCredits({ planId, invoiceId, periodStart }, opts = {}) {
  const plan = catalog.plan(planId);
  const at = periodStart ? new Date(periodStart) : now(opts.clock);
  const expires = new Date(at);
  // a grant lives for this cycle plus however many months of rollover
  expires.setMonth(expires.getMonth() + 1 + (plan.rolloverMonths || 0));

  return append({
    delta: plan.monthlyCredits,
    type: "plan_grant",
    expires_at: expires.toISOString(),
    ref_id: invoiceId || null,
    idempotency_key: invoiceId ? `grant:${invoiceId}` : undefined,
    note: `${plan.name} monthly credits`,
  }, Object.assign({}, opts, { clock: () => at.getTime() }));
}

/** A bought top-up. Never expires while the subscription is alive. */
function grantTopup({ packId, sessionId, credits }, opts = {}) {
  const pack = catalog.TOPUP_PACKS[packId];
  const amount = credits || (pack && pack.credits);
  if (!amount) throw new Error("Unknown top-up pack.");
  return append({
    delta: amount,
    type: "topup",
    ref_id: sessionId || null,
    idempotency_key: sessionId ? `topup:${sessionId}` : undefined,
    note: pack ? pack.label : `${amount} credits`,
  }, opts);
}

/** A Launch Pack or add-on — setup work that must not eat the allowance. */
function grantLaunchPack({ packId, sessionId, credits }, opts = {}) {
  const pack = catalog.LAUNCH_PACKS[packId] || catalog.ADDONS[packId];
  const amount = credits || (pack && pack.credits);
  if (!amount) throw new Error("Unknown Launch Pack.");
  return append({
    delta: amount,
    type: "launch_pack",
    ref_id: sessionId || null,
    idempotency_key: sessionId ? `launch:${sessionId}` : undefined,
    note: pack ? pack.name : `${amount} setup credits`,
  }, opts);
}

function grantBonus({ credits, reason, key }, opts = {}) {
  return append({
    delta: credits,
    type: "bonus",
    idempotency_key: key,
    note: reason || "Bonus credits",
  }, opts);
}

// ---- spending ---------------------------------------------------------------

/**
 * Can this action run? Returns { ok, cost, reason, essential }.
 * Essential actions stay allowed into the overdraft; everything else stops
 * dead at zero and asks for a top-up.
 */
function check(actionKey, { planId, units } = {}, opts = {}) {
  const cost = catalog.cost(actionKey, units);
  if (cost === null) {
    const a = catalog.action(actionKey);
    return { ok: false, cost: 0, reason: a ? `${a.label} isn't available yet.` : `Unknown action "${actionKey}".` };
  }
  const bal = balance(opts);
  const essential = catalog.isEssential(actionKey);
  if (bal >= cost) return { ok: true, cost, balance: bal, essential };

  if (essential) {
    const limit = catalog.overdraftFor(planId);
    const after = bal - cost;
    if (after >= -limit) {
      return { ok: true, cost, balance: bal, essential: true, usingOverdraft: true };
    }
    return { ok: false, cost, balance: bal, essential: true,
             reason: "You're past the emergency buffer — top up to keep going." };
  }
  return { ok: false, cost, balance: bal, essential: false,
           reason: `This needs ${cost} credits and you have ${Math.max(0, bal)}. Top up to continue.` };
}

/**
 * Reserve credits before an expensive call. Returns a handle with commit() and
 * release(). Anything under the threshold doesn't reserve — it just debits
 * after the work succeeds.
 */
async function reserve(actionKey, { planId, units, refId } = {}, opts = {}) {
  const verdict = check(actionKey, { planId, units }, opts);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, cost: verdict.cost };

  const a = catalog.action(actionKey);
  if (verdict.cost < catalog.RESERVE_THRESHOLD) {
    // small action: nothing held, charged on success
    return {
      ok: true, cost: verdict.cost, held: false,
      commit: (note) => charge(actionKey, { planId, units, refId, note }, opts),
      release: () => Promise.resolve({ released: false }),
    };
  }

  const { entry } = await append({
    delta: -verdict.cost,
    type: "reserve",
    action_key: actionKey,
    employee: a.employee,
    ref_id: refId || null,
    essential: !!a.essential,
    note: `Reserved for ${a.label}`,
  }, opts);

  let settled = false;
  return {
    ok: true, cost: verdict.cost, held: true, reserveId: entry.id,
    // Success: turn the hold into a real usage entry.
    commit: async (note) => {
      if (settled) return { ok: true, already: true };
      settled = true;
      await append({
        delta: 0, type: "adjustment", ref_id: entry.id,
        action_key: actionKey, employee: a.employee,
        note: note || `Committed ${a.label}`,
        idempotency_key: `commit:${entry.id}`,
      }, opts);
      return { ok: true, cost: verdict.cost };
    },
    // Failure: give it all back. A failed AI call is never charged.
    release: async (why) => {
      if (settled) return { released: false, already: true };
      settled = true;
      await append({
        delta: verdict.cost, type: "refund", ref_id: entry.id,
        action_key: actionKey, employee: a.employee,
        note: why ? `Released: ${String(why).slice(0, 80)}` : "Released — the work failed",
        idempotency_key: `release:${entry.id}`,
      }, opts);
      return { released: true, cost: verdict.cost };
    },
  };
}

/** Debit for a completed small action. */
function charge(actionKey, { planId, units, refId, note, idempotencyKey } = {}, opts = {}) {
  const cost = catalog.cost(actionKey, units);
  if (cost === null) return Promise.resolve({ ok: false, reason: "Unknown or unavailable action." });
  const a = catalog.action(actionKey);
  return append({
    delta: -cost,
    type: "usage",
    action_key: actionKey,
    employee: a.employee,
    ref_id: refId || null,
    essential: !!a.essential,
    idempotency_key: idempotencyKey,
    note: note || a.label,
  }, opts).then((r) => ({ ok: true, cost, duplicate: r.duplicate, entry: r.entry }));
}

/** The raw entries, newest first, for the usage history page. */
function history({ limit = 200, type, employee, since } = {}) {
  let out = read().entries.slice().reverse();
  if (type) out = out.filter((e) => e.type === type);
  if (employee) out = out.filter((e) => e.employee === employee);
  if (since) out = out.filter((e) => new Date(e.created_at) >= new Date(since));
  return out.slice(0, limit);
}

module.exports = {
  append, balance, summary, replay, history, check, reserve, charge,
  grantPlanCredits, grantTopup, grantLaunchPack, grantBonus,
  cycleWindow, TYPES,
};
