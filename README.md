# HarperLinks Dashboard

The AI Business Operating System — a chat-first command centre where AI employees learn
your business, write and schedule your content, capture leads, book clash-checked
appointments and run automations.

This is the **application**. The public marketing site is a separate project:
[harperlinks-website](https://github.com/stoneharper66-jpg/harperlinks-website).
They deploy independently and the website does not link here.

---

## Run it

```bash
npm install
npm start          # http://localhost:4700
```

The dashboard is served at `/`. (`/app` 301-redirects there, for old links.)

### Live vs demo mode

| Mode | When | What you get |
|---|---|---|
| **DEMO** | no API key | A keyword brain runs the same tools — ingest, write, schedule, publish all work with canned content. Nothing is faked beyond the writing. |
| **LIVE** | `ANTHROPIC_API_KEY` set | Real Claude writes in the brand's voice and drives every tool conversationally. |

```bash
cp .env.example .env     # then add your key
```

**Never commit `.env`.** It's gitignored.

---

## The AI employees

| | Role | Status |
|---|---|---|
| **Sage** | Social Media Manager | Works |
| **Riley** | Customer Support Agent | Works in chat; social DMs need Meta approval |
| **Harper** | AI Receptionist | Needs a Twilio number + voice connection |
| **Flynn** | Sales Agent | Works; auto-send needs email/SMS |
| **Indi** | Website Builder | Works; live CMS edits need WordPress access |
| **Darcy** | Business Manager | Works |

**The switches are real.** Turn Sage off and the scheduler genuinely stops publishing.
Put Sage in **Assisted** mode and generated content is held as drafts for approval
instead of self-scheduling. Turn Flynn off and workflow lead-steps skip with a logged
reason. These are enforced server-side in `src/employees.js` via `getState()`.

---

## Layout

```
server.js          Express app — dashboard at /, plus the whole JSON API
src/
  engine.js        Claude tool-use loop + the keyless demo brain
  prompt.js        System prompt, built from the business profile + knowledge base
  tools.js         Bot tools: ingest_website, create_post, schedule_post,
                   create_lead, book_appointment (clash-checked), add_task …
  ingest.js        URL → readable text → business profile
  scheduler.js     30s tick: publishes due posts, surfaces due tasks
  events.js        Automation engine — events fire enabled workflows
  employees.js     The six AI employees + their enabled/mode state
  datetime.js      Natural-language dates ("tomorrow 3pm", "next week")
  store.js         JSON-file store with atomic writes
public/
  app.html         Shell
  app.js           Core runtime: router, sidebar, shared widgets
  pages.js         Every dashboard page
  social.js        Shared AI chat builder + the Social Media page
data/              Runtime state — gitignored, created on first run
```

### Linking back to the marketing site

`public/app.js` has a `HL.SITE_URL` constant near the bottom. Set it to the live website
URL and a "Site ↗" link appears in the top bar; leave it empty and the link stays hidden
rather than pointing somewhere dead.

---

## Honest status

This project does not fake anything, and shouldn't start:

- **Publishing runs in preview mode.** The scheduler fires exactly on time and logs every
  publish, but posts are not pushed to Instagram/Facebook/TikTok until those platform
  integrations are connected. `src/scheduler.js → publish()` is the single seam to swap
  in real API calls.
- **Video** — the bot writes real scripts and shot lists. Rendering footage needs a video
  AI integration.
- **Phone, email/SMS, payments** — not connected. Those pages show a designed setup
  state, never fake data.
- **Stats are always real.** Metrics that need an unconnected integration say
  "Not connected" rather than inventing a number.

Keep it that way.

---

## Deploying

This needs a **Node host** — Railway, Render or Fly.io. It cannot go on a static host,
because of the AI engine, the scheduler and the JSON datastore.

Set `ANTHROPIC_API_KEY` and `PORT` as environment variables there. Note that `data/` is
local disk; for a real deployment you'd want a persistent volume or a proper database.
