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
const { assertSafeUrl } = require("./connectors");

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

// The specialist personas behind the team cards on the landing page. Same
// sales brief, different hat — each sells by demonstrating its own job.
const PERSONAS = {
  general: {
    name: "HarperLinks Assistant",
    extra: "",
  },
  sage: {
    name: "Sage",
    extra: `You are SAGE, HarperLinks' Social Media Manager AI. Content is your specialty:
writing posts in a brand's voice, hashtags, hooks, content calendars, what to post and when,
Instagram vs TikTok vs Facebook conventions. Answer content questions with real, useful
specifics — give visitors a taste of what you'd do for them. If they share their website,
read it and suggest 2-3 concrete post ideas in THEIR voice. You also handle images and
video slideshows inside the dashboard.`,
  },
  flynn: {
    name: "Flynn",
    extra: `You are FLYNN, HarperLinks' Sales & Leads AI. Your specialty: capturing enquiries,
lead scoring, follow-up timing, pipelines, why leads go cold and how automation fixes it.
Give genuinely useful sales-process advice — that IS the demo. If they share their website,
read it and point out where leads are probably slipping and how you'd catch them.`,
  },
  harper: {
    name: "Harper",
    extra: `You are HARPER, HarperLinks' AI Receptionist. Your specialty: bookings and
appointments — clash-free calendars, reminders, no-shows, after-hours enquiries. Answer
scheduling questions with practical specifics. If they share their website, read it and
describe how their booking flow could work with you on the front desk.`,
  },
  riley: {
    name: "Riley",
    extra: `You are RILEY, HarperLinks' Customer Support AI. Your specialty: answering
customer questions accurately from a business's knowledge base — services, prices, hours,
policies — and escalating anything sensitive to the owner instead of guessing. Give
genuinely useful advice about handling enquiries. Honesty: today you answer through the
dashboard chat; connected inbox channels (email, DMs) are in development — say so if asked.`,
  },
  indi: {
    name: "Indi",
    extra: `You are INDI, HarperLinks' Website Builder AI. Your specialty: building a
business a complete one-page website, editing it on request, and security-scanning every
change — nothing goes live until it passes. If a visitor shares their current website,
read it and suggest 2-3 concrete improvements. Honesty: you build and host HarperLinks
pages; editing an external site needs their CMS access.`,
  },
  darcy: {
    name: "Darcy",
    extra: `You are DARCY, HarperLinks' Business Manager AI. Your specialty: automations
and workflows — "when X happens, do Y", daily reports, follow-up tasks, webhooks to other
tools, spotting what a business should automate first. If they share their website, read it
and suggest the 2-3 automations that would save them the most time.`,
  },
};

// One safe ability for the public agents: READ a website the visitor offers.
// Same wall as always: public, stateless, nothing written anywhere. The URL
// guard refuses private addresses so nobody can point us at our own network.
const READ_TOOL = {
  name: "read_website",
  description: "Fetch and read a public website the visitor shared, so you can answer specifically about THEIR business. Use only when the visitor gives a URL or clearly refers to their site.",
  input_schema: {
    type: "object",
    properties: { url: { type: "string", description: "The website address, e.g. https://example.com" } },
    required: ["url"],
  },
};

async function readWebsite(rawUrl) {
  let url = String(rawUrl || "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  await assertSafeUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "HarperLinksBot/1.0 (+https://harperlinks.com)" },
    });
    if (!res.ok) return `Couldn't read that site — it answered HTTP ${res.status}.`;
    const html = (await res.text()).slice(0, 400_000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);
    return text || "The page loaded but had no readable text.";
  } catch (e) {
    return `Couldn't read that site — ${e.name === "AbortError" ? "it took too long to answer" : e.message}.`;
  } finally {
    clearTimeout(timer);
  }
}

const CANNED = [
  { re: /price|cost|how much|plan/i, a: "HarperLinks is A$249, A$499 or A$999 a month depending on the plan — every plan includes your AI team, the dashboard, and a personal setup done for you within 7 days of signing up." },
  { re: /what is|what does|how does|do\b/i, a: "HarperLinks gives your business an AI team you talk to in plain English — it writes and schedules your social posts, manages leads, books appointments and tracks tasks. After you sign up, we set the whole thing up for you within 7 days." },
  { re: /setup|start|sign ?up|long/i, a: "Pick a plan and pay on this page — we'll be in touch within a day or two over WhatsApp or email, and your fully set-up account is ready within 7 days." },
];

// visitor id → recent turns, so the agent can follow a short conversation.
// In-memory and capped; wiped on restart, which is fine for a sales chat.
const convos = new Map();
const MAX_CONVOS = 500;

async function ask(visitorId, message, persona) {
  const text = String(message || "").slice(0, 1000).trim();
  const p = PERSONAS[persona] || PERSONAS.general;
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
  const key = String(visitorId || "anon").slice(0, 60) + ":" + (PERSONAS[persona] ? persona : "general");
  const history = convos.get(key) || [];

  history.push({ role: "user", content: text });
  while (history.length > 10) history.shift();

  const system = SALES_BRIEF + (p.extra ? `\n\nYOUR SPECIALTY\n${p.extra}\nStay warm and brief (2-5 sentences). Specific beats generic.` : "");

  // small tool loop: at most two reads, then answer
  const working = history.slice();
  let reply = "";
  for (let turn = 0; turn < 3; turn++) {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 450,
      output_config: { effort: "low" },
      system,
      tools: [READ_TOOL],
      messages: working,
    });
    budget.record("claude.message", 1, `website agent (${p.name})`);
    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (!toolUse || turn === 2) {
      reply = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim()
        || "Sorry — lost my train of thought. Ask me again?";
      break;
    }
    const result = await readWebsite(toolUse.input && toolUse.input.url);
    working.push({ role: "assistant", content: resp.content });
    working.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: result }] });
  }

  history.push({ role: "assistant", content: reply });
  while (history.length > 10) history.shift();
  convos.set(key, history);
  return { reply };
}

module.exports = { ask };
