function registerBillingUserRoutes(app, deps) {
  const {
    completeMockCheckout,
    CREDIT_PACKS,
    currentUser,
    formatSubscriptionPlan,
    getPaymentProvider,
    PLAN_CONFIG,
    PLAN_PRICING,
    prisma,
    requireAuth,
    setFlash,
    STRIPE_PROVIDER_NAME,
    createBillingPortalSession,
    createCheckoutSession,
    wrap,
  } = deps;

  app.post('/billing/plan', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.role !== 'HANDYMAN') {
      setFlash(req, 'Only handymen can manage plans.');
      return res.redirect('/dashboard');
    }

    const plan = String(req.body.plan || '').trim();
    if (!PLAN_CONFIG[plan]) {
      setFlash(req, 'Choose a valid plan.');
      return res.redirect('/dashboard');
    }

    const profile = await prisma.handymanProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      setFlash(req, 'Billing profile not found.');
      return res.redirect('/dashboard');
    }

    const provider = getPaymentProvider();
    if (plan === 'FREE') {
      if (provider === STRIPE_PROVIDER_NAME && profile.stripeSubscriptionId) {
        setFlash(req, 'Use Manage billing to cancel or downgrade your Stripe subscription safely.');
        return res.redirect('/dashboard');
      }

      await prisma.handymanProfile.update({
        where: { userId: user.id },
        data: {
          subscriptionPlan: 'FREE',
          subscriptionRenewsAt: null,
          billingStatus: 'INACTIVE',
          billingPeriodEndsAt: null,
          stripeSubscriptionId: null,
        },
      });
      setFlash(req, 'Free plan is now active on your account.');
      return res.redirect('/dashboard');
    }

    const session = await createCheckoutSession({
      prisma,
      req,
      userId: user.id,
      targetType: 'PLAN',
      planKey: plan,
      amount: PLAN_PRICING[plan] || 0,
    });

    if (session.provider === STRIPE_PROVIDER_NAME && session.checkoutUrl) {
      return res.redirect(session.checkoutUrl);
    }

    await completeMockCheckout(session);

    setFlash(req, formatSubscriptionPlan(plan) + ' plan activated via provider checkout.');
    return res.redirect('/dashboard');
  }));

  app.post('/billing/portal', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.role !== 'HANDYMAN') {
      setFlash(req, 'Only handymen can manage billing.');
      return res.redirect('/dashboard');
    }

    const profile = await prisma.handymanProfile.findUnique({ where: { userId: user.id } });
    if (!profile?.stripeCustomerId) {
      setFlash(req, 'Stripe billing is not active on this account yet.');
      return res.redirect('/dashboard');
    }

    if (getPaymentProvider() !== STRIPE_PROVIDER_NAME) {
      setFlash(req, 'Customer portal is only available in Stripe billing mode.');
      return res.redirect('/dashboard');
    }

    const portal = await createBillingPortalSession({
      customerId: profile.stripeCustomerId,
      returnUrl: `${req.protocol}://${req.get('host')}/dashboard`,
    });

    return res.redirect(portal.url);
  }));

  app.post('/billing/credits', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.role !== 'HANDYMAN') {
      setFlash(req, 'Only handymen can buy lead credits.');
      return res.redirect('/dashboard');
    }

    const packKey = String(req.body.pack || '').trim();
    const pack = CREDIT_PACKS[packKey];
    if (!pack) {
      setFlash(req, 'Choose a valid credit pack.');
      return res.redirect('/dashboard');
    }

    const session = await createCheckoutSession({
      prisma,
      req,
      userId: user.id,
      targetType: 'CREDIT_PACK',
      creditPack: packKey,
      amount: pack.amount,
    });

    if (session.provider === STRIPE_PROVIDER_NAME && session.checkoutUrl) {
      return res.redirect(session.checkoutUrl);
    }

    await completeMockCheckout(session);

    setFlash(req, pack.credits + ' lead credits added via provider checkout.');
    return res.redirect('/dashboard');
  }));
}

module.exports = {
  registerBillingUserRoutes,
};
