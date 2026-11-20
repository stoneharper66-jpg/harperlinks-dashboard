// The customer's website.
//
// Two honest modes:
//   external — they already have a site. We store the URL and show it in a
//              preview frame. We CANNOT edit someone else's hosted site
//              without their CMS credentials, and we never pretend otherwise.
//   built    — a one-page site the AI wrote, stored per account and served
//              from this server at /site/<accountId>. This one the AI can
//              genuinely edit, because we own it.
//
// Every save keeps the previous version so an edit can be undone.

const store = require("./store");

const MAX_VERSIONS = 10;

function get() {
  const w = store.getCol("website", {});
  return {
    mode: w.mode || (w.html || w.draft ? "built" : w.externalUrl ? "external" : "none"),
    externalUrl: w.externalUrl || "",
    html: w.html || "",                       // the PUBLISHED page
    draft: w.draft ? { title: w.draft.title, note: w.draft.note, at: w.draft.at } : null,
    hasDraft: !!(w.draft && w.draft.html),
    published: !!w.html,
    publishedAt: w.publishedAt || null,
    title: (w.draft && w.draft.title) || w.title || "",
    updatedAt: w.updatedAt || null,
    versions: (w.versions || []).map((v) => ({ at: v.at, note: v.note })),
  };
}

function draftHtml() {
  const w = raw();
  return (w.draft && w.draft.html) || w.html || "";
}

function raw() {
  return store.getCol("website", {});
}

function setExternal(url) {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) throw new Error("Give a full address starting with http:// or https://");
  const w = raw();
  w.mode = "external";
  w.externalUrl = u;
  w.updatedAt = new Date().toISOString();
  store.saveCol("website", w);
  store.logActivity("website", `Website linked: ${u}`);
  return get();
}

// Every save is a DRAFT. Nothing reaches the public address until publish()
// runs — and publish refuses while the security scan has failures.
function saveHtml(html, { title, note } = {}) {
  const body = String(html || "");
  if (body.length < 40) throw new Error("That page looks empty.");
  if (body.length > 400_000) throw new Error("That page is too big to store.");
  const w = raw();
  w.mode = "built";
  w.draft = {
    html: body,
    title: String(title || (w.draft && w.draft.title) || w.title || "").slice(0, 120),
    note: note || "",
    at: new Date().toISOString(),
  };
  w.updatedAt = w.draft.at;
  store.saveCol("website", w);
  store.logActivity("website", note ? `Website draft saved — ${note}` : "Website draft saved");
  return get();
}

// ---- the security & quality scan -------------------------------------------
// Static checks against the page we'd be putting on the public internet.
// "security" failures block publishing; "quality" ones are advice.
function scan() {
  const html = draftHtml();
  if (!html) throw new Error("There's no page to scan yet.");
  const checks = [];
  const add = (id, label, ok, kind, detail) =>
    checks.push({ id, label, ok: !!ok, kind, detail: ok ? "" : detail });

  const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const scripts = (noComments.match(/<script\b/gi) || []).length;
  add("scripts", "No JavaScript on the page", scripts === 0, "security",
    scripts + " <script> tag(s) found — the public page is served with scripts blocked, so these would silently not run. Remove them.");

  const handlers = (noComments.match(/\son[a-z]+\s*=/gi) || []).length;
  add("handlers", "No inline event handlers", handlers === 0, "security",
    handlers + " inline handler(s) like onclick= found — they won't run under the page's security policy and shouldn't be there.");

  const jsUrls = (noComments.match(/(href|src|action)\s*=\s*["']?\s*javascript:/gi) || []).length;
  add("jsurls", "No javascript: links", jsUrls === 0, "security", jsUrls + " javascript: URL(s) found.");

  const frames = (noComments.match(/<(iframe|object|embed)\b/gi) || []).length;
  add("frames", "No embedded frames or plugins", frames === 0, "security", frames + " <iframe>/<object>/<embed> found.");

  const extRes = (noComments.match(/(src|href)\s*=\s*["']https?:\/\//gi) || []).length
    - (noComments.match(/<a[^>]+href\s*=\s*["']https?:\/\//gi) || []).length;
  add("external", "Self-contained (no external images, styles or fonts)", extRes <= 0, "security",
    "The page pulls resources from other servers — they're blocked by its security policy and would show as broken. Inline them or use data: URIs.");

  const httpRefs = (noComments.match(/(src|href|action)\s*=\s*["']http:\/\//gi) || []).length;
  add("mixed", "No insecure http:// references", httpRefs === 0, "security", httpRefs + " plain-http reference(s).");

  const extForms = (noComments.match(/<form[^>]+action\s*=\s*["']https?:\/\//gi) || []).length;
  add("forms", "No forms posting to other sites", extForms === 0, "security", extForms + " form(s) send data to another server.");

  const blankNoOpener = (noComments.match(/target\s*=\s*["']_blank["'](?![^>]*rel=)/gi) || []).length;
  add("noopener", "External links open safely", blankNoOpener === 0, "security",
    blankNoOpener + ' target="_blank" link(s) missing rel="noopener".');

  // quality / SEO / accessibility
  add("title", "Has a page title", /<title>\s*\S[\s\S]*?<\/title>/i.test(noComments), "quality", "Add a <title> — it's the browser tab and the Google headline.");
  add("viewport", "Mobile-ready (viewport meta)", /<meta[^>]+name\s*=\s*["']viewport/i.test(noComments), "quality", "Add the viewport meta tag or phones will show a zoomed-out desktop page.");
  add("charset", "Character encoding declared", /<meta[^>]+charset/i.test(noComments), "quality", "Add <meta charset=\"utf-8\">.");
  add("lang", "Language declared for screen readers", /<html[^>]+lang\s*=/i.test(noComments), "quality", "Add lang=\"en\" to the <html> tag.");
  add("description", "Has a meta description", /<meta[^>]+name\s*=\s*["']description/i.test(noComments), "quality", "Add a meta description — it's the text under your Google result.");
  const h1s = (noComments.match(/<h1\b/gi) || []).length;
  add("h1", "Exactly one main headline (h1)", h1s === 1, "quality", h1s === 0 ? "No <h1> found." : h1s + " <h1> tags — keep one.");
  const imgs = (noComments.match(/<img\b[^>]*>/gi) || []);
  const noAlt = imgs.filter((t) => !/\salt\s*=/i.test(t)).length;
  add("alt", "All images have alt text", noAlt === 0, "quality", noAlt + " image(s) missing alt text.");

  const secFails = checks.filter((c) => c.kind === "security" && !c.ok).length;
  const qualFails = checks.filter((c) => c.kind === "quality" && !c.ok).length;
  const score = Math.round(100 * checks.filter((c) => c.ok).length / checks.length);
  return { checks, score, secFails, qualFails, publishable: secFails === 0, scannedAt: new Date().toISOString() };
}

// Publish the draft. Refuses while security checks fail — the scan isn't
// decoration, it's the gate.
function publish() {
  const w = raw();
  if (!w.draft || !w.draft.html) {
    if (w.html) throw new Error("Nothing new to publish — the live page is already the latest version.");
    throw new Error("There's no draft to publish yet.");
  }
  const report = scan();
  if (!report.publishable) {
    throw new Error("Publishing is blocked: " + report.secFails + " security check(s) failed. Fix them and scan again.");
  }
  // snapshot the outgoing live page so publish is reversible
  if (w.html) {
    w.versions = w.versions || [];
    w.versions.push({ at: w.publishedAt || new Date().toISOString(), note: w.lastNote || "previously live", html: w.html });
    while (w.versions.length > MAX_VERSIONS) w.versions.shift();
  }
  w.html = w.draft.html;
  w.title = w.draft.title || w.title;
  w.lastNote = w.draft.note || "";
  w.publishedAt = new Date().toISOString();
  w.draft = null;
  store.saveCol("website", w);
  store.logActivity("website", `Website published — passed the security scan (${report.score}% overall)`);
  return Object.assign(get(), { report });
}

// Restore an earlier version. Omit the index for "the one before this".
// The version you're leaving is kept too, so a restore is itself undoable.
function restore(index) {
  const w = raw();
  const versions = w.versions || [];
  if (!versions.length) throw new Error("There's no earlier version to go back to.");
  const i = index === undefined || index === null ? versions.length - 1 : Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= versions.length) throw new Error("That version doesn't exist.");
  const target = versions[i];
  const current = w.html;
  versions.splice(i, 1);
  if (current) {
    versions.push({ at: w.updatedAt || new Date().toISOString(), note: w.lastNote || "before restore", html: current });
    while (versions.length > MAX_VERSIONS) versions.shift();
  }
  w.versions = versions;
  w.html = target.html;
  w.lastNote = `restored "${target.note || "earlier version"}"`;
  w.updatedAt = new Date().toISOString();
  store.saveCol("website", w);
  store.logActivity("website", `Website restored to an earlier version (${target.note || "no note"})`);
  return get();
}

function restorePrevious() {
  return restore(undefined);
}

module.exports = { get, setExternal, saveHtml, draftHtml, scan, publish, restore, restorePrevious };
