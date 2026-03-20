function registerSavedViewsRoutes(app, deps) {
  const {
    buildSavedSearchQuery,
    buildSupportCaseViewQuery,
    currentUser,
    parseAdminBillingFilters,
    parseHandymanFilters,
    prisma,
    requireAdmin,
    requireAuth,
    setFlash,
    wrap,
  } = deps;

  app.post('/saved-searches', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.role !== 'HANDYMAN') {
      setFlash(req, 'Only handymen can save job searches.');
      return res.redirect('/dashboard');
    }

    const filters = parseHandymanFilters(req.body);
    const name = String(req.body.name || '').trim();
    if (!name) {
      setFlash(req, 'Add a name for this saved search.');
      return res.redirect('/dashboard');
    }

    await prisma.savedSearch.create({
      data: {
        userId: user.id,
        name,
        search: filters.search || null,
        category: filters.category || null,
        minBudget: filters.minBudget,
        maxBudget: filters.maxBudget,
        sort: filters.sort,
        photosOnly: filters.photosOnly,
        nearMeOnly: filters.nearMeOnly,
      },
    });

    setFlash(req, 'Saved search created.');
    return res.redirect(buildSavedSearchQuery({
      search: filters.search,
      category: filters.category,
      minBudget: filters.minBudget,
      maxBudget: filters.maxBudget,
      sort: filters.sort,
      photosOnly: filters.photosOnly,
      nearMeOnly: filters.nearMeOnly,
    }));
  }));

  app.post('/saved-searches/:id/delete', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const savedSearch = await prisma.savedSearch.findUnique({ where: { id: req.params.id } });
    if (!user || !savedSearch || savedSearch.userId !== user.id || user.role !== 'HANDYMAN') {
      setFlash(req, 'Saved search not found.');
      return res.redirect('/dashboard');
    }

    await prisma.savedSearch.delete({ where: { id: savedSearch.id } });
    setFlash(req, 'Saved search removed.');
    return res.redirect('/dashboard');
  }));

  app.post('/admin/support-case-views', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.role !== 'ADMIN') {
      setFlash(req, 'Only admins can save support case views.');
      return res.redirect('/dashboard');
    }

    const filters = parseAdminBillingFilters(req.body);
    const name = String(req.body.name || '').trim();
    if (!name) {
      setFlash(req, 'Add a name for this saved support case view.');
      return res.redirect('/admin');
    }

    const scope = String(req.body.scope || 'PERSONAL').trim().toUpperCase();
    const isPinned = String(req.body.isPinned || '') === '1';
    const autoApplyOnCreate = String(req.body.autoApplyOnCreate || '') === '1';
    const autoAssignAdminUserId = String(req.body.autoAssignAdminUserId || '').trim() || null;
    if (!['PERSONAL', 'SHARED'].includes(scope)) {
      setFlash(req, 'Choose a valid support case view scope.');
      return res.redirect('/admin');
    }

    if (autoAssignAdminUserId) {
      const adminUser = await prisma.user.findUnique({ where: { id: autoAssignAdminUserId } });
      if (!adminUser || adminUser.role !== 'ADMIN') {
        setFlash(req, 'Choose a valid routing owner for this support case view.');
        return res.redirect('/admin');
      }
    }

    await prisma.savedSupportCaseView.create({
      data: {
        userId: user.id,
        name,
        scope,
        isPinned,
        isDefaultLanding: false,
        autoApplyOnCreate,
        autoAssignAdminUserId,
        supportCaseSearch: filters.supportCaseSearch || null,
        supportCaseStatus: filters.supportCaseStatus || null,
        supportCaseOwner: filters.supportCaseOwner || null,
        supportCaseQueue: filters.supportCaseQueue || null,
      },
    });

    setFlash(req, 'Saved support case view created.');
    return res.redirect(buildSupportCaseViewQuery({
      supportCaseSearch: filters.supportCaseSearch,
      supportCaseStatus: filters.supportCaseStatus,
      supportCaseOwner: filters.supportCaseOwner,
      supportCaseQueue: filters.supportCaseQueue,
    }));
  }));

  app.post('/admin/support-case-views/:id/delete', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    const savedView = await prisma.savedSupportCaseView.findUnique({ where: { id: req.params.id } });
    if (!user || !savedView || savedView.userId !== user.id || user.role !== 'ADMIN') {
      setFlash(req, 'Saved support case view not found.');
      return res.redirect('/admin');
    }

    await prisma.savedSupportCaseView.delete({ where: { id: savedView.id } });
    setFlash(req, 'Saved support case view removed.');
    return res.redirect('/admin');
  }));

  app.post('/admin/support-case-views/:id/pin', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    const savedView = await prisma.savedSupportCaseView.findUnique({ where: { id: req.params.id } });
    if (!user || !savedView || user.role !== 'ADMIN') {
      setFlash(req, 'Saved support case view not found.');
      return res.redirect('/admin');
    }
    if (savedView.scope !== 'SHARED' && savedView.userId !== user.id) {
      setFlash(req, 'You can only pin your own personal views or shared team views.');
      return res.redirect('/admin');
    }

    const action = String(req.body.action || '').trim().toLowerCase();
    await prisma.savedSupportCaseView.update({
      where: { id: savedView.id },
      data: { isPinned: action === 'pin' },
    });
    setFlash(req, action === 'pin' ? 'Support case view pinned.' : 'Support case view unpinned.');
    return res.redirect('/admin');
  }));

  app.post('/admin/support-case-views/:id/default', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    const savedView = await prisma.savedSupportCaseView.findUnique({ where: { id: req.params.id } });
    if (!user || !savedView || user.role !== 'ADMIN') {
      setFlash(req, 'Saved support case view not found.');
      return res.redirect('/admin');
    }
    if (savedView.scope !== 'SHARED' && savedView.userId !== user.id) {
      setFlash(req, 'You can only set your own personal views or shared team views as the admin default.');
      return res.redirect('/admin');
    }

    const action = String(req.body.action || '').trim().toLowerCase();
    if (action === 'set') {
      if (savedView.scope === 'SHARED') {
        await prisma.savedSupportCaseView.updateMany({
          where: { scope: 'SHARED', isDefaultLanding: true },
          data: { isDefaultLanding: false },
        });
      } else {
        await prisma.savedSupportCaseView.updateMany({
          where: { userId: user.id, scope: 'PERSONAL', isDefaultLanding: true },
          data: { isDefaultLanding: false },
        });
      }
      await prisma.savedSupportCaseView.update({
        where: { id: savedView.id },
        data: { isDefaultLanding: true },
      });
      setFlash(req, 'Support case view set as the admin landing default.');
      return res.redirect('/admin');
    }

    await prisma.savedSupportCaseView.update({
      where: { id: savedView.id },
      data: { isDefaultLanding: false },
    });
    setFlash(req, 'Support case view removed as the admin landing default.');
    return res.redirect('/admin');
  }));
}

module.exports = {
  registerSavedViewsRoutes,
};
