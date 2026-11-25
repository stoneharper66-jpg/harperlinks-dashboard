# Connector Setup Guide

**Everything takes seconds. Everything is secure.**

## How to Connect Any Service

### For Users (Business Owners)

1. Go to **Settings → Apps & Connections**
2. Click on any app you want to use
3. For OAuth services (Google Calendar, Stripe, etc.):
   - Click the app → "Sign in with [Service]"
   - Authorize on their domain (we never see your password)
   - Done! ✓

4. For API key services (Twilio, WordPress, etc.):
   - Click the app → Enter your credentials
   - We verify it works before saving
   - Your keys are encrypted and never logged
   - Done! ✓

### For Developers

Adding a new connector takes 10 minutes:

```javascript
// 1. Create src/newservice.js with your API client
const call = async (path, options) => { /* ... */ };
const isConfigured = () => { /* ... */ };
const health = async () => { /* ... */ };
module.exports = { call, isConfigured, health };

// 2. Register in src/connector-setup.js
const CONNECTORS = {
  newservice: {
    name: "New Service",
    icon: "newservice",
    category: "category",
    setupMethod: "api-key", // or "oauth"
    fields: [
      { name: "apiKey", label: "API Key", type: "password" },
    ],
    instructions: "Get your key from...",
    testMethod: async (config) => {
      // Validate config works
      return await newservice.health();
    },
  },
};

// 3. Add endpoints in server.js
app.get("/api/newservice/health", async (req, res) => {
  res.json(await newservice.health());
});
```

That's it. The UI, encryption, validation, and dashboard integration all work automatically.

## Security Principles

✓ **No passwords ever sent to us** — OAuth services authorize on their own domain

✓ **API keys encrypted at rest** — using AES-256-CBC

✓ **No keys in logs or console** — sensitive fields are stripped from activity logs

✓ **Health checks before saving** — we verify credentials work before storing them

✓ **Tokens isolated per account** — each HarperLinks account has its own encrypted store

✓ **No third-party API integrations** — no Firebase, no Auth0, no external services

## Current Connectors

| Service | Method | Status |
|---------|--------|--------|
| **Stripe** | API Key | ✓ Ready |
| **Twilio** | API Key | ✓ Ready |
| **Google Calendar** | OAuth | ✓ Ready |
| **Video AI** | API Key | ✓ Ready |
| **WhatsApp Business** | API Key | ✓ Ready |
| **Shopify** | API Key | ✓ Ready |
| **WordPress** | API Key | ✓ Ready |
| **GoHighLevel** | API Key | ✓ Ready |
| **Email (SMTP)** | API Key | ✓ Ready |
| **Custom Webhooks** | Config | ✓ Ready |

## Configuration Files

```
src/
  connector-setup.js    ← Central connector registry (add new ones here)
  stripe.js            ← Stripe API client
  twilio.js            ← Twilio API client
  gcal.js              ← Google Calendar API client
  videoai.js           ← Video AI provider
  whatsapp.js          ← WhatsApp Business API
  shopify.js           ← Shopify API client
  wordpress.js         ← WordPress REST API
  
public/
  connector-setup.js    ← UI component (loads in all pages)
  pages.js             ← Integrations page (uses ConnectorSetup UI)
```

## Environment Variables for Connectors

You can optionally set defaults in `.env` (useful for single-tenant deployments):

```bash
# Stripe
STRIPE_SECRET_KEY=sk_live_...

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1234567890

# Google Calendar (for OAuth)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4700/api/gcal/callback

# GoHighLevel
GHL_TOKEN=pit-...
GHL_LOCATION_ID=...

# Encryption (required)
ENCRYPTION_KEY=32-character-key-here-no-spaces
```

## Testing a Connector

```bash
# Check if Stripe is configured
curl http://localhost:4700/api/stripe/health

# Check if Google Calendar is configured
curl http://localhost:4700/api/gcal/health

# See all available connectors
curl http://localhost:4700/api/connectors
```

## Troubleshooting

**"Configuration saved but test failed"**
- Double-check your credentials in the service's dashboard
- Make sure the token/key hasn't expired
- If using OAuth, re-authorize and try again

**"Connector shows 'Not connected' in the dashboard"**
- Refresh the page (the UI caches the status)
- Check that the connector's health endpoint is returning `connected: true`

**"Can't connect via OAuth"**
- Make sure popups are allowed for this site
- Check that PUBLIC_BASE_URL in .env matches your actual domain
- Clear browser cookies for the OAuth provider

## Adding a Connector with OAuth

For OAuth services (like Google), you'll need to:

1. Register your app on the service's developer dashboard
2. Get your Client ID and Secret
3. Set the redirect URI to `https://yourdomain/api/[service]/callback`
4. Add to connector-setup.js:
   ```javascript
   setupMethod: "oauth",
   oauthConfig: { provider: "google", scopes: [...] }
   ```
5. The UI will show "Sign in with [Service]" button automatically
