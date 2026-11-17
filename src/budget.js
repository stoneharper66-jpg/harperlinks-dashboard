// Spend guardrail.
//
// Anything that costs real money (Claude calls, image/video generation) has to
// go through here first. There is a hard monthly ceiling: under it the AI
// spends freely, and the moment it is reached everything paid stops dead.
//
// The point is that an autonomous bot can't quietly burn a month's budget
// overnight. Refusals are loud and logged, never silent.

const store = require("./store");

const DEFAULTS = {
  monthlyCapAUD: 50,      // hard ceiling — nothing paid runs past this
  warnAtPercent: 80,      // log a warning once spend crosses this
};

// Rough per-unit costs so the ledger means something before real invoices land.
// These are estimates, not billing truth — reconcile against the provider.
const PRICES = {
  "claude.message": 0.01,       // per chat turn, ballpark
  "image.generate": 0.06,       // per image
  "video.generate": 0.05,       // PER SECOND — multiply by duration
};

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7); // YYYY-MM
}

function getConfig() {
  const saved = store.getCol("budget-config", {});
  return Object.assign({}, DEFAULTS, saved);
}

function setConfig(patch) {
  const cfg = Object.assign(getConfig(), patch || {});
  if (typeof cfg.monthlyCapAUD === "number") {
    cfg.monthlyCapAUD = Math.max(0, cfg.monthlyCapAUD);
  }
  store.saveCol("budget-config", cfg);
  store.logActivity("budget", `Monthly spend cap set to A$${cfg.monthlyCapAUD}`);
  return cfg;
}

function ledger() {
  return store.getCol("budget-ledger", []);
}

function spentThisMonth(mk = monthKey()) {
  return ledger()
    .filter((e) => e.month === mk)
    .reduce((sum, e) => sum + e.cost, 0);
}

function status() {
  const cfg = getConfig();
  const spent = spentThisMonth();
  const cap = cfg.monthlyCapAUD;
  return {
    month: monthKey(),
    cap,
    spent: Math.round(spent * 100) / 100,
    remaining: Math.round(Math.max(0, cap - spent) * 100) / 100,
    percent: cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 100,
    exhausted: spent >= cap,
  };
}

function estimate(kind, units = 1) {
  const unit = PRICES[kind];
  if (unit === undefined) return 0;
  return unit * units;
}

/**
 * Ask permission before doing something that costs money.
 * Returns { ok: true } or { ok: false, reason } — callers must respect it.
 */
function canSpend(kind, units = 1) {
  const cost = estimate(kind, units);
  const s = status();
  if (cost === 0) return { ok: true, cost: 0 };
  if (s.exhausted) {
    return {
      ok: false,
      cost,
      reason: `Monthly spend cap reached (A$${s.spent.toFixed(2)} of A$${s.cap}). Raise the cap in Settings to continue.`,
    };
  }
  if (s.spent + cost > s.cap) {
    return {
      ok: false,
      cost,
      reason: `That would cost about A$${cost.toFixed(2)} and only A$${s.remaining.toFixed(2)} is left this month. Raise the cap in Settings to continue.`,
    };
  }
  return { ok: true, cost };
}

/** Record money actually spent. Call this AFTER the work succeeds. */
function record(kind, units = 1, note) {
  const cost = estimate(kind, units);
  if (cost === 0) return status();
  const before = status();
  const entries = ledger();
  entries.push({
    at: new Date().toISOString(),
    month: monthKey(),
    kind,
    units,
    cost,
    note: note || null,
  });
  while (entries.length > 2000) entries.shift();
  store.saveCol("budget-ledger", entries);

  const after = status();
  const cfg = getConfig();
  if (before.percent < cfg.warnAtPercent && after.percent >= cfg.warnAtPercent) {
    store.logActivity(
      "budget",
      `Spend is at ${after.percent}% of the A$${after.cap} monthly cap (A$${after.spent.toFixed(2)} used)`
    );
  }
  if (!before.exhausted && after.exhausted) {
    store.logActivity(
      "budget",
      `Monthly spend cap of A$${after.cap} reached — paid AI work is paused until the cap is raised or the month rolls over`
    );
  }
  return after;
}

module.exports = { getConfig, setConfig, status, canSpend, record, estimate, PRICES };
