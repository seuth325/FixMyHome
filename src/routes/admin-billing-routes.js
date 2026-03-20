function registerAdminBillingRoutes(app, deps) {
  const {
    applySupportCaseAutoRouting,
    baseViewModel,
    buildBillingPlaybookExportFilename,
    buildBillingPlaybookHistoryCreatedAtFilter,
    buildBillingPlaybookSummary,
    buildBillingPlaybookSummaryPayload,
    currentUser,
    decorateBillingEvent,
    loadCheckoutSessionsByIds,
    logSupportCaseActivity,
    normalizeBillingPlaybookHistoryFilters,
    notifySupportCaseAdmins,
    prisma,
    requireAdmin,
    requireAuth,
    setFlash,
    wrap,
  } = deps;

  app.get('/admin/billing-events/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const event = await prisma.paymentWebhookEvent.findUnique({
      where: { id: req.params.id },
      include: { assignedAdmin: true },
    });
    if (!event) {
      setFlash(req, 'Billing event not found.');
      return res.redirect('/admin');
    }

    const checkoutSessionMap = await loadCheckoutSessionsByIds(event.checkoutSessionId ? [event.checkoutSessionId] : []);
    const checkoutSession = event.checkoutSessionId ? checkoutSessionMap.get(event.checkoutSessionId) || null : null;
    const billingEvent = decorateBillingEvent(event, checkoutSession);

    const adminUsers = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { name: 'asc' },
    });

    return res.render('admin-billing-event', {
      ...baseViewModel(req, user),
      billingEvent,
      adminUsers,
    });
  }));

  app.get('/admin/billing-playbooks/:id/history', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const filters = normalizeBillingPlaybookHistoryFilters(req.query);
    const pageSize = 2;
    const historyWhere = {
      playbookId: req.params.id,
      action: filters.action || undefined,
      actorAdminUserId: filters.actorAdminUserId || undefined,
      createdAt: buildBillingPlaybookHistoryCreatedAtFilter(filters.dateRange),
    };

    const [playbook, playbookHistory, filteredHistoryCount, allPlaybookHistory, adminUsers] = await Promise.all([
      prisma.billingSupportPlaybook.findUnique({
        where: { id: req.params.id },
        include: {
          createdByAdmin: true,
          archivedByAdmin: true,
        },
      }),
      prisma.billingPlaybookHistory.findMany({
        where: historyWhere,
        include: { actorAdmin: true },
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.billingPlaybookHistory.count({ where: historyWhere }),
      prisma.billingPlaybookHistory.findMany({
        where: { playbookId: req.params.id },
        include: { actorAdmin: true },
        orderBy: { createdAt: 'desc' },
        take: 24,
      }),
      prisma.user.findMany({
        where: { role: 'ADMIN' },
        orderBy: { name: 'asc' },
      }),
    ]);

    if (!playbook && allPlaybookHistory.length === 0) {
      setFlash(req, 'Billing playbook history not found.');
      return res.redirect('/admin');
    }

    const latestHistory = allPlaybookHistory[0] || null;
    const pagination = {
      page: filters.page,
      pageSize,
      totalCount: filteredHistoryCount,
      totalPages: Math.max(1, Math.ceil(filteredHistoryCount / pageSize)),
      hasPreviousPage: filters.page > 1,
      hasNextPage: filters.page * pageSize < filteredHistoryCount,
    };
    const actorAdminName = filters.actorAdminUserId ? (adminUsers.find((adminUser) => adminUser.id === filters.actorAdminUserId)?.name || '') : '';
    const historyQueryString = 'action=' + encodeURIComponent(filters.action || '') + '&actorAdminUserId=' + encodeURIComponent(filters.actorAdminUserId || '') + '&dateRange=' + encodeURIComponent(filters.dateRange || 'ALL') + '&page=' + encodeURIComponent(String(filters.page));
    const playbookSummaryText = buildBillingPlaybookSummary({
      playbook,
      latestHistory,
      historyEntries: playbookHistory,
      filters,
      pagination,
      actorAdminName,
    });

    return res.render('admin-billing-playbook', {
      ...baseViewModel(req, user),
      playbook,
      playbookHistory,
      latestHistory,
      adminUsers,
      playbookHistoryFilters: filters,
      playbookHistoryPagination: pagination,
      playbookHistoryQueryString: historyQueryString,
      playbookSummaryText,
    });
  }));

  app.get('/admin/billing-playbooks/:id/history/summary', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const filters = normalizeBillingPlaybookHistoryFilters(req.query);
    const historyWhere = {
      playbookId: req.params.id,
      action: filters.action || undefined,
      actorAdminUserId: filters.actorAdminUserId || undefined,
      createdAt: buildBillingPlaybookHistoryCreatedAtFilter(filters.dateRange),
    };

    const [playbook, playbookHistory, allPlaybookHistory, adminUsers] = await Promise.all([
      prisma.billingSupportPlaybook.findUnique({
        where: { id: req.params.id },
        include: {
          createdByAdmin: true,
          archivedByAdmin: true,
        },
      }),
      prisma.billingPlaybookHistory.findMany({
        where: historyWhere,
        include: { actorAdmin: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.billingPlaybookHistory.findMany({
        where: { playbookId: req.params.id },
        include: { actorAdmin: true },
        orderBy: { createdAt: 'desc' },
        take: 24,
      }),
      prisma.user.findMany({
        where: { role: 'ADMIN' },
        orderBy: { name: 'asc' },
      }),
    ]);

    if (!playbook && allPlaybookHistory.length === 0) {
      setFlash(req, 'Billing playbook history not found.');
      return res.redirect('/admin');
    }

    const latestHistory = allPlaybookHistory[0] || null;
    const actorAdminName = filters.actorAdminUserId ? (adminUsers.find((adminUser) => adminUser.id === filters.actorAdminUserId)?.name || '') : '';
    const summaryText = buildBillingPlaybookSummary({
      playbook,
      latestHistory,
      historyEntries: playbookHistory,
      filters,
      pagination: null,
      actorAdminName,
    });
    const exportFilename = buildBillingPlaybookExportFilename({ playbook, latestHistory, extension: 'txt' });

    res.type('text/plain');
    res.attachment(exportFilename);
    return res.send(summaryText + '\n');
  }));

  app.get('/admin/billing-playbooks/:id/history/summary.json', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const filters = normalizeBillingPlaybookHistoryFilters(req.query);
    const historyWhere = {
      playbookId: req.params.id,
      action: filters.action || undefined,
      actorAdminUserId: filters.actorAdminUserId || undefined,
      createdAt: buildBillingPlaybookHistoryCreatedAtFilter(filters.dateRange),
    };

    const [playbook, playbookHistory, filteredHistoryCount, allPlaybookHistory, adminUsers] = await Promise.all([
      prisma.billingSupportPlaybook.findUnique({
        where: { id: req.params.id },
        include: {
          createdByAdmin: true,
          archivedByAdmin: true,
        },
      }),
      prisma.billingPlaybookHistory.findMany({
        where: historyWhere,
        include: { actorAdmin: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.billingPlaybookHistory.count({ where: historyWhere }),
      prisma.billingPlaybookHistory.findMany({
        where: { playbookId: req.params.id },
        include: { actorAdmin: true },
        orderBy: { createdAt: 'desc' },
        take: 24,
      }),
      prisma.user.findMany({
        where: { role: 'ADMIN' },
        orderBy: { name: 'asc' },
      }),
    ]);

    if (!playbook && allPlaybookHistory.length === 0) {
      setFlash(req, 'Billing playbook history not found.');
      return res.redirect('/admin');
    }

    const latestHistory = allPlaybookHistory[0] || null;
    const actorAdminName = filters.actorAdminUserId ? (adminUsers.find((adminUser) => adminUser.id === filters.actorAdminUserId)?.name || '') : '';
    const payload = buildBillingPlaybookSummaryPayload({
      playbook,
      latestHistory,
      historyEntries: playbookHistory,
      filters,
      pagination: {
        page: filters.page,
        pageSize: 100,
        totalCount: filteredHistoryCount,
        totalPages: Math.max(1, Math.ceil(filteredHistoryCount / 100)),
      },
      actorAdminName,
    });
    const exportFilename = buildBillingPlaybookExportFilename({ playbook, latestHistory, extension: 'json' });

    res.type('application/json');
    res.attachment(exportFilename);
    return res.send(JSON.stringify(payload, null, 2) + '\n');
  }));

  app.post('/admin/billing-playbooks/:id/history/cases', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const filters = normalizeBillingPlaybookHistoryFilters(req.body);
    const historyWhere = {
      playbookId: req.params.id,
      action: filters.action || undefined,
      actorAdminUserId: filters.actorAdminUserId || undefined,
      createdAt: buildBillingPlaybookHistoryCreatedAtFilter(filters.dateRange),
    };

    const [playbook, playbookHistory, allPlaybookHistory, adminUsers] = await Promise.all([
      prisma.billingSupportPlaybook.findUnique({
        where: { id: req.params.id },
        include: {
          createdByAdmin: true,
          archivedByAdmin: true,
        },
      }),
      prisma.billingPlaybookHistory.findMany({
        where: historyWhere,
        include: { actorAdmin: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.billingPlaybookHistory.findMany({
        where: { playbookId: req.params.id },
        include: { actorAdmin: true },
        orderBy: { createdAt: 'desc' },
        take: 24,
      }),
      prisma.user.findMany({
        where: { role: 'ADMIN' },
        orderBy: { name: 'asc' },
      }),
    ]);

    if (!playbook && allPlaybookHistory.length === 0) {
      setFlash(req, 'Billing playbook history not found.');
      return res.redirect('/admin');
    }

    const latestHistory = allPlaybookHistory[0] || null;
    const actorAdminName = filters.actorAdminUserId ? (adminUsers.find((adminUser) => adminUser.id === filters.actorAdminUserId)?.name || '') : '';
    const summaryText = buildBillingPlaybookSummary({
      playbook,
      latestHistory,
      historyEntries: playbookHistory,
      filters,
      pagination: null,
      actorAdminName,
    });
    const summaryJson = buildBillingPlaybookSummaryPayload({
      playbook,
      latestHistory,
      historyEntries: playbookHistory,
      filters,
      pagination: null,
      actorAdminName,
    });
    const playbookName = playbook ? playbook.name : (latestHistory?.playbookName || 'Unknown playbook');
    const title = String(req.body.caseTitle || '').trim() || (playbookName + ' handoff case');

    const createdSupportCase = await prisma.supportCase.create({
      data: {
        title,
        summaryText,
        summaryJson: JSON.stringify(summaryJson, null, 2),
        sourcePlaybookId: playbook?.id || latestHistory?.playbookId || null,
        sourcePlaybookName: playbookName,
        createdByAdminUserId: req.session.userId,
      },
    });

    await logSupportCaseActivity({
      supportCaseId: createdSupportCase.id,
      actorAdminUserId: req.session.userId,
      type: 'CREATED',
      message: 'Created support case from playbook summary.',
    });

    await notifySupportCaseAdmins({
      actorAdminUserId: req.session.userId,
      supportCaseId: createdSupportCase.id,
      title: 'New support case created',
      body: createdSupportCase.title + ' is ready for admin review.',
      href: '/admin/support-cases/' + createdSupportCase.id,
      mode: 'all_admins',
    });

    await applySupportCaseAutoRouting(createdSupportCase.id, req.session.userId);

    setFlash(req, 'Support case created from playbook summary.');
    const historyQueryString = 'action=' + encodeURIComponent(filters.action || '') + '&actorAdminUserId=' + encodeURIComponent(filters.actorAdminUserId || '') + '&dateRange=' + encodeURIComponent(filters.dateRange || 'ALL') + '&page=1';
    return res.redirect('/admin/billing-playbooks/' + req.params.id + '/history?' + historyQueryString);
  }));
}

module.exports = {
  registerAdminBillingRoutes,
};
