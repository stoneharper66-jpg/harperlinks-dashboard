// The price list. Everything about what a plan gives and what an action costs
// lives here and nowhere else, so tuning the economics is a one-file edit and
// never a hunt through the codebase.
//
// Nothing in here is a feature gate. Every plan unlocks every employee and
// every feature — plans differ only by how many credits they include, how long
// unused credits last, how often the report runs, the support level, and the
// discount on top-ups.

// ---- plans ------------------------------------------------------------------

const PLANS = {
  starter: {
    id: "starter",
    name: "Starter",
    priceAUD: 99,
    monthlyCredits: 1000,
    rolloverMonths: 0,          // Starter resets each cycle
    topupDiscount: 0,
    report: "weekly",
    support: "Riley + email",
    blurb: "For a one-person business getting started.",
  },
  professional: {
    id: "professional",
    name: "Professional",
    priceAUD: 249,
    monthlyCredits: 3000,
    rolloverMonths: 1,
    topupDiscount: 0,
    report: "daily",
    support: "Email",
    blurb: "For solo operators who want content and leads handled.",
  },
  business: {
    id: "business",
    name: "Business",
    priceAUD: 499,
    monthlyCredits: 10000,
    rolloverMonths: 1,
    topupDiscount: 0.10,
    report: "daily",
    support: "Priority",
    popular: true,
    blurb: "For teams that want the whole front office automated.",
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    priceAUD: 999,
    monthlyCredits: 30000,
    rolloverMonths: 2,
    topupDiscount: 0.20,
    report: "daily",
    support: "Direct line",
    launchPackIncluded: true,
    extras: ["Custom workflows", "Signed webhooks", "Launch Pack included"],
    blurb: "For established businesses that want the lot, set up hands-on.",
  },
};

const PLAN_IDS = Object.keys(PLANS);
const DEFAULT_PLAN = "starter";

// ---- what an action costs ---------------------------------------------------
//
// `essential` actions are the ones a business loses money by missing: a lead
// going uncaptured, an enquiry going unanswered, a booking not taken. Those
// keep running on the overdraft buffer when credits hit zero. Everything else
// stops and asks for a top-up.
//
// `unit` marks costs that are charged per something — per 15 seconds of video,
// per minute of phone — rather than once per action.

const ACTIONS = {
  "social.post":            { credits: 5,    employee: "social",       label: "Social post + hashtags" },
  "social.week_plan":       { credits: 30,   employee: "social",       label: "Weekly content plan (7 posts)" },
  "social.image":           { credits: 20,   employee: "social",       label: "Branded image" },
  "social.video":           { credits: 400,  employee: "social",       label: "Short video", unit: "per 15 seconds", unitSeconds: 15 },

  "crm.lead_capture":       { credits: 1,    employee: "sales",        label: "Lead capture + score",  essential: true },
  "crm.follow_up":          { credits: 3,    employee: "sales",        label: "Follow-up draft",       essential: true },

  "support.reply":          { credits: 2,    employee: "support",      label: "Support reply",         essential: true },

  "booking.create":         { credits: 2,    employee: "receptionist", label: "Clash-checked booking", essential: true },

  "workflow.run":           { credits: 2,    employee: "manager",      label: "Workflow run" },

  "report.generate":        { credits: 10,   employee: "system",       label: "Daily / weekly AI report" },

  "website.learn":          { credits: 50,   employee: "system",       label: "Website learning",
                              freeAtOnboarding: true },
  "website.build":          { credits: 1500, employee: "web",          label: "Full website build" },
  "website.edit_small":     { credits: 50,   employee: "web",          label: "Website edit + security scan (small)" },
  "website.edit_large":     { credits: 100,  employee: "web",          label: "Website edit + security scan (large)" },

  // Off until the phone receptionist actually ships. `flag` names the feature
  // flag that must be true before this can ever be charged.
  "phone.minute":           { credits: 40,   employee: "manager",      label: "Phone receptionist", unit: "per minute",
                              flag: "phoneReceptionist" },
};

// Anything at or above this is worth confirming with the owner first, and is
// reserved before the work starts rather than debited after.
const RESERVE_THRESHOLD = 100;

// When the balance hits zero, essential work keeps running this far into the
// red — 5% of the plan's monthly allowance. Recovered from the next grant.
const OVERDRAFT_FRACTION = 0.05;

// ---- top-ups ----------------------------------------------------------------

const TOPUP_PACKS = {
  small:  { id: "small",  credits: 1000,  priceAUD: 15,  label: "1,000 credits" },
  medium: { id: "medium", credits: 5000,  priceAUD: 59,  label: "5,000 credits" },
  large:  { id: "large",  credits: 15000, priceAUD: 149, label: "15,000 credits" },
};

/** What a pack costs this plan, after its standing discount. */
function topupPriceAUD(packId, planId) {
  const pack = TOPUP_PACKS[packId];
  if (!pack) return null;
  const plan = PLANS[planId] || PLANS[DEFAULT_PLAN];
  const price = pack.priceAUD * (1 - (plan.topupDiscount || 0));
  return Math.round(price * 100) / 100;
}

// ---- Launch Packs and add-ons ----------------------------------------------
// One-off setup work we do for them. The credits land as `launch_pack` entries
// so the setup never eats the customer's monthly allowance.

const LAUNCH_PACKS = {
  starter: {
    id: "starter", name: "Starter Launch", priceAUD: 299, credits: 2000,
    includes: [
      "Business profile + brand voice",
      "Website refresh (up to 5 pages)",
      "2-week social plan — 14 posts written and scheduled",
      "Socials connected",
      "Handover video",
    ],
  },
  professional: {
    id: "professional", name: "Professional Launch", priceAUD: 449, credits: 2800,
    includes: [
      "Everything in Starter Launch",
      "Full website rebuild",
      "30-day plan — 30 posts + 10 branded images",
      "CRM pipeline + booking calendar set up",
    ],
  },
  business: {
    id: "business", name: "Business Launch", priceAUD: 699, credits: 4500,
    includes: [
      "Everything in Professional Launch",
      "Riley's knowledge base loaded",
      "3 automation workflows",
      "2 short videos",
      "30-minute handover call",
    ],
  },
  enterprise: {
    id: "enterprise", name: "Enterprise Launch", priceAUD: 0, credits: 5000,
    includedWithPlan: true,
    includes: [
      "Everything in Business Launch",
      "Custom workflows and signed webhooks",
      "Delivered within 7 days",
    ],
  },
};

const ADDONS = {
  website_rebuild: {
    id: "website_rebuild", name: "Website rebuild", priceAUD: 349, credits: 1700,
    includes: ["New site, security-scanned and published", "2 rounds of edits"],
  },
  social_kickstart: {
    id: "social_kickstart", name: "Social media kickstart", priceAUD: 149, credits: 550,
    includes: ["Audit", "30-day plan", "30 posts", "10 images"],
  },
  brand_voice: {
    id: "brand_voice", name: "Brand voice refresh", priceAUD: 99, credits: 100,
    includes: ["Re-learn the website", "Update tone, hashtags and knowledge base"],
  },
};

// ---- feature flags ----------------------------------------------------------

const FLAGS = {
  // The AI phone receptionist is not built. Until this is true, phone.minute
  // can never be charged and the feature is advertised as coming soon.
  phoneReceptionist: false,
  // Waive the Launch Pack fee for anyone on annual billing. Off by default.
  waiveLaunchPackOnAnnual: false,

  // The master switch for the whole rollout.
  //
  // While this is false, credits are COUNTED but never ENFORCED: every action
  // still writes a usage entry, so real consumption data builds up, but
  // nothing is ever refused. That is what makes it safe to ship the backend
  // before the credit bar and the pricing page exist — on the day this went
  // live nobody had a ledger, so enforcing would have blocked every post,
  // image and website edit for every existing customer.
  //
  // Flip to true only once: customers can see their balance, the site sells
  // credits, and the migration has granted everyone their first cycle.
  enforceCredits: false,
};

// ---- helpers ----------------------------------------------------------------

function plan(planId) {
  return PLANS[planId] || PLANS[DEFAULT_PLAN];
}

function action(key) {
  return ACTIONS[key] || null;
}

/**
 * What this action costs right now, in credits.
 * `units` multiplies unit-priced actions (video seconds, phone minutes) and is
 * rounded UP to the next whole unit, as specified.
 */
function cost(key, units) {
  const a = ACTIONS[key];
  if (!a) return null;                       // unknown action — caller decides
  if (a.flag && !FLAGS[a.flag]) return null; // feature isn't live; cannot charge
  if (!a.unitSeconds && a.unit !== "per minute") return a.credits;
  const per = a.unitSeconds || 60;           // video is per 15s, phone per minute
  const n = Math.max(1, Math.ceil((Number(units) || 0) / (a.unit === "per minute" ? 1 : per)));
  return a.credits * n;
}

function isEssential(key) {
  return !!(ACTIONS[key] && ACTIONS[key].essential);
}

function overdraftFor(planId) {
  return Math.floor(plan(planId).monthlyCredits * OVERDRAFT_FRACTION);
}

/** The public price list the marketing site and Riley both read. */
function publicCatalog() {
  return {
    plans: PLAN_IDS.map((id) => {
      const p = PLANS[id];
      return {
        id: p.id, name: p.name, priceAUD: p.priceAUD, monthlyCredits: p.monthlyCredits,
        rolloverMonths: p.rolloverMonths, topupDiscount: p.topupDiscount,
        report: p.report, support: p.support, popular: !!p.popular, blurb: p.blurb,
        launchPackIncluded: !!p.launchPackIncluded,
      };
    }),
    actions: Object.entries(ACTIONS)
      .filter(([, a]) => !a.flag || FLAGS[a.flag])
      .map(([key, a]) => ({ key, label: a.label, credits: a.credits, unit: a.unit || null,
                            employee: a.employee, essential: !!a.essential })),
    topups: Object.values(TOPUP_PACKS),
    launchPacks: Object.values(LAUNCH_PACKS),
    addons: Object.values(ADDONS),
    flags: Object.assign({}, FLAGS),
  };
}

module.exports = {
  PLANS, PLAN_IDS, DEFAULT_PLAN,
  ACTIONS, RESERVE_THRESHOLD, OVERDRAFT_FRACTION,
  TOPUP_PACKS, LAUNCH_PACKS, ADDONS, FLAGS,
  plan, action, cost, isEssential, overdraftFor, topupPriceAUD, publicCatalog,
};
