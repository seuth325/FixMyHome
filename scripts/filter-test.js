const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.FILTER_PORT || '3103';
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
  process.stdout.write(`\n[filters] ${message}\n`);
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
  const location = response.headers.get('location') || '';
  if (!location.includes('/dashboard')) throw new Error(`Expected successful login redirect for ${email}, received ${location || 'unknown location'}`);
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

    await prisma.user.updateMany({
      where: { email: { in: ['homeowner@example.com', 'alex@example.com'] } },
      data: { isSuspended: false },
    });

    logStep('Logging in as homeowner and handyman');
    const homeownerJar = await login('homeowner@example.com', 'password123');
    const handymanJar = await login('alex@example.com', 'password123');

    const suffix = Date.now();
    const filterJobA = `Filter painting job ${suffix}`;
    const filterJobB = `Filter plumbing job ${suffix}`;

    logStep('Creating jobs for filter coverage');
    await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title: filterJobA,
        category: 'Painting',
        description: 'Fresh paint needed in a bright hallway.',
        location: 'Columbus, OH 43215',
        budget: '320',
        preferredDate: 'Weekday morning',
      },
    });
    await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title: filterJobB,
        category: 'Plumbing',
        description: 'Kitchen sink drip needs repair.',
        location: 'Dublin, OH 43017',
        budget: '140',
        preferredDate: 'Weekend afternoon',
      },
    });

    const categoryResponse = await request(`/dashboard?category=Painting&search=${encodeURIComponent(filterJobA)}&sort=budget_desc`, {
      jar: handymanJar,
      redirect: 'follow',
    });
    const categoryHtml = await categoryResponse.text();
    assert(categoryResponse.status === 200, `Expected filtered dashboard 200, received ${categoryResponse.status}`);
    assert(categoryHtml.includes(filterJobA), 'Expected painting filter to include the painting job.');
    assert(!categoryHtml.includes(filterJobB), 'Expected painting filter to exclude the plumbing job.');

    const searchResponse = await request(`/dashboard?search=${encodeURIComponent(filterJobB)}&maxBudget=200&sort=budget_asc`, {
      jar: handymanJar,
      redirect: 'follow',
    });
    const searchHtml = await searchResponse.text();
    assert(searchHtml.includes(filterJobB), 'Expected title and budget filters to include the plumbing job.');
    assert(!searchHtml.includes(filterJobA), 'Expected title and budget filters to exclude the painting job.');
    assert(searchHtml.includes('Budget low to high'), 'Expected filter form to preserve the selected sort option.');

    logStep('Filter test passed');
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();
    if (stderr.trim()) {
      process.stderr.write(`\n[filters] server stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[filters] FAILED: ${error.message}\n`);
  process.exit(1);
});
