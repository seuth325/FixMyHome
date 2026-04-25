function registerAdminCoreRoutes(app, deps) {
  const {
    baseViewModel,
    buildAdminJobTimeline,
    buildSupportCaseViewQuery,
    currentUser,
    createJobCategory,
    moveJobCategory,
    notifyAdmins,
    renameJobCategory,
    setJobCategoryActiveState,
    setPaymentOptionEnabled,
    enrichAdminJob,
    formatCurrency,
    getStatusTone,
    getUserDeletionEligibility,
    loadAdminData,
    parseAdminBillingFilters,
    prisma,
    requireAdmin,
    requireAuth,
    setFlash,
    wrap,
  } = deps;

  app.get('/admin', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const filters = parseAdminBillingFilters(req.query);
    if (!filters.hasFilters) {
      const defaultView = await prisma.savedSupportCaseView.findFirst({
        where: {
          isDefaultLanding: true,
          OR: [
            { userId: user.id },
            { scope: 'SHARED' },
          ],
        },
        orderBy: [
          { userId: 'desc' },
          { scope: 'desc' },
          { updatedAt: 'desc' },
        ],
      });
      if (defaultView) {
        return res.redirect(buildSupportCaseViewQuery(defaultView));
      }
    }

    const filtersWithDefault = filters;
    const data = await loadAdminData(user, filtersWithDefault);
    return res.render('admin', {
      ...baseViewModel(req, user),
      ...data,
    });
  }));

  app.get('/admin/jobs/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        homeowner: true,
        photos: { orderBy: { sortOrder: 'asc' } },
        acceptedBid: {
          include: {
            handyman: {
              include: { handymanProfile: true },
            },
          },
        },
        bids: {
          include: {
            handyman: {
              include: { handymanProfile: true },
            },
            messages: {
              include: { sender: true },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: [
            { status: 'asc' },
            { amount: 'asc' },
            { createdAt: 'asc' },
          ],
        },
        payment: true,
        dispute: {
          include: {
            openedBy: true,
            assignedAdmin: true,
          },
        },
        review: true,
        reports: {
          include: {
            filedBy: true,
            assignedAdmin: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!job) {
      setFlash(req, 'Job not found.');
      return res.redirect('/admin');
    }

    const adminJob = enrichAdminJob(job);
    const jobTimeline = buildAdminJobTimeline(job);

    return res.render('admin-job', {
      ...baseViewModel(req, user),
      adminJob,
      jobTimeline,
    });
  }));

  app.get('/admin/users/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const account = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        handymanProfile: true,
        homeownerJobs: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: {
            payment: true,
            dispute: true,
            review: true,
            photos: {
              orderBy: { sortOrder: 'asc' },
              take: 1,
            },
            bids: {
              include: {
                handyman: {
                  include: {
                    handymanProfile: true,
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        bids: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            job: {
              include: {
                homeowner: true,
                payment: true,
                dispute: true,
                review: true,
              },
            },
            messages: {
              include: { sender: true },
              orderBy: { createdAt: 'desc' },
              take: 3,
            },
          },
        },
        reviewsReceived: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: {
            reviewer: true,
            job: true,
          },
        },
        reportsFiled: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: {
            reportedUser: true,
            job: true,
            dispute: true,
            assignedAdmin: true,
          },
        },
        reportsAgainst: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: {
            filedBy: true,
            job: true,
            dispute: true,
            assignedAdmin: true,
          },
        },
        disputesOpened: {
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: {
            job: {
              include: {
                payment: true,
                homeowner: true,
                acceptedBid: {
                  include: {
                    handyman: true,
                  },
                },
              },
            },
            assignedAdmin: true,
          },
        },
        notifications: {
          orderBy: { createdAt: 'desc' },
          take: 8,
        },
      },
    });

    if (!account) {
      setFlash(req, 'User not found.');
      return res.redirect('/admin');
    }

    const deletionState = await getUserDeletionEligibility(account);

    const homeownerJobs = account.homeownerJobs.map((job) => {
      const acceptedBid = job.bids.find((bid) => bid.id === job.acceptedBidId) || null;
      return {
        ...job,
        acceptedBid,
      };
    });

    const homeownerMetrics = {
      totalJobs: homeownerJobs.length,
      fundedJobs: homeownerJobs.filter((job) => Boolean(job.payment && ['FUNDED', 'RELEASED', 'DISPUTED'].includes(job.payment.status))).length,
      completedJobs: homeownerJobs.filter((job) => job.status === 'COMPLETED').length,
      openJobs: homeownerJobs.filter((job) => ['OPEN', 'IN_REVIEW', 'AWARDED'].includes(job.status)).length,
    };

    const handymanMetrics = {
      totalBids: account.bids.length,
      acceptedBids: account.bids.filter((bid) => bid.status === 'ACCEPTED').length,
      pendingBids: account.bids.filter((bid) => ['PENDING', 'SHORTLISTED'].includes(bid.status)).length,
      completedJobs: account.bids.filter((bid) => bid.job?.status === 'COMPLETED').length,
    };

    const recentActivity = [
      ...account.notifications.map((notification) => ({
        id: `notification-${notification.id}`,
        label: notification.title,
        detail: notification.body,
        tone: notification.isRead ? 'muted' : 'review',
        at: notification.createdAt,
      })),
      ...homeownerJobs.map((job) => ({
        id: `job-${job.id}`,
        label: `Job posted: ${job.title}`,
        detail: `${job.category} in ${job.location} - ${job.status.replaceAll('_', ' ')}`,
        tone: getStatusTone(job.status),
        at: job.updatedAt,
      })),
      ...account.bids.map((bid) => ({
        id: `bid-${bid.id}`,
        label: `Bid on ${bid.job?.title || 'job'}`,
        detail: `${formatCurrency(bid.amount)} - ${bid.status.replaceAll('_', ' ')}`,
        tone: getStatusTone(bid.status),
        at: bid.updatedAt,
      })),
      ...account.reportsAgainst.map((report) => ({
        id: `report-${report.id}`,
        label: `Reported for ${report.reason}`,
        detail: `Status ${report.status.replaceAll('_', ' ')}${report.job ? ` on ${report.job.title}` : ''}`,
        tone: report.status === 'OPEN' ? 'review' : 'muted',
        at: report.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 12);

    return res.render('admin-user', {
      ...baseViewModel(req, user),
      adminAccount: account,
      deletionState,
      homeownerJobs,
      homeownerMetrics,
      handymanMetrics,
      recentActivity,
    });
  }));
  app.post('/admin/categories', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const name = String(req.body.name || '').trim();
    if (!name) {
      setFlash(req, 'Category name is required.');
      return res.redirect('/admin');
    }

    const result = await createJobCategory(name);
    setFlash(req, result.message);
    return res.redirect('/admin');
  }));

  app.post('/admin/categories/:id/rename', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const categoryId = Number.parseInt(String(req.params.id || ''), 10);
    const name = String(req.body.name || '').trim();
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      setFlash(req, 'Category could not be updated.');
      return res.redirect('/admin');
    }
    if (!name) {
      setFlash(req, 'Updated category name is required.');
      return res.redirect('/admin');
    }

    const result = await renameJobCategory(categoryId, name);
    setFlash(req, result.message);
    return res.redirect('/admin');
  }));

  app.post('/admin/categories/:id/toggle', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const categoryId = Number.parseInt(String(req.params.id || ''), 10);
    const nextState = String(req.body.nextState || '').trim().toLowerCase();
    if (!Number.isFinite(categoryId) || categoryId <= 0 || !['activate', 'deactivate'].includes(nextState)) {
      setFlash(req, 'Category status could not be changed.');
      return res.redirect('/admin');
    }

    const result = await setJobCategoryActiveState(categoryId, nextState === 'activate');
    setFlash(req, result.message);
    return res.redirect('/admin');
  }));

  app.post('/admin/categories/:id/move', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const categoryId = Number.parseInt(String(req.params.id || ''), 10);
    const direction = String(req.body.direction || '').trim().toLowerCase();
    if (!Number.isFinite(categoryId) || categoryId <= 0 || !['up', 'down'].includes(direction)) {
      setFlash(req, 'Category order could not be changed.');
      return res.redirect('/admin');
    }

    const result = await moveJobCategory(categoryId, direction);
    setFlash(req, result.message);
    return res.redirect('/admin');
  }));

  app.post('/admin/payment-options/:key/toggle', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const optionKey = String(req.params.key || '').trim().toUpperCase();
    const nextState = String(req.body.nextState || '').trim().toLowerCase();
    if (!optionKey || !['enable', 'disable'].includes(nextState)) {
      setFlash(req, 'Payment option status could not be changed.');
      return res.redirect('/admin');
    }

    const result = await setPaymentOptionEnabled(optionKey, nextState === 'enable');
    if (result.ok) {
      const adminName = user.name || user.email || 'Admin user';
      const optionLabel = result.option?.label || optionKey;
      const stateLabel = result.isEnabled ? 'enabled' : 'disabled';
      await notifyAdmins(
        'ACCOUNT_STATUS',
        'Payment option updated',
        `${adminName} ${stateLabel} ${optionLabel}.`,
        '/admin'
      );
    }
    setFlash(req, result.message);
    return res.redirect('/admin');
  }));
}

module.exports = {
  registerAdminCoreRoutes,
};
