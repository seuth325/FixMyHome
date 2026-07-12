import nodemailer from 'nodemailer';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || 'https://fixmyhome.pro';
const FROM_EMAIL = process.env.MAIL_FROM || 'FixMyHome <noreply@fixmyhome.pro>';

type ResetEmailInput = {
  to: string;
  name: string;
  token: string;
};

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: { user, pass },
    });
  }

  return nodemailer.createTransport({ sendmail: true, newline: 'unix', path: '/usr/sbin/sendmail' });
}

export async function sendPasswordResetEmail({ to, name, token }: ResetEmailInput) {
  const resetUrl = `${APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  const transporter = createTransport();

  await transporter.sendMail({
    from: FROM_EMAIL,
    to,
    subject: 'Reset your FixMyHome password',
    text: `Hi ${name},\n\nUse this secure link to reset your FixMyHome password:\n${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111827;max-width:560px;margin:0 auto;padding:24px;">
        <h1 style="font-size:22px;margin:0 0 12px;">Reset your FixMyHome password</h1>
        <p>Hi ${name},</p>
        <p>Use the secure button below to choose a new password. This link expires in 1 hour.</p>
        <p style="margin:24px 0;">
          <a href="${resetUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block;">Choose a new password</a>
        </p>
        <p style="font-size:13px;color:#6b7280;">If the button does not work, copy and paste this link into your browser:<br>${resetUrl}</p>
        <p style="font-size:13px;color:#6b7280;">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
}