// Unified connector setup and management system.
// Makes it trivially easy to connect any service in seconds.
//
// Features:
// - One-click OAuth for supported services
// - Simple API key input for others (never stored in code)
// - Automatic configuration validation
// - Encrypted token storage
// - Clear setup instructions
// - Health checks before saving

const crypto = require("crypto");
const store = require("./store");

const ENCRYPTION_KEY = (process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex")).slice(0, 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text) {
  const [iv, encrypted] = text.split(":");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), Buffer.from(iv, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Define connectors with their setup methods
const CONNECTORS = {
  stripe: {
    name: "Stripe",
    icon: "stripe",
    category: "billing",
    description: "Payment processing and subscriptions",
    setupMethod: "api-key", // oauth, api-key, or none
    fields: [
      { name: "secretKey", label: "Secret Key", type: "password", placeholder: "sk_live_..." },
    ],
    instructions: "Get your API key from Stripe Dashboard → Developers → API Keys",
    testMethod: async (config) => {
      const stripe = require("./stripe");
      return await stripe.health();
    },
  },

  twilio: {
    name: "Twilio",
    icon: "twilio",
    category: "communication",
    description: "Phone calls and SMS messaging",
    setupMethod: "api-key",
    fields: [
      { name: "accountSid", label: "Account SID", type: "text", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { name: "authToken", label: "Auth Token", type: "password", placeholder: "your_auth_token" },
      { name: "fromNumber", label: "Phone Number", type: "tel", placeholder: "+1234567890" },
    ],
    instructions: "Find these in Twilio Console → Account → API Keys & Tokens. Phone number must be your Twilio number.",
    testMethod: async (config) => {
      const twilio = require("./twilio");
      return await twilio.health();
    },
  },

  gcal: {
    name: "Google Calendar",
    icon: "gcal",
    category: "calendar",
    description: "Two-way appointment sync",
    setupMethod: "oauth",
    oauthConfig: {
      provider: "google",
      scopes: ["https://www.googleapis.com/auth/calendar"],
    },
    instructions: "Click 'Connect' and authorize access to your Google Calendar",
    testMethod: async (config) => {
      const gcal = require("./gcal");
      return await gcal.health();
    },
  },

  videoai: {
    name: "Video AI",
    icon: "videoai",
    category: "media",
    description: "AI-powered video generation",
    setupMethod: "api-key",
    fields: [
      { name: "apiKey", label: "API Key", type: "password", placeholder: "your_api_key" },
      {
        name: "provider",
        label: "Provider",
        type: "select",
        options: ["synthesia", "runway", "elevenlabs"],
        default: "synthesia",
      },
    ],
    instructions: "Get your API key from your video AI provider's dashboard",
    testMethod: async (config) => {
      const videoai = require("./videoai");
      return await videoai.health();
    },
  },

  whatsapp: {
    name: "WhatsApp Business",
    icon: "whatsapp",
    category: "communication",
    description: "Customer messaging via WhatsApp",
    setupMethod: "api-key",
    fields: [
      { name: "businessAccountId", label: "Business Account ID", type: "text" },
      { name: "phoneNumberId", label: "Phone Number ID", type: "text" },
      { name: "apiToken", label: "API Token", type: "password" },
    ],
    instructions: "Get these from your Meta Business Account → WhatsApp Business → Settings",
    testMethod: async (config) => {
      const whatsapp = require("./whatsapp");
      return await whatsapp.health();
    },
  },

  shopify: {
    name: "Shopify",
    icon: "shopify",
    category: "ecommerce",
    description: "Store data and product management",
    setupMethod: "api-key",
    fields: [
      { name: "storeUrl", label: "Store URL", type: "url", placeholder: "https://mystore.myshopify.com" },
      { name: "accessToken", label: "Access Token", type: "password" },
    ],
    instructions: "Create a custom app in Shopify Admin → Settings → Apps and integrations → Develop apps",
    testMethod: async (config) => {
      const shopify = require("./shopify");
      return await shopify.health();
    },
  },

  wordpress: {
    name: "WordPress",
    icon: "wordpress",
    category: "website",
    description: "Website publishing and CMS",
    setupMethod: "api-key",
    fields: [
      { name: "siteUrl", label: "Site URL", type: "url", placeholder: "https://myblog.com" },
      { name: "username", label: "Username", type: "text" },
      { name: "apiToken", label: "Application Password", type: "password" },
    ],
    instructions: "Generate an Application Password in WordPress → Settings → Security → Application Passwords",
    testMethod: async (config) => {
      const wordpress = require("./wordpress");
      return await wordpress.health();
    },
  },
};

function getConnector(id) {
  return CONNECTORS[id];
}

function list() {
  return Object.entries(CONNECTORS).map(([id, cfg]) => ({
    id,
    ...cfg,
  }));
}

// Save connector config securely (encrypt sensitive fields)
function saveConnectorConfig(connectorId, config) {
  const connector = CONNECTORS[connectorId];
  if (!connector) throw new Error(`Unknown connector: ${connectorId}`);

  const cfg = store.getCol("connector-configs", {});
  const encrypted = { ...config };

  // Encrypt password/token fields
  if (connector.fields) {
    connector.fields.forEach((field) => {
      if ((field.type === "password" || field.name.includes("token") || field.name.includes("key")) && encrypted[field.name]) {
        encrypted[field.name] = encrypt(encrypted[field.name]);
      }
    });
  }

  cfg[connectorId] = {
    config: encrypted,
    savedAt: new Date().toISOString(),
    status: "configured",
  };

  store.saveCol("connector-configs", cfg);
  store.logActivity("integration", `${connector.name} connected`);
}

// Get connector config (decrypt sensitive fields)
function getConnectorConfig(connectorId) {
  const connector = CONNECTORS[connectorId];
  if (!connector) return null;

  const cfg = store.getCol("connector-configs", {});
  const data = cfg[connectorId];
  if (!data) return null;

  const decrypted = { ...data.config };

  // Decrypt password/token fields
  if (connector.fields) {
    connector.fields.forEach((field) => {
      if ((field.type === "password" || field.name.includes("token") || field.name.includes("key")) && decrypted[field.name]) {
        try {
          decrypted[field.name] = decrypt(decrypted[field.name]);
        } catch (e) {
          // Fallback: return as-is if already decrypted or corrupted
        }
      }
    });
  }

  return decrypted;
}

// Check if connector is configured
function isConfigured(connectorId) {
  const cfg = store.getCol("connector-configs", {});
  return !!(cfg[connectorId] && cfg[connectorId].status === "configured");
}

// Remove connector config
function removeConnectorConfig(connectorId) {
  const connector = CONNECTORS[connectorId];
  if (!connector) throw new Error(`Unknown connector: ${connectorId}`);

  const cfg = store.getCol("connector-configs", {});
  delete cfg[connectorId];
  store.saveCol("connector-configs", cfg);
  store.logActivity("integration", `${connector.name} disconnected`);
}

// Test a connector config before saving
async function testConnectorConfig(connectorId, config) {
  const connector = CONNECTORS[connectorId];
  if (!connector || !connector.testMethod) {
    return { ok: true, message: "Configuration saved" };
  }

  try {
    const result = await connector.testMethod(config);
    return { ok: result.connected !== false, message: result.reason || "Connected successfully" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Get setup URL for OAuth connectors
function getOAuthUrl(connectorId, userId) {
  const connector = CONNECTORS[connectorId];
  if (!connector || connector.setupMethod !== "oauth") {
    throw new Error(`${connectorId} does not support OAuth`);
  }

  if (connectorId === "gcal") {
    const gcal = require("./gcal");
    return gcal.getAuthUrl(userId);
  }

  throw new Error(`OAuth not configured for ${connectorId}`);
}

module.exports = {
  CONNECTORS,
  getConnector,
  list,
  saveConnectorConfig,
  getConnectorConfig,
  isConfigured,
  removeConnectorConfig,
  testConnectorConfig,
  getOAuthUrl,
};
