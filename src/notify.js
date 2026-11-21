// Email notifications to the HarperLinks team (Stone). Honest by design:
// with SMTP configured in .env it really sends; without it, it says so and
// the signup still lands safely in the dashboard — email is the bonus,
// the CRM is the record.
//
// .env:
//   NOTIFY_EMAIL=harperlinksteam@gmail.com   (defaults to this)
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=465
//   SMTP_USER=harperlinksteam@gmail.com
//   SMTP_PASS=<a Gmail App Password — never the real account password>

const nodemailer = require("nodemailer");

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "harperlinksteam@gmail.com";

function configured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transport() {
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendToTeam(subject, text) {
  if (!configured()) {
    return { sent: false, reason: "email isn't set up yet (add SMTP_HOST/SMTP_USER/SMTP_PASS to .env)" };
  }
  try {
    await transport().sendMail({
      from: `"HarperLinks" <${process.env.SMTP_USER}>`,
      to: NOTIFY_EMAIL,
      subject,
      text,
    });
    return { sent: true, to: NOTIFY_EMAIL };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

module.exports = { sendToTeam, configured, NOTIFY_EMAIL };
