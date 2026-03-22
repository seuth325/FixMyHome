const nodemailer = require('nodemailer');

const DEFAULT_SUPPORT_EMAIL = 'support@fixmyhome.pro';

function getMailerConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const from = String(process.env.SMTP_FROM || '').trim();

  return {
    enabled: Boolean(host && from),
    host,
    port,
    secure: String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true',
    user,
    pass,
    from,
  };
}

function createTransport(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user
      ? {
          user: config.user,
          pass: config.pass,
        }
      : undefined,
  });
}

function getSupportEmail() {
  return String(process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL).trim() || DEFAULT_SUPPORT_EMAIL;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const config = getMailerConfig();
  const supportEmail = getSupportEmail();
  if (!config.enabled) {
    return {
      delivered: false,
      mode: 'log',
      reason: 'SMTP is not configured.',
    };
  }

  const transport = createTransport(config);
  await transport.sendMail({
    from: config.from,
    to,
    subject: 'Reset your FixMyHome password',
    text: [
      'A password reset was requested for your FixMyHome account.',
      '',
      `Open this link to choose a new password: ${resetUrl}`,
      '',
      'This link expires in 1 hour. If you did not request this reset, you can ignore this email.',
      `Need help? Contact ${supportEmail}.`,
    ].join('\n'),
    html: `
      <p>A password reset was requested for your FixMyHome account.</p>
      <p><a href="${escapeHtml(resetUrl)}">Open this link to choose a new password</a></p>
      <p>This link expires in 1 hour. If you did not request this reset, you can ignore this email.</p>
      <p>Need help? Contact <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>.</p>
    `,
  });

  return {
    delivered: true,
    mode: 'smtp',
  };
}

async function sendContactMessageEmail({ fromName, fromEmail, subject, message }) {
  const config = getMailerConfig();
  const supportEmail = getSupportEmail();
  if (!config.enabled) {
    return {
      delivered: false,
      mode: 'log',
      reason: 'SMTP is not configured.',
    };
  }

  const transport = createTransport(config);
  const safeName = String(fromName || '').trim() || 'FixMyHome visitor';
  const safeEmail = String(fromEmail || '').trim();
  const safeSubject = String(subject || '').trim() || 'New FixMyHome contact form message';
  const safeMessage = String(message || '').trim();

  await transport.sendMail({
    from: config.from,
    to: supportEmail,
    replyTo: safeEmail || undefined,
    subject: `[FixMyHome Contact] ${safeSubject}`,
    text: [
      `Name: ${safeName}`,
      `Email: ${safeEmail || 'Not provided'}`,
      '',
      safeMessage,
    ].join('\n'),
    html: `
      <p><strong>Name:</strong> ${escapeHtml(safeName)}</p>
      <p><strong>Email:</strong> ${escapeHtml(safeEmail || 'Not provided')}</p>
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(safeMessage).replace(/\n/g, '<br />')}</p>
    `,
  });

  return {
    delivered: true,
    mode: 'smtp',
  };
}

async function sendWelcomeEmail({ to, name, role, loginUrl }) {
  const config = getMailerConfig();
  const supportEmail = getSupportEmail();
  if (!config.enabled) {
    return {
      delivered: false,
      mode: 'log',
      reason: 'SMTP is not configured.',
    };
  }

  const safeName = String(name || '').trim() || 'there';
  const normalizedRole = String(role || '').trim().toUpperCase();
  const roleLabel = normalizedRole === 'HANDYMAN' ? 'handyman' : 'homeowner';
  const safeLoginUrl = String(loginUrl || '').trim();

  const roleWelcomeLine = normalizedRole === 'HANDYMAN'
    ? 'Set up your profile and start finding local jobs that match your skills.'
    : 'Post your first job, compare bids, and hire with confidence.';

  await createTransport(config).sendMail({
    from: config.from,
    to,
    subject: `Welcome to FixMyHome, ${safeName}!`,
    text: [
      `Hi ${safeName},`,
      '',
      `Welcome to FixMyHome. Your ${roleLabel} account is ready.`,
      roleWelcomeLine,
      safeLoginUrl ? `Log in here: ${safeLoginUrl}` : 'Log in to start using your account.',
      '',
      `Need help? Contact ${supportEmail}.`,
    ].join('\n'),
    html: `
      <p>Hi ${escapeHtml(safeName)},</p>
      <p>Welcome to FixMyHome. Your ${escapeHtml(roleLabel)} account is ready.</p>
      <p>${escapeHtml(roleWelcomeLine)}</p>
      ${safeLoginUrl ? `<p><a href="${escapeHtml(safeLoginUrl)}">Log in to your account</a></p>` : ''}
      <p>Need help? Contact <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>.</p>
    `,
  });

  return {
    delivered: true,
    mode: 'smtp',
  };
}

async function sendHandymanBidInviteEmail({ to, homeownerName, jobTitle, jobLocation, budget, inviteUrl }) {
  const config = getMailerConfig();
  const supportEmail = getSupportEmail();
  if (!config.enabled) {
    return {
      delivered: false,
      mode: 'log',
      reason: 'SMTP is not configured.',
    };
  }

  const safeHomeownerName = String(homeownerName || '').trim() || 'A homeowner';
  const safeJobTitle = String(jobTitle || '').trim() || 'a new job';
  const safeJobLocation = String(jobLocation || '').trim();
  const safeInviteUrl = String(inviteUrl || '').trim();
  const numericBudget = Number.parseInt(String(budget || ''), 10);
  const budgetLabel = Number.isFinite(numericBudget) && numericBudget > 0
    ? `$${numericBudget.toLocaleString('en-US')}`
    : null;

  await createTransport(config).sendMail({
    from: config.from,
    to,
    subject: `${safeHomeownerName} invited you to bid on a FixMyHome job`,
    text: [
      `${safeHomeownerName} invited you to bid on this job: ${safeJobTitle}`,
      safeJobLocation ? `Location: ${safeJobLocation}` : null,
      budgetLabel ? `Budget: ${budgetLabel}` : null,
      '',
      safeInviteUrl ? `View the job and place your bid: ${safeInviteUrl}` : 'Sign in to FixMyHome to view and bid on this job.',
      '',
      `Need help? Contact ${supportEmail}.`,
    ].filter(Boolean).join('\n'),
    html: `
      <p>${escapeHtml(safeHomeownerName)} invited you to bid on a FixMyHome job.</p>
      <p><strong>${escapeHtml(safeJobTitle)}</strong></p>
      ${safeJobLocation ? `<p><strong>Location:</strong> ${escapeHtml(safeJobLocation)}</p>` : ''}
      ${budgetLabel ? `<p><strong>Budget:</strong> ${escapeHtml(budgetLabel)}</p>` : ''}
      ${safeInviteUrl ? `<p><a href="${escapeHtml(safeInviteUrl)}">View the job and place your bid</a></p>` : '<p>Sign in to FixMyHome to view and bid on this job.</p>'}
      <p>Need help? Contact <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>.</p>
    `,
  });

  return {
    delivered: true,
    mode: 'smtp',
  };
}

module.exports = {
  getMailerConfig,
  getSupportEmail,
  sendContactMessageEmail,
  sendHandymanBidInviteEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
};
