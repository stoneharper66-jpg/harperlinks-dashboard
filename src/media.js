// The media studio: real image and video generation, no external services.
//
// Images are branded SVG layouts rasterised to PNG with sharp. Videos are
// those same frames assembled into an MP4 slideshow by the bundled ffmpeg
// (ffmpeg-static) — slight zoom, clean fades, silent track. Everything lands
// in the current account's own media folder and is recorded in its "media"
// collection, so customers' files stay as separated as their data.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const sharp = require("sharp");
const ffmpegPath = require("ffmpeg-static");
const store = require("./store");
const tenant = require("./tenant");

const FORMATS = {
  square: { w: 1080, h: 1080 }, // Instagram/Facebook feed
  story: { w: 1080, h: 1920 },  // Stories / Reels / TikTok
  wide: { w: 1280, h: 720 },    // YouTube / link cards
};

const STYLES = ["bold", "clean", "dark"];

function mediaDir() {
  const id = tenant.current();
  if (!tenant.isValidId(id)) throw new Error("Bad account id");
  const dir = path.join(store.ACCOUNTS_DIR, id, "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Greedy word-wrap sized for the headline font. SVG has no text wrapping.
function wrap(text, perLine, maxLines) {
  const words = String(text || "").trim().split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length + cur.length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  }
  return lines;
}

// One branded frame as SVG. Styles: bold (brand gradient), clean (white),
// dark (charcoal). The business name sits top, headline centre, sub below.
function frameSVG({ headline, sub, business, style = "bold", format = "square" }) {
  const { w, h } = FORMATS[format] || FORMATS.square;
  const st = STYLES.includes(style) ? style : "bold";
  const palettes = {
    bold: { bg: `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A6DD8"/><stop offset="1" stop-color="#D81B72"/></linearGradient>`, fill: "url(#g)", text: "#FFFFFF", subText: "rgba(255,255,255,.85)", chip: "rgba(255,255,255,.18)", chipText: "#FFFFFF" },
    clean: { bg: "", fill: "#F6F8FC", text: "#0E1116", subText: "#55606E", chip: "rgba(10,109,216,.1)", chipText: "#0A6DD8" },
    dark: { bg: "", fill: "#101521", text: "#FFFFFF", subText: "rgba(255,255,255,.72)", chip: "rgba(95,233,247,.14)", chipText: "#5FE9F7" },
  };
  const p = palettes[st];
  const headSize = Math.round(w / 11);
  const perLine = format === "story" ? 16 : 18;
  const lines = wrap(headline, perLine, 4);
  const lineH = Math.round(headSize * 1.18);
  const blockH = lines.length * lineH;
  const cy = Math.round(h / 2 - blockH / 2 + headSize * 0.8);
  const headTspans = lines.map((l, i) => `<tspan x="${w / 2}" y="${cy + i * lineH}">${esc(l)}</tspan>`).join("");
  const subLines = wrap(sub, format === "story" ? 34 : 44, 2);
  const subSize = Math.round(headSize * 0.38);
  const subY = cy + blockH + Math.round(subSize * 0.6);
  const subTspans = subLines.map((l, i) => `<tspan x="${w / 2}" y="${subY + i * Math.round(subSize * 1.45)}">${esc(l)}</tspan>`).join("");
  const bizSize = Math.round(headSize * 0.32);
  const deco = st === "bold"
    ? `<circle cx="${w * 0.92}" cy="${h * 0.1}" r="${w * 0.18}" fill="rgba(255,255,255,.07)"/><circle cx="${w * 0.06}" cy="${h * 0.94}" r="${w * 0.22}" fill="rgba(255,255,255,.06)"/>`
    : st === "dark"
      ? `<circle cx="${w * 0.9}" cy="${h * 0.12}" r="${w * 0.2}" fill="rgba(10,109,216,.15)"/><circle cx="${w * 0.08}" cy="${h * 0.92}" r="${w * 0.24}" fill="rgba(216,27,114,.12)"/>`
      : `<circle cx="${w * 0.92}" cy="${h * 0.08}" r="${w * 0.2}" fill="rgba(10,109,216,.07)"/><circle cx="${w * 0.05}" cy="${h * 0.95}" r="${w * 0.24}" fill="rgba(216,27,114,.06)"/>`;
  const bizChip = business
    ? `<rect x="${w / 2 - (esc(business).length * bizSize * 0.32 + 44) / 2}" y="${Math.round(h * 0.08)}" rx="${bizSize}" width="${esc(business).length * bizSize * 0.32 + 44}" height="${Math.round(bizSize * 1.9)}" fill="${p.chip}"/>
       <text x="${w / 2}" y="${Math.round(h * 0.08) + Math.round(bizSize * 1.32)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${bizSize}" font-weight="700" fill="${p.chipText}">${esc(business)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${p.bg}</defs>
  <rect width="${w}" height="${h}" fill="${p.fill}"/>
  ${deco}
  ${bizChip}
  <text text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${headSize}" font-weight="800" fill="${p.text}" letter-spacing="-1">${headTspans}</text>
  <text text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${subSize}" font-weight="500" fill="${p.subText}">${subTspans}</text>
</svg>`;
}

function record(entry) {
  const media = store.getCol("media", []);
  media.push(entry);
  while (media.length > 200) media.shift();
  store.saveCol("media", media);
  return entry;
}

function list() {
  return store.getCol("media", []).slice().reverse();
}

function filePath(name) {
  // names are generated by us; reject anything that isn't ours
  if (!/^(img|vid)_[a-z0-9]+\.(png|mp4)$/.test(String(name))) return null;
  const p = path.join(mediaDir(), name);
  return fs.existsSync(p) ? p : null;
}

async function generateImage({ headline, sub, style, format }) {
  if (!String(headline || "").trim()) throw new Error("The image needs a headline.");
  const fmt = FORMATS[format] ? format : "square";
  const profile = store.getProfile();
  const svg = frameSVG({
    headline: String(headline).trim().slice(0, 120),
    sub: String(sub || "").trim().slice(0, 160),
    business: profile.configured ? profile.name : "",
    style, format: fmt,
  });
  const name = `${store.newId("img")}.png`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(mediaDir(), name));
  const { w, h } = FORMATS[fmt];
  const entry = record({
    id: name.replace(/\.png$/, ""), type: "image", file: name,
    headline: String(headline).trim().slice(0, 120), style: STYLES.includes(style) ? style : "bold",
    format: fmt, w, h, createdAt: new Date().toISOString(),
  });
  store.logActivity("media", `Designed a ${fmt} image — "${entry.headline}"`, entry.id);
  return entry;
}

function run(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { timeout: timeoutMs || 120000 }, (err, _out, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${String(stderr || err.message).slice(-300)}`));
      else resolve();
    });
  });
}

// A real MP4: each slide rendered as a frame, gentle zoom on every slide,
// crossfades between them, 30fps H.264 — plays everywhere, uploads anywhere.
async function generateVideo({ slides, style, format }) {
  const list_ = Array.isArray(slides) ? slides.filter((s) => s && String(s.headline || "").trim()) : [];
  if (!list_.length) throw new Error("The video needs at least one slide with a headline.");
  if (list_.length > 8) throw new Error("Keep it to 8 slides or fewer.");
  const fmt = FORMATS[format] ? format : "story";
  const { w, h } = FORMATS[fmt];
  const profile = store.getProfile();
  const dir = mediaDir();
  const stamp = store.newId("vid");
  const frames = [];
  for (let i = 0; i < list_.length; i++) {
    const svg = frameSVG({
      headline: String(list_[i].headline).trim().slice(0, 120),
      sub: String(list_[i].sub || "").trim().slice(0, 160),
      business: profile.configured ? profile.name : "",
      style, format: fmt,
    });
    const f = path.join(dir, `${stamp}_f${i}.png`);
    // render oversized so the zoom never shows soft edges
    await sharp(Buffer.from(svg)).resize(Math.round(w * 1.25), Math.round(h * 1.25)).png().toFile(f);
    frames.push(f);
  }

  const SLIDE_S = 2.6, FADE_S = 0.5, FPS = 30;
  const name = `${stamp}.mp4`;
  const outPath = path.join(dir, name);
  try {
    const inputs = [];
    frames.forEach((f) => inputs.push("-loop", "1", "-t", String(SLIDE_S), "-i", f));
    const zoom = `zoompan=z='1+0.04*on/${Math.round(SLIDE_S * FPS)}':d=${Math.round(SLIDE_S * FPS)}:s=${w}x${h}:fps=${FPS}`;
    const parts = frames.map((_, i) => `[${i}:v]${zoom},format=yuv420p[v${i}]`);
    let chain = "", last = "v0";
    for (let i = 1; i < frames.length; i++) {
      const next = `x${i}`;
      chain += `;[${last}][v${i}]xfade=transition=fade:duration=${FADE_S}:offset=${(SLIDE_S - FADE_S) * i}[${next}]`;
      last = next;
    }
    const filter = parts.join(";") + chain;
    await run([...inputs, "-filter_complex", filter, "-map", `[${last}]`, "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", "-y", outPath]);
  } finally {
    frames.forEach((f) => { try { fs.unlinkSync(f); } catch { /* already gone */ } });
  }

  const seconds = Math.round((SLIDE_S * list_.length - FADE_S * (list_.length - 1)) * 10) / 10;
  const entry = record({
    id: stamp, type: "video", file: name,
    headline: String(list_[0].headline).trim().slice(0, 120),
    slides: list_.length, seconds,
    style: STYLES.includes(style) ? style : "bold",
    format: fmt, w, h, createdAt: new Date().toISOString(),
  });
  store.logActivity("media", `Produced a ${seconds}s ${fmt} video — ${list_.length} slide(s), "${entry.headline}"`, entry.id);
  return entry;
}

module.exports = { generateImage, generateVideo, list, filePath, FORMATS, STYLES };
