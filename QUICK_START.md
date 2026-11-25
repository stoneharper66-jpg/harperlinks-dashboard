# ⚡ Quick Start: Connect Everything in Seconds

**The HarperLinks Dashboard now has unified, simple, secure connector setup.**

## What Changed

Before: Complex, service-specific setup flows. Now: **One unified system.**

### For Users

Go to **Settings → Apps & Connections** and see this:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Communication
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [📱 Twilio]           [💬 WhatsApp]
  Not connected         Not connected
  Click to connect      Click to connect

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Billing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [💳 Stripe]
  Not connected
  Click to connect

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**To connect Stripe:**
1. Click the Stripe card
2. Modal appears: "Get your API key from Stripe Dashboard → Developers → API Keys"
3. Paste your key
4. We verify it works
5. Done ✓ (key is encrypted, never logged)

**To connect Google Calendar:**
1. Click the Google Calendar card
2. Modal appears: "Sign in with Google"
3. Click the button (opens their login on Google's domain)
4. You authorize
5. Done ✓ (we never see your password)

## Architecture

### Unified Registration (`src/connector-setup.js`)

All connectors defined in one place. Each connector specifies:

```javascript
const CONNECTORS = {
  stripe: {
    name: "Stripe",
    setupMethod: "api-key", // or "oauth"
    fields: [
      { name: "secretKey", label: "Secret Key", type: "password" }
    ],
    instructions: "Get your key from...",
    testMethod: async (config) => {
      return await stripe.health();
    },
  },
};
```

### Simple Endpoints (`server.js`)

- `GET /api/connectors` — List all available
- `GET /api/connectors/:id` — Get setup instructions
- `POST /api/connectors/:id/setup` — Save config (validates + encrypts)
- `DELETE /api/connectors/:id` — Disconnect
- `GET /api/connectors/:id/oauth-url` — Get OAuth consent URL

### Secure Storage

All sensitive fields are encrypted with AES-256-CBC before storage:

```javascript
const encrypted = encrypt(apiKey);  // "iv:encrypted_data"
store.saveCol("connector-configs", { stripe: { config: encrypted } });
// Later...
const decrypted = decrypt(encrypted);  // Back to original apiKey
```

### Smart UI (`public/connector-setup.js`)

Single component handles all connectors:

```javascript
// Show setup modal for any connector
HL.ConnectorSetup.showSetup("stripe");

// Show all connectors grouped by category
HL.ConnectorSetup.showAll();
```

The UI automatically:
- Shows OAuth button for OAuth services
- Shows form fields for API key services
- Validates before saving
- Shows clear error messages
- Encrypts sensitive fields
- Never logs credentials

## Available Connectors

### Billing
- **Stripe** — Subscriptions, payment processing

### Communication
- **Twilio** — Phone calls, SMS
- **WhatsApp Business** — Customer messaging

### Calendar
- **Google Calendar** — Two-way appointment sync (OAuth)

### Media
- **Video AI** — Video generation from scripts

### E-commerce
- **Shopify** — Store data, products, orders

### Website
- **WordPress** — Blog/site publishing

### Social
- **GoHighLevel** — Instagram, Facebook, TikTok, LinkedIn, YouTube, Pinterest (OAuth)

### Other
- **Email (SMTP)** — Notifications and sending
- **Custom Webhooks** — Zapier, Make, n8n

## Security Features

✅ **No passwords to us** — OAuth services use their own auth domains

✅ **Encryption at rest** — API keys stored encrypted (AES-256-CBC)

✅ **No third parties** — No Firebase, Auth0, or external services

✅ **Health checks** — Credentials validated before saving

✅ **Audit trail** — Every connect/disconnect logged to activity

✅ **Isolated storage** — Each HarperLinks account has separate encrypted config

✅ **Automatic rotation ready** — Easy to add token refresh logic

## Configuration

### For Development

No environment variables needed. Just click "Connect" and follow the prompts.

### For Production

Set an encryption key in `.env`:

```bash
ENCRYPTION_KEY=your-32-character-key-here-no-spaces
```

If not set, one is auto-generated (but won't survive server restart).

Optionally set defaults for single-tenant deployments:

```bash
STRIPE_SECRET_KEY=sk_live_...
GHL_TOKEN=pit-...
GOOGLE_CLIENT_ID=...
```

## For Developers: Adding a New Connector

Takes ~10 minutes:

1. **Create API client** (`src/newservice.js`)
   ```javascript
   const isConfigured = () => { /* check env */ };
   const health = async () => { /* test connection */ };
   module.exports = { isConfigured, health };
   ```

2. **Register in `src/connector-setup.js`**
   ```javascript
   const CONNECTORS = {
     newservice: {
       name: "New Service",
       icon: "newservice",
       setupMethod: "api-key", // or "oauth"
       fields: [ /* form fields */ ],
       instructions: "Get your key from...",
       testMethod: async (config) => await newservice.health(),
     },
   };
   ```

3. **Add endpoints in `server.js`** (optional, if you need more than health check)
   ```javascript
   app.get("/api/newservice/something", async (req, res) => {
     // ...
   });
   ```

Done. The UI, encryption, storage, and validation all work automatically.

## Testing

```bash
# See all available connectors
curl http://localhost:4700/api/connectors -H "Authorization: Bearer $TOKEN"

# Check if Stripe is configured
curl http://localhost:4700/api/stripe/health -H "Authorization: Bearer $TOKEN"

# Connect Stripe (after getting key from dashboard)
curl -X POST http://localhost:4700/api/connectors/stripe/setup \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"config":{"secretKey":"sk_live_..."}}'
```

## What's Next

- **Add OAuth for more services** — Follow the Google Calendar pattern
- **Add token refresh** — Auto-renew expiring credentials
- **Add permission scopes** — Let users choose what access to grant
- **Add disconnect confirmation** — Ask before removing critical integrations
- **Add usage metrics** — Show API call counts per connector

All of these are easy additions to the unified system now that it exists.
