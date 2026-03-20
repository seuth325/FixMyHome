function registerAdminSupportWriteRoutes(app, deps) {
  const {
    logSupportCaseActivity,
    notifySupportCaseAdmins,
    prisma,
    requireAdmin,
    requireAuth,
    saveSupportCaseAttachment,
    setFlash,
    supportCaseAttachmentUpload,
    wrap,
  } = deps;

  app.post('/admin/support-cases/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
    const supportCase = await prisma.supportCase.findUnique({ where: { id: req.params.id } });
    if (!supportCase) {
      setFlash(req, 'Support case not found.');
      return res.redirect('/admin');
    }

    const notes = String(req.body.notes || '').trim();
    const assignedAdminUserId = String(req.body.assignedAdminUserId || '').trim() || null;
    const nextStatus = String(req.body.status || '').trim().toUpperCase();
    if (!['OPEN', 'CLOSED'].includes(nextStatus)) {
      setFlash(req, 'Choose a valid support case status.');
      return res.redirect('/admin/support-cases/' + supportCase.id);
    }

    if (assignedAdminUserId) {
      const adminUser = await prisma.user.findUnique({ where: { id: assignedAdminUserId } });
      if (!adminUser || adminUser.role !== 'ADMIN') {
        setFlash(req, 'Choose a valid support case owner.');
        return res.redirect('/admin/support-cases/' + supportCase.id);
      }
    }

    await prisma.supportCase.update({
      where: { id: supportCase.id },
      data: {
        status: nextStatus,
        assignedAdminUserId,
        notes: notes || null,
        notesUpdatedAt: notes ? new Date() : null,
      },
    });

    const activityEntries = [];
    if (supportCase.assignedAdminUserId !== assignedAdminUserId) {
      const ownerLabel = assignedAdminUserId ? 'Assigned case to a new owner.' : 'Cleared case owner.';
      activityEntries.push(logSupportCaseActivity({
        supportCaseId: supportCase.id,
        actorAdminUserId: req.session.userId,
        type: 'REASSIGNED',
        message: ownerLabel,
      }));
    }
    if ((supportCase.notes || '') !== (notes || '')) {
      activityEntries.push(logSupportCaseActivity({
        supportCaseId: supportCase.id,
        actorAdminUserId: req.session.userId,
        type: 'UPDATED_NOTES',
        message: notes ? 'Updated internal case notes.' : 'Cleared internal case notes.',
      }));
    }
    if (supportCase.status !== nextStatus) {
      activityEntries.push(logSupportCaseActivity({
        supportCaseId: supportCase.id,
        actorAdminUserId: req.session.userId,
        type: 'STATUS_CHANGED',
        message: nextStatus === 'CLOSED' ? 'Closed support case.' : 'Reopened support case.',
      }));
    }
    if (activityEntries.length > 0) {
      await Promise.all(activityEntries);
    }

    if (activityEntries.length > 0) {
      const notificationTitle = supportCase.assignedAdminUserId !== assignedAdminUserId && assignedAdminUserId
        ? 'Support case assigned'
        : 'Support case updated';
      const notificationBody = notificationTitle === 'Support case assigned'
        ? supportCase.title + ' was assigned for follow-up.'
        : supportCase.title + ' has new case updates.';

      await notifySupportCaseAdmins({
        actorAdminUserId: req.session.userId,
        supportCaseId: supportCase.id,
        title: notificationTitle,
        body: notificationBody,
        href: '/admin/support-cases/' + supportCase.id,
        mode: notificationTitle === 'Support case assigned' ? 'all_admins' : 'watchers',
      });
    }

    setFlash(req, 'Support case updated.');
    return res.redirect('/admin/support-cases/' + supportCase.id);
  }));

  app.post('/admin/support-cases/:id/comments', requireAuth, requireAdmin, wrap(async (req, res) => {
    const body = String(req.body.body || '').trim();
    if (!body) {
      setFlash(req, 'Add a comment before posting to the case thread.');
      return res.redirect('/admin/support-cases/' + req.params.id);
    }

    const supportCase = await prisma.supportCase.findUnique({ where: { id: req.params.id } });
    if (!supportCase) {
      setFlash(req, 'Support case not found.');
      return res.redirect('/admin');
    }

    await prisma.supportCaseComment.create({
      data: {
        supportCaseId: supportCase.id,
        authorAdminUserId: req.session.userId,
        body,
      },
    });

    await logSupportCaseActivity({
      supportCaseId: supportCase.id,
      actorAdminUserId: req.session.userId,
      type: 'COMMENTED',
      message: 'Added an internal case comment.',
    });

    await notifySupportCaseAdmins({
      actorAdminUserId: req.session.userId,
      supportCaseId: supportCase.id,
      title: 'New support case comment',
      body: supportCase.title + ' has a new internal comment.',
      href: '/admin/support-cases/' + supportCase.id,
    });

    setFlash(req, 'Support case comment added.');
    return res.redirect('/admin/support-cases/' + supportCase.id);
  }));

  app.post('/admin/support-cases/:id/attachments', requireAuth, requireAdmin, supportCaseAttachmentUpload.array('attachments', 3), wrap(async (req, res) => {
    const supportCase = await prisma.supportCase.findUnique({ where: { id: req.params.id } });
    if (!supportCase) {
      setFlash(req, 'Support case not found.');
      return res.redirect('/admin');
    }

    const files = Array.isArray(req.files) ? req.files.filter(Boolean) : [];
    if (files.length === 0) {
      setFlash(req, 'Choose at least one attachment before uploading evidence.');
      return res.redirect('/admin/support-cases/' + supportCase.id);
    }

    const uploadedFiles = await Promise.all(files.map(async (file) => ({
      url: await saveSupportCaseAttachment(file),
      filename: file.originalname || 'attachment',
      mimeType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size || 0,
    })));

    await prisma.supportCaseAttachment.createMany({
      data: uploadedFiles.map((file) => ({
        supportCaseId: supportCase.id,
        uploadedByAdminUserId: req.session.userId,
        url: file.url,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      })),
    });

    await logSupportCaseActivity({
      supportCaseId: supportCase.id,
      actorAdminUserId: req.session.userId,
      type: 'ATTACHMENT_UPLOADED',
      message: uploadedFiles.length === 1 ? 'Uploaded case evidence attachment.' : 'Uploaded case evidence attachments.',
    });

    await notifySupportCaseAdmins({
      actorAdminUserId: req.session.userId,
      supportCaseId: supportCase.id,
      title: 'Support case evidence added',
      body: supportCase.title + ' has new evidence attachments.',
      href: '/admin/support-cases/' + supportCase.id,
    });

    setFlash(req, uploadedFiles.length === 1 ? 'Support case attachment uploaded.' : 'Support case attachments uploaded.');
    return res.redirect('/admin/support-cases/' + supportCase.id);
  }));

  app.post('/admin/support-cases/:id/attachments/:attachmentId', requireAuth, requireAdmin, wrap(async (req, res) => {
    const note = String(req.body.note || '').trim();
    const attachment = await prisma.supportCaseAttachment.findUnique({ where: { id: req.params.attachmentId } });
    if (!attachment || attachment.supportCaseId !== req.params.id) {
      setFlash(req, 'Support case attachment not found.');
      return res.redirect('/admin/support-cases/' + req.params.id);
    }

    await prisma.supportCaseAttachment.update({
      where: { id: attachment.id },
      data: { note: note || null },
    });

    await logSupportCaseActivity({
      supportCaseId: attachment.supportCaseId,
      actorAdminUserId: req.session.userId,
      type: 'ATTACHMENT_UPDATED',
      message: note ? 'Updated attachment notes.' : 'Cleared attachment notes.',
    });

    await notifySupportCaseAdmins({
      actorAdminUserId: req.session.userId,
      supportCaseId: attachment.supportCaseId,
      title: 'Support case evidence updated',
      body: 'Attachment notes changed on a support case.',
      href: '/admin/support-cases/' + attachment.supportCaseId,
    });

    setFlash(req, 'Attachment notes updated.');
    return res.redirect('/admin/support-cases/' + attachment.supportCaseId);
  }));

  app.post('/admin/support-cases/:id/attachments/:attachmentId/archive', requireAuth, requireAdmin, wrap(async (req, res) => {
    const action = String(req.body.action || '').trim().toLowerCase();
    const attachment = await prisma.supportCaseAttachment.findUnique({ where: { id: req.params.attachmentId } });
    if (!attachment || attachment.supportCaseId !== req.params.id) {
      setFlash(req, 'Support case attachment not found.');
      return res.redirect('/admin/support-cases/' + req.params.id);
    }

    if (action === 'archive') {
      await prisma.supportCaseAttachment.update({
        where: { id: attachment.id },
        data: {
          archivedAt: new Date(),
          archivedByAdminUserId: req.session.userId,
        },
      });

      await logSupportCaseActivity({
        supportCaseId: attachment.supportCaseId,
        actorAdminUserId: req.session.userId,
        type: 'ATTACHMENT_ARCHIVED',
        message: 'Archived a case evidence attachment.',
      });

      await notifySupportCaseAdmins({
        actorAdminUserId: req.session.userId,
        supportCaseId: attachment.supportCaseId,
        title: 'Support case evidence archived',
        body: attachment.filename + ' was archived on a support case.',
        href: '/admin/support-cases/' + attachment.supportCaseId,
      });

      setFlash(req, 'Attachment archived.');
      return res.redirect('/admin/support-cases/' + attachment.supportCaseId);
    }

    if (action === 'restore') {
      await prisma.supportCaseAttachment.update({
        where: { id: attachment.id },
        data: {
          archivedAt: null,
          archivedByAdminUserId: null,
        },
      });

      await logSupportCaseActivity({
        supportCaseId: attachment.supportCaseId,
        actorAdminUserId: req.session.userId,
        type: 'ATTACHMENT_ARCHIVED',
        message: 'Restored a case evidence attachment from archive.',
      });

      await notifySupportCaseAdmins({
        actorAdminUserId: req.session.userId,
        supportCaseId: attachment.supportCaseId,
        title: 'Support case evidence restored',
        body: attachment.filename + ' was restored to an active support case.',
        href: '/admin/support-cases/' + attachment.supportCaseId,
      });

      setFlash(req, 'Attachment restored.');
      return res.redirect('/admin/support-cases/' + attachment.supportCaseId);
    }

    setFlash(req, 'Choose a valid attachment action.');
    return res.redirect('/admin/support-cases/' + attachment.supportCaseId);
  }));

  app.post('/admin/support-cases/:id/attachments/:attachmentId/delete', requireAuth, requireAdmin, wrap(async (req, res) => {
    const attachment = await prisma.supportCaseAttachment.findUnique({ where: { id: req.params.attachmentId } });
    if (!attachment || attachment.supportCaseId !== req.params.id) {
      setFlash(req, 'Support case attachment not found.');
      return res.redirect('/admin/support-cases/' + req.params.id);
    }

    await prisma.supportCaseAttachment.delete({ where: { id: attachment.id } });

    await logSupportCaseActivity({
      supportCaseId: attachment.supportCaseId,
      actorAdminUserId: req.session.userId,
      type: 'ATTACHMENT_DELETED',
      message: 'Deleted a case evidence attachment.',
    });

    await notifySupportCaseAdmins({
      actorAdminUserId: req.session.userId,
      supportCaseId: attachment.supportCaseId,
      title: 'Support case evidence deleted',
      body: attachment.filename + ' was removed from a support case.',
      href: '/admin/support-cases/' + attachment.supportCaseId,
    });

    setFlash(req, 'Attachment deleted.');
    return res.redirect('/admin/support-cases/' + attachment.supportCaseId);
  }));

  app.post('/admin/support-cases/:id/comments/:commentId', requireAuth, requireAdmin, wrap(async (req, res) => {
    const body = String(req.body.body || '').trim();
    if (!body) {
      setFlash(req, 'Add comment text before saving your edit.');
      return res.redirect('/admin/support-cases/' + req.params.id);
    }

    const comment = await prisma.supportCaseComment.findUnique({
      where: { id: req.params.commentId },
      include: { supportCase: true },
    });
    if (!comment || comment.supportCaseId !== req.params.id) {
      setFlash(req, 'Support case comment not found.');
      return res.redirect('/admin/support-cases/' + req.params.id);
    }

    await prisma.supportCaseComment.update({
      where: { id: comment.id },
      data: { body },
    });

    await logSupportCaseActivity({
      supportCaseId: comment.supportCaseId,
      actorAdminUserId: req.session.userId,
      type: 'COMMENT_EDITED',
      message: 'Edited an internal case comment.',
    });

    await notifySupportCaseAdmins({
      actorAdminUserId: req.session.userId,
      supportCaseId: comment.supportCaseId,
      title: 'Support case comment updated',
      body: 'An internal support case comment was edited.',
      href: '/admin/support-cases/' + comment.supportCaseId,
    });

    setFlash(req, 'Support case comment updated.');
    return res.redirect('/admin/support-cases/' + comment.supportCaseId);
  }));

  app.post('/admin/support-cases/:id/comments/:commentId/resolution', requireAuth, requireAdmin, wrap(async (req, res) => {
    const action = String(req.body.action || '').trim().toLowerCase();
    const comment = await prisma.supportCaseComment.findUnique({ where: { id: req.params.commentId } });
    if (!comment || comment.supportCaseId !== req.params.id) {
      setFlash(req, 'Support case comment not found.');
      return res.redirect('/admin/support-cases/' + req.params.id);
    }

    if (action === 'mark') {
      await prisma.$transaction([
        prisma.supportCaseComment.updateMany({
          where: { supportCaseId: comment.supportCaseId },
          data: { isResolution: false },
        }),
        prisma.supportCaseComment.update({
          where: { id: comment.id },
          data: { isResolution: true },
        }),
      ]);

      await logSupportCaseActivity({
        supportCaseId: comment.supportCaseId,
        actorAdminUserId: req.session.userId,
        type: 'COMMENT_MARKED',
        message: 'Marked a case comment as the current answer.',
      });

      await notifySupportCaseAdmins({
        actorAdminUserId: req.session.userId,
        supportCaseId: comment.supportCaseId,
        title: 'Support case answer updated',
        body: 'A comment was marked as the current answer on a support case.',
        href: '/admin/support-cases/' + comment.supportCaseId,
      });

      setFlash(req, 'Current answer updated for this support case.');
      return res.redirect('/admin/support-cases/' + comment.supportCaseId);
    }

    if (action === 'clear') {
      await prisma.supportCaseComment.update({
        where: { id: comment.id },
        data: { isResolution: false },
      });

      await logSupportCaseActivity({
        supportCaseId: comment.supportCaseId,
        actorAdminUserId: req.session.userId,
        type: 'COMMENT_MARKED',
        message: 'Cleared the current answer marker from a case comment.',
      });

      await notifySupportCaseAdmins({
        actorAdminUserId: req.session.userId,
        supportCaseId: comment.supportCaseId,
        title: 'Support case answer cleared',
        body: 'The current answer marker was removed from a support case comment.',
        href: '/admin/support-cases/' + comment.supportCaseId,
      });

      setFlash(req, 'Current answer cleared for this support case.');
      return res.redirect('/admin/support-cases/' + comment.supportCaseId);
    }

    setFlash(req, 'Choose a valid comment action.');
    return res.redirect('/admin/support-cases/' + comment.supportCaseId);
  }));

  app.post('/admin/support-cases/:id/status', requireAuth, requireAdmin, wrap(async (req, res) => {
    const nextStatus = String(req.body.status || '').trim().toUpperCase();
    if (!['OPEN', 'CLOSED'].includes(nextStatus)) {
      setFlash(req, 'Choose a valid support case status.');
      return res.redirect('/admin');
    }

    const supportCase = await prisma.supportCase.findUnique({ where: { id: req.params.id } });
    if (!supportCase) {
      setFlash(req, 'Support case not found.');
      return res.redirect('/admin');
    }

    await prisma.supportCase.update({
      where: { id: supportCase.id },
      data: { status: nextStatus },
    });

    await logSupportCaseActivity({
      supportCaseId: supportCase.id,
      actorAdminUserId: req.session.userId,
      type: 'STATUS_CHANGED',
      message: nextStatus === 'CLOSED' ? 'Closed support case.' : 'Reopened support case.',
    });

    await notifySupportCaseAdmins({
      actorAdminUserId: req.session.userId,
      supportCaseId: supportCase.id,
      title: nextStatus === 'CLOSED' ? 'Support case closed' : 'Support case reopened',
      body: supportCase.title + (nextStatus === 'CLOSED' ? ' was closed.' : ' was reopened.'),
      href: '/admin/support-cases/' + supportCase.id,
      mode: 'all_admins',
    });

    setFlash(req, nextStatus === 'CLOSED' ? 'Support case closed.' : 'Support case reopened.');
    return res.redirect('/admin');
  }));
}

module.exports = {
  registerAdminSupportWriteRoutes,
};
