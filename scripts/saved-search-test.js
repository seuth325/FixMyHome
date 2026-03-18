const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.SAVED_SEARCH_PORT || '3104';
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
  process.stdout.write(`\n[saved-searches] ${message}\n`);
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
    const localJob = `Local patch job ${suffix}`;
    const farJob = `Far deck job ${suffix}`;

    logStep('Creating a local and far-away job');
    await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title: localJob,
        category: 'Repairs',
        description: 'Drywall patch and quick paint touch-up in a downtown condo.',
        location: 'Columbus, OH 43215',
        budget: '225',
        preferredDate: 'Weeknight',
      },
    });

    await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title: farJob,
        category: 'Yard Help',
        description: 'Backyard cleanup in a different part of the state.',
        location: 'Cleveland, OH 44114',
        budget: '260',
        preferredDate: 'Saturday',
      },
    });

    logStep('Checking near-me filtering and local-match labels');
    const nearResponse = await request('/dashboard?nearMeOnly=1', { jar: handymanJar, redirect: 'follow' });
    const nearHtml = await nearResponse.text();
    assert(nearResponse.status === 200, `Expected near-me dashboard 200, received ${nearResponse.status}`);
    assert(nearHtml.includes(localJob), 'Expected local job to remain in the near-me view.');
    assert(!nearHtml.includes(farJob), 'Expected far-away job to be excluded from the near-me view.');
    assert(/miles away|Under 1 mile away|Same city area|Same ZIP area|Exact area match/.test(nearHtml), 'Expected a location match label to appear on local jobs.');

    logStep('Saving the current search');
    const saveResponse = await request('/saved-searches', {
      method: 'POST',
      jar: handymanJar,
      form: {
        name: `Local leads ${suffix}`,
        nearMeOnly: '1',
        search: 'Columbus',
        category: 'Repairs',
        minBudget: '150',
        maxBudget: '300',
        sort: 'newest',
        photosOnly: '',
      },
    });
    assert(saveResponse.status === 302, `Expected saved search redirect, received ${saveResponse.status}`);
    const locationHeader = saveResponse.headers.get('location') || '';
    assert(locationHeader.includes('nearMeOnly=1'), 'Expected saved search redirect to preserve near-me filtering.');
    assert(locationHeader.includes('category=Repairs'), 'Expected saved search redirect to preserve category filtering.');

    const dashboardResponse = await request('/dashboard', { jar: handymanJar, redirect: 'follow' });
    const dashboardHtml = await dashboardResponse.text();
    assert(dashboardHtml.includes(`Local leads ${suffix}`), 'Expected saved search name to render on the dashboard.');

    const savedSearch = await prisma.savedSearch.findFirst({
      where: {
        name: `Local leads ${suffix}`,
      },
    });
    assert(savedSearch, 'Expected saved search record to be stored in the database.');
    assert(savedSearch.nearMeOnly === true, 'Expected saved search to persist near-me flag.');
    assert(savedSearch.category === 'Repairs', 'Expected saved search to persist category filter.');

    logStep('Deleting the saved search');
    const deleteResponse = await request(`/saved-searches/${savedSearch.id}/delete`, {
      method: 'POST',
      jar: handymanJar,
    });
    assert(deleteResponse.status === 302, `Expected delete redirect, received ${deleteResponse.status}`);

    const deletedSearch = await prisma.savedSearch.findUnique({ where: { id: savedSearch.id } });
    assert(!deletedSearch, 'Expected saved search to be deleted.');

    logStep('Saved search test passed');
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();
    if (stderr.trim()) {
      process.stderr.write(`\n[saved-searches] server stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[saved-searches] FAILED: ${error.message}\n`);
  process.exit(1);
});
