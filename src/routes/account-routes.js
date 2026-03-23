function registerAccountRoutes(app, deps) {
  const {
    createNotification,
    currentUser,
    prisma,
    requireAuth,
    setFlash,
    wrap,
  } = deps;

  app.post('/notifications/read-all', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) {
      req.session.userId = null;
      return res.redirect('/login');
    }

    await prisma.userNotification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });

    return res.redirect(user.role === 'ADMIN' ? '/admin' : '/dashboard');
  }));

  app.post('/notifications/:id/read', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    const notification = await prisma.userNotification.findUnique({ where: { id: req.params.id } });
    if (!user || !notification || notification.userId !== user.id) {
      setFlash(req, 'Notification not found.');
      return res.redirect(user?.role === 'ADMIN' ? '/admin' : '/dashboard');
    }

    await prisma.userNotification.update({
      where: { id: notification.id },
      data: { isRead: true },
    });

    return res.redirect(notification.href || (user.role === 'ADMIN' ? '/admin' : '/dashboard'));
  }));

  app.get('/checkout/return', requireAuth, wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) {
      req.session.userId = null;
      return res.redirect('/login');
    }

    const status = String(req.query.status || '').trim();
    const providerSessionId = String(req.query.session_id || '').trim();
    const session = providerSessionId
      ? await prisma.checkoutSession.findUnique({ where: { providerSessionId } })
      : null;

    if (status === 'cancelled') {
      await createNotification(
        user.id,
        'ACCOUNT_STATUS',
        'Checkout cancelled',
        'Your payment checkout was cancelled. No billing changes were applied.',
        '/dashboard'
      );
      setFlash(req, 'Checkout was cancelled. No changes were applied.');
      return res.redirect('/dashboard');
    }

    if (!session || session.userId !== user.id) {
      setFlash(req, 'Checkout session not found.');
      return res.redirect('/dashboard');
    }

    if (session.status === 'COMPLETED') {
      await createNotification(
        user.id,
        'ACCOUNT_STATUS',
        'Checkout completed',
        'Your payment checkout completed successfully.',
        '/dashboard'
      );
      setFlash(req, 'Checkout completed successfully.');
    } else {
      await createNotification(
        user.id,
        'ACCOUNT_STATUS',
        'Checkout processing',
        'Your payment was submitted and is still processing. We will update your account shortly.',
        '/dashboard'
      );
      setFlash(req, 'Checkout is still processing. Refresh in a moment if the update has not appeared yet.');
    }

    return res.redirect('/dashboard');
  }));
}

module.exports = {
  registerAccountRoutes,
};
