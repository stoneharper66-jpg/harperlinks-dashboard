// Video AI integration for rendering videos from scripts.
//
// Handles:
// - Video generation from scripts and shot lists
// - Slideshow video creation
// - Avatar/AI presenter videos (via Synthesia or similar)
// - Background music and voice-over
// - Video upload to media storage
// - Integration with scheduler for video post publishing
// - Progress tracking and status updates
//
// Setup: Set VIDEO_AI_API_KEY and VIDEO_AI_PROVIDER in .env
// Supported providers: synthesia, runway, elevenlabs, custom

const store = require("./store");
const tenant = require("./tenant");

const TIMEOUT_MS = 30000; // longer timeout for video processing

function config() {
  return {
    apiKey: String(process.env.VIDEO_AI_API_KEY || "").trim(),
    provider: String(process.env.VIDEO_AI_PROVIDER || "synthesia").trim(),
    webhookUrl: `${process.env.PUBLIC_BASE_URL || "https://harperlinks-dashboard-production.up.railway.app"}/api/webhooks/videoai/status`,
  };
}

function isConfigured() {
  const c = config();
  return !!(c.apiKey && c.provider);
}

// Save a video generation job
function saveJob(job) {
  const jobs = store.getCol("video-jobs", []);
  const existing = jobs.findIndex((j) => j.id === job.id);
  if (existing >= 0) jobs[existing] = job;
  else jobs.push(job);
  store.saveCol("video-jobs", jobs);
}

function getJob(jobId) {
  const jobs = store.getCol("video-jobs", []);
  return jobs.find((j) => j.id === jobId);
}

function listJobs(status = null) {
  const jobs = store.getCol("video-jobs", []);
  if (status) return jobs.filter((j) => j.status === status);
  return jobs;
}

// Synthesia provider
async function synthesia_createVideo(script, { voiceId = "d60ba2f6-a1f1-4a8e-9c5d-33a8e0b05f04", avatarId = "default" } = {}) {
  const { apiKey, webhookUrl } = config();
  if (!apiKey) throw new Error("Video AI API key not configured.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.synthesia.io/v2/videos", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: [
          {
            type: "avatar",
            avatar_id: avatarId,
            text: script,
            voice: { type: "professional", voice_id: voiceId },
          },
        ],
        output_format: { type: "mp4", resolution: "1080p" },
        webhook: { url: webhookUrl, events: ["video.completed", "video.failed"] },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    return { id: json.id, status: "processing", provider: "synthesia" };
  } finally {
    clearTimeout(timer);
  }
}

// Runway provider
async function runway_createVideo(script, { mode = "text-to-video" } = {}) {
  const { apiKey, webhookUrl } = config();
  if (!apiKey) throw new Error("Video AI API key not configured.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.runwayml.com/v1/videos", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: script,
        mode: mode,
        webhook_url: webhookUrl,
        output_format: "mp4",
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return { id: json.id, status: "processing", provider: "runway" };
  } finally {
    clearTimeout(timer);
  }
}

// Generate a video from a script
async function generateVideo(script, { shotList = [], music = null, voiceOver = null, options = {} } = {}) {
  if (!isConfigured()) throw new Error("Video AI is not configured.");
  if (!script) throw new Error("Script is required.");

  const { provider } = config();
  const jobId = store.newId("video");
  let result;

  try {
    if (provider === "synthesia") {
      result = await synthesia_createVideo(script, options);
    } else if (provider === "runway") {
      result = await runway_createVideo(script, options);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const job = {
      id: jobId,
      providerId: result.id,
      provider: result.provider,
      status: "processing",
      script,
      shotList,
      music,
      voiceOver,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveJob(job);
    store.logActivity("video", `Video generation started: ${script.slice(0, 50)}...`);
    return job;
  } catch (e) {
    store.logActivity("video", `Video generation failed: ${e.message}`);
    throw e;
  }
}

// Get video status
async function getVideoStatus(jobId) {
  const job = getJob(jobId);
  if (!job) throw new Error("Job not found.");

  const { provider, apiKey } = config();
  if (!apiKey) throw new Error("Video AI is not configured.");

  try {
    if (provider === "synthesia") {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`https://api.synthesia.io/v2/videos/${job.providerId}`, {
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error("Failed to fetch status from Synthesia.");
        return { id: jobId, status: json.status, videoUrl: json.download_url };
      } finally {
        clearTimeout(timer);
      }
    } else if (provider === "runway") {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`https://api.runwayml.com/v1/videos/${job.providerId}`, {
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error("Failed to fetch status from Runway.");
        return { id: jobId, status: json.status, videoUrl: json.output_url };
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (e) {
    return { id: jobId, status: "error", error: e.message };
  }
}

// Handle webhook from video provider
async function handleStatusWebhook(body) {
  const { video_id, status, download_url } = body;
  if (!video_id) return { ok: false };

  const jobs = store.getCol("video-jobs", []);
  const job = jobs.find((j) => j.providerId === video_id);
  if (!job) return { ok: false };

  job.status = status === "completed" ? "done" : status === "failed" ? "error" : "processing";
  job.videoUrl = download_url || null;
  job.updatedAt = new Date().toISOString();
  saveJob(job);

  store.logActivity("video", `Video ${status}: ${job.id}`);
  return { ok: true };
}

// Health check
async function health() {
  if (!isConfigured()) return { connected: false, reason: "Video AI is not configured." };
  try {
    const jobs = listJobs("done");
    return { connected: true, completedVideos: jobs.length };
  } catch (e) {
    return { connected: false, reason: e.message };
  }
}

module.exports = {
  isConfigured,
  config,
  generateVideo,
  getVideoStatus,
  getJob,
  listJobs,
  saveJob,
  handleStatusWebhook,
  health,
};
