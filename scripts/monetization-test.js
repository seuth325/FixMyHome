const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.MONETIZATION_PORT || '3110';
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
function logStep(message) { process.stdout.write(`\n[monetization] ${message}\n`); }
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
    const alex = await prisma.user.findUnique({ where: { email: 'alex@example.com' }, include: { handymanProfile: true } });

    await prisma.handymanProfile.update({
      where: { userId: alex.id },
      data: {
        subscriptionPlan: 'FREE',
        leadCredits: 1,
        subscriptionRenewsAt: null,
      },
    });

    const suffix = Date.now();
    const jobOneTitle = `Credit bid one ${suffix}`;
    const jobTwoTitle = `Credit bid two ${suffix}`;
    const jobThreeTitle = `Pro bid ${suffix}`;

    logStep('Creating three jobs for credit and plan coverage');
    for (const [title, category] of [[jobOneTitle, 'Repairs'], [jobTwoTitle, 'Painting'], [jobThreeTitle, 'Installations']]) {
      await request('/jobs', {
        method: 'POST',
        jar: homeownerJar,
        form: {
          title,
          category,
          description: `Automated monetization coverage for ${title}`,
          location: 'Columbus, OH 43215',
          budget: '240',
          preferredDate: 'Weeknight',
        },
      });
    }

    const jobOne = await prisma.job.findFirst({ where: { title: jobOneTitle } });
    const jobTwo = await prisma.job.findFirst({ where: { title: jobTwoTitle } });
    const jobThree = await prisma.job.findFirst({ where: { title: jobThreeTitle } });

    logStep('Submitting the first bid should spend the last free credit');
    const firstBid = await request(`/jobs/${jobOne.id}/bids`, {
      method: 'POST',
      jar: handymanJar,
      form: { amount: '180', etaDays: '2', message: 'First credit-backed bid.' },
    });
    assert(firstBid.status === 302, `Expected first bid redirect, received ${firstBid.status}`);

    let refreshedProfile = await prisma.handymanProfile.findUnique({ where: { userId: alex.id } });
    assert(refreshedProfile.leadCredits === 0, `Expected credits to reach 0, received ${refreshedProfile.leadCredits}`);
    const debitTx = await prisma.leadCreditTransaction.findFirst({ where: { handymanProfileId: refreshedProfile.id, type: 'BID_UNLOCK' }, orderBy: { createdAt: 'desc' } });
    assert(debitTx && debitTx.amount === -1, 'Expected a bid unlock transaction for the first bid.');

    logStep('Submitting another new bid with zero credits should be blocked');
    const blockedBid = await request(`/jobs/${jobTwo.id}/bids`, {
      method: 'POST',
      jar: handymanJar,
      form: { amount: '195', etaDays: '3', message: 'Blocked until more credits are added.' },
    });
    assert(blockedBid.status === 302, `Expected blocked bid redirect, received ${blockedBid.status}`);
    const absentBid = await prisma.bid.findUnique({ where: { jobId_handymanId: { jobId: jobTwo.id, handymanId: alex.id } } });
    assert(!absentBid, 'Expected second bid to be blocked when credits are exhausted.');

    logStep('Buying credits should restore bidding access');
    const packPurchase = await request('/billing/credits', {
      method: 'POST',
      jar: handymanJar,
      form: { pack: 'STARTER' },
    });
    assert(packPurchase.status === 302, `Expected credit purchase redirect, received ${packPurchase.status}`);
    refreshedProfile = await prisma.handymanProfile.findUnique({ where: { userId: alex.id } });
    assert(refreshedProfile.leadCredits === 5, `Expected starter pack to add 5 credits, received ${refreshedProfile.leadCredits}`);

    const secondBid = await request(`/jobs/${jobTwo.id}/bids`, {
      method: 'POST',
      jar: handymanJar,
      form: { amount: '190', etaDays: '2', message: 'Credits restored, bidding again.' },
    });
    assert(secondBid.status === 302, `Expected second bid redirect, received ${secondBid.status}`);
    refreshedProfile = await prisma.handymanProfile.findUnique({ where: { userId: alex.id } });
    assert(refreshedProfile.leadCredits === 4, `Expected one purchased credit to be consumed, received ${refreshedProfile.leadCredits}`);

    logStep('Upgrading to Pro should allow unlimited bidding without spending credits');
    const proUpgrade = await request('/billing/plan', {
      method: 'POST',
      jar: handymanJar,
      form: { plan: 'PRO' },
    });
    assert(proUpgrade.status === 302, `Expected Pro upgrade redirect, received ${proUpgrade.status}`);
    refreshedProfile = await prisma.handymanProfile.findUnique({ where: { userId: alex.id } });
    assert(refreshedProfile.subscriptionPlan === 'PRO', 'Expected Alex to be on the Pro plan.');

    const proBid = await request(`/jobs/${jobThree.id}/bids`, {
      method: 'POST',
      jar: handymanJar,
      form: { amount: '205', etaDays: '1', message: 'Unlimited bidding on Pro.' },
    });
    assert(proBid.status === 302, `Expected Pro bid redirect, received ${proBid.status}`);
    const finalProfile = await prisma.handymanProfile.findUnique({ where: { userId: alex.id } });
    assert(finalProfile.leadCredits === 4, `Expected Pro bid not to consume credits, received ${finalProfile.leadCredits}`);

    const dashboardResponse = await request('/dashboard', { jar: handymanJar, redirect: 'follow' });
    const dashboardHtml = await dashboardResponse.text();
    assert(dashboardHtml.includes('Choose a plan that fits your pipeline'), 'Expected billing panel to render on the handyman dashboard.');
    assert(dashboardHtml.includes('Unlimited active'), 'Expected Pro billing status to appear on the dashboard.');

    logStep('Monetization test passed');
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();
    if (stderr.trim()) {
      process.stderr.write(`\n[monetization] server stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[monetization] FAILED: ${error.message}\n`);
  process.exit(1);
});
