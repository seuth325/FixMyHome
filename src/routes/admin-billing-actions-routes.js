function registerAdminBillingActionRoutes(app, deps) {
  const {
    logBillingPlaybookHistory,
    prisma,
    requireAdmin,
    requireAuth,
    setFlash,
    wrap,
  } = deps;

  app.post('/admin/billing-events/:id/support', requireAuth, requireAdmin, wrap(async (req, res) => {
    const notes = String(req.body.supportNotes || '').trim();
    const supportStatus = String(req.body.supportStatus || '').trim();
    const assignedAdminUserId = String(req.body.assignedAdminUserId || '').trim() || null;
    const returnTo = String(req.body.returnTo || '').trim();
    const nextPath = returnTo.startsWith('/admin') ? returnTo : '/admin/billing-events/' + req.params.id;
    const event = await prisma.paymentWebhookEvent.findUnique({ where: { id: req.params.id } });
    if (!event) {
      setFlash(req, 'Billing event not found.');
      return res.redirect('/admin');
    }

    if (!['NEW', 'NEEDS_FOLLOW_UP', 'WAITING_ON_PROVIDER', 'RESOLVED'].includes(supportStatus)) {
      setFlash(req, 'Choose a valid billing support status.');
      return res.redirect(nextPath);
    }

    if (assignedAdminUserId) {
      const adminUser = await prisma.user.findUnique({ where: { id: assignedAdminUserId } });
      if (!adminUser || adminUser.role !== 'ADMIN') {
        setFlash(req, 'Choose a valid admin owner.');
        return res.redirect(nextPath);
      }
    }

    await prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: {
        supportNotes: notes || null,
        supportNotesUpdatedAt: notes ? new Date() : null,
        supportStatus,
        assignedAdminUserId,
      },
    });

    setFlash(req, 'Billing support details saved.');
    return res.redirect(nextPath);
  }));

  app.post('/admin/billing-playbooks', requireAuth, requireAdmin, wrap(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const provider = String(req.body.provider || '').trim() || null;
    const eventType = String(req.body.eventType || '').trim() || null;
    const targetType = String(req.body.targetType || '').trim() || null;
    const supportStatus = String(req.body.supportStatus || '').trim();
    const scope = String(req.body.scope || 'PERSONAL').trim();
    const status = String(req.body.status || 'ACTIVE').trim();
    const isFavorite = String(req.body.isFavorite || '') === '1';
    const assignToCreator = String(req.body.assignToCreator || '') === '1';
    const cleanupReason = String(req.body.cleanupReason || '').trim() || null;

    if (!name || !supportStatus) {
      setFlash(req, 'Playbook name and support status are required.');
      return res.redirect('/admin');
    }

    if (!['NEW', 'NEEDS_FOLLOW_UP', 'WAITING_ON_PROVIDER', 'RESOLVED'].includes(supportStatus)) {
      setFlash(req, 'Choose a valid playbook support status.');
      return res.redirect('/admin');
    }

    if (!['PERSONAL', 'SHARED'].includes(scope)) {
      setFlash(req, 'Choose a valid playbook scope.');
      return res.redirect('/admin');
    }

    if (!['ACTIVE', 'ARCHIVED'].includes(status)) {
      setFlash(req, 'Choose a valid playbook status.');
      return res.redirect('/admin');
    }

    const createdPlaybook = await prisma.billingSupportPlaybook.create({
      data: {
        createdByAdminUserId: req.session.userId,
        name,
        provider,
        eventType,
        targetType,
        supportStatus,
        scope,
        status,
        isFavorite,
        archivedAt: status === 'ARCHIVED' ? new Date() : null,
        archivedByAdminUserId: status === 'ARCHIVED' ? req.session.userId : null,
        cleanupReason,
        assignToCreator,
      },
    });

    await logBillingPlaybookHistory({
      actorAdminUserId: req.session.userId,
      playbookId: createdPlaybook.id,
      playbookName: createdPlaybook.name,
      action: 'CREATED',
      notes: status === 'ARCHIVED' ? (cleanupReason || 'Created directly in archived state.') : 'Created billing playbook.',
    });

    setFlash(req, 'Billing playbook created.');
    return res.redirect('/admin');
  }));

  app.post('/admin/billing-playbooks/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    const playbook = await prisma.billingSupportPlaybook.findUnique({ where: { id: req.params.id } });
    if (!playbook) {
      setFlash(req, 'Billing playbook not found.');
      return res.redirect('/admin');
    }

    if (playbook.scope === 'PERSONAL' && playbook.createdByAdminUserId !== req.session.userId) {
      setFlash(req, 'Only the creator can edit a personal billing playbook.');
      return res.redirect('/admin');
    }

    const name = String(req.body.name || '').trim();
    const provider = String(req.body.provider || '').trim() || null;
    const eventType = String(req.body.eventType || '').trim() || null;
    const targetType = String(req.body.targetType || '').trim() || null;
    const supportStatus = String(req.body.supportStatus || '').trim();
    const scope = String(req.body.scope || 'PERSONAL').trim();
    const status = String(req.body.status || 'ACTIVE').trim();
    const isFavorite = String(req.body.isFavorite || '') === '1';
    const assignToCreator = String(req.body.assignToCreator || '') === '1';
    const cleanupReason = String(req.body.cleanupReason || '').trim() || null;

    if (!name || !supportStatus) {
      setFlash(req, 'Playbook name and support status are required.');
      return res.redirect('/admin');
    }

    if (!['NEW', 'NEEDS_FOLLOW_UP', 'WAITING_ON_PROVIDER', 'RESOLVED'].includes(supportStatus)) {
      setFlash(req, 'Choose a valid playbook support status.');
      return res.redirect('/admin');
    }

    if (!['PERSONAL', 'SHARED'].includes(scope)) {
      setFlash(req, 'Choose a valid playbook scope.');
      return res.redirect('/admin');
    }

    if (!['ACTIVE', 'ARCHIVED'].includes(status)) {
      setFlash(req, 'Choose a valid playbook status.');
      return res.redirect('/admin');
    }

    const updatedPlaybook = await prisma.billingSupportPlaybook.update({
      where: { id: playbook.id },
      data: {
        name,
        provider,
        eventType,
        targetType,
        supportStatus,
        scope,
        status,
        isFavorite,
        archivedAt: status === 'ARCHIVED' ? (playbook.archivedAt || new Date()) : null,
        archivedByAdminUserId: status === 'ARCHIVED' ? (playbook.archivedByAdminUserId || req.session.userId) : null,
        cleanupReason,
        assignToCreator,
      },
    });

    const historyEntries = [{
      actorAdminUserId: req.session.userId,
      playbookId: updatedPlaybook.id,
      playbookName: updatedPlaybook.name,
      action: 'UPDATED',
      notes: 'Updated billing playbook settings.',
    }];

    if (playbook.status !== updatedPlaybook.status) {
      historyEntries.push({
        actorAdminUserId: req.session.userId,
        playbookId: updatedPlaybook.id,
        playbookName: updatedPlaybook.name,
        action: updatedPlaybook.status === 'ARCHIVED' ? 'ARCHIVED' : 'RESTORED',
        notes: updatedPlaybook.status === 'ARCHIVED'
          ? (cleanupReason || 'Archived from playbook editor.')
          : 'Restored from playbook editor.',
      });
    }

    await Promise.all(historyEntries.map((entry) => logBillingPlaybookHistory(entry)));

    setFlash(req, 'Billing playbook updated.');
    return res.redirect('/admin');
  }));

  app.post('/admin/billing-playbooks/actions/bulk-status', requireAuth, requireAdmin, wrap(async (req, res) => {
    const playbookIdsRaw = req.body.playbookIds;
    const playbookIds = Array.isArray(playbookIdsRaw)
      ? playbookIdsRaw.flatMap((value) => String(value || '').split(',')).map((value) => value.trim()).filter(Boolean)
      : String(playbookIdsRaw || '').split(',').map((value) => value.trim()).filter(Boolean);
    const action = String(req.body.action || '').trim().toUpperCase();
    const cleanupReason = String(req.body.cleanupReason || '').trim() || null;

    if (playbookIds.length === 0) {
      setFlash(req, 'Select at least one billing playbook.');
      return res.redirect('/admin');
    }

    if (!['ARCHIVE', 'RESTORE', 'DELETE'].includes(action)) {
      setFlash(req, 'Choose a valid billing playbook bulk action.');
      return res.redirect('/admin');
    }

    const playbooks = await prisma.billingSupportPlaybook.findMany({
      where: { id: { in: playbookIds } },
    });
    const allowedPlaybooks = playbooks.filter((playbook) => playbook.scope === 'SHARED' || playbook.createdByAdminUserId === req.session.userId);

    if (allowedPlaybooks.length === 0) {
      setFlash(req, 'No eligible billing playbooks were selected.');
      return res.redirect('/admin');
    }

    const allowedIds = allowedPlaybooks.map((playbook) => playbook.id);
    if (action === 'ARCHIVE') {
      await prisma.billingSupportPlaybook.updateMany({
        where: { id: { in: allowedIds } },
        data: {
          status: 'ARCHIVED',
          archivedAt: new Date(),
          archivedByAdminUserId: req.session.userId,
          cleanupReason,
        },
      });
      await Promise.all(allowedPlaybooks.map((playbook) => logBillingPlaybookHistory({
        actorAdminUserId: req.session.userId,
        playbookId: playbook.id,
        playbookName: playbook.name,
        action: 'ARCHIVED',
        notes: cleanupReason || 'Archived from bulk cleanup.',
      })));
      setFlash(req, 'Archived ' + allowedIds.length + ' billing playbooks.');
      return res.redirect('/admin');
    }

    if (action === 'RESTORE') {
      await prisma.billingSupportPlaybook.updateMany({
        where: { id: { in: allowedIds } },
        data: {
          status: 'ACTIVE',
          archivedAt: null,
          archivedByAdminUserId: null,
        },
      });
      await Promise.all(allowedPlaybooks.map((playbook) => logBillingPlaybookHistory({
        actorAdminUserId: req.session.userId,
        playbookId: playbook.id,
        playbookName: playbook.name,
        action: 'RESTORED',
        notes: 'Restored from bulk cleanup.',
      })));
      setFlash(req, 'Restored ' + allowedIds.length + ' billing playbooks.');
      return res.redirect('/admin');
    }

    await Promise.all(allowedPlaybooks.map((playbook) => logBillingPlaybookHistory({
      actorAdminUserId: req.session.userId,
      playbookId: playbook.id,
      playbookName: playbook.name,
      action: 'DELETED',
      notes: 'Deleted from bulk cleanup.',
    })));
    await prisma.billingSupportPlaybook.deleteMany({
      where: { id: { in: allowedIds } },
    });
    setFlash(req, 'Deleted ' + allowedIds.length + ' billing playbooks.');
    return res.redirect('/admin');
  }));

  app.post('/admin/billing-playbooks/:id/archive', requireAuth, requireAdmin, wrap(async (req, res) => {
    const playbook = await prisma.billingSupportPlaybook.findUnique({ where: { id: req.params.id } });
    if (!playbook) {
      setFlash(req, 'Billing playbook not found.');
      return res.redirect('/admin');
    }

    if (playbook.scope === 'PERSONAL' && playbook.createdByAdminUserId !== req.session.userId) {
      setFlash(req, 'Only the creator can archive a personal billing playbook.');
      return res.redirect('/admin');
    }

    const cleanupReason = String(req.body.cleanupReason || '').trim() || null;

    await prisma.billingSupportPlaybook.update({
      where: { id: playbook.id },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
        archivedByAdminUserId: req.session.userId,
        cleanupReason,
      },
    });

    await logBillingPlaybookHistory({
      actorAdminUserId: req.session.userId,
      playbookId: playbook.id,
      playbookName: playbook.name,
      action: 'ARCHIVED',
      notes: cleanupReason || 'Archived billing playbook.',
    });

    setFlash(req, 'Billing playbook archived.');
    return res.redirect('/admin');
  }));

  app.post('/admin/billing-playbooks/:id/restore', requireAuth, requireAdmin, wrap(async (req, res) => {
    const playbook = await prisma.billingSupportPlaybook.findUnique({ where: { id: req.params.id } });
    if (!playbook) {
      setFlash(req, 'Billing playbook not found.');
      return res.redirect('/admin');
    }

    if (playbook.scope === 'PERSONAL' && playbook.createdByAdminUserId !== req.session.userId) {
      setFlash(req, 'Only the creator can restore a personal billing playbook.');
      return res.redirect('/admin');
    }

    await prisma.billingSupportPlaybook.update({
      where: { id: playbook.id },
      data: {
        status: 'ACTIVE',
        archivedAt: null,
        archivedByAdminUserId: null,
      },
    });

    await logBillingPlaybookHistory({
      actorAdminUserId: req.session.userId,
      playbookId: playbook.id,
      playbookName: playbook.name,
      action: 'RESTORED',
      notes: 'Restored billing playbook.',
    });

    setFlash(req, 'Billing playbook restored.');
    return res.redirect('/admin');
  }));

  app.post('/admin/billing-playbooks/:id/delete', requireAuth, requireAdmin, wrap(async (req, res) => {
    const playbook = await prisma.billingSupportPlaybook.findUnique({ where: { id: req.params.id } });
    if (!playbook) {
      setFlash(req, 'Billing playbook not found.');
      return res.redirect('/admin');
    }

    if (playbook.scope === 'PERSONAL' && playbook.createdByAdminUserId !== req.session.userId) {
      setFlash(req, 'Only the creator can delete a personal billing playbook.');
      return res.redirect('/admin');
    }

    await logBillingPlaybookHistory({
      actorAdminUserId: req.session.userId,
      playbookId: playbook.id,
      playbookName: playbook.name,
      action: 'DELETED',
      notes: 'Deleted billing playbook.',
    });
    await prisma.billingSupportPlaybook.delete({ where: { id: playbook.id } });
    setFlash(req, 'Billing playbook deleted.');
    return res.redirect('/admin');
  }));

  app.post('/admin/billing-events/bulk-support', requireAuth, requireAdmin, wrap(async (req, res) => {
    const eventIdsRaw = req.body.eventIds;
    const eventIds = Array.isArray(eventIdsRaw)
      ? eventIdsRaw.flatMap((value) => String(value || '').split(',')).map((value) => value.trim()).filter(Boolean)
      : String(eventIdsRaw || '').split(',').map((value) => value.trim()).filter(Boolean);
    const supportStatus = String(req.body.supportStatus || '').trim();
    const assignedAdminUserId = String(req.body.assignedAdminUserId || '').trim() || null;
    const playbookId = String(req.body.playbookId || '').trim() || null;
    const returnTo = String(req.body.returnTo || '').trim();
    const nextPath = returnTo.startsWith('/admin') ? returnTo : '/admin';

    if (eventIds.length === 0) {
      setFlash(req, 'Select at least one billing event to update.');
      return res.redirect(nextPath);
    }

    if (!['NEW', 'NEEDS_FOLLOW_UP', 'WAITING_ON_PROVIDER', 'RESOLVED'].includes(supportStatus)) {
      setFlash(req, 'Choose a valid billing support status.');
      return res.redirect(nextPath);
    }

    if (assignedAdminUserId) {
      const adminUser = await prisma.user.findUnique({ where: { id: assignedAdminUserId } });
      if (!adminUser || adminUser.role !== 'ADMIN') {
        setFlash(req, 'Choose a valid admin owner.');
        return res.redirect(nextPath);
      }
    }

    await prisma.paymentWebhookEvent.updateMany({
      where: { id: { in: eventIds } },
      data: {
        supportStatus,
        assignedAdminUserId,
      },
    });

    if (playbookId) {
      const playbook = await prisma.billingSupportPlaybook.findUnique({ where: { id: playbookId } });
      if (playbook && (playbook.scope === 'SHARED' || playbook.createdByAdminUserId === req.session.userId)) {
        await prisma.billingSupportPlaybook.update({
          where: { id: playbookId },
          data: {
            usageCount: { increment: 1 },
            lastUsedAt: new Date(),
          },
        });
      }
    }

    setFlash(req, 'Updated ' + eventIds.length + ' billing events.');
    return res.redirect(nextPath);
  }));
}

module.exports = {
  registerAdminBillingActionRoutes,
};
