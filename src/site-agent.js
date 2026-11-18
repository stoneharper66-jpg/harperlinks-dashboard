// The AI agent that lives on the public marketing website.
//
// It answers visitor questions about HarperLinks — what it is, pricing, how
// the 7-day setup works. By design it is NOT the dashboard engine:
//   - no tools, so it cannot touch posts, leads or any customer data
//   - its knowledge is this file's sales brief, nothing else
//   - every turn is metered against the founder's spend cap
//   - per-IP rate limiting lives in server.js in front of this
//
// Keyless installs answer from a small canned FAQ instead of pretending.

const budget = require("./budget");

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

let anthropic = null;
if (HAS_KEY) {
  const Anthropic = require("@anthropic-ai/sdk");
  anthropic = new Anthropic();
}

const SALES_BRIEF = `You are the friendly assistant on the HarperLinks website, a father-and-son
business automation company from Perth, Western Australia.

What HarperLinks is:
- An AI Business OS: customers tell their AI team what to do in plain English
  ("write me 5 posts for next week", "remind me to call Terry at 9am") and it
  does the work — writes social content in their brand voice, schedules and
  publishes it, manages leads, books appointments, tracks tasks.
- Done-for-you: after payment, the HarperLinks team personally sets up the
  customer's account — business profile, brand voice, social connections —
  within 7 days, coordinating over WhatsApp or email. The customer logs into a
  ready-made dashboard.

Pricing (AUD per month): Professional $249, Business $499, Enterprise $999.
Every plan includes the AI team, the dashboard, and the personal setup.

How buying works: pick a plan on this page, pay by card (Stripe), and the team
makes contact within a day or two — full setup inside 7 days.

Rules:
- Keep answers short (2-4 sentences), warm and plain-spoken. No emojis.
- Only discuss HarperLinks. For anything else, steer kindly back.
- Never invent features. If unsure, say the team can answer over WhatsApp
  after signup, or suggest they use the contact option.
- Never ask for or accept passwords, API keys or payment details in chat.`;

const CANNED = [
  { re: /price|cost|how much|plan/i, a: "HarperLinks is A$249, A$499 or A$999 a month depending on the plan — every plan includes your AI team, the dashboard, and a personal setup done for you within 7 days of signing up." },
  { re: /what is|what does|how does|do\b/i, a: "HarperLinks gives your business an AI team you talk to in plain English — it writes and schedules your social posts, manages leads, books appointments and tracks tasks. After you sign up, we set the whole thing up for you within 7 days." },
  { re: /setup|start|sign ?up|long/i, a: "Pick a plan and pay on this page — we'll be in touch within a day or two over WhatsApp or email, and your fully set-up account is ready within 7 days." },
];

// visitor id → recent turns, so the agent can follow a short conversation.
// In-memory and capped; wiped on restart, which is fine for a sales chat.
const convos = new Map();
const MAX_CONVOS = 500;

async function ask(visitorId, message) {
  const text = String(message || "").slice(0, 1000).trim();
  if (!text) return { reply: "Ask me anything about HarperLinks!" };

  if (!HAS_KEY) {
    const hit = CANNED.find((c) => c.re.test(text));
    return { reply: hit ? hit.a : "Great question — the team can answer that properly over WhatsApp or email once you get in touch. The short version: HarperLinks is your AI team for social content, leads and bookings, fully set up for you within 7 days." };
  }

  const allowed = budget.canSpend("claude.message");
  if (!allowed.ok) {
    return { reply: "I'm resting right now — but the team would love to hear from you. Pick a plan or reach out and they'll answer everything personally." };
  }

  if (convos.size > MAX_CONVOS) convos.clear();
  const key = String(visitorId || "anon").slice(0, 60);
  const history = convos.get(key) || [];

  history.push({ role: "user", content: text });
  while (history.length > 10) history.shift();

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    output_config: { effort: "low" },
    system: SALES_BRIEF,
    messages: history,
  });
  const reply = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  history.push({ role: "assistant", content: reply });
  convos.set(key, history);
  budget.record("claude.message", 1, "website agent");
  return { reply };
}

module.exports = { ask };
