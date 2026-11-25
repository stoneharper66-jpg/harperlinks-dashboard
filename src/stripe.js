// Stripe integration for billing and subscriptions.
//
// Handles:
// - Product and pricing management
// - Subscription status tracking
// - Payment link management
// - Customer billing information
// - Usage-based billing and cost tracking
//
// Setup: Set STRIPE_SECRET_KEY in .env

const store = require("./store");
const tenant = require("./tenant");

const STRIPE_API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 10000;

function config() {
  return {
    secretKey: String(process.env.STRIPE_SECRET_KEY || "").trim(),
  };
}

function isConfigured() {
  const c = config();
  return !!c.secretKey;
}

// Make authenticated calls to Stripe API
async function call(path, { method = "GET", body } = {}) {
  const { secretKey } = config();
  if (!secretKey) throw new Error("Stripe is not configured.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };

    let bodyStr = "";
    if (body) {
      bodyStr = new URLSearchParams(body).toString();
    }

    const res = await fetch(STRIPE_API + path, {
      method,
      signal: ctrl.signal,
      headers,
      body: bodyStr || undefined,
    });

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }

    if (!res.ok) {
      const msg = (json && (json.error && json.error.message)) || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`Stripe ${res.status}: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// List or get a specific product
async function listProducts() {
  if (!isConfigured()) return [];
  try {
    const res = await call("/products?limit=100&active=true");
    return (res.data || []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      metadata: p.metadata || {},
    }));
  } catch (e) {
    throw new Error(`Failed to list products: ${e.message}`);
  }
}

// List prices for a product
async function listPrices(productId) {
  if (!isConfigured()) return [];
  try {
    const res = await call(`/prices?product=${encodeURIComponent(productId)}&limit=100&active=true`);
    return (res.data || []).map((p) => ({
      id: p.id,
      productId: p.product,
      amount: p.unit_amount,
      currency: p.currency,
      interval: p.recurring ? p.recurring.interval : null,
      intervalCount: p.recurring ? p.recurring.interval_count : null,
    }));
  } catch (e) {
    throw new Error(`Failed to list prices: ${e.message}`);
  }
}

// Get current subscription for a customer
async function getSubscription(customerId) {
  if (!isConfigured()) return null;
  try {
    const res = await call(`/subscriptions?customer=${encodeURIComponent(customerId)}&limit=1`);
    const sub = res.data && res.data[0];
    if (!sub) return null;
    return {
      id: sub.id,
      customerId: sub.customer,
      status: sub.status, // active, past_due, unpaid, canceled, trialing
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      items: (sub.items.data || []).map((item) => ({
        id: item.id,
        priceId: item.price.id,
        productId: item.price.product,
        quantity: item.quantity,
      })),
    };
  } catch (e) {
    return null; // No subscription
  }
}

// Create a payment link (the checkout URL customers visit)
async function createPaymentLink(prices) {
  if (!isConfigured()) throw new Error("Stripe is not configured.");
  if (!Array.isArray(prices) || prices.length === 0) throw new Error("At least one price is required.");

  try {
    const body = {
      line_items: prices.map((p) => ({ price: p, quantity: 1 })),
      mode: "subscription",
      success_url: `${process.env.PUBLIC_BASE_URL || "https://harperlinks-dashboard-production.up.railway.app"}/app?paid=1`,
      cancel_url: `${process.env.PUBLIC_BASE_URL || "https://harperlinks-dashboard-production.up.railway.app"}/`,
    };

    const res = await call("/payment_links", { method: "POST", body });
    return { id: res.id, url: res.url };
  } catch (e) {
    throw new Error(`Failed to create payment link: ${e.message}`);
  }
}

// Save payment links in config (so we can reference them in the UI)
function savePaymentLinks(links) {
  const cfg = store.getCol("stripe-config", {});
  cfg.paymentLinks = links;
  cfg.savedAt = new Date().toISOString();
  store.saveCol("stripe-config", cfg);
}

function getPaymentLinks() {
  const cfg = store.getCol("stripe-config", {});
  return cfg.paymentLinks || {};
}

// Health check for integrations page
async function health() {
  if (!isConfigured()) return { connected: false, reason: "Stripe is not configured." };
  try {
    await listProducts();
    return { connected: true };
  } catch (e) {
    return { connected: false, reason: e.message };
  }
}

module.exports = {
  isConfigured,
  config,
  listProducts,
  listPrices,
  getSubscription,
  createPaymentLink,
  savePaymentLinks,
  getPaymentLinks,
  health,
};
