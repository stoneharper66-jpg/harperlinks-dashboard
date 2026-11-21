# Deploying HarperLinks — the exact steps

Two deploys: the **dashboard** (this repo, a Node server) and the
**marketing site** (harperlinks-website, static files). ~1 evening total.

## 1 · Dashboard → Railway (~US$5/mo)

1. railway.app → sign in with GitHub → New Project → Deploy from GitHub repo
   → pick `harperlinks-dashboard`.
2. Add a **Volume** (Project → right-click service → Attach Volume), mount
   path `/data`.
3. Service → Variables — set:
   - `ANTHROPIC_API_KEY` = your key
   - `HARPERLINKS_DATA_DIR` = `/data`
   - `PUBLIC_BASE_URL` = the Railway URL for now (step 5 swaps in the domain)
   - `SITE_ORIGINS` = your site's URL, e.g. `https://harperlinks.com.au`
   - SMTP_* from .env.example for email notifications
4. Settings → Health check path: `/healthz`.
5. **First boot on an empty volume shows the create-admin screen — open the
   URL immediately and create your admin account before sharing the link.**
   (Local data doesn't follow automatically; the clean start is simpler —
   recreate your account and reconnect GHL from HQ.)

## 2 · Marketing site → Netlify (free)

1. app.netlify.com → Add new site → Import from GitHub → `harperlinks-website`.
   No build command; publish directory = repo root. Done — it's live.
2. In `index.html` set:
   - `DASHBOARD_URL` + `AGENT_URL` = the dashboard's public URL
   - `og:image` to the absolute URL: `https://<your-domain>/assets/og-1200x630.png`

## 3 · Domain (~A$20/yr)

1. Buy it (Namecheap / Cloudflare / VentraIP for .com.au).
2. Netlify → Domain settings → add `harperlinks.com.au` → follow its DNS prompts.
3. Railway → Settings → Domains → add `app.harperlinks.com.au` → add the
   CNAME it shows at your registrar.
4. Update `SITE_ORIGINS` + `PUBLIC_BASE_URL` (Railway vars) and
   `DASHBOARD_URL`/`AGENT_URL` (site) to the real domains. HTTPS is automatic
   on both hosts; cookies flip to Secure on their own.

## 4 · After it's live — 10-minute checklist

- Sign in at the real URL, connect GHL from HQ, link socials (Socials ↗).
- Submit the site's sign-up form once — lead should appear in your CRM and
  email you.
- Ask the AI for an image on a post — check the post publishes WITH media
  (that's PUBLIC_BASE_URL working).
- Check `data/backups/` has a fresh `.tgz` the next morning.
