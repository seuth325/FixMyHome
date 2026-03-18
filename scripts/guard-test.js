const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.GUARD_PORT || '3102';
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
  process.stdout.write(`\n[guards] ${message}\n`);
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch (error) {
      await sleep(300);
      continue;
    }
    await sleep(300);
  }
  throw new Error('Server did not become ready in time.');
}

async function request(path, { method = 'GET', jar, form, headers, redirect = 'manual' } = {}) {
  const finalHeaders = jar ? jar.apply(headers) : { ...(headers || {}) };
  let body;

  if (form) {
    body = new URLSearchParams(form);
    finalHeaders['content-type'] = 'application/x-www-form-urlencoded';
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: finalHeaders,
    body,
    redirect,
  });

  if (jar) jar.store(response);
  return response;
}

async function login(email, password) {
  const jar = new CookieJar();
  const page = await request('/login', { jar });
  if (page.status !== 200) {
    throw new Error(`Expected login page 200, received ${page.status}`);
  }

  const response = await request('/login', {
    method: 'POST',
    jar,
    form: { email, password },
  });

  if (response.status !== 302) {
    throw new Error(`Expected login redirect for ${email}, received ${response.status}`);
  }

  return jar;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function findBidWithRetry(jobId, handymanId, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const bid = await prisma.bid.findUnique({
      where: { jobId_handymanId: { jobId, handymanId } },
    });
    if (bid) return bid;
    await sleep(250);
  }
  return null;
}

async function main() {
  let alexUser;
  let miaUser;
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  server.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    logStep(`Starting app on port ${port}`);
    await waitForServer();

    await prisma.user.updateMany({
      where: { email: { in: ['homeowner@example.com', 'alex@example.com', 'mia@example.com'] } },
      data: { isSuspended: false },
    });

    logStep('Logging in as homeowner and both handymen');
    const homeownerJar = await login('homeowner@example.com', 'password123');
    const alexJar = await login('alex@example.com', 'password123');
    const miaJar = await login('mia@example.com', 'password123');

    const suffix = Date.now();
    const title = `Guard test job ${suffix}`;

    logStep('Verifying a handyman cannot post a homeowner job');
    const beforeHandymanJobs = await prisma.job.count({ where: { title: `Blocked handyman job ${suffix}` } });
    const handymanPost = await request('/jobs', {
      method: 'POST',
      jar: alexJar,
      form: {
        title: `Blocked handyman job ${suffix}`,
        category: 'Repairs',
        description: 'This should not be allowed.',
        location: 'Columbus, OH 43215',
        budget: '99',
        preferredDate: 'Tomorrow',
      },
    });
    assert(handymanPost.status === 302, `Expected handyman post redirect, received ${handymanPost.status}`);
    const afterHandymanJobs = await prisma.job.count({ where: { title: `Blocked handyman job ${suffix}` } });
    assert(beforeHandymanJobs === afterHandymanJobs, 'Handyman should not be able to create a job.');

    logStep('Creating a homeowner job for bid-decline verification');
    const createJob = await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title,
        category: 'General Handyman',
        description: 'Guard test job for verifying acceptance and decline behavior.',
        location: 'Columbus, OH 43215',
        budget: '220',
        preferredDate: 'Next week',
      },
    });
    assert(createJob.status === 302, `Expected homeowner create redirect, received ${createJob.status}`);

    const job = await prisma.job.findFirst({ where: { title }, orderBy: { createdAt: 'desc' } });
    assert(job, 'Guard test job was not created.');

    logStep('Verifying a homeowner cannot bid on their own job');
    const beforeHomeownerBids = await prisma.bid.count({ where: { jobId: job.id } });
    const homeownerBid = await request(`/jobs/${job.id}/bids`, {
      method: 'POST',
      jar: homeownerJar,
      form: {
        amount: '210',
        etaDays: '1',
        message: 'This should be blocked.',
      },
    });
    assert(homeownerBid.status === 302, `Expected homeowner bid redirect, received ${homeownerBid.status}`);
    const afterHomeownerBids = await prisma.bid.count({ where: { jobId: job.id } });
    assert(beforeHomeownerBids === afterHomeownerBids, 'Homeowner should not be able to bid on a job.');

    [alexUser, miaUser] = await Promise.all([
      prisma.user.findUnique({ where: { email: 'alex@example.com' } }),
      prisma.user.findUnique({ where: { email: 'mia@example.com' } }),
    ]);

    await prisma.handymanProfile.updateMany({
      where: { userId: { in: [alexUser.id, miaUser.id] } },
      data: {
        subscriptionPlan: 'PRO',
        leadCredits: 5,
      },
    });

    const biddingAlexJar = await login('alex@example.com', 'password123');
    const biddingMiaJar = await login('mia@example.com', 'password123');

    logStep('Submitting competing bids from two handymen');
    const alexBidResponse = await request(`/jobs/${job.id}/bids`, {
      method: 'POST',
      jar: biddingAlexJar,
      form: {
        amount: '205',
        etaDays: '2',
        message: 'Alex bid for guard test.',
      },
    });
    const miaBidResponse = await request(`/jobs/${job.id}/bids`, {
      method: 'POST',
      jar: biddingMiaJar,
      form: {
        amount: '198',
        etaDays: '3',
        message: 'Mia bid for guard test.',
      },
    });
    assert(alexBidResponse.status === 302, `Expected Alex bid redirect, received ${alexBidResponse.status}`);
    assert(miaBidResponse.status === 302, `Expected Mia bid redirect, received ${miaBidResponse.status}`);

    let alexBid = await findBidWithRetry(job.id, alexUser.id);
    let miaBid = await findBidWithRetry(job.id, miaUser.id);

    if (!alexBid) {
      const refreshedAlexJar = await login('alex@example.com', 'password123');
      await prisma.handymanProfile.update({
        where: { userId: alexUser.id },
        data: { leadCredits: 5 },
      });
      const retryAlexBidResponse = await request('/jobs/' + job.id + '/bids', {
        method: 'POST',
        jar: refreshedAlexJar,
        form: {
          amount: '205',
          etaDays: '2',
          message: 'Alex bid for guard test.',
        },
      });
      assert(retryAlexBidResponse.status === 302, 'Expected Alex retry bid redirect, received ' + retryAlexBidResponse.status);
      alexBid = await findBidWithRetry(job.id, alexUser.id);
    }

    if (!miaBid) {
      const refreshedMiaJar = await login('mia@example.com', 'password123');
      await prisma.handymanProfile.update({
        where: { userId: miaUser.id },
        data: { leadCredits: 5 },
      });
      const retryMiaBidResponse = await request('/jobs/' + job.id + '/bids', {
        method: 'POST',
        jar: refreshedMiaJar,
        form: {
          amount: '198',
          etaDays: '3',
          message: 'Mia bid for guard test.',
        },
      });
      assert(retryMiaBidResponse.status === 302, 'Expected Mia retry bid redirect, received ' + retryMiaBidResponse.status);
      miaBid = await findBidWithRetry(job.id, miaUser.id);
    }

    assert(alexBid && miaBid, 'Expected both guard-test bids to exist.');

    logStep('Accepting one bid should decline the other automatically');
    const accept = await request(`/bids/${miaBid.id}/accept`, {
      method: 'POST',
      jar: homeownerJar,
    });
    assert(accept.status === 302, `Expected accept redirect, received ${accept.status}`);

    const refreshedJob = await prisma.job.findUnique({ where: { id: job.id } });
    const refreshedAlexBid = await prisma.bid.findUnique({ where: { id: alexBid.id } });
    const refreshedMiaBid = await prisma.bid.findUnique({ where: { id: miaBid.id } });

    assert(refreshedJob.status === 'AWARDED', `Expected job status AWARDED, received ${refreshedJob.status}`);
    assert(refreshedJob.acceptedBidId === miaBid.id, 'Expected acceptedBidId to match the chosen bid.');
    assert(refreshedMiaBid.status === 'ACCEPTED', `Expected chosen bid ACCEPTED, received ${refreshedMiaBid.status}`);
    assert(refreshedAlexBid.status === 'DECLINED', `Expected competing bid DECLINED, received ${refreshedAlexBid.status}`);

    const homeownerDashboard = await request('/dashboard', { jar: homeownerJar, redirect: 'follow' });
    const homeownerHtml = await homeownerDashboard.text();
    assert(homeownerDashboard.status === 200, `Expected homeowner dashboard 200, received ${homeownerDashboard.status}`);
    assert(homeownerHtml.includes('DECLINED'), 'Expected dashboard to show a declined bid after award.');

    logStep('Guard test passed');
  } finally {
    if (alexUser || miaUser) {
      await prisma.handymanProfile.updateMany({
        where: { userId: { in: [alexUser?.id, miaUser?.id].filter(Boolean) } },
        data: {
          subscriptionPlan: 'FREE',
          leadCredits: 3,
        },
      });
      if (alexUser) {
        await prisma.handymanProfile.updateMany({
          where: { userId: alexUser.id },
          data: {
            subscriptionPlan: 'PLUS',
            leadCredits: 12,
          },
        });
      }
      if (miaUser) {
        await prisma.handymanProfile.updateMany({
          where: { userId: miaUser.id },
          data: {
            subscriptionPlan: 'FREE',
            leadCredits: 2,
          },
        });
      }
    }

    server.kill('SIGTERM');
    await prisma.$disconnect();

    if (stderr.trim()) {
      process.stderr.write(`\n[guards] server stderr:\n${stderr}\n`);
    }
    if (server.exitCode !== null && server.exitCode !== 0) {
      process.stderr.write(`\n[guards] server stdout:\n${stdout}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[guards] FAILED: ${error.message}\n`);
  process.exit(1);
});
