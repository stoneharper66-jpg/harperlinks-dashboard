// Chat history that survives — a refresh, a timeout, a deploy.
//
// Before this, conversations lived in a Map with a 30-minute TTL, and the
// browser made up a fresh random session id on every page load. So the AI
// forgot the thread as soon as you reloaded, and a Railway restart wiped
// every conversation in the product. This persists both halves:
//
//   history    — the real Anthropic messages array (text AND tool_use /
//                tool_result blocks), so the model picks the thread back up
//                with its own prior reasoning intact.
//   transcript — what the human said and heard, for drawing the chat back
//                on screen. Separate because the history gets trimmed hard
//                and tool payloads (a whole web page of HTML) must never be
//                replayed into the UI.
//
// One thread per employee, so Sage's conversation and Indi's don't bleed
// into each other the way they did when every chat shared one session id.

const store = require("./store");

const HISTORY_MAX = 24;        // messages kept for the model (matches engine's trim)
const TRANSCRIPT_MAX = 120;    // turns kept for the screen
const TOOL_RESULT_MAX = 4000;  // chars of a tool result we persist

function key(thread) {
  const t = String(thread || "default").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "default";
  return `chat-${t}`;
}

function load(thread) {
  const data = store.getCol(key(thread), null);
  if (data && Array.isArray(data.history)) return data;
  return { history: [], transcript: [], updatedAt: null };
}

// Big tool results are worth keeping in the live session (the model may still
// be editing that HTML) but not worth carrying across restarts, where they'd
// bloat the file and the next prompt for no gain.
function slimForDisk(history) {
  return history.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    return {
      role: msg.role,
      content: msg.content.map((b) => {
        if (b.type === "tool_result" && typeof b.content === "string" && b.content.length > TOOL_RESULT_MAX) {
          return Object.assign({}, b, { content: b.content.slice(0, TOOL_RESULT_MAX) + "\n…(trimmed)" });
        }
        return b;
      }),
    };
  });
}

// A history must never start on a tool_result: the tool_use that paired with
// it may have been trimmed away, and the API rejects the orphan.
function repair(history) {
  let i = 0;
  while (i < history.length) {
    const m = history[i];
    const orphan = Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result");
    if (i === 0 && (orphan || m.role !== "user")) { i++; continue; }
    break;
  }
  return i ? history.slice(i) : history;
}

function save(thread, session) {
  const history = repair(slimForDisk(session.history || []).slice(-HISTORY_MAX));
  store.saveCol(key(thread), {
    history,
    transcript: (session.transcript || []).slice(-TRANSCRIPT_MAX),
    updatedAt: new Date().toISOString(),
  });
}

/** What the browser needs to redraw the conversation. */
function transcript(thread) {
  return load(thread).transcript || [];
}

function clear(thread) {
  store.saveCol(key(thread), { history: [], transcript: [], updatedAt: null });
}

/** Append one completed exchange to the human-readable transcript. */
function record(session, userMessage, out) {
  session.transcript = session.transcript || [];
  session.transcript.push({ role: "user", text: userMessage, at: new Date().toISOString() });
  session.transcript.push({
    role: "bot",
    text: out.reply || "",
    steps: (out.steps || []).map((s) => ({ tool: s.tool, ok: s.ok })),
    actions: (out.actions || []).length,
    at: new Date().toISOString(),
  });
  if (session.transcript.length > TRANSCRIPT_MAX) {
    session.transcript.splice(0, session.transcript.length - TRANSCRIPT_MAX);
  }
}

module.exports = { load, save, transcript, clear, record, repair, HISTORY_MAX };
