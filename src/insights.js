// What's working, what isn't, and who else is out there.
//
// The honesty rule shapes everything here: we only ever analyse numbers we
// actually have. Until a customer's platforms are connected and engagement
// flows back, the insights say so plainly instead of inventing a chart.
// What we CAN always do is analyse the mix (platforms, post types, timing),
// and read competitors' websites with the same crawler that read the
// customer's own site.

const store = require("./store");
const budget = require("./budget");

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || process.env.MODEL || "claude-opus-4-8";

// ---- performance ------------------------------------------------------------

function score(e) {
  if (!e) return null;
  // Weighted the way platforms weight them: a comment beats a like.
  return (e.likes || 0) + (e.comments || 0) * 3 + (e.shares || 0) * 5 + (e.clicks || 0) * 2;
}

/**
 * The learning loop. Groups published posts by kind / platform / hour and
 * ranks the groups by real engagement where it exists.
 */
function computeInsights() {
  const posts = store.getPosts();
  const published = posts.filter((p) => p.status === "published");
  const withData = published.filter((p) => score(p.engagement) !== null);

  const by = (key) => {
    const groups = {};
    withData.forEach((p) => {
      const k = key(p) || "other";
      (groups[k] = groups[k] || []).push(score(p.engagement));
    });
    return Object.entries(groups)
      .map(([k, arr]) => ({ key: k, posts: arr.length, avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) }))
      .sort((a, b) => b.avg - a.avg);
  };

  const out = {
    posts: posts.length,
    published: published.length,
    withEngagement: withData.length,
    hasData: withData.length >= 3, // one lucky post is noise, not a lesson
    byKind: by((p) => p.kind),
    byPlatform: by((p) => p.platform),
    byHour: by((p) => { const h = new Date(p.publishedAt || p.scheduledAt || 0).getHours(); return h + ":00"; }),
    mix: {},
    recommendations: [],
  };

  // The content mix is always real — it's our own calendar.
  posts.filter((p) => p.status === "scheduled" || p.status === "draft").forEach((p) => {
    out.mix[p.kind || "post"] = (out.mix[p.kind || "post"] || 0) + 1;
  });

  if (out.hasData) {
    const topKind = out.byKind[0], topPlat = out.byPlatform[0], topHour = out.byHour[0];
    if (topKind) out.recommendations.push(`"${topKind.key}" posts are your best performers (avg score ${topKind.avg}) — lean the calendar toward them.`);
    if (topPlat) out.recommendations.push(`${topPlat.key} is where your audience actually responds — worth an extra slot a day there.`);
    if (topHour) out.recommendations.push(`Posts around ${topHour.key} do best — the planner should bias toward that window.`);
    const worst = out.byKind[out.byKind.length - 1];
    if (worst && out.byKind.length > 1 && worst.avg * 2 < topKind.avg) {
      out.recommendations.push(`"${worst.key}" posts land flat — swap most of them for "${topKind.key}".`);
    }
  } else {
    out.recommendations.push(
      published.length
        ? "No engagement numbers have come back yet, so there's nothing honest to rank. Once the platforms are connected and a week of posts has run, the winners show up here and the planner adapts to them."
        : "Nothing has published yet — the learning loop starts with the first real post."
    );
  }
  return out;
}

/** A compact prompt block so Sage and the planner write toward what works. */
function insightsBlock() {
  const i = computeInsights();
  if (!i.hasData) return "";
  const lines = ["WHAT'S WORKING (from this account's real engagement numbers)"];
  if (i.byKind[0]) lines.push(`  - Best post type: ${i.byKind[0].key} (avg ${i.byKind[0].avg}); weakest: ${i.byKind[i.byKind.length - 1].key}`);
  if (i.byPlatform[0]) lines.push(`  - Strongest platform: ${i.byPlatform[0].key}`);
  if (i.byHour[0]) lines.push(`  - Best posting window: around ${i.byHour[0].key}`);
  lines.push("  Shape new content toward these. Don't mention the numbers in posts.");
  return lines.join("\n") + "\n";
}

// ---- competitors --------------------------------------------------------------

/**
 * Read a competitor's website with the same crawler that read the customer's,
 * and have Claude compare the two honestly. Nothing is invented: if we can't
 * reach the site, we say so.
 */
async function researchCompetitor(url) {
  const ingest = require("./ingest");
  const clean = ingest.normalizeUrl(url);
  if (!clean) throw new Error("That doesn't look like a valid website address.");

  const site = await ingest.crawl(clean);
  if (!site.pages.length) throw new Error("Their site loaded but had no readable text.");

  const profile = store.getProfile();
  let analysis;
  if (HAS_KEY && budget.canSpend("claude.message", 1).ok) {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      output_config: { effort: "low" },
      system:
        "You compare a competitor's website against your client's business. Reply with ONLY JSON: " +
        '{ "name": string, "offer": string (what they sell, 1 sentence), "strengths": [max 4 short strings], ' +
        '"gaps": [max 3 short strings — things the CLIENT offers or could say that the competitor doesn\'t], ' +
        '"takeaway": string (one plain-English sentence on how the client should respond) }. ' +
        "Base everything strictly on the two texts given. Never invent prices, reviews or claims.",
      messages: [{
        role: "user",
        content: `MY CLIENT:\n${JSON.stringify({ name: profile.name, services: profile.services, audience: profile.audience, location: profile.location })}\n\nCOMPETITOR SITE (${clean}):\n${site.text.slice(0, 12000)}`,
      }],
    });
    budget.record("claude.message", 1, "competitor research");
    try {
      const raw = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      analysis = JSON.parse(raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim());
    } catch { /* fall through */ }
  }
  if (!analysis) {
    analysis = {
      name: site.pages[0].title.split(/[|–—-]/)[0].trim() || new URL(clean).hostname,
      offer: site.pages[0].metaDescription || site.pages[0].text.slice(0, 140),
      strengths: [], gaps: [],
      takeaway: "Read their site above — full AI comparison needs the live engine.",
    };
  }

  const record = Object.assign({ url: clean, pagesRead: site.pages.length, at: new Date().toISOString() }, analysis);
  const all = store.getCol("competitors").filter((c) => c.url !== clean);
  all.unshift(record);
  store.saveCol("competitors", all.slice(0, 12));
  store.logActivity("research", `Studied competitor ${record.name} (${site.pages.length} pages)`);
  return record;
}

function listCompetitors() {
  return store.getCol("competitors");
}

module.exports = { computeInsights, insightsBlock, researchCompetitor, listCompetitors, score };
