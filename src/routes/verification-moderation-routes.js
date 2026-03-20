function registerVerificationModerationRoutes(app, deps) {
  const {
    createNotification,
    currentUser,
    getRoleLabel,
    getUserDeletionEligibility,
    logModerationAction,
    prisma,
    requireAdmin,
    requireAuth,
    setFlash,
    wrap,
  } = deps;

  app.post('/profile/verification/:kind', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.role !== 'HANDYMAN') {
      setFlash(req, 'Only handymen can submit verification details.');
      return res.redirect('/dashboard');
    }

    const kind = req.params.kind === 'license' ? 'license' : req.params.kind === 'insurance' ? 'insurance' : null;
    if (!kind) {
      setFlash(req, 'Verification type not found.');
      return res.redirect('/dashboard');
    }

    const proofDetails = String(req.body.proofDetails || '').trim();
    if (!proofDetails) {
      setFlash(req, 'Add document or policy details before submitting for review.');
      return res.redirect('/dashboard');
    }

    const data = kind === 'insurance'
      ? {
          insuranceProofDetails: proofDetails,
          insuranceStatus: 'PENDING',
          insuranceSubmittedAt: new Date(),
          insuranceAdminNotes: null,
          insuranceVerified: false,
        }
      : {
          licenseProofDetails: proofDetails,
          licenseStatus: 'PENDING',
          licenseSubmittedAt: new Date(),
          licenseAdminNotes: null,
          licenseVerified: false,
        };

    await prisma.handymanProfile.update({
      where: { userId: user.id },
      data,
    });

    setFlash(req, (kind === 'insurance' ? 'Insurance' : 'License') + ' verification submitted for admin review.');
    return res.redirect('/dashboard');
  }));

  app.post('/admin/verification/:userId/:kind', requireAuth, requireAdmin, wrap(async (req, res) => {
    const profile = await prisma.handymanProfile.findUnique({ where: { userId: req.params.userId } });
    if (!profile) {
      setFlash(req, 'Verification profile not found.');
      return res.redirect('/admin');
    }

    const kind = req.params.kind === 'license' ? 'license' : req.params.kind === 'insurance' ? 'insurance' : null;
    if (!kind) {
      setFlash(req, 'Verification type not found.');
      return res.redirect('/admin');
    }

    const decision = String(req.body.decision || '').trim();
    const adminNotes = String(req.body.adminNotes || '').trim();
    if (!['APPROVED', 'REJECTED'].includes(decision) || !adminNotes) {
      setFlash(req, 'Choose approve or reject and include review notes.');
      return res.redirect('/admin');
    }

    const data = kind === 'insurance'
      ? {
          insuranceStatus: decision,
          insuranceVerified: decision === 'APPROVED',
          insuranceAdminNotes: adminNotes,
        }
      : {
          licenseStatus: decision,
          licenseVerified: decision === 'APPROVED',
          licenseAdminNotes: adminNotes,
        };

    await prisma.handymanProfile.update({
      where: { userId: profile.userId },
      data,
    });

    await createNotification(
      profile.userId,
      'VERIFICATION_REVIEWED',
      (kind === 'insurance' ? 'Insurance' : 'License') + ' review complete',
      'Admin ' + (decision === 'APPROVED' ? 'approved' : 'rejected') + ' your ' + kind + ' submission.',
      '/dashboard'
    );

    setFlash(req, (kind === 'insurance' ? 'Insurance' : 'License') + ' verification ' + (decision === 'APPROVED' ? 'approved.' : 'rejected.'));
    return res.redirect('/admin');
  }));

  app.post('/jobs/:id/report', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!user || !job || user.role === 'ADMIN' || job.homeownerId === user.id) {
      setFlash(req, 'That job cannot be reported from this account.');
      return res.redirect('/dashboard');
    }

    const reason = String(req.body.reason || '').trim();
    const details = String(req.body.details || '').trim();
    if (!reason || !details) {
      setFlash(req, 'Add a reason and a few details to report this job.');
      return res.redirect('/dashboard');
    }

    await prisma.moderationReport.create({
      data: {
        filedByUserId: user.id,
        jobId: job.id,
        subjectType: 'JOB',
        reason,
        details,
      },
    });

    setFlash(req, 'Job report submitted for admin review.');
    return res.redirect('/dashboard');
  }));

  app.post('/users/:id/report', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const reportedUser = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user || !reportedUser || user.role === 'ADMIN' || reportedUser.id === user.id) {
      setFlash(req, 'That user cannot be reported from this account.');
      return res.redirect('/dashboard');
    }

    const reason = String(req.body.reason || '').trim();
    const details = String(req.body.details || '').trim();
    if (!reason || !details) {
      setFlash(req, 'Add a reason and a few details to report this user.');
      return res.redirect('/dashboard');
    }

    await prisma.moderationReport.create({
      data: {
        filedByUserId: user.id,
        reportedUserId: reportedUser.id,
        subjectType: 'USER',
        reason,
        details,
      },
    });

    setFlash(req, 'User report submitted for admin review.');
    return res.redirect('/dashboard');
  }));

  app.post('/disputes/:id/report', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.id },
      include: { job: { include: { acceptedBid: true } } },
    });
    if (!user || !dispute || user.role === 'ADMIN') {
      setFlash(req, 'That dispute cannot be reported from this account.');
      return res.redirect('/dashboard');
    }

    const allowed = dispute.job.homeownerId === user.id
      || dispute.openedByUserId === user.id
      || dispute.job.acceptedBid?.handymanId === user.id;
    if (!allowed) {
      setFlash(req, 'You do not have access to that dispute.');
      return res.redirect('/dashboard');
    }

    const reason = String(req.body.reason || '').trim();
    const details = String(req.body.details || '').trim();
    if (!reason || !details) {
      setFlash(req, 'Add a reason and a few details to report this dispute.');
      return res.redirect('/dashboard');
    }

    await prisma.moderationReport.create({
      data: {
        filedByUserId: user.id,
        disputeId: dispute.id,
        subjectType: 'DISPUTE',
        reason,
        details,
      },
    });

    setFlash(req, 'Dispute report submitted for admin review.');
    return res.redirect('/dashboard');
  }));

  app.post('/admin/reports/:id/assign', requireAuth, requireAdmin, wrap(async (req, res) => {
    const adminUserId = String(req.body.adminUserId || '').trim() || null;
    const report = await prisma.moderationReport.findUnique({ where: { id: req.params.id } });
    if (!report) {
      setFlash(req, 'Report not found.');
      return res.redirect('/admin');
    }

    if (adminUserId) {
      const adminUser = await prisma.user.findUnique({ where: { id: adminUserId } });
      if (!adminUser || adminUser.role !== 'ADMIN') {
        setFlash(req, 'Choose a valid admin assignee.');
        return res.redirect('/admin');
      }
    }

    await prisma.moderationReport.update({
      where: { id: report.id },
      data: { assignedAdminUserId: adminUserId },
    });
    await logModerationAction({
      actorAdminUserId: req.session.userId,
      moderationReportId: report.id,
      action: 'ASSIGNED_REPORT',
      notes: adminUserId ? 'Assigned report to admin queue owner.' : 'Cleared report assignment.',
    });

    setFlash(req, adminUserId ? 'Report assigned.' : 'Report assignment cleared.');
    return res.redirect('/admin');
  }));

  app.post('/admin/reports/:id/resolve', requireAuth, requireAdmin, wrap(async (req, res) => {
    const notes = String(req.body.resolutionNotes || '').trim();
    if (!notes) {
      setFlash(req, 'Add resolution notes before closing a report.');
      return res.redirect('/admin');
    }

    const updatedReport = await prisma.moderationReport.update({
      where: { id: req.params.id },
      data: {
        status: 'RESOLVED',
        resolutionNotes: notes,
        resolvedAt: new Date(),
      },
    });
    await logModerationAction({
      actorAdminUserId: req.session.userId,
      moderationReportId: updatedReport.id,
      action: 'RESOLVED_REPORT',
      notes,
    });

    setFlash(req, 'Report resolved.');
    return res.redirect('/admin');
  }));

  app.post('/admin/users/:id/toggle-suspension', requireAuth, requireAdmin, wrap(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.role === 'ADMIN') {
      setFlash(req, 'That user cannot be suspended.');
      return res.redirect('/admin');
    }

    await prisma.user.update({
      where: { id: target.id },
      data: { isSuspended: !target.isSuspended },
    });
    await logModerationAction({
      actorAdminUserId: req.session.userId,
      targetUserId: target.id,
      action: target.isSuspended ? 'RESTORED_USER' : 'SUSPENDED_USER',
      notes: target.isSuspended ? 'Admin restored the user account.' : 'Admin suspended the user account.',
    });

    await createNotification(
      target.id,
      'ACCOUNT_STATUS',
      target.isSuspended ? 'Account restored' : 'Account suspended',
      target.isSuspended ? 'An admin restored your account access.' : 'An admin suspended your account. Contact support if you believe this is a mistake.',
      '/login'
    );

    setFlash(req, target.isSuspended ? 'User restored.' : 'User suspended.');
    return res.redirect('/admin');
  }));

  app.post('/admin/users/:id/delete', requireAuth, requireAdmin, wrap(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.role === 'ADMIN') {
      setFlash(req, 'That user cannot be deleted.');
      return res.redirect('/admin');
    }

    const deletionState = await getUserDeletionEligibility(target);
    if (!deletionState.allowed) {
      setFlash(req, deletionState.reason);
      return res.redirect('/admin');
    }

    await prisma.user.delete({ where: { id: target.id } });
    setFlash(req, `${getRoleLabel(target.role)} account deleted.`);
    return res.redirect('/admin');
  }));

  app.post('/admin/disputes/:id/assign', requireAuth, requireAdmin, wrap(async (req, res) => {
    const adminUserId = String(req.body.adminUserId || '').trim() || null;
    const dispute = await prisma.dispute.findUnique({ where: { id: req.params.id } });
    if (!dispute) {
      setFlash(req, 'Dispute not found.');
      return res.redirect('/admin');
    }

    if (adminUserId) {
      const adminUser = await prisma.user.findUnique({ where: { id: adminUserId } });
      if (!adminUser || adminUser.role !== 'ADMIN') {
        setFlash(req, 'Choose a valid admin assignee.');
        return res.redirect('/admin');
      }
    }

    await prisma.dispute.update({
      where: { id: dispute.id },
      data: { assignedAdminUserId: adminUserId },
    });
    await logModerationAction({
      actorAdminUserId: req.session.userId,
      disputeId: dispute.id,
      action: 'ASSIGNED_DISPUTE',
      notes: adminUserId ? 'Assigned dispute to admin queue owner.' : 'Cleared dispute assignment.',
    });

    setFlash(req, adminUserId ? 'Dispute assigned.' : 'Dispute assignment cleared.');
    return res.redirect('/admin');
  }));

  app.post('/admin/disputes/:id/resolve', requireAuth, requireAdmin, wrap(async (req, res) => {
    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.id },
      include: { job: { include: { payment: true } } },
    });
    if (!dispute || dispute.status !== 'OPEN' || !dispute.job.payment) {
      setFlash(req, 'Dispute not found.');
      return res.redirect('/admin');
    }

    const resolution = String(req.body.resolution || '').trim();
    const resolutionNotes = String(req.body.resolutionNotes || '').trim();
    if (!['RELEASE_PAYMENT', 'REFUND_HOMEOWNER'].includes(resolution) || !resolutionNotes) {
      setFlash(req, 'Choose a resolution and add notes.');
      return res.redirect('/admin');
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
          ? { status: 'RELEASED', releasedAt: new Date() }
          : { status: 'REFUNDED' },
      }),
    ]);
    await logModerationAction({
      actorAdminUserId: req.session.userId,
      disputeId: dispute.id,
      action: 'RESOLVED_DISPUTE',
      notes: resolutionNotes,
    });

    setFlash(req, 'Dispute resolved by admin.');
    return res.redirect('/admin');
  }));
}

module.exports = {
  registerVerificationModerationRoutes,
};
