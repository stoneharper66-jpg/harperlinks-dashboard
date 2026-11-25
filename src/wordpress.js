// WordPress integration for website publishing and CMS.
//
// Handles:
// - WordPress.com and self-hosted REST API
// - Post creation and publishing
// - Page and blog management
// - Media upload and embedding
// - Two-way content sync
// - Integration with Indi (website builder)
// - Activity logging for publishing events
//
// Setup: Set WORDPRESS_SITE_URL, WORDPRESS_USERNAME, WORDPRESS_API_TOKEN in .env

const store = require("./store");
const tenant = require("./tenant");

const TIMEOUT_MS = 10000;

function config() {
  return {
    siteUrl: String(process.env.WORDPRESS_SITE_URL || "").trim(),
    username: String(process.env.WORDPRESS_USERNAME || "").trim(),
    apiToken: String(process.env.WORDPRESS_API_TOKEN || "").trim(),
  };
}

function isConfigured() {
  const c = config();
  return !!(c.siteUrl && c.username && c.apiToken);
}

// Make authenticated calls to WordPress REST API
async function call(path, { method = "GET", body } = {}) {
  const { siteUrl, username, apiToken } = config();
  if (!siteUrl || !username || !apiToken) throw new Error("WordPress is not configured.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `${siteUrl}/wp-json/wp/v2${path}`;
    const auth = Buffer.from(`${username}:${apiToken}`).toString("base64");
    const headers = {
      Authorization: `Basic ${auth}`,
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
      const msg = (json && json.message) || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`WordPress ${res.status}: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Get site information
async function getSite() {
  if (!isConfigured()) return null;
  try {
    const { siteUrl } = config();
    const res = await fetch(`${siteUrl}/wp-json`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const json = await res.json();
    return {
      name: json.name,
      description: json.description,
      url: json.url,
      language: json.language,
    };
  } catch (e) {
    throw new Error(`Failed to get site info: ${e.message}`);
  }
}

// List posts
async function listPosts({ limit = 10, status = "publish", orderby = "date" } = {}) {
  if (!isConfigured()) return [];
  try {
    const res = await call(`/posts?per_page=${limit}&status=${status}&orderby=${orderby}&_embed`);
    return Array.isArray(res) ? res.map((p) => ({
      id: p.id,
      title: p.title.rendered,
      excerpt: p.excerpt.rendered,
      content: p.content.rendered,
      status: p.status,
      date: new Date(p.date),
      author: p._embedded?.author?.[0]?.name,
      link: p.link,
      slug: p.slug,
      categories: p.categories,
      tags: p.tags,
    })) : [];
  } catch (e) {
    return [];
  }
}

// Get a specific post
async function getPost(postId) {
  if (!isConfigured()) return null;
  try {
    const res = await call(`/posts/${postId}?_embed`);
    return {
      id: res.id,
      title: res.title.rendered,
      content: res.content.rendered,
      excerpt: res.excerpt.rendered,
      status: res.status,
      date: new Date(res.date),
      link: res.link,
      slug: res.slug,
      categories: res.categories,
      tags: res.tags,
    };
  } catch (e) {
    return null;
  }
}

// Create a post
async function createPost({ title, content, excerpt = "", status = "draft", categories = [], tags = [] } = {}) {
  if (!isConfigured()) throw new Error("WordPress is not configured.");
  if (!title || !content) throw new Error("title and content required.");

  try {
    const res = await call("/posts", {
      method: "POST",
      body: {
        title,
        content,
        excerpt,
        status,
        categories,
        tags,
      },
    });
    return {
      id: res.id,
      title: res.title.rendered,
      link: res.link,
      status: res.status,
    };
  } catch (e) {
    throw new Error(`Failed to create post: ${e.message}`);
  }
}

// Update a post
async function updatePost(postId, { title, content, excerpt, status, categories, tags } = {}) {
  if (!isConfigured()) throw new Error("WordPress is not configured.");

  try {
    const body = {};
    if (title) body.title = title;
    if (content) body.content = content;
    if (excerpt !== undefined) body.excerpt = excerpt;
    if (status) body.status = status;
    if (categories) body.categories = categories;
    if (tags) body.tags = tags;

    const res = await call(`/posts/${postId}`, { method: "POST", body });
    return { id: res.id, title: res.title.rendered, status: res.status };
  } catch (e) {
    throw new Error(`Failed to update post: ${e.message}`);
  }
}

// Delete a post
async function deletePost(postId) {
  if (!isConfigured()) throw new Error("WordPress is not configured.");

  try {
    await call(`/posts/${postId}`, { method: "DELETE", body: { force: true } });
    return { ok: true };
  } catch (e) {
    throw new Error(`Failed to delete post: ${e.message}`);
  }
}

// Upload media
async function uploadMedia(filename, fileData) {
  if (!isConfigured()) throw new Error("WordPress is not configured.");
  if (!filename || !fileData) throw new Error("filename and fileData required.");

  const { siteUrl, username, apiToken } = config();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `${siteUrl}/wp-json/wp/v2/media`;
    const auth = Buffer.from(`${username}:${apiToken}`).toString("base64");
    const headers = {
      Authorization: `Basic ${auth}`,
      "Content-Disposition": `attachment; filename="${filename}"`,
    };

    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers,
      body: fileData,
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);

    return {
      id: json.id,
      url: json.source_url,
      title: json.title.rendered,
    };
  } finally {
    clearTimeout(timer);
  }
}

// List pages
async function listPages({ limit = 10, status = "publish" } = {}) {
  if (!isConfigured()) return [];
  try {
    const res = await call(`/pages?per_page=${limit}&status=${status}&_embed`);
    return Array.isArray(res) ? res.map((p) => ({
      id: p.id,
      title: p.title.rendered,
      content: p.content.rendered,
      link: p.link,
      slug: p.slug,
      date: new Date(p.date),
    })) : [];
  } catch (e) {
    return [];
  }
}

// Get categories
async function getCategories() {
  if (!isConfigured()) return [];
  try {
    const res = await call("/categories");
    return Array.isArray(res) ? res.map((c) => ({ id: c.id, name: c.name })) : [];
  } catch (e) {
    return [];
  }
}

// Get tags
async function getTags() {
  if (!isConfigured()) return [];
  try {
    const res = await call("/tags");
    return Array.isArray(res) ? res.map((t) => ({ id: t.id, name: t.name })) : [];
  } catch (e) {
    return [];
  }
}

// Health check
async function health() {
  if (!isConfigured()) return { connected: false, reason: "WordPress is not configured." };
  try {
    const site = await getSite();
    return { connected: true, site: site.name };
  } catch (e) {
    return { connected: false, reason: e.message };
  }
}

module.exports = {
  isConfigured,
  config,
  getSite,
  listPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  uploadMedia,
  listPages,
  getCategories,
  getTags,
  health,
};
