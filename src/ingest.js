// Website ingestion: crawl a business's site, strip it to readable text,
// harvest its real photos, and extract a business profile. LIVE mode asks
// Claude to extract structured fields; DEMO mode uses the page title + meta
// description heuristically.
//
// The crawl follows links on the SAME host only, and every URL goes through
// the connectors SSRF guard first — following links off a stranger's page is
// exactly the shape of request you don't want pointed at your own network.
//
// Progress is written to the account's "scan" record as it goes, so the
// dashboard can show the scan happening rather than a frozen spinner.

const store = require("./store");
const { assertSafeUrl } = require("./connectors");

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || process.env.MODEL || "claude-opus-4-8";
const MAX_BYTES = 500 * 1024;
const MAX_CHARS = 8000;       // per page
const MAX_TOTAL_CHARS = 26000; // across the whole crawl, keeps the Claude call sane
const MAX_PAGES = 12;
const MAX_IMAGES = 16;

// Pages worth reading first — this is where a small business actually says
// what it does, who it's for and how it talks.
const PRIORITY = [
  /about/i, /service/i, /product/i, /menu/i, /price|pricing|packages/i,
  /treatment|class|course/i, /gallery|work|portfolio/i, /contact/i, /faq/i, /blog|news/i,
];
const SKIP = /\.(pdf|zip|jpg|jpeg|png|gif|webp|svg|mp4|mov|avi|css|js|ico|woff2?|ttf)(\?|$)/i;
const SKIP_PATH = /\/(wp-admin|wp-login|cart|checkout|basket|account|login|signin|signup|privacy|terms|cookie)/i;

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

// ---- the crawl --------------------------------------------------------------

function sameHost(a, b) {
  const strip = (h) => h.replace(/^www\./, "").toLowerCase();
  return strip(a.hostname) === strip(b.hostname);
}

function discoverLinks(html, base) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 120) {
    let href = m[1].trim();
    if (!href || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    let u;
    try { u = new URL(href, base); } catch { continue; }
    u.hash = "";
    if (!sameHost(u, new URL(base))) continue;
    if (SKIP.test(u.pathname) || SKIP_PATH.test(u.pathname)) continue;
    const key = u.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  // Read the pages that describe the business before the long tail.
  return out.sort((a, b) => rank(a) - rank(b));
}

function rank(url) {
  for (let i = 0; i < PRIORITY.length; i++) if (PRIORITY[i].test(url)) return i;
  return PRIORITY.length + url.length / 1000; // shorter paths first among the rest
}

// Real photographs from the business's own site, for reuse in their posts.
// Icons, logos, sprites and tracking pixels are not photographs.
function harvestImages(html, base) {
  const out = [];
  const push = (raw) => {
    if (!raw) return;
    let u;
    try { u = new URL(raw.trim(), base); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(u.pathname)) return;        // no SVG/GIF
    if (/logo|icon|favicon|sprite|avatar|badge|pixel|placeholder|spinner/i.test(u.pathname)) return;
    const s = u.toString();
    if (!out.includes(s)) out.push(s);
  };
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og) push(og[1]);
  let m;
  const re = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
  while ((m = re.exec(html)) && out.length < MAX_IMAGES * 3) {
    const tag = m[0];
    // Skip anything the page itself declares tiny — those are never photos.
    const w = (tag.match(/\bwidth=["']?(\d+)/i) || [])[1];
    if (w && Number(w) < 240) continue;
    push(m[1]);
    const srcset = (tag.match(/\bsrcset=["']([^"']+)["']/i) || [])[1];
    if (srcset) push(srcset.split(",").pop().trim().split(/\s+/)[0]);
  }
  return out.slice(0, MAX_IMAGES);
}

function setScan(patch) {
  const cur = store.getCol("scan", {});
  const next = Object.assign({}, cur && cur.startedAt ? cur : {}, patch);
  store.saveCol("scan", next);
  return next;
}

/**
 * Walk the site breadth-first from the home page.
 * Returns { pages: [{url,title,metaDescription,text}], images: [url], text }
 */
async function crawl(startUrl, onStep) {
  const queue = [startUrl];
  const visited = new Set();
  const pages = [];
  const images = [];
  let total = 0;

  while (queue.length && pages.length < MAX_PAGES && total < MAX_TOTAL_CHARS) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    let html;
    try {
      await assertSafeUrl(url);        // re-checked per hop, not just on the seed
      html = await fetchPage(url);
    } catch (e) {
      if (pages.length === 0) throw e; // the home page failing is fatal; a sub-page isn't
      continue;
    }

    const page = extractText(html);
    page.url = url;
    if (page.text || page.title) {
      pages.push(page);
      total += page.text.length;
    }
    harvestImages(html, url).forEach((i) => { if (!images.includes(i)) images.push(i); });

    if (onStep) onStep({ url, pagesRead: pages.length, imagesFound: images.length, title: page.title });

    if (pages.length < MAX_PAGES) {
      discoverLinks(html, url).forEach((l) => {
        if (!visited.has(l) && !queue.includes(l)) queue.push(l);
      });
      queue.sort((a, b) => rank(a) - rank(b));
    }
  }

  return {
    pages,
    images: images.slice(0, MAX_IMAGES),
    text: pages.map((p) => `--- ${p.url}\n${p.text}`).join("\n\n").slice(0, MAX_TOTAL_CHARS),
  };
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

// Main entry: crawl → extract → save. Returns the saved profile.
async function ingestWebsite(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error("That doesn't look like a valid website address.");

  setScan({
    status: "crawling", url, startedAt: new Date().toISOString(),
    pagesRead: 0, imagesFound: 0, step: "Opening the site", visited: [], error: null,
  });

  let site;
  try {
    site = await crawl(url, (s) => {
      const cur = store.getCol("scan", {});
      const visited = (cur.visited || []).concat([{ url: s.url, title: s.title }]).slice(-MAX_PAGES);
      setScan({
        status: "crawling", pagesRead: s.pagesRead, imagesFound: s.imagesFound,
        step: `Reading ${prettyPath(s.url)}`, visited,
      });
    });
  } catch (e) {
    const msg = e.name === "AbortError"
      ? "That site took too long to respond."
      : `Couldn't reach ${url} — ${e.message}`;
    setScan({ status: "failed", step: msg, error: msg, finishedAt: new Date().toISOString() });
    throw new Error(msg);
  }

  if (!site.pages.length) {
    const msg = "The site loaded but had no readable text.";
    setScan({ status: "failed", step: msg, error: msg, finishedAt: new Date().toISOString() });
    throw new Error(msg);
  }

  setScan({ status: "thinking", step: "Working out what this business actually does" });

  const home = site.pages[0];
  const combined = { title: home.title, metaDescription: home.metaDescription, text: site.text };
  let fields;
  if (HAS_KEY) {
    try {
      fields = await extractProfileLive(url, combined);
    } catch {
      fields = extractProfileDemo(url, combined); // fall back rather than fail the ingest
    }
  } else {
    fields = extractProfileDemo(url, combined);
  }

  const profile = {
    configured: true,
    sourceUrl: url,
    ingestedAt: new Date().toISOString(),
    name: fields.name || home.title || url,
    businessType: fields.businessType || "Business",
    tagline: fields.tagline || "",
    services: Array.isArray(fields.services) ? fields.services.slice(0, 6) : [],
    audience: fields.audience || "",
    tone: fields.tone || "friendly, professional",
    location: fields.location || null,
    keywords: Array.isArray(fields.keywords) ? fields.keywords.slice(0, 8) : [],
    // Their own photographs, for their own posts.
    photos: site.images,
    pagesRead: site.pages.map((p) => ({ url: p.url, title: p.title })),
  };
  store.saveProfile(profile);

  // The scan also pre-fills the knowledge base — only the gaps, never
  // overwriting anything the owner typed themselves. Everything here came
  // off their own website, so it's theirs to correct, not ours to invent.
  const kb = store.getKnowledge();
  let kbTouched = false;
  if (!kb.description && (profile.tagline || profile.businessType)) {
    kb.description = [profile.name, profile.businessType, profile.tagline].filter(Boolean).join(" — ");
    kbTouched = true;
  }
  if ((!kb.services || !kb.services.length) && profile.services.length) {
    kb.services = profile.services.map((s) => ({ name: String(s).slice(0, 80), price: "" }));
    kbTouched = true;
  }
  if (!kb.locations && profile.location) { kb.locations = profile.location; kbTouched = true; }
  if (!kb.brandVoice && profile.tone) { kb.brandVoice = profile.tone; kbTouched = true; }
  if (kbTouched) {
    store.saveKnowledge(kb);
    store.logActivity("ingested", "Filled the knowledge base in from the website — check Settings and fix anything that's off");
  }

  store.logActivity("ingested",
    `Read ${site.pages.length} page${site.pages.length === 1 ? "" : "s"} of ${profile.name} and found ${site.images.length} photo${site.images.length === 1 ? "" : "s"}`);
  setScan({
    status: "done", step: `Learned ${profile.name}`, pagesRead: site.pages.length,
    imagesFound: site.images.length, finishedAt: new Date().toISOString(),
  });
  require("./events").emit("website.ingested", { summary: profile.name });
  return profile;
}

function prettyPath(u) {
  try {
    const p = new URL(u).pathname.replace(/\/$/, "");
    return p ? p.split("/").pop().replace(/[-_]/g, " ") : "the home page";
  } catch { return "a page"; }
}

function getScan() {
  return store.getCol("scan", {});
}

module.exports = { ingestWebsite, normalizeUrl, crawl, getScan };
