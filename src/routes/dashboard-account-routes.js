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

    return res.render('dashboard', {
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
