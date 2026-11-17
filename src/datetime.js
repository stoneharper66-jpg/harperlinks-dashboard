// Natural-language date/time understanding.
// Turns phrases like "tomorrow at 3pm", "Friday morning", or "the 24th at noon"
// into a concrete date + time the bot can actually reason about and book.

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};
const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

function now() {
  return new Date();
}

function dayKeyOf(date) {
  return DAY_KEYS[date.getDay()];
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// "HH:MM" 24h string -> minutes since midnight
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// minutes -> "3:30 PM"
function formatTime(hhmm) {
  let [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDay(date, base = now()) {
  const t0 = startOfDay(base).getTime();
  const d0 = startOfDay(date).getTime();
  const diff = Math.round((d0 - t0) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()];
  if (diff > 1 && diff < 7) return weekday;
  return `${weekday}, ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][date.getMonth()]} ${date.getDate()}`;
}

// Parse a time out of free text. Returns "HH:MM" (24h) or null.
function parseTime(text) {
  const t = text.toLowerCase();
  if (/\bnoon\b|\bmidday\b/.test(t)) return "12:00";
  if (/\bmidnight\b/.test(t)) return "00:00";

  // 3pm, 3:30 pm, 3 pm, at 4, 15:00
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const pm = m[3].startsWith("p");
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  // 24h "15:00"
  m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return `${String(+m[1]).padStart(2, "0")}:${m[2]}`;

  // "at 4" / "at 4 o'clock" (assume daytime: 1-7 -> PM, 8-11 -> AM)
  m = t.match(/\bat\s+(\d{1,2})\s*(o'?clock)?\b/);
  if (m) {
    let h = parseInt(m[1], 10);
    if (h >= 1 && h <= 7) h += 12; // 1–7 "at" almost always means PM for appts
    if (h > 23) return null;
    return `${String(h).padStart(2, "0")}:00`;
  }

  // Fuzzy parts of day -> representative time
  if (/\bmorning\b/.test(t)) return "09:00";
  if (/\bafternoon\b/.test(t)) return "14:00";
  if (/\bevening\b|\btonight\b/.test(t)) return "18:00";
  return null;
}

// Parse a day out of free text. Returns a Date (midnight) or null.
function parseDay(text, base = now()) {
  const t = text.toLowerCase();
  const today = startOfDay(base);

  if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/.test(t)) return today;
  if (/\btomorrow\b|\btmrw\b/.test(t)) return addDays(today, 1);

  // "Month Day" e.g. "June 24", "jun 24th"
  let m = t.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m && MONTHS[m[1]] !== undefined) {
    const month = MONTHS[m[1]];
    const day = parseInt(m[2], 10);
    let year = base.getFullYear();
    let candidate = new Date(year, month, day);
    if (startOfDay(candidate) < today) candidate = new Date(year + 1, month, day);
    return startOfDay(candidate);
  }

  // Weekday name -> next occurrence (including today)
  for (const [name, dow] of Object.entries(DAY_NAMES)) {
    const re = new RegExp(`\\b${name}\\b`);
    if (re.test(t)) {
      const explicitNext = /\bnext\b/.test(t);
      let delta = (dow - today.getDay() + 7) % 7;
      if (delta === 0 && explicitNext) delta = 7;
      return addDays(today, delta);
    }
  }
  return null;
}

// Combined parse. Returns { date|null, time|null, dayLabel, timeLabel, slotKey|null }.
function parse(text, base = now()) {
  const date = parseDay(text, base);
  const time = parseTime(text);
  let slotKey = null;
  if (date && time) {
    const d = startOfDay(date);
    slotKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${time}`;
  }
  return {
    date,
    time,
    dayLabel: date ? formatDay(date, base) : null,
    timeLabel: time ? formatTime(time) : null,
    slotKey,
  };
}

// Human-readable "now" for the system prompt.
function nowContext(base = now()) {
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][base.getDay()];
  const date = base.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const time = formatTime(`${String(base.getHours()).padStart(2, "0")}:${String(base.getMinutes()).padStart(2, "0")}`);
  return `${weekday}, ${date}, ${time}`;
}

module.exports = {
  now, dayKeyOf, startOfDay, addDays, toMinutes, formatTime, formatDay,
  parseTime, parseDay, parse, nowContext, DAY_KEYS,
};
