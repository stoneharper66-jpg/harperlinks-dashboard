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

module.exports = { get, setExternal, saveHtml, restore, restorePrevious };
