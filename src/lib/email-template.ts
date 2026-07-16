// Table-based FixMyHome email templates for broad email-client compatibility.

export interface DigestEmailData {
  recipientName: string;
  recipientEmail: string;
  role: 'HOMEOWNER' | 'HANDYMAN';
  location: string;
  notifications: Array<{ title: string; body: string; type: string }>;
  activeJobs?: number;
  pendingBids?: number;
  inProgress?: number;
  activeBids?: number;
  jobsWon?: number;
  matchingJobs?: Array<{ title: string; category: string; budget: number; location: string }>;
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL || 'https://fixmyhome.pro').replace(/\/$/, '');
const ACCENT = '#2563eb';
const ACCENT_DARK = '#1d4ed8';
const SUCCESS = '#16a34a';
const BG_MAIN = '#f3f4f6';
const BG_CARD = '#ffffff';
const BG_SOFT = '#eff6ff';
const TEXT = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

const TOP_PROJECTS = [
  'Bathroom Remodel',
  'Roofing',
  'Tree Service',
  'Plumbing',
  'Painting',
  'Fencing',
  'Electrical',
  'Handyman',
  'Concrete & Brick',
  'Landscaping',
];

const PROJECT_COSTS = [
  ['Handyman', 'from $150*'],
  ['Driveways', 'from $4,900*'],
  ['Decks & Porches', 'from $2,500*'],
  ['Roofing', 'from $9,500*'],
  ['Tree Service', 'from $750*'],
  ['Bathroom Remodel', 'from $12,000*'],
  ['Painting', 'from $2,000*'],
  ['Plumbing', 'from $337*'],
  ['Electrical', 'from $348*'],
  ['Kitchen Remodel', 'from $26,000*'],
  ['Windows', 'from $11,800*'],
  ['Landscaping', 'from $3,600*'],
];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(label: string, href: string, variant: 'primary' | 'secondary' = 'primary') {
  const styles = variant === 'primary'
    ? `background:${ACCENT};color:#ffffff;border:1px solid ${ACCENT};`
    : `background:#ffffff;color:${ACCENT_DARK};border:1px solid ${BORDER};`;

  return `<a href="${href}" style="${styles}display:inline-block;border-radius:6px;padding:12px 22px;font-size:14px;font-weight:700;text-decoration:none;">${label}</a>`;
}

function topProjectsHtml() {
  return TOP_PROJECTS.map((project) => `
    <td style="padding:4px 6px 8px 0;font-size:13px;color:${TEXT};white-space:nowrap;">
      ${escapeHtml(project)}
    </td>`).reduce((rows, cell, index) => {
      const rowIndex = Math.floor(index / 5);
      rows[rowIndex] = `${rows[rowIndex] || ''}${cell}`;
      return rows;
    }, [] as string[]).map((row) => `<tr>${row}</tr>`).join('');
}

function costCardsHtml() {
  const rows: string[] = [];
  for (let i = 0; i < PROJECT_COSTS.length; i += 2) {
    const left = PROJECT_COSTS[i];
    const right = PROJECT_COSTS[i + 1];
    rows.push(`
      <tr>
        ${costCard(left[0], left[1])}
        <td width="16"></td>
        ${right ? costCard(right[0], right[1]) : '<td width="50%"></td>'}
      </tr>`);
  }
  return rows.join('');
}

function costCard(name: string, price: string) {
  return `
    <td width="50%" valign="top" style="padding-bottom:16px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-radius:8px;background:#ffffff;">
        <tr>
          <td style="padding:14px 16px;">
            <div style="font-size:16px;font-weight:700;color:${TEXT};line-height:1.25;">${escapeHtml(name)}</div>
            <div style="font-size:13px;color:${SUCCESS};font-weight:700;margin-top:4px;">${escapeHtml(price)}</div>
            <div style="margin-top:12px;">${button('Find pros', `${APP_URL}/browse`, 'secondary')}</div>
          </td>
        </tr>
      </table>
    </td>`;
}

function notificationRows(items: DigestEmailData['notifications']) {
  if (items.length === 0) {
    return `<tr><td style="padding:12px 0;text-align:center;color:${MUTED};font-size:13px;">No recent notifications.</td></tr>`;
  }

  return items.map((item) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${BORDER};">
        <div style="font-size:13px;font-weight:700;color:${TEXT};">${escapeHtml(item.title)}</div>
        <div style="font-size:12px;color:${MUTED};margin-top:2px;line-height:1.45;">${escapeHtml(item.body)}</div>
      </td>
    </tr>`).join('');
}

function emailShell(title: string, preview: string, body: string, recipientEmail?: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BG_MAIN};font-family:Arial,Helvetica,sans-serif;color:${TEXT};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preview)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG_MAIN}">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:${BG_CARD};border-radius:8px;overflow:hidden;border:1px solid ${BORDER};">
          <tr>
            <td style="padding:22px 32px;border-bottom:1px solid ${BORDER};">
              <img src="${APP_URL}/fixmyhome-logo.png" width="96" height="96" alt="FixMyHome.pro" style="display:block;border:0;border-radius:4px;outline:none;text-decoration:none;" />
              <div style="font-size:13px;color:${MUTED};margin-top:3px;">Your local home repair marketplace</div>
            </td>
          </tr>
          ${body}
          <tr>
            <td style="padding:22px 32px;background:#f9fafb;border-top:1px solid ${BORDER};text-align:center;">
              <div style="font-size:11px;color:${MUTED};line-height:1.5;">
                Copyright 2026 FixMyHome. All rights reserved.<br />
                Currently serving Florida homeowners and local pros.${recipientEmail ? `<br />This email was sent to ${escapeHtml(recipientEmail)}.` : ''}
              </div>
              <div style="font-size:11px;color:${MUTED};line-height:1.5;margin-top:10px;">
                <a href="${APP_URL}" style="color:${ACCENT_DARK};text-decoration:none;">View in browser</a> |
                <a href="${APP_URL}/forgot-password" style="color:${ACCENT_DARK};text-decoration:none;">Account help</a> |
                <a href="${APP_URL}/sign-in" style="color:${ACCENT_DARK};text-decoration:none;">Sign in</a>
              </div>
              <div style="font-size:10px;color:${MUTED};line-height:1.5;margin-top:10px;">
                *Costs are planning estimates. Actual prices vary by scope, materials, timing, and local professional availability.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildDigestEmail(data: DigestEmailData): string {
  const firstName = escapeHtml(data.recipientName.split(' ')[0] || data.recipientName);
  const isHomeowner = data.role === 'HOMEOWNER';
  const location = escapeHtml(data.location || 'your area');
  const primaryCta = isHomeowner
    ? { label: 'Compare Quotes', href: `${APP_URL}/jobs/new` }
    : { label: 'Browse Jobs', href: `${APP_URL}/browse` };
  const secondaryCta = isHomeowner
    ? { label: 'View My Jobs', href: `${APP_URL}/jobs` }
    : { label: 'View My Bids', href: `${APP_URL}/bids` };
  const headline = isHomeowner
    ? `What Can You Expect to Pay for Home Projects in ${location}?`
    : `What Jobs Are Available Near ${location}?`;
  const range = isHomeowner
    ? 'On average, common home projects can range from a few hundred dollars to $20,000+ depending on scope.'
    : `There are ${data.matchingJobs?.length ?? 0} matching opportunities and recent homeowner activity near ${location}.`;

  const body = `
    <tr>
      <td style="padding:34px 32px 26px;text-align:center;">
        <div style="font-size:13px;color:${MUTED};margin-bottom:10px;">Hi ${firstName},</div>
        <h1 style="font-size:30px;line-height:1.15;margin:0;color:${TEXT};font-weight:800;">${headline}</h1>
        <p style="font-size:16px;line-height:1.5;color:${MUTED};margin:14px auto 22px;max-width:520px;">${range}</p>
        ${button(primaryCta.label, primaryCta.href)}
      </td>
    </tr>
    <tr>
      <td style="padding:24px 32px;border-top:1px solid ${BORDER};">
        <div style="font-size:18px;font-weight:800;color:${TEXT};margin-bottom:12px;">Top Ten Projects in ${location}</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">${topProjectsHtml()}</table>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 32px;background:#f9fafb;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-size:16px;font-weight:800;color:${TEXT};">What can we help you with?</td>
            <td align="right">${button(isHomeowner ? 'Find Pros' : 'Find Jobs', primaryCta.href, 'secondary')}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 32px;background:${BG_SOFT};">
        <div style="font-size:18px;font-weight:800;color:${TEXT};margin-bottom:4px;">Project Costs in ${location}</div>
        <div style="font-size:13px;color:${MUTED};margin-bottom:18px;">Use these planning ranges to compare quotes and decide what to post next.</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">${costCardsHtml()}</table>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 32px;border-top:1px solid ${BORDER};">
        <div style="font-size:18px;font-weight:800;color:${TEXT};margin-bottom:10px;">Account Activity</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="33%" style="padding:12px;text-align:center;background:#eff6ff;border-radius:8px;"><div style="font-size:24px;font-weight:800;">${isHomeowner ? data.activeJobs ?? 0 : data.activeBids ?? 0}</div><div style="font-size:12px;color:${MUTED};">${isHomeowner ? 'Active Jobs' : 'Active Bids'}</div></td>
            <td width="2%"></td>
            <td width="33%" style="padding:12px;text-align:center;background:#f0fdf4;border-radius:8px;"><div style="font-size:24px;font-weight:800;">${isHomeowner ? data.pendingBids ?? 0 : data.jobsWon ?? 0}</div><div style="font-size:12px;color:${MUTED};">${isHomeowner ? 'Pending Bids' : 'Jobs Won'}</div></td>
            <td width="2%"></td>
            <td width="33%" style="padding:12px;text-align:center;background:#fffbeb;border-radius:8px;"><div style="font-size:24px;font-weight:800;">${isHomeowner ? data.inProgress ?? 0 : data.matchingJobs?.length ?? 0}</div><div style="font-size:12px;color:${MUTED};">${isHomeowner ? 'In Progress' : 'Matching Jobs'}</div></td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">${notificationRows(data.notifications)}</table>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 32px;text-align:center;border-top:1px solid ${BORDER};">
        ${button(primaryCta.label, primaryCta.href)}
        <span style="display:inline-block;width:8px;"></span>
        ${button(secondaryCta.label, secondaryCta.href, 'secondary')}
      </td>
    </tr>`;

  return emailShell('FixMyHome Project Costs', `Project cost estimates and activity for ${location}.`, body, data.recipientEmail);
}

export function buildPasswordResetEmail(input: { name: string; resetUrl: string; recipientEmail: string }) {
  const firstName = escapeHtml(input.name.split(' ')[0] || input.name);
  const body = `
    <tr>
      <td style="padding:34px 32px 26px;text-align:center;">
        <div style="font-size:13px;color:${MUTED};margin-bottom:10px;">Hi ${firstName},</div>
        <h1 style="font-size:30px;line-height:1.15;margin:0;color:${TEXT};font-weight:800;">Reset Your FixMyHome Password</h1>
        <p style="font-size:16px;line-height:1.5;color:${MUTED};margin:14px auto 22px;max-width:520px;">Use this secure link to choose a new password. The link expires in 1 hour.</p>
        ${button('Choose a New Password', input.resetUrl)}
      </td>
    </tr>
    <tr>
      <td style="padding:22px 32px;background:#f9fafb;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">
        <div style="font-size:16px;font-weight:800;color:${TEXT};margin-bottom:8px;">Account Help</div>
        <div style="font-size:13px;color:${MUTED};line-height:1.55;">If the button does not work, copy and paste this link into your browser:<br /><a href="${input.resetUrl}" style="color:${ACCENT_DARK};word-break:break-all;">${input.resetUrl}</a></div>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 32px;">
        <div style="font-size:13px;color:${MUTED};line-height:1.55;">If you did not request a password reset, you can ignore this email. Your password will not change unless this link is used.</div>
      </td>
    </tr>`;

  return emailShell('Reset Your FixMyHome Password', 'Choose a new password for your FixMyHome account.', body, input.recipientEmail);
}