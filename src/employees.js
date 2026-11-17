// The AI workforce. Definitions are code (capabilities are facts about what
// this build can do); per-business state (enabled, mode, config) lives in
// data/employees.json. `ready: true` means the employee genuinely works in
// this build; otherwise `needs` lists what has to be connected first.

const store = require("./store");

const DEFINITIONS = [
  {
    id: "social",
    name: "Sage",
    role: "Social Media Manager",
    emoji: "📣",
    description: "Learns your business from your website, writes posts in your voice, plans the week and runs the publishing calendar.",
    capabilities: ["Generate posts, captions & hashtags", "Weekly content plans", "Schedule & queue posts", "Content calendar", "Publishing pipeline (preview mode)"],
    ready: true,
    needs: [],
  },
  {
    id: "support",
    name: "Riley",
    role: "Customer Support Agent",
    emoji: "💬",
    description: "Answers customer questions from your knowledge base, handles enquiries and escalates anything complex to you.",
    capabilities: ["Answer FAQs from the knowledge base", "Handle website enquiries", "Escalate complex conversations"],
    ready: true,
    needs: ["Instagram/Facebook DM access for social inboxes (Meta approval)"],
  },
  {
    id: "receptionist",
    name: "Harper",
    role: "AI Receptionist",
    emoji: "📞",
    description: "Answers calls, books and reschedules appointments, and takes messages. Phone line requires a Twilio connection.",
    capabilities: ["Book & reschedule appointments", "Take messages", "Answer business questions"],
    ready: false,
    needs: ["Twilio phone number + voice AI connection"],
  },
  {
    id: "sales",
    name: "Flynn",
    role: "Sales Agent",
    emoji: "🤝",
    description: "Captures and qualifies leads, keeps the CRM up to date and drafts follow-ups so nothing slips through.",
    capabilities: ["Capture & qualify leads", "Update the CRM", "Draft follow-ups for your approval"],
    ready: true,
    needs: ["Email/SMS integrations to send follow-ups automatically"],
  },
  {
    id: "web",
    name: "Indi",
    role: "Website Builder",
    emoji: "🌐",
    description: "Reads your current website, keeps the business knowledge fresh, and drafts new page copy and landing-page content.",
    capabilities: ["Ingest & re-ingest your website", "Draft landing page copy", "Keep business knowledge current"],
    ready: true,
    needs: ["Hosting/CMS access to push live edits (e.g. WordPress)"],
  },
  {
    id: "manager",
    name: "Darcy",
    role: "Business Manager",
    emoji: "📊",
    description: "Watches the numbers, writes your daily report, and points out what needs attention and where the opportunities are.",
    capabilities: ["Daily business report", "Monitor pipeline & calendar", "Spot missed follow-ups"],
    ready: true,
    needs: [],
  },
];

const STATE_DEFAULTS = { enabled: false, mode: "assisted", activatedAt: null };

function getEmployees() {
  const state = store.getCol("employees", []);
  return DEFINITIONS.map((def) => {
    const s = state.find((e) => e.id === def.id) || {};
    return Object.assign({}, def, STATE_DEFAULTS, s);
  });
}

function updateEmployee(id, patch) {
  const def = DEFINITIONS.find((d) => d.id === id);
  if (!def) return null;
  const state = store.getCol("employees", []);
  let s = state.find((e) => e.id === id);
  if (!s) {
    s = Object.assign({ id }, STATE_DEFAULTS);
    state.push(s);
  }
  if (typeof patch.enabled === "boolean") {
    s.enabled = patch.enabled;
    s.activatedAt = patch.enabled ? new Date().toISOString() : s.activatedAt;
    store.logActivity("employee", `${def.name} (${def.role}) ${patch.enabled ? "activated" : "paused"}`);
  }
  if (["assisted", "supervised", "autonomous"].includes(patch.mode)) {
    s.mode = patch.mode;
    store.logActivity("employee", `${def.name}'s operating mode set to ${patch.mode}`);
  }
  store.saveCol("employees", state);
  return Object.assign({}, def, STATE_DEFAULTS, s);
}

// Quick state lookup for behaviour gating (scheduler, tools, workflows).
function getState(id) {
  const def = DEFINITIONS.find((d) => d.id === id);
  if (!def) return { enabled: false, mode: "assisted", name: id };
  const s = store.getCol("employees", []).find((e) => e.id === id) || {};
  return {
    enabled: s.enabled || false,
    mode: s.mode || "assisted",
    name: def.name,
    role: def.role,
  };
}

module.exports = { getEmployees, updateEmployee, getState, DEFINITIONS };
