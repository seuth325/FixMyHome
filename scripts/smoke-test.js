const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.SMOKE_PORT || '3101';
const baseUrl = `http://127.0.0.1:${port}`;
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9sAAAAASUVORK5CYII=',
  'base64'
);

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
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Server did not become ready in time.');
}

async function request(path, { method = 'GET', jar, form, multipart, headers, redirect = 'manual' } = {}) {
  const finalHeaders = jar ? jar.apply(headers) : { ...(headers || {}) };
  let body;

  if (multipart) {
    body = new FormData();
    for (const [key, value] of Object.entries(multipart)) {
      if (Array.isArray(value)) {
        value.forEach((entry) => body.append(key, entry.value, entry.filename));
      } else {
        body.append(key, value);
      }
    }
  } else if (form) {
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

    await prisma.user.updateMany({
      where: { email: { in: ['homeowner@example.com', 'alex@example.com'] } },
      data: { isSuspended: false },
    });
    await prisma.handymanProfile.updateMany({
      where: { user: { email: 'alex@example.com' } },
      data: {
        leadCredits: 10,
        subscriptionPlan: 'FREE',
      },
    });

    logStep('Logging in as homeowner and handyman');
    const homeownerJar = await login('homeowner@example.com', 'password123');
    const handymanJar = await login('alex@example.com', 'password123');

    const suffix = Date.now();
    const title = `Smoke test job ${suffix}`;

    logStep('Creating a homeowner job with a photo');
    const createResponse = await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      multipart: {
        title,
        category: 'Repairs',
        description: 'Automated smoke test job for verifying the core homeowner and handyman flow.',
        location: 'Columbus, OH 43215',
        budget: '140',
        preferredDate: 'This weekend',
        photos: [
          {
            value: new Blob([tinyPng], { type: 'image/png' }),
            filename: 'smoke-test.png',
          },
        ],
      },
    });
    await expect(createResponse.status === 302, `Expected create job redirect, received ${createResponse.status}`);

    const job = await prisma.job.findFirst({
      where: { title },
      include: { photos: true },
      orderBy: { createdAt: 'desc' },
    });
    await expect(job, 'Created job was not found in the database.');
    await expect(job.photos.length === 1, `Expected 1 photo for created job, found ${job.photos.length}`);
    await expect(job.photos[0].url.startsWith('/uploads/'), 'Expected uploaded photo URL to be stored on the job.');

    logStep('Editing the homeowner job before any bids exist');
    const editResponse = await request(`/jobs/${job.id}/edit`, {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title: `${title} updated`,
        category: 'Electrical',
        description: 'Updated smoke test job before any bids arrive.',
        location: 'Columbus, OH 43215',
        budget: '275',
        preferredDate: 'Flexible this week',
      },
    });
    await expect(editResponse.status === 302, `Expected edit job redirect, received ${editResponse.status}`);

    const editedJob = await prisma.job.findUnique({ where: { id: job.id } });
    await expect(editedJob.title === `${title} updated`, 'Expected homeowner edit to update the job title.');
    await expect(editedJob.category === 'Electrical', 'Expected homeowner edit to update the job category.');
    await expect(editedJob.budget === 275, `Expected homeowner edit to update budget to 275, received ${editedJob.budget}`);

    logStep('Managing homeowner photos before any bids exist');
    const existingPhoto = await prisma.jobPhoto.findFirst({
      where: { jobId: job.id },
      orderBy: { sortOrder: 'asc' },
    });
    await expect(existingPhoto, 'Expected editable homeowner job to have an existing photo.');
    const removePhotoResponse = await request(`/jobs/${job.id}/photos/${existingPhoto.id}/delete`, {
      method: 'POST',
      jar: homeownerJar,
    });
    await expect(removePhotoResponse.status === 302, `Expected remove photo redirect, received ${removePhotoResponse.status}`);
    const remainingPhotos = await prisma.jobPhoto.findMany({ where: { jobId: job.id } });
    await expect(remainingPhotos.length === 0, `Expected photo removal to leave 0 photos, found ${remainingPhotos.length}`);

    logStep('Deleting a second homeowner job before any bids exist');
    const deleteTitle = `Smoke delete job ${suffix}`;
    const deleteCreateResponse = await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title: deleteTitle,
        category: 'Repairs',
        description: 'Temporary smoke test job to verify delete-before-bids.',
        location: 'Columbus, OH 43215',
        budget: '160',
        preferredDate: 'Next week',
      },
    });
    await expect(deleteCreateResponse.status === 302, `Expected delete candidate create redirect, received ${deleteCreateResponse.status}`);

    const deleteJob = await prisma.job.findFirst({
      where: { title: deleteTitle },
      orderBy: { createdAt: 'desc' },
    });
    await expect(deleteJob, 'Delete candidate job was not found in the database.');

    const deleteResponse = await request(`/jobs/${deleteJob.id}/delete`, {
      method: 'POST',
      jar: homeownerJar,
    });
    await expect(deleteResponse.status === 302, `Expected delete job redirect, received ${deleteResponse.status}`);

    const deletedJob = await prisma.job.findUnique({ where: { id: deleteJob.id } });
    await expect(!deletedJob, 'Expected delete-before-bids job to be removed from the database.');

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

    const handyman = await prisma.user.findUnique({ where: { email: 'alex@example.com' } });
    const bid = await prisma.bid.findUnique({
      where: {
        jobId_handymanId: {
          jobId: job.id,
          handymanId: handyman.id,
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

    logStep('Short-listing, accepting, and funding escrow');
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

    const awardedJob = await prisma.job.findUnique({ where: { id: job.id }, include: { payment: true } });
    await expect(awardedJob.status === 'AWARDED', `Expected job to be AWARDED, received ${awardedJob.status}`);
    await expect(Boolean(awardedJob.payment), 'Expected accepted job to create an escrow payment.');
    await expect(awardedJob.payment.status === 'PENDING_FUNDING', `Expected escrow to be PENDING_FUNDING, received ${awardedJob.payment.status}`);

    const fundResponse = await request(`/jobs/${job.id}/payment/fund`, {
      method: 'POST',
      jar: homeownerJar,
    });
    await expect(fundResponse.status === 302, `Expected fund escrow redirect, received ${fundResponse.status}`);

    const fundedJob = await prisma.job.findUnique({ where: { id: job.id }, include: { payment: true } });
    await expect(fundedJob.payment.status === 'FUNDED', `Expected escrow to be FUNDED, received ${fundedJob.payment.status}`);

    logStep('Marking the job complete, releasing payment, and leaving a review');
    const completeResponse = await request(`/jobs/${job.id}/status`, {
      method: 'POST',
      jar: homeownerJar,
      form: { action: 'complete' },
    });
    await expect(completeResponse.status === 302, `Expected complete redirect, received ${completeResponse.status}`);

    const releaseResponse = await request(`/jobs/${job.id}/payment/release`, {
      method: 'POST',
      jar: homeownerJar,
    });
    await expect(releaseResponse.status === 302, `Expected release payment redirect, received ${releaseResponse.status}`);

    const reviewResponse = await request(`/jobs/${job.id}/reviews`, {
      method: 'POST',
      jar: homeownerJar,
      form: { stars: '5', text: 'Smoke test review: smooth and professional.' },
    });
    await expect(reviewResponse.status === 302, `Expected review redirect, received ${reviewResponse.status}`);

    const completedJob = await prisma.job.findUnique({
      where: { id: job.id },
      include: { review: true, photos: true, payment: true },
    });
    await expect(completedJob.status === 'COMPLETED', `Expected job to be COMPLETED, received ${completedJob.status}`);
    await expect(completedJob.payment.status === 'RELEASED', `Expected payment to be RELEASED, received ${completedJob.payment.status}`);
    await expect(Boolean(completedJob.review), 'Expected completed job to have a review.');
    await expect(completedJob.photos.length === 0, `Expected removed photo to stay deleted after completion, found ${completedJob.photos.length}.`);

    const dashboardResponse = await request('/dashboard', { jar: homeownerJar, redirect: 'follow' });
    const dashboardHtml = await dashboardResponse.text();
    await expect(dashboardResponse.status === 200, `Expected dashboard 200, received ${dashboardResponse.status}`);
    await expect(dashboardHtml.includes(`${title} updated`), 'Expected homeowner dashboard to contain the updated smoke test job title.');

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
