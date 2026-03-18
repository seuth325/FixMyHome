const Stripe = require('stripe');
const crypto = require('crypto');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const MOCK_PROVIDER_NAME = 'mockpay';
const STRIPE_PROVIDER_NAME = 'stripe';

function getPaymentProvider() {
  const explicit = String(process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  if (explicit === STRIPE_PROVIDER_NAME) return STRIPE_PROVIDER_NAME;
  if (explicit === MOCK_PROVIDER_NAME) return MOCK_PROVIDER_NAME;
  return process.env.STRIPE_SECRET_KEY ? STRIPE_PROVIDER_NAME : MOCK_PROVIDER_NAME;
}

function appendStripeMockCapture(entry) {
  const capturePath = String(process.env.STRIPE_MOCK_CAPTURE_FILE || '').trim();
  if (!capturePath) return;
  const payload = JSON.stringify({ ...entry, capturedAt: new Date().toISOString() }) + '\n';
  fs.appendFileSync(capturePath, payload, 'utf8');
}

function getStripeMockClient() {
  return {
    customers: {
      create: async (payload) => {
        const customerId = `cus_mock_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
        appendStripeMockCapture({ kind: 'customer.create', payload });
        return { id: customerId };
      },
    },
    checkout: {
      sessions: {
        create: async (payload) => {
          const sessionId = `cs_mock_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
          appendStripeMockCapture({ kind: 'checkout.sessions.create', payload });
          return {
            id: sessionId,
            url: `https://mock.stripe.test/checkout/${sessionId}`,
          };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (payload) => {
          const portalId = `bps_mock_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
          appendStripeMockCapture({ kind: 'billingPortal.sessions.create', payload });
          return {
            id: portalId,
            url: `https://mock.stripe.test/portal/${portalId}`,
          };
        },
      },
    },
    webhooks: Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_fixmyhome').webhooks,
  };
}

function getStripeClient() {
  if (String(process.env.STRIPE_MOCK_CAPTURE_FILE || '').trim()) {
    return getStripeMockClient();
  }
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

function getMockWebhookSecret() {
  return process.env.PAYMENT_WEBHOOK_SECRET || 'mockpay-dev-secret';
}

function getStripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET || '';
}

function getStripePlanPriceId(planKey) {
  if (planKey === 'PLUS') return String(process.env.STRIPE_PRICE_PLUS_MONTHLY || '').trim() || null;
  if (planKey === 'PRO') return String(process.env.STRIPE_PRICE_PRO_MONTHLY || '').trim() || null;
  return null;
}

function getPlanKeyFromStripePriceId(priceId) {
  if (!priceId) return null;
  if (priceId === getStripePlanPriceId('PLUS')) return 'PLUS';
  if (priceId === getStripePlanPriceId('PRO')) return 'PRO';
  return null;
}

function signPayload(payload) {
  return crypto
    .createHmac('sha256', getMockWebhookSecret())
    .update(payload)
    .digest('hex');
}

function verifyMockSignature(payload, signature) {
  if (!signature) return false;
  const expected = signPayload(payload);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (_error) {
    return false;
  }
}

function buildWebhookEvent(session) {
  return {
    id: `evt_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
    type: 'checkout.session.completed',
    createdAt: new Date().toISOString(),
    data: {
      sessionId: session.providerSessionId,
      targetType: session.targetType,
      amount: session.amount,
      currency: session.currency,
      subscriptionId: session.subscriptionId || null,
      customerId: session.customerId || null,
      quantity: session.quantity || 1,
      metadata: {
        userId: session.userId,
        jobId: session.jobId,
        planKey: session.planKey,
        creditPack: session.creditPack,
      },
    },
  };
}

function getBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (req) return `${req.protocol}://${req.get('host')}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

function getCheckoutDescriptor({ targetType, planKey, creditPack, amount }) {
  if (targetType === 'PLAN') {
    return {
      name: `FixMyHome ${planKey} plan`,
      description: `Subscription plan purchase for ${planKey}`,
      amount,
    };
  }
  if (targetType === 'CREDIT_PACK') {
    return {
      name: `FixMyHome ${creditPack} credits`,
      description: `Lead credit purchase for ${creditPack}`,
      amount,
    };
  }
  return {
    name: 'FixMyHome escrow funding',
    description: 'Escrow funding for awarded job',
    amount,
  };
}

async function createCheckoutSession({ prisma, req, userId, jobId = null, targetType, planKey = null, creditPack = null, amount }) {
  const provider = getPaymentProvider();

  if (provider === STRIPE_PROVIDER_NAME) {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error('Stripe provider selected without STRIPE_SECRET_KEY.');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { handymanProfile: true },
    });
    if (!user) {
      throw new Error('Checkout user not found.');
    }

    let stripeCustomerId = user.handymanProfile?.stripeCustomerId || null;
    if ((targetType === 'PLAN' || targetType === 'CREDIT_PACK') && !stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id, role: user.role },
      });
      stripeCustomerId = customer.id;
      if (user.handymanProfile) {
        await prisma.handymanProfile.update({
          where: { userId: user.id },
          data: { stripeCustomerId },
        });
      }
    }

    const descriptor = getCheckoutDescriptor({ targetType, planKey, creditPack, amount });
    const metadata = {
      userId,
      jobId: jobId || '',
      targetType,
      planKey: planKey || '',
      creditPack: creditPack || '',
    };
    const planPriceId = targetType === 'PLAN' ? getStripePlanPriceId(planKey) : null;

    const stripeSession = await stripe.checkout.sessions.create({
      mode: targetType === 'PLAN' ? 'subscription' : 'payment',
      success_url: `${getBaseUrl(req)}/checkout/return?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getBaseUrl(req)}/checkout/return?status=cancelled&session_id={CHECKOUT_SESSION_ID}`,
      line_items: [
        targetType === 'PLAN' && planPriceId
          ? {
              quantity: 1,
              price: planPriceId,
            }
          : {
              quantity: 1,
              price_data: targetType === 'PLAN'
                ? {
                    currency: 'usd',
                    recurring: { interval: 'month' },
                    unit_amount: amount,
                    product_data: {
                      name: descriptor.name,
                      description: descriptor.description,
                    },
                  }
                : {
                    currency: 'usd',
                    unit_amount: amount,
                    product_data: {
                      name: descriptor.name,
                      description: descriptor.description,
                    },
                  },
            },
      ],
      customer: stripeCustomerId || undefined,
      metadata,
      subscription_data: targetType === 'PLAN'
        ? {
            metadata,
          }
        : undefined,
    });

    const checkoutSession = await prisma.checkoutSession.create({
      data: {
        providerSessionId: stripeSession.id,
        userId,
        jobId,
        targetType,
        planKey,
        creditPack,
        amount,
        currency: 'USD',
        provider,
        status: 'PENDING',
      },
    });

    return {
      ...checkoutSession,
      checkoutUrl: stripeSession.url,
      provider,
    };
  }

  const checkoutSession = await prisma.checkoutSession.create({
    data: {
      providerSessionId: `cs_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
      userId,
      jobId,
      targetType,
      planKey,
      creditPack,
      amount,
      currency: 'USD',
      provider,
      status: 'PENDING',
    },
  });

  return {
    ...checkoutSession,
    checkoutUrl: null,
    provider,
  };
}

async function createBillingPortalSession({ returnUrl, customerId }) {
  if (getPaymentProvider() !== STRIPE_PROVIDER_NAME) {
    return null;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe provider selected without STRIPE_SECRET_KEY.');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session;
}

function getStripeItemData(object) {
  const firstItem = object.items?.data?.[0] || object.lines?.data?.[0] || null;
  const priceId = firstItem?.price?.id || firstItem?.plan?.id || null;
  const quantity = firstItem?.quantity || object.quantity || 1;
  const planKey = firstItem?.metadata?.planKey || object.metadata?.planKey || getPlanKeyFromStripePriceId(priceId);
  return {
    priceId,
    quantity,
    planKey,
  };
}

function normalizeStripeEvent(event) {
  const object = event.data.object || {};
  const metadata = object.metadata || {};
  const createdAt = event.created ? new Date(event.created * 1000).toISOString() : new Date().toISOString();
  const itemData = getStripeItemData(object);

  if (event.type === 'checkout.session.completed') {
    return {
      id: event.id,
      type: event.type,
      createdAt,
      data: {
        sessionId: object.id,
        targetType: metadata.targetType,
        amount: object.amount_total,
        currency: object.currency,
        subscriptionId: object.subscription || null,
        customerId: object.customer || null,
        currentPeriodEnd: null,
        billingReason: null,
        amountPaid: object.amount_total || null,
        quantity: itemData.quantity,
        priceId: itemData.priceId,
        status: object.status || null,
        metadata: {
          userId: metadata.userId || null,
          jobId: metadata.jobId || null,
          planKey: metadata.planKey || itemData.planKey || null,
          creditPack: metadata.creditPack || null,
        },
      },
    };
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    return {
      id: event.id,
      type: event.type,
      createdAt,
      data: {
        sessionId: null,
        targetType: 'PLAN',
        amount: null,
        currency: object.currency || 'usd',
        subscriptionId: object.id,
        customerId: object.customer || null,
        currentPeriodEnd: object.current_period_end || null,
        billingReason: null,
        amountPaid: null,
        quantity: itemData.quantity,
        priceId: itemData.priceId,
        status: object.status || null,
        metadata: {
          userId: object.metadata?.userId || null,
          jobId: null,
          planKey: itemData.planKey || object.metadata?.planKey || null,
          creditPack: null,
        },
      },
    };
  }

  if (event.type === 'invoice.payment_failed' || event.type === 'invoice.paid') {
    return {
      id: event.id,
      type: event.type,
      createdAt,
      data: {
        sessionId: null,
        targetType: 'PLAN',
        amount: object.amount_due || object.amount_remaining || object.amount_paid || null,
        currency: object.currency || 'usd',
        subscriptionId: object.subscription || null,
        customerId: object.customer || null,
        currentPeriodEnd: object.lines?.data?.[0]?.period?.end || null,
        billingReason: object.billing_reason || null,
        amountPaid: object.amount_paid || null,
        quantity: itemData.quantity,
        priceId: itemData.priceId,
        status: event.type === 'invoice.payment_failed' ? 'past_due' : 'active',
        metadata: {
          userId: object.metadata?.userId || null,
          jobId: null,
          planKey: itemData.planKey || object.parent?.subscription_details?.metadata?.planKey || null,
          creditPack: null,
        },
      },
    };
  }

  return {
    id: event.id,
    type: event.type,
    createdAt,
    data: {
      sessionId: object.id || null,
      targetType: metadata.targetType || null,
      amount: object.amount_total || null,
      currency: object.currency || null,
      subscriptionId: object.subscription || null,
      customerId: object.customer || null,
      currentPeriodEnd: object.current_period_end || null,
      billingReason: null,
      amountPaid: object.amount_paid || null,
      quantity: itemData.quantity,
      priceId: itemData.priceId,
      status: object.status || null,
      metadata: {
        userId: metadata.userId || null,
        jobId: metadata.jobId || null,
        planKey: metadata.planKey || itemData.planKey || null,
        creditPack: metadata.creditPack || null,
      },
    },
  };
}

function verifyWebhookRequest(req) {
  const provider = getPaymentProvider();

  if (provider === STRIPE_PROVIDER_NAME) {
    const stripe = getStripeClient();
    const endpointSecret = getStripeWebhookSecret();
    const signature = req.get('stripe-signature') || '';
    if (!stripe || !endpointSecret || !req.rawBody) {
      throw new Error('Stripe webhook is not fully configured.');
    }
    const event = stripe.webhooks.constructEvent(req.rawBody, signature, endpointSecret);
    return {
      provider,
      event: normalizeStripeEvent(event),
    };
  }

  const payload = JSON.stringify(req.body || {});
  const signature = req.get('x-mockpay-signature') || '';
  if (!verifyMockSignature(payload, signature)) {
    throw new Error('Invalid mockpay webhook signature.');
  }
  return {
    provider,
    event: req.body,
  };
}

module.exports = {
  MOCK_PROVIDER_NAME,
  STRIPE_PROVIDER_NAME,
  buildWebhookEvent,
  createBillingPortalSession,
  createCheckoutSession,
  getPaymentProvider,
  getPlanKeyFromStripePriceId,
  getStripeClient,
  getStripePlanPriceId,
  getStripeWebhookSecret,
  signPayload,
  verifyMockSignature,
  verifyWebhookRequest,
};
