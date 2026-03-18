const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.CHECKOUT_CONFIG_PORT || '3113';
const baseUrl = `http://127.0.0.1:${port}`;
const captureFile = path.join(os.tmpdir(), `fixmyhome-stripe-capture-${Date.now()}.jsonl`);

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

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function logStep(message) { process.stdout.write(`\n[checkout-config] ${message}\n`); }
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

async function request(pathname, { method = 'GET', jar, form, headers, redirect = 'manual' } = {}) {
  const finalHeaders = jar ? jar.apply(headers) : { ...(headers || {}) };
  let body;

  if (form) {
    body = new URLSearchParams(form);
    finalHeaders['content-type'] = 'application/x-www-form-urlencoded';
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
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
  assert(page.status === 200, `Expected login page 200, received ${page.status}`);

  const response = await request('/login', {
    method: 'POST',
    jar,
    form: { email, password },
  });
  assert(response.status === 302, `Expected login redirect, received ${response.status}`);
  return jar;
}

function readCaptureEntries() {
  if (!fs.existsSync(captureFile)) return [];
  return fs.readFileSync(captureFile, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function main() {
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: port,
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_fixmyhome',
      STRIPE_WEBHOOK_SECRET: 'whsec_fixmyhome_test',
      STRIPE_PRICE_PLUS_MONTHLY: 'price_plus_monthly_test',
      STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly_test',
      STRIPE_MOCK_CAPTURE_FILE: captureFile,
      APP_BASE_URL: baseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    logStep(`Starting app on port ${port}`);
    await waitForServer();

    const mia = await prisma.user.findUnique({ where: { email: 'mia@example.com' }, include: { handymanProfile: true } });
    await prisma.handymanProfile.update({
      where: { userId: mia.id },
      data: {
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        billingStatus: 'INACTIVE',
        billingPeriodEndsAt: null,
        subscriptionRenewsAt: null,
      },
    });

    const handymanJar = await login('mia@example.com', 'password123');

    logStep('Posting a Plus plan selection should create Stripe Checkout in subscription mode with the saved price id');
    const planResponse = await request('/billing/plan', {
      method: 'POST',
      jar: handymanJar,
      form: { plan: 'PLUS' },
    });
    assert(planResponse.status === 302, `Expected billing plan redirect, received ${planResponse.status}`);
    const planLocation = planResponse.headers.get('location') || '';
    assert(planLocation.startsWith('https://mock.stripe.test/checkout/'), 'Expected Stripe plan flow to redirect to the mock hosted checkout URL, received ' + (planLocation || '<empty>') + '.');

    const entries = readCaptureEntries();
    const customerEntry = entries.find((entry) => entry.kind === 'customer.create');
    assert(Boolean(customerEntry), 'Expected Stripe customer creation to be captured.');
    const checkoutEntry = entries.find((entry) => entry.kind === 'checkout.sessions.create');
    assert(Boolean(checkoutEntry), 'Expected Stripe checkout session creation to be captured.');
    assert(checkoutEntry.payload.mode === 'subscription', 'Expected plan checkout to use Stripe subscription mode.');
    assert(checkoutEntry.payload.line_items[0].price === 'price_plus_monthly_test', 'Expected Plus plan checkout to use STRIPE_PRICE_PLUS_MONTHLY.');
    assert(!('price_data' in checkoutEntry.payload.line_items[0]), 'Expected saved Stripe Price ID plans not to send inline price_data.');
    assert(checkoutEntry.payload.subscription_data.metadata.planKey === 'PLUS', 'Expected subscription metadata to include the selected plan key.');
    assert(checkoutEntry.payload.metadata.targetType === 'PLAN', 'Expected checkout metadata to identify plan purchases.');

    logStep('Posting a credit-pack purchase should still use payment mode and inline pricing');
    const creditResponse = await request('/billing/credits', {
      method: 'POST',
      jar: handymanJar,
      form: { pack: 'STARTER' },
    });
    assert(creditResponse.status === 302, `Expected credit purchase redirect, received ${creditResponse.status}`);
    const creditLocation = creditResponse.headers.get('location') || '';
    assert(creditLocation.startsWith('https://mock.stripe.test/checkout/'), 'Expected credit-pack flow to redirect to a mock hosted checkout URL, received ' + (creditLocation || '<empty>') + '.');

    const creditCheckoutEntry = readCaptureEntries().filter((entry) => entry.kind === 'checkout.sessions.create')[1];
    assert(Boolean(creditCheckoutEntry), 'Expected a second Stripe checkout session for the credit pack.');
    assert(creditCheckoutEntry.payload.mode === 'payment', 'Expected credit packs to stay in one-time payment mode.');
    assert(Boolean(creditCheckoutEntry.payload.line_items[0].price_data), 'Expected credit packs to keep inline price_data instead of plan price ids.');
    assert(creditCheckoutEntry.payload.metadata.creditPack === 'STARTER', 'Expected credit-pack metadata to be preserved.');

    logStep('Checkout config test passed');
  } finally {
    server.kill('SIGTERM');
    if (fs.existsSync(captureFile)) {
      fs.unlinkSync(captureFile);
    }
    await prisma.$disconnect();
    if (stderr.trim()) {
      process.stderr.write(`\n[checkout-config] server stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[checkout-config] FAILED: ${error.message}\n`);
  process.exit(1);
});



