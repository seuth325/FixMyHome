function registerAdminSupportReadRoutes(app, deps) {
  const {
    baseViewModel,
    buildSupportCaseAttachmentHref,
    buildSupportCaseExportFilename,
    buildSupportCasePackagePayload,
    buildSupportCasePackageText,
    currentUser,
    getSupportCaseAttachmentLocalPath,
    logSupportCaseActivity,
    notifySupportCaseAdmins,
    prisma,
    requireAdmin,
    requireAuth,
    setFlash,
    wrap,
  } = deps;

  app.post('/admin/support-cases/bulk', requireAuth, requireAdmin, wrap(async (req, res) => {
    const rawSupportCaseIds = Array.isArray(req.body.supportCaseIds)
      ? req.body.supportCaseIds
      : [req.body.supportCaseIds];
    const supportCaseIds = [...new Set(rawSupportCaseIds
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter(Boolean))];
    const bulkAssignedAdminUserId = String(req.body.bulkAssignedAdminUserId || '').trim();
    const bulkStatus = String(req.body.bulkStatus || '').trim().toUpperCase();
    const returnTo = String(req.body.returnTo || '').trim();
    const nextPath = returnTo.startsWith('/admin') ? returnTo : '/admin';

    if (supportCaseIds.length === 0) {
      setFlash(req, 'Select at least one support case before running a bulk action.');
      return res.redirect(nextPath);
    }

    if (bulkStatus && bulkStatus !== '__NO_CHANGE__' && !['OPEN', 'CLOSED'].includes(bulkStatus)) {
      setFlash(req, 'Choose a valid bulk support case status.');
      return res.redirect(nextPath);
    }

    let validatedAssignedAdminUserId = null;
    if (bulkAssignedAdminUserId && bulkAssignedAdminUserId !== '__NO_CHANGE__' && bulkAssignedAdminUserId !== 'unassigned') {
      const adminUser = await prisma.user.findUnique({ where: { id: bulkAssignedAdminUserId } });
      if (!adminUser || adminUser.role !== 'ADMIN') {
        setFlash(req, 'Choose a valid bulk support case owner.');
        return res.redirect(nextPath);
      }
      validatedAssignedAdminUserId = adminUser.id;
    }

    const supportCases = await prisma.supportCase.findMany({
      where: { id: { in: supportCaseIds } },
      orderBy: { updatedAt: 'desc' },
    });

    if (supportCases.length === 0) {
      setFlash(req, 'Support cases not found for bulk update.');
      return res.redirect(nextPath);
    }

    let ownerChangedCount = 0;
    let statusChangedCount = 0;
    let updatedCount = 0;

    for (const supportCase of supportCases) {
      const nextAssignedAdminUserId = bulkAssignedAdminUserId === '__NO_CHANGE__' || !bulkAssignedAdminUserId
        ? supportCase.assignedAdminUserId
        : bulkAssignedAdminUserId === 'unassigned'
          ? null
          : validatedAssignedAdminUserId;
      const nextStatus = bulkStatus && bulkStatus !== '__NO_CHANGE__'
        ? bulkStatus
        : supportCase.status;
      const ownerChanged = supportCase.assignedAdminUserId !== nextAssignedAdminUserId;
      const statusChanged = supportCase.status !== nextStatus;

      if (!ownerChanged && !statusChanged) {
        continue;
      }

      await prisma.supportCase.update({
        where: { id: supportCase.id },
        data: {
          assignedAdminUserId: nextAssignedAdminUserId,
          status: nextStatus,
        },
      });

      if (ownerChanged) {
        ownerChangedCount += 1;
        await logSupportCaseActivity({
          supportCaseId: supportCase.id,
          actorAdminUserId: req.session.userId,
          type: 'REASSIGNED',
          message: nextAssignedAdminUserId ? 'Assigned case to a new owner from the bulk queue.' : 'Cleared case owner from the bulk queue.',
        });
      }

      if (statusChanged) {
        statusChangedCount += 1;
        await logSupportCaseActivity({
          supportCaseId: supportCase.id,
          actorAdminUserId: req.session.userId,
          type: 'STATUS_CHANGED',
          message: nextStatus === 'CLOSED' ? 'Closed support case from the bulk queue.' : 'Reopened support case from the bulk queue.',
        });
      }

      await notifySupportCaseAdmins({
        actorAdminUserId: req.session.userId,
        supportCaseId: supportCase.id,
        title: ownerChanged && nextAssignedAdminUserId ? 'Support case assigned' : 'Support case updated',
        body: supportCase.title + ' was updated from the support case bulk queue.',
        href: '/admin/support-cases/' + supportCase.id,
        mode: 'all_admins',
      });

      updatedCount += 1;
    }

    if (updatedCount === 0) {
      setFlash(req, 'Bulk action skipped because the selected cases already matched those values.');
      return res.redirect(nextPath);
    }

    const summaryParts = [updatedCount + ' support case' + (updatedCount === 1 ? '' : 's') + ' updated'];
    if (ownerChangedCount > 0) {
      summaryParts.push(ownerChangedCount + ' owner change' + (ownerChangedCount === 1 ? '' : 's'));
    }
    if (statusChangedCount > 0) {
      summaryParts.push(statusChangedCount + ' status change' + (statusChangedCount === 1 ? '' : 's'));
    }
    setFlash(req, summaryParts.join(' | ') + '.');
    return res.redirect(nextPath);
  }));

  app.get('/admin/support-cases/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const [supportCase, adminUsers] = await Promise.all([
      prisma.supportCase.findUnique({
        where: { id: req.params.id },
        include: {
          createdByAdmin: true,
          assignedAdmin: true,
          activities: {
            include: { actorAdmin: true },
            orderBy: { createdAt: 'desc' },
            take: 24,
          },
          comments: {
            include: { authorAdmin: true },
            orderBy: [
              { isResolution: 'desc' },
              { createdAt: 'desc' },
            ],
            take: 50,
          },
          attachments: {
            include: { uploadedByAdmin: true, archivedByAdmin: true },
            orderBy: [
              { archivedAt: 'asc' },
              { createdAt: 'desc' },
            ],
            take: 50,
          },
        },
      }),
      prisma.user.findMany({
        where: { role: 'ADMIN' },
        orderBy: { name: 'asc' },
      }),
    ]);

    if (!supportCase) {
      setFlash(req, 'Support case not found.');
      return res.redirect('/admin');
    }

    supportCase.attachments = supportCase.attachments.map((attachment) => ({
      ...attachment,
      protectedHref: buildSupportCaseAttachmentHref(supportCase.id, attachment.id),
    }));

    return res.render('admin-support-case', {
      ...baseViewModel(req, user),
      supportCase,
      adminUsers,
    });
  }));

  app.get('/admin/support-cases/:id/attachments/:attachmentId/file', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const attachment = await prisma.supportCaseAttachment.findUnique({
      where: { id: req.params.attachmentId },
    });

    if (!attachment || attachment.supportCaseId !== req.params.id) {
      setFlash(req, 'Support case attachment not found.');
      return res.redirect('/admin/support-cases/' + req.params.id);
    }

    const localPath = getSupportCaseAttachmentLocalPath(attachment.url);
    if (localPath) {
      return res.download(localPath, attachment.filename);
    }

    return res.redirect(attachment.url);
  }));

  app.get('/admin/support-cases/:id/export.txt', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const supportCase = await prisma.supportCase.findUnique({
      where: { id: req.params.id },
      include: {
        createdByAdmin: true,
        assignedAdmin: true,
        comments: { include: { authorAdmin: true }, orderBy: [{ isResolution: 'desc' }, { createdAt: 'desc' }] },
        attachments: { include: { uploadedByAdmin: true, archivedByAdmin: true }, orderBy: [{ archivedAt: 'asc' }, { createdAt: 'desc' }] },
        activities: { include: { actorAdmin: true }, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!supportCase) {
      setFlash(req, 'Support case not found.');
      return res.redirect('/admin');
    }

    res.type('text/plain');
    res.attachment(buildSupportCaseExportFilename(supportCase, 'txt'));
    return res.send(buildSupportCasePackageText(supportCase) + '\n');
  }));

  app.get('/admin/support-cases/:id/export.json', requireAuth, requireAdmin, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.isSuspended || user.role !== 'ADMIN') {
      req.session.userId = null;
      req.session.role = null;
      return res.redirect('/login');
    }

    const supportCase = await prisma.supportCase.findUnique({
      where: { id: req.params.id },
      include: {
        createdByAdmin: true,
        assignedAdmin: true,
        comments: { include: { authorAdmin: true }, orderBy: [{ isResolution: 'desc' }, { createdAt: 'desc' }] },
        attachments: { include: { uploadedByAdmin: true, archivedByAdmin: true }, orderBy: [{ archivedAt: 'asc' }, { createdAt: 'desc' }] },
        activities: { include: { actorAdmin: true }, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!supportCase) {
      setFlash(req, 'Support case not found.');
      return res.redirect('/admin');
    }

    res.type('application/json');
    res.attachment(buildSupportCaseExportFilename(supportCase, 'json'));
    return res.send(JSON.stringify(buildSupportCasePackagePayload(supportCase), null, 2) + '\n');
  }));
}

module.exports = {
  registerAdminSupportReadRoutes,
};
