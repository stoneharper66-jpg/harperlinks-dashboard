// Website ingestion: fetch a URL, strip it to readable text, extract a
// business profile. LIVE mode asks Claude to extract structured fields;
// DEMO mode uses the page title + meta description heuristically.

const store = require("./store");

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || process.env.MODEL || "claude-opus-4-8";
const MAX_BYTES = 500 * 1024;
const MAX_CHARS = 8000;

let anthropic = null;
if (HAS_KEY) {
  const Anthropic = require("@anthropic-ai/sdk");
  anthropic = new Anthropic();
}

function normalizeUrl(raw) {
  let url = String(raw || "").trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const u = new URL(url);
    if (!/\./.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error(`The site responded with ${res.status}`);
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}

// Strip an HTML document down to { title, metaDescription, text }.
function extractText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const metaDescription =
    (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) ||
      [])[1] || "";

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: decode(title.trim()),
    metaDescription: decode(metaDescription.trim()),
    text: body.slice(0, MAX_CHARS),
  };
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// LIVE: ask Claude to pull structured business facts out of the page text.
async function extractProfileLive(url, page) {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    output_config: { effort: "low" },
    system:
      "You extract business facts from website text. Reply with ONLY a JSON object — no prose, no markdown fences — with keys: " +
      'name (string), businessType (string), tagline (string), services (array of strings, max 6), audience (string), tone (string, e.g. "friendly, professional"), location (string or null), keywords (array of strings, max 8). ' +
      "Use only facts present in the text; keep values short.",
    messages: [
      {
        role: "user",
        content: `Website: ${url}\nTitle: ${page.title}\nMeta description: ${page.metaDescription}\n\nPage text:\n${page.text}`,
      },
    ],
  });
  const raw = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const json = raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  return JSON.parse(json);
}

// DEMO: heuristic profile so ingestion visibly works with no API key.
function extractProfileDemo(url, page) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const name = (page.title.split(/[|–—-]/)[0] || host).trim() || host;
  const sentences = page.text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30);
  return {
    name,
    businessType: "Local business",
    tagline: page.metaDescription || sentences[0] || `What ${name} does best.`,
    services: sentences.slice(1, 4).map((s) => s.slice(0, 60).trim()).filter(Boolean),
    audience: "Local customers",
    tone: "friendly, professional",
    location: null,
    keywords: name.toLowerCase().split(/\s+/).slice(0, 3),
  };
}

// Main entry: fetch → extract → save. Returns the saved profile.
async function ingestWebsite(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error("That doesn't look like a valid website address.");

  let html;
  try {
    html = await fetchPage(url);
  } catch (e) {
    if (e.name === "AbortError") throw new Error("That site took too long to respond.");
    throw new Error(`Couldn't reach ${url} — ${e.message}`);
  }

  const page = extractText(html);
  if (!page.text && !page.title) throw new Error("The page loaded but had no readable text.");

  let fields;
  if (HAS_KEY) {
    try {
      fields = await extractProfileLive(url, page);
    } catch {
      fields = extractProfileDemo(url, page); // fall back rather than fail the ingest
    }
  } else {
    fields = extractProfileDemo(url, page);
  }

  const profile = {
    configured: true,
    sourceUrl: url,
    ingestedAt: new Date().toISOString(),
    name: fields.name || page.title || url,
    businessType: fields.businessType || "Business",
    tagline: fields.tagline || "",
    services: Array.isArray(fields.services) ? fields.services.slice(0, 6) : [],
    audience: fields.audience || "",
    tone: fields.tone || "friendly, professional",
    location: fields.location || null,
    keywords: Array.isArray(fields.keywords) ? fields.keywords.slice(0, 8) : [],
  };
  store.saveProfile(profile);
  store.logActivity("ingested", `Learned ${profile.name} from ${url}`);
  require("./events").emit("website.ingested", { summary: profile.name });
  return profile;
}

module.exports = { ingestWebsite, normalizeUrl };
