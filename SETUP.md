# Turning the dashboard on properly

## Accounts & sign-in (how you sell this)

The dashboard is multi-tenant now — it's the product you sell.

- **First boot** shows a one-time setup page: create the owner (admin) account.
  That's you. It only ever appears once.
- **When a customer pays**: sign in → **Customer Accounts** (HQ section) →
  **+ New customer account**. Give them a temporary password; they can change
  it later by clicking their name in the top bar.
- Every account's data lives in its own folder (`data/accounts/<id>/`) —
  posts, leads, chat, budget and GHL connection are completely separate.
  There is no code path from one account's session to another's folder.
- **White-glove setup**: use the **GoHighLevel** button on their account row
  to paste *their* GHL sub-account token + location id. It's saved into their
  account only and tested against GHL on the spot.
- **Disable** stops a non-paying customer signing in, instantly — their live
  session dies too. Re-enable brings them back untouched.

## Stripe (getting paid)

1. Stripe → **Products**: create Professional (A$249/mo), Business (A$499/mo),
   Enterprise (A$999/mo) as recurring prices.
2. Each product → **Create payment link**. In the link's **After payment**
   settings, redirect to your website with `?paid=1` on the end — buyers come
   back to a "here's what happens next" banner instead of a dead end.
3. Paste the three links into `STRIPE_LINKS` near the bottom of the website's
   `index.html` (`~/harperlinks-website`). The pricing buttons become real
   checkouts the moment a link is filled in.
4. **Get emailed when someone pays**: Stripe → Settings → (your profile) →
   **Notifications** → tick successful payments. No code involved — Stripe
   sends it to your account email directly.

## The website AI agent

The floating "Ask HarperLinks" chat on the marketing site answers visitor
questions (pricing, setup, what it does). It runs on this server at
`/api/public/ask` — no login, rate-limited per visitor, metered against your
spend cap, and it has **no access to any account data by construction**.
Point `AGENT_URL` in the website's `index.html` at wherever this server is
deployed. If the server's unreachable the chat bubble simply hides.

---

Two keys take the AI from a demo to a real system. Neither needs platform approval.

---

## 1. The AI brain — Anthropic key

Right now the bots run a keyword fallback. They follow the right steps but don't
genuinely *write*. One key fixes that.

1. <https://console.anthropic.com> → **API Keys** → create one
2. Add billing (pay-as-you-go, no subscription)
3. In the project root:

```bash
cp .env.example .env
```

4. Put the key in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

5. Restart. The top-left badge flips from **Demo mode** to **Live · Claude**.

Expect roughly **A$5–20/month** at small-business volume — a few hundred chat turns.
Your A$50 cap stops it dead well before that becomes a surprise.

---

## 2. Actually posting — GoHighLevel

This is the step everyone gets stuck on. Posting to Instagram, Facebook and TikTok
normally needs each platform's publishing permission: Meta app review, TikTok's
content-posting audit, business verification, demo videos. **Weeks of paperwork.**

You already pay for GoHighLevel, and **GHL already holds those approvals**. So we hand
posts to GHL and let it publish.

**Step 1 — connect your socials inside GHL (once)**
GHL → **Marketing → Social Planner** → connect Instagram, Facebook, TikTok, LinkedIn,
YouTube. Whatever you connect here is what the dashboard can post to.

**Step 2 — make a Private Integration token**
GHL → **Settings** (bottom-left gear) → **Private Integrations** → **Create new
Integration**. Tick these scopes:

- `socialplanner/post.write`
- `socialplanner/account.readonly`

Copy the token — **it's only shown once**.

**Step 3 — find your location id**
It's in your GHL dashboard URL:
`app.gohighlevel.com/v2/location/`**`<THIS BIT>`**`/dashboard`

**Step 4 — add both to `.env`**

```
GHL_TOKEN=pit-...
GHL_LOCATION_ID=your-location-id
```

Restart. On boot the log will say:

```
Scheduler: running (30s tick, publishing LIVE via GoHighLevel)
```

Integrations → GoHighLevel will show **connected**, and scheduled posts will go out for
real instead of preview.

---

## The spend cap

**Settings & Knowledge → AI spend cap.** Default **A$50/month**.

The AI spends freely under the ceiling and **stops dead** when it's reached — chat
refuses with an explanation rather than silently failing, and it's written to the
activity log. You get a warning entry at 80%.

Rough costs used by the meter:

| | Estimate (AUD) |
|---|---|
| Chat turn | ~4.5c (Opus 4.8) |
| Image | ~6c |
| Video | ~5c **per second** (a 15s reel ≈ 75c) |

The chat figure is Anthropic's list price for `claude-opus-4-8` — US$5 per million words in,
US$25 per million out — converted to AUD with a little headroom. A typical turn sends the
system prompt plus your business profile and writes a caption back. **A$50/month is roughly
1,100 chat turns**, which is far more than a small business will use.

These are estimates for guardrail purposes, not billing truth — reconcile against the
provider's invoice.

---

## What still isn't connected

Honest list, so nothing surprises you:

- **Image and video generation** — not wired yet. The bot writes video *scripts and
  shot lists*; it doesn't render footage.
- **Phone (Harper)** — needs Twilio.
- **Email/SMS sending** — needs Gmail/SMTP and Twilio. Workflow steps that need them
  skip with a logged reason rather than pretending.
- **Media uploads** — GHL needs a public URL for images/video. Once generation is added
  it'll also need object storage (R2/S3).

## Deploying it

This needs a **Node host** — Railway, Render or Fly.io. It can't go on Netlify.

Set `ANTHROPIC_API_KEY`, `GHL_TOKEN`, `GHL_LOCATION_ID` and `PORT` as environment
variables there. Note `data/` is local disk — on a cloud host that's usually ephemeral,
so for anything long-lived move to a persistent volume or Postgres.
