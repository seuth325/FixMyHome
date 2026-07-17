import nodemailer from 'nodemailer';
import { buildPasswordResetEmail } from '@/lib/email-template';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL || 'https://fixmyhome.pro';
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.MAIL_FROM || 'FixMyHome <noreply@fixmyhome.pro>';

type ResetEmailInput = {
  to: string;
  name: string;
  token: string;
};

type ContactEmailInput = {
  name: string;
  email: string;
  role: string;
  reason: string;
  message: string;
};
type NewUserEmailInput = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
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
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendContactEmail({ name, email, role, reason, message }: ContactEmailInput) {
  const transporter = createTransport();
  const to = process.env.CONTACT_TO || process.env.SUPPORT_EMAIL || process.env.EMAIL_SERVER_USER || 'support@fixmyhome.pro';
  const submittedAt = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const subject = `FixMyHome contact form: ${reason}`;
  const text = [
    'New FixMyHome.pro contact form submission',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Role: ${role}`,
    `Reason: ${reason}`,
    `Submitted: ${submittedAt} ET`,
    '',
    'Message:',
    message,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:20px;font-weight:800;color:#111827;">New FixMyHome.pro Contact Request</div>
          <div style="margin-top:4px;font-size:13px;color:#6b7280;">Submitted ${escapeHtml(submittedAt)} ET</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.55;">
            <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Name</td><td style="padding:6px 0;font-weight:700;">${escapeHtml(name)}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(email)}" style="color:#1d4ed8;">${escapeHtml(email)}</a></td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Role</td><td style="padding:6px 0;">${escapeHtml(role)}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Reason</td><td style="padding:6px 0;">${escapeHtml(reason)}</td></tr>
          </table>
          <div style="margin-top:20px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;white-space:pre-wrap;font-size:14px;line-height:1.6;">${escapeHtml(message)}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: FROM_EMAIL,
    to,
    replyTo: email,
    subject,
    text,
    html,
  });
}
export async function sendNewUserNotification({ id, name, email, role, createdAt }: NewUserEmailInput) {
  const transporter = createTransport();
  const to = process.env.NEW_USER_NOTIFICATION_TO || process.env.SUPPORT_EMAIL || 'support@fixmyhome.pro';
  const registeredAt = createdAt.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const adminUrl = APP_URL.replace(/\/$/, '') + '/admin?user=' + encodeURIComponent(id);

  await transporter.sendMail({
    from: FROM_EMAIL,
    to,
    replyTo: email,
    subject: 'New FixMyHome.pro user: ' + name,
    text: [
      'A new user registered on FixMyHome.pro.',
      '',
      'Name: ' + name,
      'Email: ' + email,
      'Initial role: ' + role,
      'Registered: ' + registeredAt + ' ET',
      'User ID: ' + id,
      '',
      'Review users: ' + adminUrl,
    ].join('\n'),
    html: '<h1>New FixMyHome.pro User</h1>' +
      '<p><strong>Name:</strong> ' + escapeHtml(name) + '</p>' +
      '<p><strong>Email:</strong> ' + escapeHtml(email) + '</p>' +
      '<p><strong>Initial role:</strong> ' + escapeHtml(role) + '</p>' +
      '<p><strong>Registered:</strong> ' + escapeHtml(registeredAt) + ' ET</p>' +
      '<p><a href="' + escapeHtml(adminUrl) + '">Review in Admin</a></p>',
  });
}
