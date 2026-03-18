const Stripe = require('stripe');
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.WEBHOOK_PORT || '3112';
const baseUrl = `http://127.0.0.1:${port}`;
const stripe = new Stripe('sk_test_fixmyhome');
const stripeWebhookSecret = 'whsec_fixmyhome_test';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function logStep(message) { process.stdout.write(`\n[webhooks] ${message}\n`); }
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

async function postStripeWebhook(event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeWebhookSecret });
  return fetch(`${baseUrl}/webhooks/payments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    body: payload,
  });
}

async function main() {
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: port,
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_fixmyhome',
      STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
      STRIPE_PRICE_PLUS_MONTHLY: 'price_plus_monthly_test',
      STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly_test',
      APP_BASE_URL: baseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    logStep(`Starting app on port ${port}`);
    await waitForServer();

    const handyman = await prisma.user.findUnique({ where: { email: 'alex@example.com' }, include: { handymanProfile: true } });
    const homeowner = await prisma.user.findUnique({ where: { email: 'homeowner@example.com' } });
    const idSuffix = Date.now();
    const subscriptionId = `sub_test_plus_${idSuffix}`;
    const customerId = `cus_test_plus_${idSuffix}`;

    logStep('Completing a Stripe-style recurring plan checkout through the signed webhook endpoint');
    await prisma.handymanProfile.update({
      where: { userId: handyman.id },
      data: {
        subscriptionPlan: 'FREE',
        leadCredits: 0,
        subscriptionRenewsAt: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        billingStatus: 'INACTIVE',
        billingPeriodEndsAt: null,
        billingQuantity: 1,
      },
    });

    const planSession = await prisma.checkoutSession.create({
      data: {
        providerSessionId: `cs_test_plan_${idSuffix}`,
        userId: handyman.id,
        targetType: 'PLAN',
        planKey: 'PLUS',
        amount: 2900,
        currency: 'USD',
        provider: 'stripe',
        status: 'PENDING',
      },
    });

    const planEvent = {
      id: `evt_test_plan_${idSuffix}`,
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: planSession.providerSessionId,
          amount_total: 2900,
          currency: 'usd',
          customer: customerId,
          subscription: subscriptionId,
          status: 'complete',
          metadata: {
            userId: handyman.id,
            targetType: 'PLAN',
            planKey: 'PLUS',
            creditPack: '',
            jobId: '',
          },
        },
      },
    };

    const planResponse = await postStripeWebhook(planEvent);
    assert(planResponse.status === 200, `Expected webhook 200, received ${planResponse.status}`);
    const duplicatePlanResponse = await postStripeWebhook(planEvent);
    assert(duplicatePlanResponse.status === 200, `Expected duplicate webhook 200, received ${duplicatePlanResponse.status}`);

    let refreshedProfile = await prisma.handymanProfile.findUnique({ where: { userId: handyman.id } });
    assert(refreshedProfile.subscriptionPlan === 'PLUS', 'Expected signed plan webhook to activate Plus.');
    assert(refreshedProfile.leadCredits >= 12, 'Expected Plus webhook to apply included credits.');
    assert(refreshedProfile.billingStatus === 'ACTIVE', 'Expected recurring plan checkout to mark billing active.');
    assert(refreshedProfile.billingQuantity === 1, 'Expected initial plan checkout to set quantity 1.');
    assert(refreshedProfile.stripeCustomerId === customerId, 'Expected Stripe customer id to be stored after checkout completion.');
    assert(refreshedProfile.stripeSubscriptionId === subscriptionId, 'Expected Stripe subscription id to be stored after checkout completion.');

    logStep('Applying Stripe subscription lifecycle updates');
    const periodEndUnix = Math.floor(Date.now() / 1000) + (21 * 24 * 60 * 60);
    const subscriptionUpdatedEvent = {
      id: `evt_test_subscription_updated_${idSuffix}`,
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: subscriptionId,
          customer: customerId,
          status: 'active',
          current_period_end: periodEndUnix,
          metadata: {
            userId: handyman.id,
            planKey: 'PLUS',
          },
          items: {
            data: [
              {
                quantity: 1,
                price: { id: 'price_plus_monthly_test' },
              },
            ],
          },
        },
      },
    };
    const subscriptionUpdatedResponse = await postStripeWebhook(subscriptionUpdatedEvent);
    assert(subscriptionUpdatedResponse.status === 200, `Expected subscription update webhook 200, received ${subscriptionUpdatedResponse.status}`);

    refreshedProfile = await prisma.handymanProfile.findUnique({ where: { userId: handyman.id } });
    assert(refreshedProfile.billingStatus === 'ACTIVE', 'Expected active subscription update to keep billing active.');
    assert(refreshedProfile.billingPeriodEndsAt instanceof Date, 'Expected subscription update to set billing period end.');

    logStep('Applying a portal-style plan change and quantity sync from Stripe price id');
    const portalUpdateEvent = {
      id: `evt_test_subscription_portal_${idSuffix}`,
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: subscriptionId,
          customer: customerId,
          status: 'active',
          current_period_end: periodEndUnix,
          metadata: {
            userId: handyman.id,
          },
          items: {
            data: [
              {
                quantity: 2,
                price: { id: 'price_pro_monthly_test' },
              },
            ],
          },
        },
      },
    };
    const portalUpdateResponse = await postStripeWebhook(portalUpdateEvent);
    assert(portalUpdateResponse.status === 200, `Expected portal update webhook 200, received ${portalUpdateResponse.status}`);

    refreshedProfile = await prisma.handymanProfile.findUnique({ where: { userId: handyman.id } });
    assert(refreshedProfile.subscriptionPlan === 'PRO', 'Expected portal update to switch the plan from Stripe price id.');
    assert(refreshedProfile.billingQuantity === 2, 'Expected portal update to sync Stripe quantity.');

    logStep('Refreshing monthly credits from a Stripe invoice payment');
    await prisma.handymanProfile.update({
      where: { userId: handyman.id },
      data: {
        leadCredits: 2,
      },
    });
    const invoicePaidEvent = {
      id: `evt_test_invoice_paid_${idSuffix}`,
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `in_test_invoice_paid_${idSuffix}`,
          customer: customerId,
          subscription: subscriptionId,
          currency: 'usd',
          amount_paid: 7900,
          billing_reason: 'subscription_cycle',
          lines: {
            data: [
              {
                quantity: 2,
                price: { id: 'price_pro_monthly_test' },
                metadata: {
                  planKey: 'PRO',
                },
                period: {
                  end: periodEndUnix,
                },
              },
            ],
          },
        },
      },
    };
    const invoicePaidResponse = await postStripeWebhook(invoicePaidEvent);
    assert(invoicePaidResponse.status === 200, `Expected invoice paid webhook 200, received ${invoicePaidResponse.status}`);

    refreshedProfile = await prisma.handymanProfile.findUnique({ where: { userId: handyman.id } });
    assert(refreshedProfile.billingStatus === 'ACTIVE', 'Expected invoice payment success to keep billing active.');
    assert(refreshedProfile.subscriptionPlan === 'PRO', 'Expected invoice payment to preserve the portal-updated plan.');
    assert(refreshedProfile.billingQuantity === 2, 'Expected invoice payment to preserve the portal-updated quantity.');
    assert(refreshedProfile.leadCredits >= 2, 'Expected Pro invoice payment not to reduce existing credits.');
    const renewalGrant = await prisma.leadCreditTransaction.findFirst({
      where: {
        handymanProfileId: refreshedProfile.id,
        note: { contains: 'monthly credits refreshed' },
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(Boolean(renewalGrant), 'Expected invoice paid webhook to log a monthly credit refresh.');

    const paymentFailedEvent = {
      id: `evt_test_invoice_failed_${idSuffix}`,
      type: 'invoice.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `in_test_invoice_failed_${idSuffix}`,
          customer: customerId,
          subscription: subscriptionId,
          currency: 'usd',
          amount_due: 7900,
          lines: {
            data: [
              {
                quantity: 2,
                price: { id: 'price_pro_monthly_test' },
                metadata: {
                  planKey: 'PRO',
                },
              },
            ],
          },
          parent: {
            subscription_details: {
              metadata: {
                planKey: 'PRO',
              },
            },
          },
        },
      },
    };
    const paymentFailedResponse = await postStripeWebhook(paymentFailedEvent);
    assert(paymentFailedResponse.status === 200, `Expected payment failed webhook 200, received ${paymentFailedResponse.status}`);

    refreshedProfile = await prisma.handymanProfile.findUnique({ where: { userId: handyman.id } });
    assert(refreshedProfile.billingStatus === 'PAST_DUE', 'Expected invoice payment failure to mark billing past due.');
    assert(refreshedProfile.subscriptionPlan === 'PRO', 'Expected payment failure to keep the current plan selection.');
    assert(refreshedProfile.billingQuantity === 2, 'Expected payment failure to keep the current quantity.');

    const subscriptionDeletedEvent = {
      id: `evt_test_subscription_deleted_${idSuffix}`,
      type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: subscriptionId,
          customer: customerId,
          status: 'canceled',
          current_period_end: periodEndUnix,
          metadata: {
            userId: handyman.id,
          },
          items: {
            data: [
              {
                quantity: 2,
                price: { id: 'price_pro_monthly_test' },
              },
            ],
          },
        },
      },
    };
    const subscriptionDeletedResponse = await postStripeWebhook(subscriptionDeletedEvent);
    assert(subscriptionDeletedResponse.status === 200, `Expected subscription delete webhook 200, received ${subscriptionDeletedResponse.status}`);

    refreshedProfile = await prisma.handymanProfile.findUnique({ where: { userId: handyman.id } });
    assert(refreshedProfile.subscriptionPlan === 'FREE', 'Expected subscription deletion to move the handyman back to the Free plan.');
    assert(refreshedProfile.billingStatus === 'CANCELED', 'Expected subscription deletion to mark billing canceled.');
    assert(refreshedProfile.billingQuantity === 1, 'Expected canceled subscriptions to reset quantity to 1.');
    assert(refreshedProfile.stripeSubscriptionId === null, 'Expected canceled subscriptions to clear the stored Stripe subscription id.');

    logStep('Completing a Stripe-style escrow checkout through the signed webhook endpoint');
    const escrowSuffix = Date.now();
    const job = await prisma.job.create({
      data: {
        homeownerId: homeowner.id,
        title: `Webhook escrow ${escrowSuffix}`,
        category: 'Repairs',
        description: 'Webhook funding coverage.',
        location: 'Columbus, OH 43215',
        budget: 260,
        status: 'AWARDED',
      },
    });
    const bid = await prisma.bid.create({
      data: {
        jobId: job.id,
        handymanId: handyman.id,
        amount: 210,
        etaDays: 2,
        message: 'Webhook escrow bid.',
        status: 'ACCEPTED',
        shortlisted: true,
      },
    });
    await prisma.job.update({ where: { id: job.id }, data: { acceptedBidId: bid.id } });
    await prisma.payment.create({ data: { jobId: job.id, amount: 210, status: 'PENDING_FUNDING' } });
    const escrowSession = await prisma.checkoutSession.create({
      data: {
        providerSessionId: `cs_test_escrow_${escrowSuffix}`,
        userId: homeowner.id,
        jobId: job.id,
        targetType: 'ESCROW_FUNDING',
        amount: 210,
        currency: 'USD',
        provider: 'stripe',
        status: 'PENDING',
      },
    });
    const escrowEvent = {
      id: `evt_test_escrow_${escrowSuffix}`,
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: escrowSession.providerSessionId,
          amount_total: 210,
          currency: 'usd',
          metadata: {
            userId: homeowner.id,
            targetType: 'ESCROW_FUNDING',
            planKey: '',
            creditPack: '',
            jobId: job.id,
          },
        },
      },
    };
    const escrowResponse = await postStripeWebhook(escrowEvent);
    assert(escrowResponse.status === 200, `Expected escrow webhook 200, received ${escrowResponse.status}`);
    const duplicateEscrowResponse = await postStripeWebhook(escrowEvent);
    assert(duplicateEscrowResponse.status === 200, `Expected duplicate escrow webhook 200, received ${duplicateEscrowResponse.status}`);

    const fundedPayment = await prisma.payment.findUnique({ where: { jobId: job.id } });
    assert(fundedPayment.status === 'FUNDED', 'Expected signed escrow webhook to fund payment.');

    logStep('Invalid Stripe signature should be rejected');
    const badResponse = await fetch(`${baseUrl}/webhooks/payments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'bad-signature',
      },
      body: JSON.stringify(escrowEvent),
    });
    assert(badResponse.status === 401, `Expected invalid signature 401, received ${badResponse.status}`);

    logStep('Webhook test passed');
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();
    if (stderr.trim()) {
      process.stderr.write(`\n[webhooks] server stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[webhooks] FAILED: ${error.message}\n`);
  process.exit(1);
});
