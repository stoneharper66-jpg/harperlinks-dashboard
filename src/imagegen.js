// Real AI photographs for posts.
//
// Claude doesn't generate images, so this calls out to an image provider. It
// is OFF until a key is set, and everything degrades gracefully without it:
// the planner falls back to the business's own photos, then to branded cards.
//
// Turn it on with two variables:
//   IMAGEGEN_PROVIDER=openai | stability
//   IMAGEGEN_KEY=<the provider's key>
//
// Costs real money per image, so it's metered against the same monthly budget
// as everything else and refuses rather than overspends.

const fs = require("fs");
const path = require("path");
const store = require("./store");
const budget = require("./budget");

const PROVIDER = String(process.env.IMAGEGEN_PROVIDER || "").toLowerCase();
const KEY = process.env.IMAGEGEN_KEY || "";
const TIMEOUT_MS = 60000;

function configured() {
  return !!(KEY && (PROVIDER === "openai" || PROVIDER === "stability"));
}

function mediaDir() {
  const dir = path.join(store.accountDir(), "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A photo brief, not an advert. Text rendered into images always comes out
// mangled, and a stock-looking composite reads as fake — so we ask for neither.
function brief(prompt, profile) {
  const place = profile && profile.location ? ` in ${profile.location}` : "";
  return `Editorial photograph for a small business${place}. ${prompt}. ` +
    `Natural light, realistic, shallow depth of field, authentic and unposed. ` +
    `No text, no logos, no watermarks, no collage, no borders.`;
}

async function callOpenAI(prompt, size) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size, n: 1 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`image provider said ${res.status}`);
  const j = await res.json();
  const b64 = j.data && j.data[0] && j.data[0].b64_json;
  if (!b64) throw new Error("image provider returned nothing usable");
  return Buffer.from(b64, "base64");
}

async function callStability(prompt, size) {
  const [w, h] = size.split("x").map(Number);
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("output_format", "png");
  form.append("aspect_ratio", w === h ? "1:1" : "16:9");
  const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, Accept: "image/*" },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`image provider said ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Generate one photo. Returns the saved filename, or null if generation is
 * off, over budget, or the provider failed — callers fall back, never crash.
 */
async function generate(prompt, profile, opts = {}) {
  if (!configured()) return null;
  if (!budget.canSpend("image.generate", 1).ok) {
    store.logActivity("system", "Skipped generating a photo — monthly AI budget reached");
    return null;
  }
  const size = opts.format === "wide" ? "1536x1024" : "1024x1024";
  let buf;
  try {
    buf = PROVIDER === "openai"
      ? await callOpenAI(brief(prompt, profile), size)
      : await callStability(brief(prompt, profile), size);
  } catch (e) {
    store.logActivity("system", `Couldn't generate a photo — ${e.message}`);
    return null;
  }
  const name = `${store.newId("img")}.png`;
  fs.writeFileSync(path.join(mediaDir(), name), buf);
  budget.record("image.generate", 1, "AI photo for a post");
  return name;
}

module.exports = { configured, generate, PROVIDER };
