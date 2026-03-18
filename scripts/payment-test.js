const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.PAYMENTS_PORT || '3105';
const baseUrl = `http://127.0.0.1:${port}`;

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  apply(headers = {}) {
    const cookieHeader = Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

    return cookieHeader ? { ...headers, cookie: cookieHeader } : headers;
  }

  store(response) {
    const setCookie = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];

    for (const entry of setCookie) {
      const [pair] = entry.split(';');
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;
      this.cookies.set(pair.slice(0, eqIndex).trim(), pair.slice(eqIndex + 1).trim());
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logStep(message) {
  process.stdout.write(`\n[payments] ${message}\n`);
}

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

async function request(path, { method = 'GET', jar, form, redirect = 'manual' } = {}) {
  const headers = jar ? jar.apply({}) : {};
  let body;
  if (form) {
    body = new URLSearchParams(form);
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body, redirect });
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

    const suffix = Date.now();
    const title = `Payment guard job ${suffix}`;

    logStep('Creating and awarding a job');
    await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title,
        category: 'Repairs',
        description: 'Testing payment guard rails.',
        location: 'Columbus, OH 43215',
        budget: '180',
        preferredDate: 'Any evening',
      },
    });

    const job = await prisma.job.findFirst({ where: { title }, orderBy: { createdAt: 'desc' } });
    assert(job, 'Expected payment test job to exist.');

    await request(`/jobs/${job.id}/bids`, {
      method: 'POST',
      jar: handymanJar,
      form: {
        amount: '170',
        etaDays: '2',
        message: 'Ready to handle this payment test job.',
      },
    });

    const handyman = await prisma.user.findUnique({ where: { email: 'alex@example.com' } });
    const bid = await prisma.bid.findUnique({
      where: {
        jobId_handymanId: {
          jobId: job.id,
          handymanId: handyman.id,
        },
      },
    });
    assert(bid, 'Expected payment test bid to exist.');

    await request(`/bids/${bid.id}/accept`, { method: 'POST', jar: homeownerJar });

    let awardedJob = await prisma.job.findUnique({ where: { id: job.id }, include: { payment: true } });
    assert(awardedJob.payment && awardedJob.payment.status === 'PENDING_FUNDING', 'Expected awarded job to have pending escrow.');

    logStep('Verifying completion is blocked before funding');
    await request(`/jobs/${job.id}/status`, {
      method: 'POST',
      jar: homeownerJar,
      form: { action: 'complete' },
    });
    awardedJob = await prisma.job.findUnique({ where: { id: job.id }, include: { payment: true } });
    assert(awardedJob.status === 'AWARDED', 'Expected job to remain awarded before escrow funding.');

    logStep('Funding escrow and completing the job');
    await request(`/jobs/${job.id}/payment/fund`, { method: 'POST', jar: homeownerJar });
    await request(`/jobs/${job.id}/status`, {
      method: 'POST',
      jar: homeownerJar,
      form: { action: 'complete' },
    });

    let completedJob = await prisma.job.findUnique({ where: { id: job.id }, include: { payment: true, review: true } });
    assert(completedJob.status === 'COMPLETED', 'Expected funded job to complete successfully.');
    assert(completedJob.payment.status === 'FUNDED', 'Expected payment to stay funded until release.');

    logStep('Verifying review is blocked until payment release');
    await request(`/jobs/${job.id}/reviews`, {
      method: 'POST',
      jar: homeownerJar,
      form: { stars: '5', text: 'Should not save before release.' },
    });
    completedJob = await prisma.job.findUnique({ where: { id: job.id }, include: { payment: true, review: true } });
    assert(!completedJob.review, 'Expected review to be blocked until payment release.');

    logStep('Releasing payment');
    await request(`/jobs/${job.id}/payment/release`, { method: 'POST', jar: homeownerJar });
    completedJob = await prisma.job.findUnique({ where: { id: job.id }, include: { payment: true } });
    assert(completedJob.payment.status === 'RELEASED', 'Expected payment to move to released.');

    logStep('Payment test passed');
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();
    if (stderr.trim()) {
      process.stderr.write(`\n[payments] server stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[payments] FAILED: ${error.message}\n`);
  process.exit(1);
});
