function registerDashboardAccountRoutes(app, deps) {
  const {
    baseViewModel,
    currentUser,
    geocodeLocation,
    getUserDeletionEligibility,
    loadDashboardData,
    parseHandymanFilters,
    parsePositiveInt,
    prisma,
    requireAuth,
    setFlash,
    wrap,
  } = deps;

  const NOTIFICATION_FILTERS = [
    { key: 'ALL', label: 'All' },
    { key: 'PAYMENTS', label: 'Payments' },
    { key: 'MESSAGES', label: 'Messages' },
    { key: 'ADMIN', label: 'Admin' },
    { key: 'JOBS', label: 'Jobs' },
  ];

  const NOTIFICATION_FILTER_TYPES = {
    PAYMENTS: new Set(['ACCOUNT_STATUS', 'ESCROW_FUNDED']),
    MESSAGES: new Set(['NEW_MESSAGE']),
    ADMIN: new Set(['SUPPORT_CASE', 'VERIFICATION_REVIEWED']),
    JOBS: new Set(['NEW_BID', 'BID_AWARDED', 'BID_DECLINED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED']),
  };

  function normalizeNotificationFilter(value) {
    const key = String(value || '').trim().toUpperCase();
    return NOTIFICATION_FILTERS.some((filter) => filter.key === key) ? key : 'ALL';
  }

  function isNotificationInFilter(notification, filterKey) {
    if (filterKey === 'ALL') return true;
    const allowedTypes = NOTIFICATION_FILTER_TYPES[filterKey] || new Set();
    return allowedTypes.has(notification.type);
  }

  function buildNotificationFilterHrefs(query) {
    const hrefs = {};
    for (const filter of NOTIFICATION_FILTERS) {
      const params = new URLSearchParams(query || {});
      if (filter.key === 'ALL') {
        params.delete('notificationFilter');
      } else {
        params.set('notificationFilter', filter.key);
      }
      const queryString = params.toString();
      hrefs[filter.key] = queryString ? `/dashboard?${queryString}` : '/dashboard';
    }
    return hrefs;
  }

  app.get('/dashboard', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended) {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    if (user.role === 'ADMIN') {
      return res.redirect('/admin');
    }

    const filters = user.role === 'HANDYMAN' ? parseHandymanFilters(req.query) : undefined;
    const data = await loadDashboardData(user, filters);
    data.roleData.accountDeletion = await getUserDeletionEligibility(user);

    const allNotifications = user.notifications || [];
    const notificationFilter = normalizeNotificationFilter(req.query.notificationFilter);
    const notifications = allNotifications.filter((notification) => isNotificationInFilter(notification, notificationFilter));
    const notificationFilters = NOTIFICATION_FILTERS.map((filter) => ({
      ...filter,
      count: allNotifications.filter((notification) => isNotificationInFilter(notification, filter.key)).length,
      isActive: filter.key === notificationFilter,
    }));

    return res.render('dashboard', {
      ...baseViewModel(req, user),
      ...data,
      notifications,
      notificationFilter,
      notificationFilters,
      notificationFilterHrefs: buildNotificationFilterHrefs(req.query),
      filteredUnreadNotificationCount: notifications.filter((notification) => !notification.isRead).length,
    });
  }));

  app.get('/profile', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended) {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    if (user.role === 'ADMIN') {
      return res.redirect('/admin');
    }

    const filters = user.role === 'HANDYMAN' ? parseHandymanFilters({}) : undefined;
    const data = await loadDashboardData(user, filters);
    data.roleData.accountDeletion = await getUserDeletionEligibility(user);

    return res.render('profile', {
      ...baseViewModel(req, user),
      ...data,
    });
  }));
  app.post('/profile', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) {
      req.session.userId = null;
      return res.redirect('/login');
    }

    const name = String(req.body.name || '').trim();
    const location = String(req.body.location || '').trim();
    if (!name || !location) {
      setFlash(req, 'Name and location are required.');
      return res.redirect('/dashboard');
    }

    const locationGeocode = geocodeLocation(location);

    if (user.role === 'HOMEOWNER') {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          name,
          location,
          locationLat: locationGeocode?.latitude ?? null,
          locationLng: locationGeocode?.longitude ?? null,
        },
      });
      setFlash(req, 'Homeowner profile updated.');
      return res.redirect('/dashboard');
    }

    const skills = String(req.body.skills || '')
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean);
    const serviceRadius = parsePositiveInt(req.body.serviceRadius);
    const hourlyGuideline = req.body.hourlyGuideline ? parsePositiveInt(req.body.hourlyGuideline) : null;

    if (!serviceRadius) {
      setFlash(req, 'Service radius must be a positive number.');
      return res.redirect('/dashboard');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        name,
        location,
        locationLat: locationGeocode?.latitude ?? null,
        locationLng: locationGeocode?.longitude ?? null,
        handymanProfile: {
          upsert: {
            create: {
              businessName: String(req.body.businessName || '').trim() || null,
              skills,
              bio: String(req.body.bio || '').trim() || null,
              serviceRadius,
              hourlyGuideline,
              subscriptionPlan: user.handymanProfile?.subscriptionPlan || 'FREE',
              leadCredits: user.handymanProfile?.leadCredits ?? 3,
              subscriptionRenewsAt: user.handymanProfile?.subscriptionRenewsAt || null,
              insuranceVerified: user.handymanProfile?.insuranceVerified || false,
              insuranceStatus: user.handymanProfile?.insuranceStatus || 'NOT_SUBMITTED',
              insuranceProofDetails: user.handymanProfile?.insuranceProofDetails || null,
              insuranceSubmittedAt: user.handymanProfile?.insuranceSubmittedAt || null,
              insuranceAdminNotes: user.handymanProfile?.insuranceAdminNotes || null,
              licenseVerified: user.handymanProfile?.licenseVerified || false,
              licenseStatus: user.handymanProfile?.licenseStatus || 'NOT_SUBMITTED',
              licenseProofDetails: user.handymanProfile?.licenseProofDetails || null,
              licenseSubmittedAt: user.handymanProfile?.licenseSubmittedAt || null,
              licenseAdminNotes: user.handymanProfile?.licenseAdminNotes || null,
            },
            update: {
              businessName: String(req.body.businessName || '').trim() || null,
              skills,
              bio: String(req.body.bio || '').trim() || null,
              serviceRadius,
              hourlyGuideline,
            },
          },
        },
      },
    });

    setFlash(req, 'Handyman profile updated.');
    return res.redirect('/dashboard');
  }));

  app.post('/account/delete', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    if (user.role === 'ADMIN') {
      setFlash(req, 'Admin accounts cannot be deleted from the self-serve dashboard.');
      return res.redirect('/admin');
    }

    const confirmation = String(req.body.confirmation || '').trim().toUpperCase();
    if (confirmation !== 'DELETE') {
      setFlash(req, 'Type DELETE to confirm account deletion.');
      return res.redirect('/dashboard');
    }

    const deletionState = await getUserDeletionEligibility(user);
    if (!deletionState.allowed) {
      setFlash(req, deletionState.reason);
      return res.redirect('/dashboard');
    }

    await prisma.user.delete({ where: { id: user.id } });
    return req.session.destroy(() => res.redirect('/login?accountDeleted=1'));
  }));
}

module.exports = {
  registerDashboardAccountRoutes,
};

