const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.NOTIFICATION_PORT || '3111';
const baseUrl = `http://127.0.0.1:${port}`;

class CookieJar {
  constructor() { this.cookies = new Map(); }
  apply(headers = {}) {
    const cookieHeader = Array.from(this.cookies.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
    return cookieHeader ? { ...headers, cookie: cookieHeader } : headers;
  }
  store(response) {
    const setCookie = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const entry of setCookie) {
      const [pair] = entry.split(';');
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;
      this.cookies.set(pair.slice(0, eqIndex).trim(), pair.slice(eqIndex + 1).trim());
    }
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function logStep(message) { process.stdout.write(`\n[notifications] ${message}\n`); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch (_error) {
      await sleep(300);
      continue;
    }
    await sleep(300);
  }
  throw new Error('Server did not become ready in time.');
}

async function request(urlPath, { method = 'GET', jar, form, redirect = 'manual' } = {}) {
  const headers = jar ? jar.apply({}) : {};
  let body;
  if (form) {
    body = new URLSearchParams(form);
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  const response = await fetch(`${baseUrl}${urlPath}`, { method, headers, body, redirect });
  if (jar) jar.store(response);
  return response;
}

async function login(email, password) {
  const jar = new CookieJar();
  const page = await request('/login', { jar });
  if (page.status !== 200) throw new Error(`Expected login page 200, received ${page.status}`);
  const response = await request('/login', { method: 'POST', jar, form: { email, password } });
  if (response.status !== 302) throw new Error(`Expected login redirect for ${email}, received ${response.status}`);
  return jar;
}

async function main() {
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    logStep(`Starting app on port ${port}`);
    await waitForServer();

    const homeownerJar = await login('homeowner@example.com', 'password123');
    const handymanJar = await login('alex@example.com', 'password123');
    const adminJar = await login('admin@example.com', 'password123');
    const homeowner = await prisma.user.findUnique({ where: { email: 'homeowner@example.com' } });
    const handyman = await prisma.user.findUnique({ where: { email: 'alex@example.com' } });
    const admin = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });

    const suffix = Date.now();
    const title = `Notification flow ${suffix}`;

    logStep('Creating a job and triggering a new-bid notification');
    await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title,
        category: 'Repairs',
        description: 'Notification regression job.',
        location: 'Columbus, OH 43215',
        budget: '250',
        preferredDate: 'Friday',
      },
    });
    const job = await prisma.job.findFirst({ where: { title } });
    await request(`/jobs/${job.id}/bids`, {
      method: 'POST',
      jar: handymanJar,
      form: { amount: '190', etaDays: '2', message: 'Bid that should trigger notifications.' },
    });

    let homeownerNotif = await prisma.userNotification.findFirst({ where: { userId: homeowner.id, type: 'NEW_BID' }, orderBy: { createdAt: 'desc' } });
    assert(homeownerNotif && homeownerNotif.body.includes(title), 'Expected homeowner NEW_BID notification.');

    const bid = await prisma.bid.findUnique({ where: { jobId_handymanId: { jobId: job.id, handymanId: handyman.id } } });

    logStep('Accepting the bid and funding escrow should notify the handyman');
    await request(`/bids/${bid.id}/accept`, { method: 'POST', jar: homeownerJar });
    await request(`/jobs/${job.id}/payment/fund`, { method: 'POST', jar: homeownerJar });

    const awardNotif = await prisma.userNotification.findFirst({ where: { userId: handyman.id, type: 'BID_AWARDED' }, orderBy: { createdAt: 'desc' } });
    const escrowNotif = await prisma.userNotification.findFirst({ where: { userId: handyman.id, type: 'ESCROW_FUNDED' }, orderBy: { createdAt: 'desc' } });
    assert(awardNotif && awardNotif.body.includes(title), 'Expected handyman BID_AWARDED notification.');
    assert(escrowNotif && escrowNotif.body.includes(title), 'Expected handyman ESCROW_FUNDED notification.');

    logStep('Sending a message and opening a dispute should notify the other user and admin');
    await request(`/bids/${bid.id}/messages`, {
      method: 'POST',
      jar: handymanJar,
      form: { body: 'Checking in before I head over.' },
    });
    await request(`/jobs/${job.id}/disputes`, {
      method: 'POST',
      jar: handymanJar,
      form: { reason: 'Scope mismatch', details: 'Homeowner added extra wall patching after award.' },
    });

    const messageNotif = await prisma.userNotification.findFirst({ where: { userId: homeowner.id, type: 'NEW_MESSAGE' }, orderBy: { createdAt: 'desc' } });
    const adminDisputeNotif = await prisma.userNotification.findFirst({ where: { userId: admin.id, type: 'DISPUTE_OPENED' }, orderBy: { createdAt: 'desc' } });
    assert(messageNotif && messageNotif.body.includes('sent you a message'), 'Expected homeowner NEW_MESSAGE notification.');
    assert(adminDisputeNotif && adminDisputeNotif.body.includes(title), 'Expected admin DISPUTE_OPENED notification.');

    logStep('Marking all notifications read should update read state');
    const beforeUnread = await prisma.userNotification.count({ where: { userId: homeowner.id, isRead: false } });
    assert(beforeUnread > 0, 'Expected homeowner to have unread notifications before mark-all-read.');
    const markRead = await request('/notifications/read-all', { method: 'POST', jar: homeownerJar });
    assert(markRead.status === 302, `Expected mark-all redirect, received ${markRead.status}`);
    const afterUnread = await prisma.userNotification.count({ where: { userId: homeowner.id, isRead: false } });
    assert(afterUnread === 0, 'Expected homeowner unread notifications to be cleared.');

    const dashboardResponse = await request('/dashboard', { jar: homeownerJar, redirect: 'follow' });
    const dashboardHtml = await dashboardResponse.text();
    assert(dashboardHtml.includes('Recent alerts'), 'Expected notification center to render on dashboard.');

    const adminResponse = await request('/admin', { jar: adminJar, redirect: 'follow' });
    const adminHtml = await adminResponse.text();
    assert(adminHtml.includes('Recent alerts'), 'Expected notification center to render on admin page.');

    logStep('Notification test passed');
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();
    if (stderr.trim()) {
      process.stderr.write(`\n[notifications] server stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[notifications] FAILED: ${error.message}\n`);
  process.exit(1);
});
