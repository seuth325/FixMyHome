const nodemailer = require('nodemailer');

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
    auth: config.user ? {
      user: config.user,
      pass: config.pass,
    } : undefined,
  });
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const config = getMailerConfig();
  const supportEmail = String(process.env.SUPPORT_EMAIL || 'support@fixmyhome.pro').trim() || 'support@fixmyhome.pro';
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
      <p><a href="${resetUrl}">Open this link to choose a new password</a></p>
      <p>This link expires in 1 hour. If you did not request this reset, you can ignore this email.</p>
      <p>Need help? Contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
    `,
  });

  return {
    delivered: true,
    mode: 'smtp',
  };
}

module.exports = {
  getMailerConfig,
  sendPasswordResetEmail,
};
