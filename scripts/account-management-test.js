const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.ACCOUNT_TEST_PORT || '3102';
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
  process.stdout.write(`\n[account-test] ${message}\n`);
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/forgot-password`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch (_error) {
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

async function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function signup({ name, email, password, role, location = 'Columbus, OH 43215' }) {
  const response = await request('/signup', {
    method: 'POST',
    form: {
      name,
      email,
      password,
      confirmPassword: password,
      role,
      location,
    },
  });

  await expect(response.status === 302, `Expected signup redirect, received ${response.status}`);
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

  await expect(response.status === 302, `Expected login redirect, received ${response.status}`);
  return jar;
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
      where: { email: 'admin@example.com' },
      data: { isSuspended: false },
    });

    const suffix = Date.now();
    const homeownerEmail = `delete-homeowner-${suffix}@example.com`;
    const handymanEmail = `delete-handyman-${suffix}@example.com`;
    const password = 'Password1!';

    logStep('Creating disposable homeowner and handyman accounts');
    await signup({
      name: 'Delete Me Homeowner',
      email: homeownerEmail,
      password,
      role: 'HOMEOWNER',
    });
    await signup({
      name: 'Delete Me Handyman',
      email: handymanEmail,
      password,
      role: 'HANDYMAN',
    });

    logStep('Verifying self-delete requires DELETE confirmation');
    const homeownerJar = await login(homeownerEmail, password);
    const wrongConfirm = await request('/account/delete', {
      method: 'POST',
      jar: homeownerJar,
      form: { confirmation: 'nope' },
    });
    await expect(wrongConfirm.status === 302, `Expected self-delete confirmation redirect, received ${wrongConfirm.status}`);
    const stillExists = await prisma.user.findUnique({ where: { email: homeownerEmail } });
    await expect(Boolean(stillExists), 'Expected homeowner to remain after wrong delete confirmation.');

    logStep('Deleting the homeowner through self-serve account deletion');
    const selfDelete = await request('/account/delete', {
      method: 'POST',
      jar: homeownerJar,
      form: { confirmation: 'DELETE' },
    });
    await expect(selfDelete.status === 302, `Expected self-delete redirect, received ${selfDelete.status}`);
    await expect((selfDelete.headers.get('location') || '').includes('/login?accountDeleted=1'), 'Expected self-delete to redirect to login with accountDeleted flag.');
    const deletedHomeowner = await prisma.user.findUnique({ where: { email: homeownerEmail } });
    await expect(!deletedHomeowner, 'Expected homeowner account to be deleted.');

    logStep('Deleting a clean handyman account from the admin dashboard');
    const adminJar = await login('admin@example.com', 'password123');
    const handyman = await prisma.user.findUnique({ where: { email: handymanEmail } });
    await expect(Boolean(handyman), 'Expected disposable handyman account to exist before admin delete.');
    const userDetail = await request(`/admin/users/${handyman.id}`, {
      jar: adminJar,
    });
    await expect(userDetail.status === 200, `Expected admin user detail page 200, received ${userDetail.status}`);
    const adminDelete = await request(`/admin/users/${handyman.id}/delete`, {
      method: 'POST',
      jar: adminJar,
    });
    await expect(adminDelete.status === 302, `Expected admin delete redirect, received ${adminDelete.status}`);
    const deletedHandyman = await prisma.user.findUnique({ where: { email: handymanEmail } });
    await expect(!deletedHandyman, 'Expected admin delete to remove the handyman account.');

    console.log('\nAccount management test passed');
  } finally {
    await prisma.$disconnect();
    server.kill('SIGTERM');

    if (stderr.trim()) {
      process.stderr.write(`\n[account-test stderr]\n${stderr}\n`);
    }
    if (stdout.trim()) {
      process.stdout.write(`\n[account-test stdout]\n${stdout}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
