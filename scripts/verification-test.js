const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.VERIFICATION_PORT || '3108';
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
  process.stdout.write(`\n[verification] ${message}\n`);
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

    const handymanJar = await login('alex@example.com', 'password123');
    const adminJar = await login('admin@example.com', 'password123');
    const alex = await prisma.user.findUnique({ where: { email: 'alex@example.com' } });

    logStep('Submitting insurance and license verification details');
    await request('/profile/verification/insurance', {
      method: 'POST',
      jar: handymanJar,
      form: { proofDetails: 'Carrier Acme Mutual, policy AC-123, expires 2027-01-01' },
    });
    await request('/profile/verification/license', {
      method: 'POST',
      jar: handymanJar,
      form: { proofDetails: 'OH LIC-7788, expires 2026-12-31' },
    });

    let profile = await prisma.handymanProfile.findUnique({ where: { userId: alex.id } });
    assert(profile.insuranceStatus === 'PENDING', 'Expected insurance verification to be pending.');
    assert(profile.licenseStatus === 'PENDING', 'Expected license verification to be pending.');

    logStep('Reviewing verification queue as admin');
    const adminPage = await request('/admin', { jar: adminJar, redirect: 'follow' });
    const adminHtml = await adminPage.text();
    assert(adminPage.status === 200, `Expected admin dashboard 200, received ${adminPage.status}`);
    assert(adminHtml.includes('Verification queue'), 'Expected verification queue on admin dashboard.');
    assert(adminHtml.includes('Alex Repairs'), 'Expected handyman profile to appear in verification queue.');

    await request(`/admin/verification/${alex.id}/insurance`, {
      method: 'POST',
      jar: adminJar,
      form: {
        decision: 'APPROVED',
        adminNotes: 'Policy details matched and expiration is valid.',
      },
    });
    await request(`/admin/verification/${alex.id}/license`, {
      method: 'POST',
      jar: adminJar,
      form: {
        decision: 'REJECTED',
        adminNotes: 'License number needs supporting state document.',
      },
    });

    profile = await prisma.handymanProfile.findUnique({ where: { userId: alex.id } });
    assert(profile.insuranceStatus === 'APPROVED', 'Expected insurance verification to be approved.');
    assert(profile.insuranceVerified === true, 'Expected insuranceVerified to be true.');
    assert(profile.insuranceAdminNotes.includes('matched'), 'Expected insurance admin notes to persist.');
    assert(profile.licenseStatus === 'REJECTED', 'Expected license verification to be rejected.');
    assert(profile.licenseVerified === false, 'Expected licenseVerified to remain false.');
    assert(profile.licenseAdminNotes.includes('supporting'), 'Expected license admin notes to persist.');

    logStep('Verification test passed');
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();
    if (stderr.trim()) {
      process.stderr.write(`\n[verification] server stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[verification] FAILED: ${error.message}\n`);
  process.exit(1);
});
