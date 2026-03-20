function registerJobsAiRoutes(app, deps) {
  const {
    buildBidAssistSuggestion,
    buildJobAssistSuggestion,
    createRateLimitMiddleware,
    currentUser,
    geocodeLocation,
    parsePositiveInt,
    prisma,
    requireAuth,
    saveJobPhoto,
    setFlash,
    upload,
    wrap,
  } = deps;

  app.post('/api/ai/job-assist', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.role !== 'HOMEOWNER') {
      return res.status(403).json({ error: 'Only homeowners can use the job assistant.' });
    }

    const prompt = String(req.body.prompt || '').trim();
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const category = String(req.body.category || '').trim();
    const location = String(req.body.location || '').trim();
    const preferredDate = String(req.body.preferredDate || '').trim();

    if (!prompt && !title && !description) {
      return res.status(400).json({ error: 'Add a short task note, title, or description so the assistant has something to work with.' });
    }

    return res.json(buildJobAssistSuggestion({
      prompt,
      title,
      description,
      category,
      location,
      preferredDate,
    }));
  }));

  app.post('/api/ai/bid-assist', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.role !== 'HANDYMAN') {
      return res.status(403).json({ error: 'Only handymen can use the bid assistant.' });
    }

    const mode = String(req.body.mode || 'recommend').trim().toLowerCase();
    const jobId = String(req.body.jobId || '').trim();
    if (!jobId) {
      return res.status(400).json({ error: 'A job id is required for bid assistance.' });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        photos: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { bids: true } },
        bids: {
          where: { handymanId: user.id },
          take: 1,
        },
      },
    });

    if (!job || job.homeownerId === user.id) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const profile = await prisma.handymanProfile.findUnique({ where: { userId: user.id } });
    const currentBid = job.bids?.[0] || null;

    return res.json(buildBidAssistSuggestion({
      job,
      profile,
      currentBid,
      mode,
      currentMessage: String(req.body.message || ''),
    }));
  }));

  app.post('/jobs', requireAuth, createRateLimitMiddleware({
    action: 'jobPost',
    getIdentifier: (req) => String(req.session?.userId || 'job-post'),
    onLimit: (req, res) => {
      setFlash(req, 'Too many job posts too quickly. Please wait a few minutes and try again.');
      return res.redirect('/dashboard');
    },
  }), upload.array('photos', 5), wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user || user.role !== 'HOMEOWNER') {
      setFlash(req, 'Only homeowners can post jobs.');
      return res.redirect('/dashboard');
    }

    const title = String(req.body.title || '').trim();
    const category = String(req.body.category || '').trim();
    const description = String(req.body.description || '').trim();
    const location = String(req.body.location || '').trim();
    const budget = parsePositiveInt(req.body.budget);
    const preferredDate = String(req.body.preferredDate || '').trim();

    if (!title || !category || !description || !location || !budget) {
      setFlash(req, 'Title, category, description, location, and budget are required.');
      return res.redirect('/dashboard');
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const uploadedPhotoUrls = await Promise.all(files.map((file) => saveJobPhoto(file)));
    const jobGeocode = geocodeLocation(location);

    await prisma.job.create({
      data: {
        homeownerId: user.id,
        title,
        category,
        description,
        location,
        locationLat: jobGeocode?.latitude ?? null,
        locationLng: jobGeocode?.longitude ?? null,
        budget,
        preferredDate: preferredDate || null,
        status: 'OPEN',
        photos: uploadedPhotoUrls.length > 0
          ? {
              create: uploadedPhotoUrls.map((url, index) => ({
                url,
                sortOrder: index,
              })),
            }
          : undefined,
      },
    });

    setFlash(req, `Job posted successfully${files.length ? ` with ${files.length} photo${files.length === 1 ? '' : 's'}` : ''}.`);
    return res.redirect('/dashboard');
  }));

  app.post('/jobs/:id/edit', requireAuth, upload.array('photos', 5), wrap(async (req, res) => {
    const user = await currentUser(req);
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        bids: { select: { id: true } },
        photos: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!user || !job || job.homeownerId !== user.id) {
      setFlash(req, 'Job not found.');
      return res.redirect('/dashboard');
    }

    if (job.status !== 'OPEN') {
      setFlash(req, 'Only open jobs can be edited.');
      return res.redirect('/dashboard');
    }

    if (job.bids.length > 0) {
      setFlash(req, 'You can only edit a job before the first bid comes in.');
      return res.redirect('/dashboard');
    }

    const title = String(req.body.title || '').trim();
    const category = String(req.body.category || '').trim();
    const description = String(req.body.description || '').trim();
    const location = String(req.body.location || '').trim();
    const budget = parsePositiveInt(req.body.budget);
    const preferredDate = String(req.body.preferredDate || '').trim();

    if (!title || !category || !description || !location || !budget) {
      setFlash(req, 'Title, category, description, location, and budget are required.');
      return res.redirect('/dashboard');
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (job.photos.length + files.length > 5) {
      setFlash(req, `This job already has ${job.photos.length} photo${job.photos.length === 1 ? '' : 's'}. You can keep at most 5 total.`);
      return res.redirect('/dashboard');
    }

    const uploadedPhotoUrls = await Promise.all(files.map((file) => saveJobPhoto(file)));
    const locationGeocode = geocodeLocation(location);

    await prisma.job.update({
      where: { id: job.id },
      data: {
        title,
        category,
        description,
        location,
        locationLat: locationGeocode?.latitude ?? null,
        locationLng: locationGeocode?.longitude ?? null,
        budget,
        preferredDate: preferredDate || null,
        photos: uploadedPhotoUrls.length > 0
          ? {
              create: uploadedPhotoUrls.map((url, index) => ({
                url,
                sortOrder: job.photos.length + index,
              })),
            }
          : undefined,
      },
    });

    setFlash(req, `Job updated successfully${files.length ? ` with ${files.length} new photo${files.length === 1 ? '' : 's'}` : ''}.`);
    return res.redirect('/dashboard');
  }));

  app.post('/jobs/:id/delete', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        bids: { select: { id: true } },
        photos: { select: { id: true } },
        payment: { select: { id: true } },
        dispute: { select: { id: true } },
        review: { select: { id: true } },
      },
    });

    if (!user || !job || job.homeownerId !== user.id) {
      setFlash(req, 'Job not found.');
      return res.redirect('/dashboard');
    }

    if (job.status !== 'OPEN') {
      setFlash(req, 'Only open jobs can be deleted.');
      return res.redirect('/dashboard');
    }

    if (job.bids.length > 0) {
      setFlash(req, 'You can only delete a job before the first bid comes in.');
      return res.redirect('/dashboard');
    }

    await prisma.job.delete({
      where: { id: job.id },
    });

    setFlash(req, 'Job deleted successfully.');
    return res.redirect('/dashboard');
  }));

  app.post('/jobs/:jobId/photos/:photoId/delete', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const job = await prisma.job.findUnique({
      where: { id: req.params.jobId },
      include: {
        bids: { select: { id: true } },
        photos: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!user || !job || job.homeownerId !== user.id) {
      setFlash(req, 'Job not found.');
      return res.redirect('/dashboard');
    }
    if (job.status !== 'OPEN' || job.bids.length > 0) {
      setFlash(req, 'Photos can only be changed before the first bid arrives.');
      return res.redirect('/dashboard');
    }

    const photo = job.photos.find((entry) => entry.id === req.params.photoId);
    if (!photo) {
      setFlash(req, 'Photo not found.');
      return res.redirect('/dashboard');
    }

    await prisma.jobPhoto.delete({ where: { id: photo.id } });
    const remainingPhotos = job.photos.filter((entry) => entry.id !== photo.id);
    await Promise.all(remainingPhotos.map((entry, index) => prisma.jobPhoto.update({
      where: { id: entry.id },
      data: { sortOrder: index },
    })));

    setFlash(req, 'Photo removed.');
    return res.redirect('/dashboard');
  }));

  app.post('/jobs/:jobId/photos/:photoId/move', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const direction = String(req.body.direction || '').trim();
    const job = await prisma.job.findUnique({
      where: { id: req.params.jobId },
      include: {
        bids: { select: { id: true } },
        photos: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!user || !job || job.homeownerId !== user.id) {
      setFlash(req, 'Job not found.');
      return res.redirect('/dashboard');
    }
    if (job.status !== 'OPEN' || job.bids.length > 0) {
      setFlash(req, 'Photos can only be changed before the first bid arrives.');
      return res.redirect('/dashboard');
    }

    const currentIndex = job.photos.findIndex((entry) => entry.id === req.params.photoId);
    if (currentIndex === -1) {
      setFlash(req, 'Photo not found.');
      return res.redirect('/dashboard');
    }

    const targetIndex = direction === 'left'
      ? currentIndex - 1
      : direction === 'right'
        ? currentIndex + 1
        : currentIndex;

    if (targetIndex < 0 || targetIndex >= job.photos.length || targetIndex === currentIndex) {
      return res.redirect('/dashboard');
    }

    const orderedPhotos = [...job.photos];
    const [movedPhoto] = orderedPhotos.splice(currentIndex, 1);
    orderedPhotos.splice(targetIndex, 0, movedPhoto);

    await Promise.all(orderedPhotos.map((entry, index) => prisma.jobPhoto.update({
      where: { id: entry.id },
      data: { sortOrder: index },
    })));

    setFlash(req, 'Photo order updated.');
    return res.redirect('/dashboard');
  }));

  app.post('/jobs/:id/status', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { bids: true, review: true, payment: true, dispute: true } });
    if (!user || !job || job.homeownerId !== user.id) {
      setFlash(req, 'Job not found.');
      return res.redirect('/dashboard');
    }

    const action = String(req.body.action || '');
    if (action === 'review' && job.status === 'OPEN') {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'IN_REVIEW' } });
      setFlash(req, 'Job moved to In Review.');
      return res.redirect('/dashboard');
    }

    if (action === 'complete' && job.status === 'AWARDED') {
      if (!job.payment || job.payment.status !== 'FUNDED') {
        setFlash(req, 'Fund escrow before marking the job complete.');
        return res.redirect('/dashboard');
      }
      if (job.dispute && job.dispute.status === 'OPEN') {
        setFlash(req, 'Resolve the open dispute before completing the job.');
        return res.redirect('/dashboard');
      }
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      setFlash(req, 'Job marked completed. Leave a review below.');
      return res.redirect('/dashboard');
    }

    setFlash(req, 'That job update is not available right now.');
    return res.redirect('/dashboard');
  }));
}

module.exports = {
  registerJobsAiRoutes,
};
