// Long-term memory — the things the AI team should still know next month.
//
// The knowledge base (store.getKnowledge) holds the structured facts a
// business has: hours, prices, services. This is the other half: the loose
// things the owner says in passing. "Call me Tez, not Terry." "We never
// discount." "Our busy season is November." None of that fits a form field,
// and before this file it evaporated the moment the chat session timed out.
//
// Two honesty rules shape it:
//   1. Nothing is remembered silently. Every entry records who saved it and
//      when, and the owner can read and delete the whole list from Settings.
//   2. Memory is never invented. The AI only writes here when the owner has
//      actually told it something — the prompt says so, and a saved fact is
//      stored as the owner's words, not a summary of what the AI assumes.

const store = require("./store");

const COL = "memory";
const MAX = 80;             // past this, the oldest unpinned fact falls off
const MAX_LEN = 280;        // a fact, not an essay
const PROMPT_MAX = 40;      // how many reach the system prompt
const PROMPT_CHARS = 4000;  // and the ceiling on that block

const CATEGORIES = ["preference", "business", "person", "rule", "goal", "other"];

function all() {
  return store.getCol(COL);
}

function save(list) {
  return store.saveCol(COL, list);
}

// Loose match so "we don't discount" doesn't get saved five times in five
// wordings. Compares the meaningful words, not the punctuation.
function fingerprint(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .sort()
    .join(" ");
}

/**
 * Remember one thing. Returns { saved, duplicate, record }.
 * A repeat of something already known updates the existing entry's timestamp
 * rather than stacking another copy — repetition means it still matters.
 */
function remember(fact, opts = {}) {
  const text = String(fact || "").trim().slice(0, MAX_LEN);
  if (text.length < 3) return { saved: false, reason: "Nothing to remember." };

  const list = all();
  const fp = fingerprint(text);
  const existing = list.find((m) => fingerprint(m.text) === fp);
  if (existing) {
    existing.at = new Date().toISOString();
    existing.timesTold = (existing.timesTold || 1) + 1;
    save(list);
    return { saved: true, duplicate: true, record: existing };
  }

  const record = {
    id: store.newId("mem"),
    text,
    category: CATEGORIES.includes(opts.category) ? opts.category : "other",
    savedBy: opts.employee || "team",
    at: new Date().toISOString(),
    pinned: !!opts.pinned,
    timesTold: 1,
  };
  list.unshift(record);

  // Trim from the back, skipping anything pinned — pinned facts are the
  // owner's own doing and shouldn't be aged out by chatter.
  while (list.length > MAX) {
    let i = list.length - 1;
    while (i >= 0 && list[i].pinned) i--;
    if (i < 0) break; // everything is pinned; let it sit over the cap
    list.splice(i, 1);
  }
  save(list);
  store.logActivity("memory", `Remembered: ${text.slice(0, 90)}`);
  return { saved: true, duplicate: false, record };
}

/** Forget by id, or by a phrase that matches one fact. */
function forget(idOrText) {
  const needle = String(idOrText || "").trim();
  if (!needle) return { removed: 0 };
  const list = all();
  const low = needle.toLowerCase();
  const keep = list.filter((m) => !(m.id === needle || m.text.toLowerCase().includes(low)));
  const removed = list.length - keep.length;
  if (removed) {
    save(keep);
    store.logActivity("memory", `Forgot ${removed} remembered item${removed > 1 ? "s" : ""}`);
  }
  return { removed };
}

function pin(id, pinned) {
  const list = all();
  const m = list.find((x) => x.id === id);
  if (!m) return null;
  m.pinned = !!pinned;
  save(list);
  return m;
}

/** Search, for the recall tool — so a long memory still answers a question. */
function search(query, limit = 8) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const list = all();
  if (!words.length) return list.slice(0, limit);
  return list
    .map((m) => {
      const t = m.text.toLowerCase();
      return { m, hits: words.filter((w) => t.includes(w)).length };
    })
    .filter((x) => x.hits)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.m);
}

/**
 * The block that goes into every system prompt. Pinned facts first, then the
 * most recent — so a long-standing rule outranks last Tuesday's aside.
 */
function memoryBlock() {
  const list = all();
  if (!list.length) return "";
  const ordered = list
    .slice()
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.at) - new Date(a.at))
    .slice(0, PROMPT_MAX);

  const lines = [];
  let chars = 0;
  for (const m of ordered) {
    const line = `  - ${m.text}${m.pinned ? " (the owner pinned this)" : ""}`;
    if (chars + line.length > PROMPT_CHARS) break;
    chars += line.length;
    lines.push(line);
  }
  if (!lines.length) return "";
  return `\nWHAT YOU REMEMBER (things this owner has told you before — treat as true)\n${lines.join("\n")}\n` +
    "  Use these without being asked again. If one is now wrong, call forget on it.\n";
}

module.exports = { all, remember, forget, pin, search, memoryBlock, CATEGORIES, MAX };
