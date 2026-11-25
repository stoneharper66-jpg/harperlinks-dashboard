// Twilio integration for phone and SMS.
//
// Handles:
// - Phone number provisioning and management
// - Incoming and outgoing voice calls
// - SMS sending and receiving
// - Call recording and transcription
// - Integration with Harper (AI receptionist) and Riley (support agent)
//
// Setup: Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in .env

const store = require("./store");
const tenant = require("./tenant");
const engine = require("./engine");

const TWILIO_API = "https://api.twilio.com";
const TIMEOUT_MS = 10000;

function config() {
  return {
    accountSid: String(process.env.TWILIO_ACCOUNT_SID || "").trim(),
    authToken: String(process.env.TWILIO_AUTH_TOKEN || "").trim(),
    fromNumber: String(process.env.TWILIO_FROM_NUMBER || "").trim(),
  };
}

function isConfigured() {
  const c = config();
  return !!(c.accountSid && c.authToken && c.fromNumber);
}

// Make authenticated calls to Twilio API
async function call(path, { method = "GET", body } = {}) {
  const { accountSid, authToken } = config();
  if (!accountSid || !authToken) throw new Error("Twilio is not configured.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const headers = {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };

    let bodyStr = "";
    if (body) {
      bodyStr = new URLSearchParams(body).toString();
    }

    const res = await fetch(TWILIO_API + path, {
      method,
      signal: ctrl.signal,
      headers,
      body: bodyStr || undefined,
    });

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }

    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`Twilio ${res.status}: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// List phone numbers for the account
async function listPhoneNumbers() {
  if (!isConfigured()) return [];
  try {
    const { accountSid } = config();
    const res = await call(`/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`);
    return (res.incoming_phone_numbers || []).map((p) => ({
      sid: p.sid,
      phoneNumber: p.phone_number,
      friendlyName: p.friendly_name,
      voiceUrl: p.voice_url,
      voiceMethod: p.voice_method,
      smsUrl: p.sms_url,
      smsMethod: p.sms_method,
      status: "active",
    }));
  } catch (e) {
    throw new Error(`Failed to list phone numbers: ${e.message}`);
  }
}

// Send an SMS
async function sendSMS(toNumber, message) {
  if (!isConfigured()) throw new Error("Twilio is not configured.");
  if (!toNumber || !message) throw new Error("toNumber and message required.");

  try {
    const { accountSid, fromNumber } = config();
    const res = await call(`/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      body: {
        From: fromNumber,
        To: toNumber,
        Body: message,
      },
    });
    return {
      sid: res.sid,
      to: res.to,
      from: res.from,
      body: res.body,
      status: res.status,
      dateCreated: new Date(res.date_created),
    };
  } catch (e) {
    throw new Error(`Failed to send SMS: ${e.message}`);
  }
}

// Get SMS message history
async function listMessages(limit = 50) {
  if (!isConfigured()) return [];
  try {
    const { accountSid } = config();
    const res = await call(`/2010-04-01/Accounts/${accountSid}/Messages.json?Limit=${limit}`);
    return (res.messages || []).map((m) => ({
      sid: m.sid,
      to: m.to,
      from: m.from,
      body: m.body,
      status: m.status,
      direction: m.direction,
      dateCreated: new Date(m.date_created),
    }));
  } catch (e) {
    return [];
  }
}

// Place an outbound call
async function makeCall(toNumber, { twimlUrl, record = true } = {}) {
  if (!isConfigured()) throw new Error("Twilio is not configured.");
  if (!toNumber) throw new Error("toNumber required.");

  try {
    const { accountSid, fromNumber } = config();
    const body = {
      From: fromNumber,
      To: toNumber,
      Record: record ? "true" : "false",
    };
    if (twimlUrl) body.Url = twimlUrl;

    const res = await call(`/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: "POST",
      body,
    });
    return {
      sid: res.sid,
      to: res.to,
      from: res.from,
      status: res.status,
      duration: res.duration,
      dateCreated: new Date(res.date_created),
    };
  } catch (e) {
    throw new Error(`Failed to make call: ${e.message}`);
  }
}

// Get call recording
async function getCallRecording(callSid) {
  if (!isConfigured()) return null;
  try {
    const { accountSid } = config();
    const res = await call(`/2010-04-01/Accounts/${accountSid}/Calls/${callSid}/Recordings.json`);
    const recordings = res.recordings || [];
    if (recordings.length === 0) return null;
    const rec = recordings[0];
    return {
      sid: rec.sid,
      duration: rec.duration,
      uri: rec.uri,
      mediaUrl: `${TWILIO_API}/2010-04-01/Accounts/${accountSid}/Recordings/${rec.sid}.mp3`,
    };
  } catch (e) {
    return null;
  }
}

// Save Twilio configuration
function saveConfig({ accountSid, authToken, fromNumber }) {
  const cfg = store.getCol("twilio-config", {});
  if (accountSid !== undefined) cfg.accountSid = String(accountSid || "").trim();
  if (authToken !== undefined) cfg.authToken = String(authToken || "").trim();
  if (fromNumber !== undefined) cfg.fromNumber = String(fromNumber || "").trim();
  store.saveCol("twilio-config", cfg);
}

// Get stored configuration (falls back to env vars)
function getStoredConfig() {
  const stored = store.getCol("twilio-config", {});
  return {
    accountSid: stored.accountSid || process.env.TWILIO_ACCOUNT_SID,
    fromNumber: stored.fromNumber || process.env.TWILIO_FROM_NUMBER,
  };
}

// Health check for integrations page
async function health() {
  if (!isConfigured()) return { connected: false, reason: "Twilio is not configured." };
  try {
    const numbers = await listPhoneNumbers();
    return { connected: true, numbers };
  } catch (e) {
    return { connected: false, reason: e.message };
  }
}

// Handle incoming SMS webhook (called by Twilio)
async function handleSmsWebhook(body) {
  const { From, To, Body } = body;
  if (!From || !Body) return { ok: false };

  // Log the incoming message
  store.logActivity("sms", `Incoming SMS from ${From}: ${Body.slice(0, 50)}`);

  // Fire automation event for SMS received
  const events = require("./events");
  await events.fire("sms.received", { from: From, to: To, body: Body });

  return { ok: true };
}

// Handle incoming call webhook (called by Twilio)
async function handleCallWebhook(body) {
  const { From, To, CallSid } = body;
  if (!From || !To) return { ok: false };

  // Log the incoming call
  store.logActivity("call", `Incoming call from ${From} to ${To}`);

  // Fire automation event for call received
  const events = require("./events");
  await events.fire("call.received", { from: From, to: To, callSid: CallSid });

  return { ok: true };
}

module.exports = {
  isConfigured,
  config,
  getStoredConfig,
  listPhoneNumbers,
  sendSMS,
  listMessages,
  makeCall,
  getCallRecording,
  saveConfig,
  health,
  handleSmsWebhook,
  handleCallWebhook,
};
