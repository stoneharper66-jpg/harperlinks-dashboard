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
    mode: w.mode || (w.html ? "built" : w.externalUrl ? "external" : "none"),
    externalUrl: w.externalUrl || "",
    html: w.html || "",
    title: w.title || "",
    updatedAt: w.updatedAt || null,
    versions: (w.versions || []).map((v) => ({ at: v.at, note: v.note })),
  };
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

function saveHtml(html, { title, note } = {}) {
  const body = String(html || "");
  if (body.length < 40) throw new Error("That page looks empty.");
  if (body.length > 400_000) throw new Error("That page is too big to store.");
  const w = raw();
  // keep the old copy so an edit is reversible
  if (w.html) {
    w.versions = w.versions || [];
    w.versions.push({ at: w.updatedAt || new Date().toISOString(), note: w.lastNote || "previous version", html: w.html });
    while (w.versions.length > MAX_VERSIONS) w.versions.shift();
  }
  w.mode = "built";
  w.html = body;
  if (title) w.title = String(title).slice(0, 120);
  w.lastNote = note || "";
  w.updatedAt = new Date().toISOString();
  store.saveCol("website", w);
  store.logActivity("website", note ? `Website updated — ${note}` : "Website updated");
  return get();
}

function restorePrevious() {
  const w = raw();
  const prev = (w.versions || []).pop();
  if (!prev) throw new Error("There's no earlier version to go back to.");
  w.html = prev.html;
  w.updatedAt = new Date().toISOString();
  store.saveCol("website", w);
  store.logActivity("website", "Website rolled back to the previous version");
  return get();
}

module.exports = { get, setExternal, saveHtml, restorePrevious };
