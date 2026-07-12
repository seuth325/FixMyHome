// Generates the HTML body for the FixMyHome weekly digest email.
// Uses table-based layout with inline CSS for maximum email-client compatibility.

export interface DigestEmailData {
  recipientName: string;
  recipientEmail: string;
  role: 'HOMEOWNER' | 'HANDYMAN';
  location: string;        // city name
  notifications: Array<{ title: string; body: string; type: string }>;
  // Homeowner specific
  activeJobs?: number;
  pendingBids?: number;
  inProgress?: number;
  // Handyman specific
  activeBids?: number;
  jobsWon?: number;
  matchingJobs?: Array<{ title: string; category: string; budget: number; location: string }>;
}

const ACCENT   = '#2563eb';   // blue-600
const SUCCESS  = '#16a34a';   // green-600
const BG_MAIN  = '#f3f4f6';   // gray-100
const BG_CARD  = '#ffffff';
const BG_BAND  = '#eff6ff';   // blue-50
const TEXT      = '#111827';  // gray-900
const MUTED     = '#6b7280';  // gray-500
const BORDER    = '#e5e7eb';  // gray-200

const TOP_PROJECTS = [
  { name: 'General Handyman',          price: '$100 – $400' },
  { name: 'Plumbing',                  price: '$150 – $400' },
  { name: 'HVAC & Air Conditioning',   price: '$300 – $800' },
  { name: 'Electrical',                price: '$200 – $500' },
  { name: 'Painting',                  price: '$500 – $2,000' },
  { name: 'Landscaping & Irrigation',  price: '$200 – $800' },
  { name: 'Pressure Washing',          price: '$150 – $500' },
  { name: 'Flooring',                  price: '$500 – $3,000' },
  { name: 'Screen Enclosures',         price: '$400 – $2,000' },
  { name: 'Pool Maintenance & Repair', price: '$200 – $1,000' },
];

const ALL_PRICING = [
  ['Plumbing',                    '$150 – $400'],
  ['Electrical',                  '$200 – $500'],
  ['HVAC & Air Conditioning',     '$300 – $800'],
  ['Painting',                    '$500 – $2,000'],
  ['Carpentry',                   '$200 – $600'],
  ['Fence Repair',                '$300 – $1,200'],
  ['Landscaping & Irrigation',    '$200 – $800'],
  ['General Handyman',            '$100 – $400'],
  ['Appliance Repair',            '$150 – $400'],
  ['Flooring',                    '$500 – $3,000'],
  ['Roofing',                     '$500 – $3,000'],
  ['Drywall',                     '$200 – $800'],
  ['Stucco Cracks and Repairs',   '$300 – $1,500'],
  ['Pool Maintenance & Repair',   '$200 – $1,000'],
  ['Screen Enclosures',           '$400 – $2,000'],
  ['Pressure Washing',            '$150 – $500'],
  ['Hurricane Shutters & Storm Prep', '$500 – $3,000'],
  ['Termite Infestations',        '$500 – $2,000'],
];

function stat(value: string | number, label: string, color: string): string {
  return `
    <td width="33%" style="text-align:center;padding:12px 8px;background:${color};border-radius:8px;">
      <div style="font-size:22px;font-weight:700;color:${TEXT};">${value}</div>
      <div style="font-size:11px;color:${MUTED};margin-top:2px;">${label}</div>
    </td>`;
}

function notifRow(n: { title: string; body: string; type: string }): string {
  const icons: Record<string, string> = {
    NEW_BID: '💰', BID_ACCEPTED: '🏆', BID_DECLINED: '✗',
    JOB_COMPLETED: '✅', NEW_MESSAGE: '💬', JOB_STATUS: '📋',
  };
  const icon = icons[n.type] ?? '🔔';
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${BORDER};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="36" valign="top" style="padding-right:10px;">
              <div style="width:34px;height:34px;border-radius:50%;background:#dbeafe;
                          text-align:center;line-height:34px;font-size:16px;">${icon}</div>
            </td>
            <td valign="top">
              <div style="font-size:13px;font-weight:600;color:${TEXT};">${n.title}</div>
              <div style="font-size:12px;color:${MUTED};margin-top:2px;">${n.body}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function projectTile(name: string, price: string): string {
  return `
    <td width="50%" style="padding:4px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
             style="border:1px solid ${BORDER};border-radius:8px;background:#fff;">
        <tr>
          <td style="padding:10px 12px;">
            <div style="font-size:12px;font-weight:600;color:${TEXT};">${name}</div>
            <div style="font-size:11px;color:${SUCCESS};margin-top:2px;">${price}</div>
          </td>
        </tr>
      </table>
    </td>`;
}

function pricingRow(name: string, price: string, alt: boolean): string {
  return `
    <tr style="background:${alt ? '#f9fafb' : '#fff'};">
      <td style="padding:8px 12px;font-size:12px;color:${TEXT};border-bottom:1px solid ${BORDER};">${name}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:600;color:${SUCCESS};
                 text-align:right;border-bottom:1px solid ${BORDER};">${price}</td>
    </tr>`;
}

function matchingJobRow(j: { title: string; category: string; budget: number; location: string }): string {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${BORDER};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="top">
              <div style="font-size:13px;font-weight:600;color:${TEXT};">${j.title}</div>
              <div style="font-size:11px;color:${MUTED};margin-top:2px;">${j.category} · ${j.location}</div>
            </td>
            <td width="80" valign="top" style="text-align:right;">
              <span style="font-size:12px;font-weight:600;color:${SUCCESS};">$${j.budget.toLocaleString()}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

export function buildDigestEmail(data: DigestEmailData): string {
  const firstName = data.recipientName.split(' ')[0];
  const isHomeowner = data.role === 'HOMEOWNER';

  const greeting = isHomeowner
    ? "Here's your weekly digest — popular home projects and local pricing in your area."
    : "Here's a summary of available jobs and opportunities near you this week.";

  // Activity stats section
  const activitySection = isHomeowner ? `
    <table width="100%" cellpadding="0" cellspacing="6" border="0" style="margin:16px 0;">
      <tr>
        ${stat(data.activeJobs ?? 0, 'Active Jobs',    '#eff6ff')}
        <td width="2%"></td>
        ${stat(data.pendingBids ?? 0, 'New Bids',     '#f0fdf4')}
        <td width="2%"></td>
        ${stat(data.inProgress ?? 0, 'In Progress',   '#fffbeb')}
      </tr>
    </table>` : `
    <table width="100%" cellpadding="0" cellspacing="6" border="0" style="margin:16px 0;">
      <tr>
        ${stat(data.activeBids ?? 0, 'Active Bids', '#eff6ff')}
        <td width="2%"></td>
        ${stat(data.jobsWon ?? 0,    'Jobs Won',    '#f0fdf4')}
        <td width="2%"></td>
        ${stat(data.matchingJobs?.length ?? 0, 'Jobs Available', '#fffbeb')}
      </tr>
    </table>`;

  // Notifications
  const notifsHtml = data.notifications.length === 0
    ? `<tr><td style="padding:12px 0;text-align:center;color:${MUTED};font-size:13px;">No recent notifications.</td></tr>`
    : data.notifications.map(notifRow).join('');

  // Handyman matching jobs
  const matchingJobsSection = !isHomeowner && (data.matchingJobs?.length ?? 0) > 0 ? `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
      ${data.matchingJobs!.map(matchingJobRow).join('')}
    </table>` : '';

  // Top 10 tiles (2 per row)
  const tileRows: string[] = [];
  for (let i = 0; i < TOP_PROJECTS.length; i += 2) {
    const a = TOP_PROJECTS[i];
    const b = TOP_PROJECTS[i + 1];
    tileRows.push(`
      <tr>
        ${projectTile(a.name, a.price)}
        ${b ? projectTile(b.name, b.price) : '<td width="50%"></td>'}
      </tr>`);
  }

  // Pricing rows
  const pricingRows = ALL_PRICING.map(([name, price], i) => pricingRow(name, price, i % 2 === 1)).join('');

  const ctaLabel = isHomeowner ? 'Post a Job' : 'Browse Available Jobs';
  const ctaLink  = isHomeowner ? 'http://localhost:3000/jobs/new' : 'http://localhost:3000/browse';
  const ctaLabel2 = isHomeowner ? 'View My Jobs' : 'View My Bids';
  const ctaLink2  = isHomeowner ? 'http://localhost:3000/jobs' : 'http://localhost:3000/bids';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FixMyHome Weekly Digest</title>
</head>
<body style="margin:0;padding:0;background:${BG_MAIN};font-family:Arial,Helvetica,sans-serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG_MAIN}">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Email card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;background:${BG_CARD};border-radius:12px;overflow:hidden;
                      box-shadow:0 2px 8px rgba(0,0,0,.08);">

          <!-- Header banner -->
          <tr>
            <td style="background:linear-gradient(135deg,#2563eb,#16a34a);
                       padding:36px 40px;text-align:center;">
              <div style="font-size:28px;font-weight:700;color:#fff;letter-spacing:-0.5px;">
                FixMyHome
              </div>
              <div style="font-size:13px;color:#bfdbfe;margin-top:4px;">
                Your local home repair marketplace
              </div>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 40px 20px;border-bottom:1px solid ${BORDER};">
              <div style="font-size:18px;font-weight:600;color:${TEXT};">Hi ${firstName},</div>
              <div style="font-size:13px;color:${MUTED};margin-top:6px;line-height:1.5;">
                ${greeting}
              </div>
            </td>
          </tr>

          <!-- Alerts & Notifications -->
          <tr>
            <td style="padding:24px 40px;border-bottom:1px solid ${BORDER};">
              <div style="font-size:15px;font-weight:700;color:${TEXT};margin-bottom:12px;">
                🔔 Alerts &amp; Notifications
              </div>
              ${activitySection}
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${notifsHtml}
              </table>
              ${matchingJobsSection}
            </td>
          </tr>

          <!-- Search CTA -->
          <tr>
            <td style="padding:20px 40px;background:#f9fafb;border-bottom:1px solid ${BORDER};
                       text-align:center;">
              <div style="font-size:12px;font-weight:600;color:${MUTED};margin-bottom:10px;
                          text-transform:uppercase;letter-spacing:.05em;">
                What can we help you with?
              </div>
              <a href="${ctaLink}"
                 style="display:inline-block;border:1px solid ${BORDER};border-radius:999px;
                        padding:10px 24px;background:#fff;color:${MUTED};font-size:13px;
                        text-decoration:none;">
                ${isHomeowner ? '🔍 Post a new home repair job...' : '🔍 Browse jobs in your area...'}
              </a>
            </td>
          </tr>

          <!-- Top 10 Projects -->
          <tr>
            <td style="padding:24px 40px;border-bottom:1px solid ${BORDER};">
              <div style="font-size:15px;font-weight:700;color:${TEXT};margin-bottom:4px;">
                Top Ten Projects in ${data.location}
              </div>
              <div style="font-size:12px;color:${MUTED};margin-bottom:14px;">
                Most requested home services in your area
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${tileRows.join('')}
              </table>
            </td>
          </tr>

          <!-- Project Costs -->
          <tr>
            <td style="padding:24px 40px;background:${BG_BAND};border-bottom:1px solid ${BORDER};">
              <div style="font-size:15px;font-weight:700;color:${TEXT};margin-bottom:4px;">
                💲 Project Costs in ${data.location}
              </div>
              <div style="font-size:12px;color:${MUTED};margin-bottom:14px;">
                Average price ranges — actual costs vary by scope
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="border:1px solid ${BORDER};border-radius:8px;overflow:hidden;background:#fff;">
                ${pricingRows}
              </table>
            </td>
          </tr>

          <!-- Star rating callout -->
          <tr>
            <td style="padding:20px 40px;background:#fffbeb;border-bottom:1px solid ${BORDER};">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="60" valign="top" style="font-size:22px;padding-top:2px;">⭐⭐⭐⭐⭐</td>
                  <td valign="top" style="padding-left:12px;">
                    <div style="font-size:13px;font-weight:600;color:${TEXT};">
                      All handymen are community-rated
                    </div>
                    <div style="font-size:12px;color:${MUTED};margin-top:4px;line-height:1.5;">
                      ${isHomeowner
                        ? 'Read reviews from real neighbors before you hire. Leave a review after your job is complete.'
                        : 'Your rating is your reputation. Deliver great work and earn 5-star reviews from homeowners.'}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Buttons -->
          <tr>
            <td style="padding:28px 40px;text-align:center;">
              <a href="${ctaLink}"
                 style="display:inline-block;background:${ACCENT};color:#fff;
                        padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;
                        text-decoration:none;margin:0 6px 8px;">
                ${ctaLabel}
              </a>
              <a href="${ctaLink2}"
                 style="display:inline-block;background:#fff;color:${ACCENT};
                        padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;
                        text-decoration:none;border:1px solid ${ACCENT};margin:0 6px 8px;">
                ${ctaLabel2}
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;background:#f9fafb;border-top:1px solid ${BORDER};
                       text-align:center;">
              <div style="font-size:11px;color:${MUTED};">
                © 2026 FixMyHome · Currently serving Florida
              </div>
              <div style="font-size:11px;color:${MUTED};margin-top:4px;">
                This digest is sent weekly to ${data.recipientEmail}
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
