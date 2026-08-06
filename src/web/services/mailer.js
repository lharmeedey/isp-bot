'use strict';

/**
 * mailer — the platform's single transactional-email sender.
 *
 * Delivery is provider-agnostic behind sendMail(). If RESEND_API_KEY is set we
 * send via Resend (lazy-required so local dev needs neither the package nor a
 * key); otherwise we fall back to logging the message — so the OTP flow is fully
 * testable locally by reading the server console. Going live = set RESEND_API_KEY
 * and MAIL_FROM in the environment; no code change.
 *
 * Shared platform sender: all mail (operator AND customer, every tenant) goes
 * out from MAIL_FROM. Per-tenant senders are intentionally out of scope.
 */
const logger = require('../../services/logger');

const FROM = process.env.MAIL_FROM || 'ISP Console <onboarding@resend.dev>';

// Lazily constructed Resend client (only when a key exists).
let _resend = null;
function getResend() {
  if (_resend) return _resend;
  const { Resend } = require('resend'); // lazy: not needed in dev without a key
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

/**
 * Send an email. Never throws for the caller's flow control — a delivery failure
 * is logged and swallowed so (e.g.) a password-reset request still returns a
 * uniform response. Returns true if handed off to a provider, false otherwise.
 */
async function sendMail({ to, subject, text, html }) {
  if (!process.env.RESEND_API_KEY) {
    // Dev fallback: surface the content in the server log.
    logger.info('📧 [mailer:dev] email not sent (no RESEND_API_KEY) — logging instead', {
      to, subject, text,
    });
    return false;
  }

  try {
    await getResend().emails.send({
      from:    FROM,
      to,
      subject,
      text,
      html: html || undefined,
    });
    logger.info('Email sent', { to, subject });
    return true;
  } catch (err) {
    logger.error('Email send failed', { to, subject, error: err.message });
    return false;
  }
}

/**
 * Send a one-time code for password reset or email-change verification.
 */
async function sendOtpEmail(to, code, purpose) {
  const isReset = purpose === 'reset';
  const subject = isReset
    ? 'Your password reset code'
    : 'Confirm your new email address';
  const action = isReset
    ? 'reset your password'
    : 'confirm your new email address';

  const text =
    `Your verification code is ${code}\n\n` +
    `Enter it to ${action}. This code expires in 10 minutes.\n` +
    `If you didn't request this, you can safely ignore this email.`;

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto">
      <p style="color:#334155;font-size:15px">Your verification code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#0d9488;margin:12px 0">${code}</p>
      <p style="color:#64748b;font-size:14px">Enter it to ${action}. This code expires in 10 minutes.</p>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">If you didn't request this, you can safely ignore this email.</p>
    </div>`;

  return sendMail({ to, subject, text, html });
}

module.exports = { sendMail, sendOtpEmail };
