import nodemailer from 'nodemailer';
import { buildPasswordResetEmail } from '@/lib/email-template';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL || 'https://fixmyhome.pro';
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.MAIL_FROM || 'FixMyHome <noreply@fixmyhome.pro>';

type ResetEmailInput = {
  to: string;
  name: string;
  token: string;
};

function createTransport() {
  const host = process.env.SMTP_HOST || process.env.EMAIL_SERVER_HOST;
  const port = Number(process.env.SMTP_PORT || process.env.EMAIL_SERVER_PORT || 587);
  const user = process.env.SMTP_USER || process.env.EMAIL_SERVER_USER;
  const pass = process.env.SMTP_PASSWORD || process.env.EMAIL_SERVER_PASSWORD;

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
    html: buildPasswordResetEmail({ name, resetUrl, recipientEmail: to }),

  });
}