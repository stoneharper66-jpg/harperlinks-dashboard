// WhatsApp Business integration for customer messaging.
//
// Handles:
// - Message template management
// - Incoming message handling (DMs, group chats)
// - Outbound message sending
// - Contact/customer list sync
// - Integration with Riley (support agent) for automated responses
// - Conversation history and activity logging
//
// Setup: Set WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_BUSINESS_API_TOKEN in .env

const store = require("./store");
const tenant = require("./tenant");

const WHATSAPP_API = "https://graph.instagram.com/v18.0";
const TIMEOUT_MS = 10000;

function config() {
  return {
    businessAccountId: String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "").trim(),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim(),
    apiToken: String(process.env.WHATSAPP_BUSINESS_API_TOKEN || "").trim(),
  };
}

function isConfigured() {
  const c = config();
  return !!(c.businessAccountId && c.phoneNumberId && c.apiToken);
}

// Make authenticated calls to WhatsApp Business API
async function call(path, { method = "GET", body } = {}) {
  const { apiToken } = config();
  if (!apiToken) throw new Error("WhatsApp Business is not configured.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(WHATSAPP_API + path, {
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
      throw new Error(`WhatsApp ${res.status}: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Send a message
async function sendMessage(toNumber, { message, templateName, parameters } = {}) {
  if (!isConfigured()) throw new Error("WhatsApp Business is not configured.");
  if (!toNumber) throw new Error("toNumber required.");
  if (!message && !templateName) throw new Error("message or templateName required.");

  const { phoneNumberId } = config();

  try {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toNumber.replace(/[^\d]/g, ""),
      type: templateName ? "template" : "text",
    };

    if (templateName) {
      body.template = {
        name: templateName,
        language: { code: "en_US" },
      };
      if (parameters && parameters.length > 0) {
        body.template.components = [{
          type: "body",
          parameters: parameters.map((p) => ({ type: "text", text: p })),
        }];
      }
    } else {
      body.text = { body: message };
    }

    const res = await call(`/${phoneNumberId}/messages`, { method: "POST", body });
    return { id: res.messages[0].id, to: toNumber, status: "sent" };
  } catch (e) {
    throw new Error(`Failed to send message: ${e.message}`);
  }
}

// List message templates
async function listTemplates() {
  if (!isConfigured()) return [];
  try {
    const { businessAccountId } = config();
    const res = await call(`/${businessAccountId}/message_templates`);
    return (res.data || []).map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      category: t.category,
      language: t.language,
    }));
  } catch (e) {
    return [];
  }
}

// Get message history
async function listMessages(limit = 50) {
  if (!isConfigured()) return [];
  try {
    const messages = store.getCol("whatsapp-messages", []);
    return messages.slice(-limit).reverse();
  } catch (e) {
    return [];
  }
}

// Save incoming message
function saveMessage(message) {
  const messages = store.getCol("whatsapp-messages", []);
  messages.push({
    id: message.id || store.newId("msg"),
    from: message.from,
    to: message.to,
    body: message.body,
    type: message.type || "text",
    timestamp: new Date().toISOString(),
    status: message.status || "received",
  });
  // Keep last 1000 messages
  if (messages.length > 1000) {
    store.saveCol("whatsapp-messages", messages.slice(-1000));
  } else {
    store.saveCol("whatsapp-messages", messages);
  }
}

// Save a contact
function saveContact(contact) {
  const contacts = store.getCol("whatsapp-contacts", []);
  const existing = contacts.findIndex((c) => c.phone === contact.phone);
  if (existing >= 0) {
    contacts[existing] = Object.assign(contacts[existing], contact);
  } else {
    contacts.push(contact);
  }
  store.saveCol("whatsapp-contacts", contacts);
}

function getContacts() {
  return store.getCol("whatsapp-contacts", []);
}

// Handle incoming message webhook (called by WhatsApp)
async function handleMessageWebhook(body) {
  const { entry } = body;
  if (!entry || !entry[0]) return { ok: false };

  const changes = entry[0].changes || [];
  const messageData = changes[0]?.value?.messages;

  if (!messageData) return { ok: false };

  for (const msg of messageData) {
    const message = {
      id: msg.id,
      from: msg.from,
      to: entry[0].changes[0].value.metadata.phone_number_id,
      body: msg.text?.body || "[media message]",
      type: msg.type || "text",
      timestamp: new Date(msg.timestamp * 1000).toISOString(),
    };

    saveMessage(message);
    store.logActivity("whatsapp", `Message from ${msg.from}: ${message.body.slice(0, 50)}`);

    // Fire automation event
    const events = require("./events");
    await events.fire("whatsapp.message", {
      from: msg.from,
      body: message.body,
      messageId: msg.id,
    });
  }

  return { ok: true };
}

// Health check
async function health() {
  if (!isConfigured()) return { connected: false, reason: "WhatsApp Business is not configured." };
  try {
    const templates = await listTemplates();
    return { connected: true, templates: templates.length };
  } catch (e) {
    return { connected: false, reason: e.message };
  }
}

module.exports = {
  isConfigured,
  config,
  sendMessage,
  listTemplates,
  listMessages,
  saveMessage,
  saveContact,
  getContacts,
  handleMessageWebhook,
  health,
};
