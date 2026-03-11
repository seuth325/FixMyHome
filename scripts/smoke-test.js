const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.SMOKE_PORT || '3101';
const baseUrl = `http://127.0.0.1:${port}`;

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  apply(headers = {}) {
    const cookieHeader = Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

    if (cookieHeader) {
      return { ...headers, cookie: cookieHeader };
    }

    return headers;
  }

  store(response) {
    const setCookie = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];

    for (const entry of setCookie) {
      const [pair] = entry.split(';');
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;
      const name = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      this.cookies.set(name, value);
    }
  }
}

function logStep(message) {
  process.stdout.write(`\n[smoke] ${message}\n`);
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
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

async function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  server.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    logStep(`Starting app on port ${port}`);
    await waitForServer();

    logStep('Logging in as homeowner and handyman');
    const homeownerJar = await login('homeowner@example.com', 'password123');
    const handymanJar = await login('alex@example.com', 'password123');

    const suffix = Date.now();
    const title = `Smoke test job ${suffix}`;

    logStep('Creating a homeowner job');
    const createResponse = await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title,
        category: 'Repairs',
        description: 'Automated smoke test job for verifying the core homeowner and handyman flow.',
        location: 'Columbus, OH 43215',
        budget: '140',
        preferredDate: 'This weekend',
      },
    });
    await expect(createResponse.status === 302, `Expected create job redirect, received ${createResponse.status}`);

    const job = await prisma.job.findFirst({
      where: { title },
      orderBy: { createdAt: 'desc' },
    });
    await expect(job, 'Created job was not found in the database.');

    logStep('Submitting a handyman bid');
    const bidResponse = await request(`/jobs/${job.id}/bids`, {
      method: 'POST',
      jar: handymanJar,
      form: {
        amount: '125',
        etaDays: '2',
        message: 'Smoke test bid: I can complete this work carefully and on schedule.',
      },
    });
    await expect(bidResponse.status === 302, `Expected bid redirect, received ${bidResponse.status}`);

    const bid = await prisma.bid.findUnique({
      where: {
        jobId_handymanId: {
          jobId: job.id,
          handymanId: (await prisma.user.findUnique({ where: { email: 'alex@example.com' } })).id,
        },
      },
    });
    await expect(bid, 'Submitted bid was not found in the database.');

    logStep('Sending one message from each side');
    const handymanMessage = await request(`/bids/${bid.id}/messages`, {
      method: 'POST',
      jar: handymanJar,
      form: { body: 'Smoke test message from handyman.' },
    });
    await expect(handymanMessage.status === 302, `Expected handyman message redirect, received ${handymanMessage.status}`);

    const homeownerMessage = await request(`/bids/${bid.id}/messages`, {
      method: 'POST',
      jar: homeownerJar,
      form: { body: 'Smoke test reply from homeowner.' },
    });
    await expect(homeownerMessage.status === 302, `Expected homeowner message redirect, received ${homeownerMessage.status}`);

    logStep('Short-listing and accepting the bid');
    const shortlistResponse = await request(`/bids/${bid.id}/shortlist`, {
      method: 'POST',
      jar: homeownerJar,
    });
    await expect(shortlistResponse.status === 302, `Expected shortlist redirect, received ${shortlistResponse.status}`);

    const acceptResponse = await request(`/bids/${bid.id}/accept`, {
      method: 'POST',
      jar: homeownerJar,
    });
    await expect(acceptResponse.status === 302, `Expected accept redirect, received ${acceptResponse.status}`);

    const awardedJob = await prisma.job.findUnique({ where: { id: job.id } });
    await expect(awardedJob.status === 'AWARDED', `Expected job to be AWARDED, received ${awardedJob.status}`);

    logStep('Marking the job complete and leaving a review');
    const completeResponse = await request(`/jobs/${job.id}/status`, {
      method: 'POST',
      jar: homeownerJar,
      form: { action: 'complete' },
    });
    await expect(completeResponse.status === 302, `Expected complete redirect, received ${completeResponse.status}`);

    const reviewResponse = await request(`/jobs/${job.id}/reviews`, {
      method: 'POST',
      jar: homeownerJar,
      form: { stars: '5', text: 'Smoke test review: smooth and professional.' },
    });
    await expect(reviewResponse.status === 302, `Expected review redirect, received ${reviewResponse.status}`);

    const completedJob = await prisma.job.findUnique({
      where: { id: job.id },
      include: { review: true },
    });
    await expect(completedJob.status === 'COMPLETED', `Expected job to be COMPLETED, received ${completedJob.status}`);
    await expect(Boolean(completedJob.review), 'Expected completed job to have a review.');

    const dashboardResponse = await request('/dashboard', { jar: homeownerJar, redirect: 'follow' });
    const dashboardHtml = await dashboardResponse.text();
    await expect(dashboardResponse.status === 200, `Expected dashboard 200, received ${dashboardResponse.status}`);
    await expect(dashboardHtml.includes(title), 'Expected homeowner dashboard to contain the smoke test job title.');

    logStep('Smoke test passed');
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();

    if (stderr.trim()) {
      process.stderr.write(`\n[smoke] server stderr:\n${stderr}\n`);
    }
    if (server.exitCode !== null && server.exitCode !== 0) {
      process.stderr.write(`\n[smoke] server stdout:\n${stdout}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[smoke] FAILED: ${error.message}\n`);
  process.exit(1);
});
