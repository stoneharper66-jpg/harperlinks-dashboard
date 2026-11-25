// Shopify integration for store data and product management.
//
// Handles:
// - OAuth authentication with Shopify
// - Product data retrieval and sync
// - Inventory tracking
// - Customer and order data
// - Sales analytics and metrics
// - Product recommendations
// - Inventory alerts and notifications
//
// Setup: Set SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN in .env

const store = require("./store");
const tenant = require("./tenant");

const TIMEOUT_MS = 10000;

function config() {
  return {
    storeUrl: String(process.env.SHOPIFY_STORE_URL || "").trim(),
    accessToken: String(process.env.SHOPIFY_ACCESS_TOKEN || "").trim(),
  };
}

function isConfigured() {
  const c = config();
  return !!(c.storeUrl && c.accessToken);
}

// Make authenticated calls to Shopify API
async function call(path, { method = "GET", body } = {}) {
  const { storeUrl, accessToken } = config();
  if (!storeUrl || !accessToken) throw new Error("Shopify is not configured.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `${storeUrl}/admin/api/2024-01${path}`;
    const headers = {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }

    if (!res.ok) {
      const msg = (json && json.errors) || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`Shopify ${res.status}: ${JSON.stringify(msg)}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Get shop information
async function getShop() {
  if (!isConfigured()) return null;
  try {
    const res = await call("/shop.json");
    const s = res.shop;
    return {
      id: s.id,
      name: s.name,
      domain: s.domain,
      currency: s.currency,
      timezone: s.iana_timezone,
      createdAt: new Date(s.created_at),
    };
  } catch (e) {
    throw new Error(`Failed to get shop: ${e.message}`);
  }
}

// List products
async function listProducts({ limit = 50, status = "active" } = {}) {
  if (!isConfigured()) return [];
  try {
    const res = await call(`/products.json?limit=${limit}&status=${status}`);
    return (res.products || []).map((p) => ({
      id: p.id,
      title: p.title,
      description: p.body_html,
      price: p.variants?.[0]?.price,
      currency: p.variants?.[0]?.price_currency,
      inventory: p.variants?.[0]?.inventory_quantity,
      images: (p.images || []).map((img) => img.src),
      createdAt: new Date(p.created_at),
      updatedAt: new Date(p.updated_at),
    }));
  } catch (e) {
    return [];
  }
}

// Get a specific product
async function getProduct(productId) {
  if (!isConfigured()) return null;
  try {
    const res = await call(`/products/${productId}.json`);
    const p = res.product;
    return {
      id: p.id,
      title: p.title,
      description: p.body_html,
      variants: (p.variants || []).map((v) => ({
        id: v.id,
        title: v.title,
        price: v.price,
        inventory: v.inventory_quantity,
      })),
      images: (p.images || []).map((img) => img.src),
    };
  } catch (e) {
    return null;
  }
}

// List orders
async function listOrders({ limit = 50, status = "any" } = {}) {
  if (!isConfigured()) return [];
  try {
    const res = await call(`/orders.json?limit=${limit}&status=${status}`);
    return (res.orders || []).map((o) => ({
      id: o.id,
      name: o.name,
      email: o.email,
      total: o.total_price,
      currency: o.currency,
      createdAt: new Date(o.created_at),
      status: o.fulfillment_status,
      lineItems: (o.line_items || []).map((item) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        price: item.price,
      })),
    }));
  } catch (e) {
    return [];
  }
}

// List customers
async function listCustomers({ limit = 50 } = {}) {
  if (!isConfigured()) return [];
  try {
    const res = await call(`/customers.json?limit=${limit}`);
    return (res.customers || []).map((c) => ({
      id: c.id,
      email: c.email,
      firstName: c.first_name,
      lastName: c.last_name,
      phone: c.phone,
      createdAt: new Date(c.created_at),
      totalOrders: c.orders_count,
      totalSpent: c.total_spent,
    }));
  } catch (e) {
    return [];
  }
}

// Get analytics
async function getAnalytics() {
  if (!isConfigured()) return null;
  try {
    const [products, orders, customers] = await Promise.all([
      listProducts({ limit: 100 }),
      listOrders({ limit: 100 }),
      listCustomers({ limit: 100 }),
    ]);

    const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total), 0);
    const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;
    const lowStockProducts = products.filter((p) => p.inventory < 5);

    return {
      products: products.length,
      orders: orders.length,
      customers: customers.length,
      totalRevenue,
      avgOrderValue,
      lowStockProducts: lowStockProducts.map((p) => ({ title: p.title, inventory: p.inventory })),
    };
  } catch (e) {
    return null;
  }
}

// Save product data locally (for reference in AI)
function syncProducts() {
  return listProducts({ limit: 100 }).then((products) => {
    store.saveCol("shopify-products", { products, syncedAt: new Date().toISOString() });
    return products.length;
  });
}

// Get locally synced products
function getSyncedProducts() {
  const data = store.getCol("shopify-products", {});
  return data.products || [];
}

// Health check
async function health() {
  if (!isConfigured()) return { connected: false, reason: "Shopify is not configured." };
  try {
    const shop = await getShop();
    return { connected: true, store: shop.name };
  } catch (e) {
    return { connected: false, reason: e.message };
  }
}

module.exports = {
  isConfigured,
  config,
  getShop,
  listProducts,
  getProduct,
  listOrders,
  listCustomers,
  getAnalytics,
  syncProducts,
  getSyncedProducts,
  health,
};
