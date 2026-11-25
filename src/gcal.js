// Google Calendar integration for two-way appointment sync.
//
// Handles:
// - OAuth authentication with Google
// - Event creation and updates
// - Two-way sync with HarperLinks calendar
// - Availability/busy time checking (clash detection)
// - Webhook subscriptions for real-time updates
//
// Setup: Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in .env

const store = require("./store");
const tenant = require("./tenant");

const GOOGLE_API = "https://www.googleapis.com";
const TIMEOUT_MS = 10000;

function config() {
  return {
    clientId: String(process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    redirectUri: String(process.env.GOOGLE_REDIRECT_URI || "").trim(),
  };
}

function isConfigured() {
  const c = config();
  return !!(c.clientId && c.clientSecret && c.redirectUri);
}

// Get stored OAuth token for the current account
function getToken() {
  const data = store.getCol("gcal-auth", {});
  return data.token || null;
}

function saveToken(token) {
  const data = store.getCol("gcal-auth", {});
  data.token = token;
  data.savedAt = new Date().toISOString();
  store.saveCol("gcal-auth", data);
}

// Refresh an expired access token
async function refreshToken(refreshToken) {
  const { clientId, clientSecret } = config();
  if (!clientId || !clientSecret || !refreshToken) throw new Error("OAuth not configured.");

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Token refresh failed");
      return json.access_token;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    throw new Error(`Failed to refresh token: ${e.message}`);
  }
}

// Make authenticated calls to Google Calendar API
async function call(path, { method = "GET", body, accessToken } = {}) {
  if (!accessToken) throw new Error("Not authenticated with Google Calendar.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(GOOGLE_API + path, {
      method,
      signal: ctrl.signal,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }

    if (!res.ok) {
      const msg = (json && json.error && json.error.message) || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`Google Calendar ${res.status}: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Get the user's primary calendar
async function getPrimaryCalendar(accessToken) {
  const res = await call("/calendar/v3/users/me/calendarList/primary", { accessToken });
  return { id: res.id, name: res.summary, timeZone: res.timeZone };
}

// List events from a date range
async function listEvents(calendarId, { startTime, endTime, accessToken, maxResults = 50 } = {}) {
  if (!accessToken) throw new Error("Not authenticated with Google Calendar.");

  const params = new URLSearchParams({
    maxResults: maxResults.toString(),
    orderBy: "startTime",
    singleEvents: "true",
  });
  if (startTime) params.set("timeMin", new Date(startTime).toISOString());
  if (endTime) params.set("timeMax", new Date(endTime).toISOString());

  const res = await call(
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { accessToken }
  );

  return (res.items || []).map((e) => ({
    id: e.id,
    title: e.summary,
    description: e.description,
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
    attendees: (e.attendees || []).map((a) => a.email),
    busy: e.transparency !== "transparent",
  }));
}

// Create an event
async function createEvent(calendarId, { title, description, startTime, endTime, attendees = [], accessToken } = {}) {
  if (!accessToken) throw new Error("Not authenticated with Google Calendar.");
  if (!title || !startTime || !endTime) throw new Error("title, startTime, and endTime required.");

  const body = {
    summary: title,
    description: description || "",
    start: { dateTime: new Date(startTime).toISOString() },
    end: { dateTime: new Date(endTime).toISOString() },
    attendees: attendees.map((email) => ({ email })),
  };

  const res = await call(
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body, accessToken }
  );

  return { id: res.id, title: res.summary, start: res.start.dateTime, end: res.end.dateTime };
}

// Update an event
async function updateEvent(calendarId, eventId, { title, description, startTime, endTime, accessToken } = {}) {
  if (!accessToken) throw new Error("Not authenticated with Google Calendar.");

  const body = {};
  if (title) body.summary = title;
  if (description !== undefined) body.description = description;
  if (startTime) body.start = { dateTime: new Date(startTime).toISOString() };
  if (endTime) body.end = { dateTime: new Date(endTime).toISOString() };

  const res = await call(
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body, accessToken }
  );

  return { id: res.id, title: res.summary };
}

// Delete an event
async function deleteEvent(calendarId, eventId, { accessToken } = {}) {
  if (!accessToken) throw new Error("Not authenticated with Google Calendar.");

  await call(
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", accessToken }
  );

  return { ok: true };
}

// Check availability in a time window
async function checkAvailability(calendarId, { startTime, endTime, accessToken } = {}) {
  if (!accessToken) throw new Error("Not authenticated with Google Calendar.");
  if (!startTime || !endTime) throw new Error("startTime and endTime required.");

  const events = await listEvents(calendarId, { startTime, endTime, accessToken, maxResults: 100 });
  const busy = events.filter((e) => e.busy);
  const isAvailable = busy.length === 0;

  return {
    available: isAvailable,
    busySlots: busy.map((e) => ({ title: e.title, start: e.start, end: e.end })),
  };
}

// Generate an OAuth consent URL
function getAuthUrl(state) {
  const { clientId, redirectUri } = config();
  if (!clientId || !redirectUri) throw new Error("Google OAuth not configured.");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar",
    access_type: "offline",
    prompt: "consent",
    state: state || "",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// Exchange authorization code for tokens
async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = config();
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google OAuth not configured.");

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Code exchange failed");
      return json;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    throw new Error(`Failed to exchange code: ${e.message}`);
  }
}

// Health check for integrations page
async function health() {
  if (!isConfigured()) return { connected: false, reason: "Google Calendar OAuth not configured." };
  const token = getToken();
  if (!token) return { connected: false, reason: "Not authenticated. Click Connect to authorize." };
  try {
    const cal = await getPrimaryCalendar(token.access_token);
    return { connected: true, calendar: cal };
  } catch (e) {
    return { connected: false, reason: e.message };
  }
}

module.exports = {
  isConfigured,
  config,
  getToken,
  saveToken,
  refreshToken,
  getPrimaryCalendar,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  checkAvailability,
  getAuthUrl,
  exchangeCode,
  health,
};
