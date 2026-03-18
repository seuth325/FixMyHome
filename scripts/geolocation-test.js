const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.GEOLOCATION_PORT || '3109';
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
  process.stdout.write(`\n[geolocation] ${message}\n`);
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
    const nearbyJob = `Dublin fan install ${suffix}`;
    const farJob = `Cleveland trim repair ${suffix}`;

    logStep('Creating one within-radius job and one outside-radius job');
    await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title: nearbyJob,
        category: 'Installations',
        description: 'Install a ceiling fan in a condo near Bridge Park.',
        location: 'Dublin, OH 43017',
        budget: '240',
        preferredDate: 'Weeknight',
      },
    });

    await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title: farJob,
        category: 'Repairs',
        description: 'Trim repair for a rental turnover downtown.',
        location: 'Cleveland, OH 44114',
        budget: '220',
        preferredDate: 'Saturday',
      },
    });

    const nearbyRecord = await prisma.job.findFirst({ where: { title: nearbyJob } });
    assert(nearbyRecord?.locationLat != null && nearbyRecord?.locationLng != null, 'Expected nearby job coordinates to be stored.');

    logStep('Checking near-me feed uses stored distance and service radius');
    const nearResponse = await request('/dashboard?nearMeOnly=1', { jar: handymanJar, redirect: 'follow' });
    const nearHtml = await nearResponse.text();
    assert(nearResponse.status === 200, `Expected near-me dashboard 200, received ${nearResponse.status}`);
    assert(nearHtml.includes(nearbyJob), 'Expected Dublin job to appear within Alex\'s radius.');
    assert(!nearHtml.includes(farJob), 'Expected Cleveland job to stay outside Alex\'s radius.');
    assert(/miles away|Under 1 mile away/.test(nearHtml), 'Expected a distance label to render.');
    assert(nearHtml.includes('Within your 20-mile radius'), 'Expected within-radius helper copy for Alex\'s service radius.');

    logStep('Shrinking Alex\'s radius should remove the same job from near-me results');
    const profileUpdate = await request('/profile', {
      method: 'POST',
      jar: handymanJar,
      form: {
        name: 'Alex Repairs',
        businessName: 'Alex Repairs Co.',
        location: 'Columbus, OH',
        serviceRadius: '5',
        hourlyGuideline: '65',
        skills: 'Painting, Furniture Assembly, Drywall',
        bio: 'Small local crew focused on clean, on-time interior work.',
      },
    });
    assert(profileUpdate.status === 302, `Expected profile update redirect, received ${profileUpdate.status}`);

    const tighterResponse = await request('/dashboard?nearMeOnly=1', { jar: handymanJar, redirect: 'follow' });
    const tighterHtml = await tighterResponse.text();
    assert(!tighterHtml.includes(nearbyJob), 'Expected Dublin job to drop out once Alex lowers the service radius.');

    logStep('Geolocation test passed');
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();
    if (stderr.trim()) {
      process.stderr.write(`\n[geolocation] server stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[geolocation] FAILED: ${error.message}\n`);
  process.exit(1);
});
