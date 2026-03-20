function registerMarketplaceRoutes(app, deps) {
  const {
    completeMockCheckout,
    createCheckoutSession,
    createNotification,
    createRateLimitMiddleware,
    currentUser,
    logLeadCreditTransaction,
    notifyAdmins,
    parsePositiveInt,
    prisma,
    requireAuth,
    setFlash,
    STRIPE_PROVIDER_NAME,
    wrap,
  } = deps;

  app.post('/jobs/:id/bids', requireAuth, createRateLimitMiddleware({
    action: 'bidSubmit',
    getIdentifier: (req) => [req.session?.userId || 'bidder', req.params.id].join(':'),
    onLimit: (req, res) => {
      setFlash(req, 'Too many bid attempts too quickly. Please wait a few minutes and try again.');
      return res.redirect('/dashboard');
    },
  }), wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.role !== 'HANDYMAN') {
      setFlash(req, 'Only handymen can submit bids.');
      return res.redirect('/dashboard');
    }

    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job || !['OPEN', 'IN_REVIEW'].includes(job.status)) {
      setFlash(req, 'This job is not accepting bids right now.');
      return res.redirect('/dashboard');
    }

    const amount = parsePositiveInt(req.body.amount);
    const etaDays = parsePositiveInt(req.body.etaDays);
    const message = String(req.body.message || '').trim();
    const profile = await prisma.handymanProfile.findUnique({ where: { userId: user.id } });

    if (!profile) {
      setFlash(req, 'Create your handyman profile before bidding.');
      return res.redirect('/dashboard');
    }

    if (!amount || !etaDays || !message) {
      setFlash(req, 'Amount, ETA, and message are required to submit a bid.');
      return res.redirect('/dashboard');
    }

    const existingBid = await prisma.bid.findUnique({
      where: {
        jobId_handymanId: {
          jobId: job.id,
          handymanId: user.id,
        },
      },
    });

    if (!existingBid && profile.subscriptionPlan !== 'PRO' && profile.leadCredits <= 0) {
      setFlash(req, 'You are out of lead credits. Buy a pack or upgrade your plan to keep bidding.');
      return res.redirect('/dashboard');
    }

    const homeowner = await prisma.user.findUnique({
      where: { id: job.homeownerId },
      select: { id: true },
    });

    await prisma.bid.upsert({
      where: {
        jobId_handymanId: {
          jobId: job.id,
          handymanId: user.id,
        },
      },
      create: {
        jobId: job.id,
        handymanId: user.id,
        amount,
        etaDays,
        message,
      },
      update: {
        amount,
        etaDays,
        message,
        status: 'PENDING',
        shortlisted: false,
      },
    });

    if (!existingBid && profile.subscriptionPlan !== 'PRO') {
      const updatedProfile = await prisma.handymanProfile.update({
        where: { userId: user.id },
        data: { leadCredits: { decrement: 1 } },
      });
      await logLeadCreditTransaction(updatedProfile.id, -1, 'BID_UNLOCK', 'Unlocked bidding for job: ' + job.title);
    }

    if (!existingBid && homeowner) {
      await createNotification(
        homeowner.id,
        'NEW_BID',
        'New bid received',
        user.name + ' submitted a bid on ' + job.title + '.',
        '/dashboard'
      );
    }

    const bidCount = await prisma.bid.count({ where: { jobId: job.id } });
    if (job.status === 'OPEN' && bidCount > 0) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'IN_REVIEW' } });
    }

    const bidFlash = existingBid
      ? 'Bid updated. You can keep refining it until the homeowner awards the job.'
      : profile.subscriptionPlan === 'PRO'
        ? 'Bid saved on your Pro plan.'
        : 'Bid saved and 1 lead credit was used.';

    setFlash(req, bidFlash);
    return res.redirect('/dashboard');
  }));

  app.post('/bids/:id/shortlist', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const bid = await prisma.bid.findUnique({
      where: { id: req.params.id },
      include: { job: true },
    });

    if (!user || !bid || bid.job.homeownerId !== user.id) {
      setFlash(req, 'Bid not found.');
      return res.redirect('/dashboard');
    }

    await prisma.bid.update({
      where: { id: bid.id },
      data: { shortlisted: true, status: 'SHORTLISTED' },
    });

    if (bid.job.status === 'OPEN') {
      await prisma.job.update({ where: { id: bid.jobId }, data: { status: 'IN_REVIEW' } });
    }

    setFlash(req, 'Bid shortlisted.');
    return res.redirect('/dashboard');
  }));

  app.post('/bids/:id/accept', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const bid = await prisma.bid.findUnique({
      where: { id: req.params.id },
      include: { job: { include: { bids: true, payment: true, homeowner: true } } },
    });

    if (!user || !bid || bid.job.homeownerId !== user.id) {
      setFlash(req, 'Bid not found.');
      return res.redirect('/dashboard');
    }

    if (['AWARDED', 'COMPLETED'].includes(bid.job.status)) {
      setFlash(req, 'This job has already been awarded.');
      return res.redirect('/dashboard');
    }

    const declinedBidderIds = bid.job.bids
      .filter((candidate) => candidate.id !== bid.id)
      .map((candidate) => candidate.handymanId);

    await prisma.$transaction([
      prisma.bid.updateMany({
        where: { jobId: bid.jobId, NOT: { id: bid.id } },
        data: { status: 'DECLINED', shortlisted: false },
      }),
      prisma.bid.update({
        where: { id: bid.id },
        data: { status: 'ACCEPTED', shortlisted: true },
      }),
      prisma.job.update({
        where: { id: bid.jobId },
        data: {
          status: 'AWARDED',
          acceptedBidId: bid.id,
          awardedAt: new Date(),
        },
      }),
      prisma.payment.upsert({
        where: { jobId: bid.jobId },
        create: {
          jobId: bid.jobId,
          amount: bid.amount,
          status: 'PENDING_FUNDING',
        },
        update: {
          amount: bid.amount,
          status: 'PENDING_FUNDING',
          fundedAt: null,
          releasedAt: null,
        },
      }),
    ]);

    await createNotification(
      bid.handymanId,
      'BID_AWARDED',
      'Your bid was accepted',
      'You were awarded ' + bid.job.title + '. Escrow is ready for funding.',
      '/dashboard'
    );
    if (declinedBidderIds.length > 0) {
      await prisma.userNotification.createMany({
        data: declinedBidderIds.map((handymanId) => ({
          userId: handymanId,
          type: 'BID_DECLINED',
          title: 'Another handyman was chosen',
          body: 'The homeowner awarded a different bid for ' + bid.job.title + '.',
          href: '/dashboard',
        })),
      });
    }

    setFlash(req, 'Bid accepted and escrow is ready to fund.');
    return res.redirect('/dashboard');
  }));

  app.post('/bids/:id/messages', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) {
      req.session.userId = null;
      return res.redirect('/login');
    }

    const bid = await prisma.bid.findUnique({
      where: { id: req.params.id },
      include: { job: true },
    });
    if (!bid) {
      setFlash(req, 'Conversation not found.');
      return res.redirect('/dashboard');
    }

    const allowed = bid.job.homeownerId === user.id || bid.handymanId === user.id;
    if (!allowed) {
      setFlash(req, 'You do not have access to that conversation.');
      return res.redirect('/dashboard');
    }

    const body = String(req.body.body || '').trim();
    const recipientId = bid.job.homeownerId === user.id ? bid.handymanId : bid.job.homeownerId;
    if (!body) {
      setFlash(req, 'Message cannot be empty.');
      return res.redirect('/dashboard');
    }

    await prisma.message.create({
      data: {
        jobId: bid.jobId,
        bidId: bid.id,
        senderId: user.id,
        body,
      },
    });

    await createNotification(
      recipientId,
      'NEW_MESSAGE',
      'New message on ' + bid.job.title,
      user.name + ' sent you a message.',
      '/dashboard'
    );

    setFlash(req, 'Message sent.');
    return res.redirect('/dashboard');
  }));

  app.post('/jobs/:id/disputes', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { acceptedBid: true, payment: true, dispute: true },
    });

    if (!user || !job) {
      setFlash(req, 'Job not found.');
      return res.redirect('/dashboard');
    }

    const allowed = job.homeownerId === user.id || job.acceptedBid?.handymanId === user.id;
    if (!allowed) {
      setFlash(req, 'You do not have access to that dispute.');
      return res.redirect('/dashboard');
    }

    if (!job.payment || !['FUNDED', 'DISPUTED'].includes(job.payment.status)) {
      setFlash(req, 'Disputes are only available while funds are being held.');
      return res.redirect('/dashboard');
    }

    if (job.dispute && job.dispute.status === 'OPEN') {
      setFlash(req, 'A dispute is already open for this job.');
      return res.redirect('/dashboard');
    }

    const reason = String(req.body.reason || '').trim();
    const details = String(req.body.details || '').trim();
    if (!reason || !details) {
      setFlash(req, 'Add a reason and details for the dispute.');
      return res.redirect('/dashboard');
    }

    await prisma.$transaction([
      prisma.dispute.upsert({
        where: { jobId: job.id },
        create: {
          jobId: job.id,
          openedByUserId: user.id,
          reason,
          details,
          status: 'OPEN',
        },
        update: {
          openedByUserId: user.id,
          reason,
          details,
          status: 'OPEN',
          resolution: null,
          resolutionNotes: null,
          resolvedAt: null,
        },
      }),
      prisma.payment.update({
        where: { jobId: job.id },
        data: { status: 'DISPUTED' },
      }),
    ]);

    const counterpartyId = job.homeownerId === user.id ? job.acceptedBid?.handymanId : job.homeownerId;
    if (counterpartyId) {
      await createNotification(
        counterpartyId,
        'DISPUTE_OPENED',
        'A dispute was opened',
        user.name + ' opened a dispute on ' + job.title + '.',
        '/dashboard'
      );
    }
    await notifyAdmins('DISPUTE_OPENED', 'New dispute needs review', 'A dispute was opened on ' + job.title + '.', '/admin');

    setFlash(req, 'Dispute opened. Payment is now on hold.');
    return res.redirect('/dashboard');
  }));

  app.post('/disputes/:id/resolve', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.id },
      include: { job: { include: { payment: true, acceptedBid: true } } },
    });

    if (!user || !dispute || dispute.job.homeownerId !== user.id) {
      setFlash(req, 'Dispute not found.');
      return res.redirect('/dashboard');
    }

    if (dispute.status !== 'OPEN' || !dispute.job.payment) {
      setFlash(req, 'This dispute is already resolved.');
      return res.redirect('/dashboard');
    }

    const resolution = String(req.body.resolution || '').trim();
    const resolutionNotes = String(req.body.resolutionNotes || '').trim();
    if (!['RELEASE_PAYMENT', 'REFUND_HOMEOWNER'].includes(resolution) || !resolutionNotes) {
      setFlash(req, 'Choose a resolution and add a note.');
      return res.redirect('/dashboard');
    }

    await prisma.$transaction([
      prisma.dispute.update({
        where: { id: dispute.id },
        data: {
          status: 'RESOLVED',
          resolution,
          resolutionNotes,
          resolvedAt: new Date(),
        },
      }),
      prisma.payment.update({
        where: { jobId: dispute.jobId },
        data: resolution === 'RELEASE_PAYMENT'
          ? {
              status: 'RELEASED',
              releasedAt: new Date(),
            }
          : {
              status: 'REFUNDED',
            },
      }),
    ]);

    const resolutionBody = resolution === 'RELEASE_PAYMENT'
      ? 'The dispute on ' + dispute.job.title + ' was resolved and payment was released.'
      : 'The dispute on ' + dispute.job.title + ' was resolved and escrow was refunded.';
    await prisma.userNotification.createMany({
      data: [dispute.job.homeownerId, dispute.job.acceptedBid.handymanId].map((userId) => ({
        userId,
        type: 'DISPUTE_RESOLVED',
        title: 'Dispute resolved',
        body: resolutionBody,
        href: '/dashboard',
      })),
    });

    setFlash(req, resolution === 'RELEASE_PAYMENT'
      ? 'Dispute resolved and payment released.'
      : 'Dispute resolved and escrow refunded.');
    return res.redirect('/dashboard');
  }));

  app.post('/jobs/:id/reviews', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { acceptedBid: true, review: true, payment: true, dispute: true },
    });

    if (!user || !job || job.homeownerId !== user.id) {
      setFlash(req, 'Job not found.');
      return res.redirect('/dashboard');
    }

    if (job.status !== 'COMPLETED' || !job.acceptedBid || job.review || !job.payment || job.payment.status !== 'RELEASED') {
      setFlash(req, 'Review is not available for this job.');
      return res.redirect('/dashboard');
    }

    const stars = parsePositiveInt(req.body.stars);
    const text = String(req.body.text || '').trim();
    if (!stars || stars > 5 || !text) {
      setFlash(req, 'Provide a 1-5 star rating and a short review.');
      return res.redirect('/dashboard');
    }

    await prisma.review.create({
      data: {
        jobId: job.id,
        reviewerId: user.id,
        handymanId: job.acceptedBid.handymanId,
        stars,
        text,
      },
    });

    const reviews = await prisma.review.findMany({
      where: { handymanId: job.acceptedBid.handymanId },
      select: { stars: true },
    });
    const ratingCount = reviews.length;
    const ratingAvg = ratingCount === 0
      ? 0
      : reviews.reduce((sum, review) => sum + review.stars, 0) / ratingCount;

    await prisma.handymanProfile.update({
      where: { userId: job.acceptedBid.handymanId },
      data: { ratingAvg, ratingCount },
    });

    setFlash(req, 'Review submitted.');
    return res.redirect('/dashboard');
  }));

  app.post('/jobs/:id/payment/fund', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { acceptedBid: true, payment: true, dispute: true },
    });

    if (!user || !job || job.homeownerId !== user.id) {
      setFlash(req, 'Job not found.');
      return res.redirect('/dashboard');
    }

    if (job.status !== 'AWARDED' || !job.acceptedBid || !job.payment) {
      setFlash(req, 'Escrow is not available for this job yet.');
      return res.redirect('/dashboard');
    }

    if (job.dispute && job.dispute.status === 'OPEN') {
      setFlash(req, 'Resolve the open dispute before funding escrow again.');
      return res.redirect('/dashboard');
    }

    if (job.payment.status !== 'PENDING_FUNDING') {
      setFlash(req, 'Escrow has already been funded.');
      return res.redirect('/dashboard');
    }

    const session = await createCheckoutSession({
      prisma,
      req,
      userId: user.id,
      jobId: job.id,
      targetType: 'ESCROW_FUNDING',
      amount: job.payment.amount,
    });

    if (session.provider === STRIPE_PROVIDER_NAME && session.checkoutUrl) {
      return res.redirect(session.checkoutUrl);
    }

    await completeMockCheckout(session);

    setFlash(req, 'Escrow funded through provider checkout. Your handyman can now begin the work.');
    return res.redirect('/dashboard');
  }));

  app.post('/jobs/:id/payment/release', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { acceptedBid: true, payment: true, dispute: true },
    });

    if (!user || !job || job.homeownerId !== user.id) {
      setFlash(req, 'Job not found.');
      return res.redirect('/dashboard');
    }

    if (job.status !== 'COMPLETED' || !job.payment) {
      setFlash(req, 'Payment release is not available yet.');
      return res.redirect('/dashboard');
    }

    if (job.dispute && job.dispute.status === 'OPEN') {
      setFlash(req, 'Resolve the open dispute before releasing payment.');
      return res.redirect('/dashboard');
    }

    if (job.payment.status !== 'FUNDED') {
      setFlash(req, 'This payment is not ready to release.');
      return res.redirect('/dashboard');
    }

    await prisma.payment.update({
      where: { jobId: job.id },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
      },
    });

    setFlash(req, 'Payment released to the handyman. You can now leave a review.');
    return res.redirect('/dashboard');
  }));
}

module.exports = {
  registerMarketplaceRoutes,
};
