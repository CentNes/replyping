const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || 'ReplyPing <noreply@replyping.com>';

async function sendEmail(to, subject, html) {
  if (!resend) {
    console.log(`[email-mock] To: ${to} | Subject: ${subject}`);
    return true;
  }
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
    return true;
  } catch (err) {
    console.error('Email send failed:', err.message);
    return false;
  }
}

module.exports = { sendEmail };
