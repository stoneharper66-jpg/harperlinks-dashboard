// Email. Honest by design: with SMTP configured it really sends; without it,
// it says so and the work still lands safely in the dashboard — email is the
// bonus, the dashboard is the record.
//
// SMTP settings come from the Settings page (stored globally, admin-only)
// first, then fall back to .env:
//   SMTP_HOST=smtp.gmail.com  SMTP_PORT=465
//   SMTP_USER=harperlinksteam@gmail.com
//   SMTP_PASS=<a Gmail App Password — never the real account password>

const nodemailer = require("nodemailer");
const store = require("./store");

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "harperlinksteam@gmail.com";

function smtpConfig() {
  const saved = store.getGlobal("smtp", {});
  const cfg = {
    host: saved.host || process.env.SMTP_HOST || "",
    port: parseInt(saved.port || process.env.SMTP_PORT || "465", 10),
    user: saved.user || process.env.SMTP_USER || "",
    pass: saved.pass || process.env.SMTP_PASS || "",
  };
  return cfg;
}

function configured() {
  const c = smtpConfig();
  return !!(c.host && c.user && c.pass);
}

function transport() {
  const c = smtpConfig();
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
  });
}

// ---- the look ----------------------------------------------------------------
// One simple branded shell for every email. Table layout and inline styles,
// because email clients still live in 2003. Nothing clever: logo wordmark,
// one card, one button.
function wrapHtml({ title, bodyHtml, buttonText, buttonUrl }) {
  const button = buttonText && buttonUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px auto 6px"><tr><td style="border-radius:12px;background:linear-gradient(120deg,#0A6DD8,#D81B72);background-color:#0A6DD8">
         <a href="${buttonUrl}" style="display:inline-block;padding:13px 30px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:12px">${buttonText}</a>
       </td></tr></table>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F6F8FC">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F6F8FC;padding:36px 16px">
    <tr><td align="center">
      <table role="presentation" width="440" cellspacing="0" cellpadding="0" style="max-width:440px;width:100%">
        <tr><td align="center" style="padding-bottom:18px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:20px;letter-spacing:-0.01em;color:#0E1116">
          <span style="font-weight:400">Harper</span><span style="font-weight:800">Links</span>
        </td></tr>
        <tr><td style="background:#FFFFFF;border:1px solid #E4E8EF;border-radius:18px;padding:30px 28px">
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:#0E1116;margin-bottom:12px">${title}</div>
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14.5px;line-height:1.65;color:#55606E">${bodyHtml}</div>
          ${button}
        </td></tr>
        <tr><td align="center" style="padding-top:16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#7A8494">
          HarperLinks — your business, on autopilot · harperlinks.com
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

/**
 * Check the credentials actually work — connect and authenticate, send
 * nothing. Used by the Settings page so a wrong App Password is caught the
 * moment it's saved, rather than discovered weeks later by a customer who
 * never got their welcome email.
 */
async function verify() {
  if (!configured()) return { ok: false, reason: "No email settings saved yet." };
  try {
    await transport().verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: friendly(e) };
  }
}

// SMTP errors are written for sysadmins. Stone is not a sysadmin.
function friendly(e) {
  const m = String((e && e.message) || e);
  if (/Invalid login|535|BadCredentials/i.test(m)) {
    return "Gmail rejected the login. The password has to be a 16-letter App Password (not your normal Gmail password), and 2-Step Verification must be on.";
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return "Couldn't find that mail server — check the address.";
  if (/ETIMEDOUT|ECONNREFUSED|ESOCKET/i.test(m)) return "Couldn't reach the mail server. Check the port (465 for Gmail).";
  if (/self signed|certificate/i.test(m)) return "The mail server's security certificate didn't check out.";
  return m;
}

// The last few sends, so a silent failure can't stay silent. Kept globally
// (email is a system-wide setting, not a per-customer one).
function logSend(entry) {
  try {
    const log = store.getGlobal("email-log", []);
    log.unshift(Object.assign({ at: new Date().toISOString() }, entry));
    store.saveGlobal("email-log", log.slice(0, 40));
  } catch { /* logging must never break a send */ }
}
function recentSends() {
  return store.getGlobal("email-log", []);
}

async function sendTo(to, subject, text, html) {
  if (!configured()) {
    const reason = "email isn't set up yet (Settings → Email, or SMTP_* in .env)";
    logSend({ to, subject, ok: false, reason });
    return { sent: false, reason };
  }
  try {
    const c = smtpConfig();
    await transport().sendMail({
      from: `"HarperLinks" <${c.user}>`,
      to,
      subject,
      text,                      // the plain version — always included
      html: html || undefined,   // the pretty version — when provided
    });
    logSend({ to, subject, ok: true });
    return { sent: true, to };
  } catch (e) {
    const reason = friendly(e);
    logSend({ to, subject, ok: false, reason });
    return { sent: false, reason };
  }
}

function sendToTeam(subject, text) {
  return sendTo(NOTIFY_EMAIL, subject, text);
}

module.exports = { sendTo, sendToTeam, configured, smtpConfig, wrapHtml, verify, recentSends, NOTIFY_EMAIL };
