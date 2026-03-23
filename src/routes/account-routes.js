function registerAccountRoutes(app, deps) {
  const {
    createNotification,
    currentUser,
    prisma,
    requireAuth,
    setFlash,
    wrap,
  } = deps;

  function getDashboardNotificationHref(filterValue) {
    const filter = String(filterValue || '').trim().toUpperCase();
    if (!filter || filter === 'ALL') return '/dashboard';
    return `/dashboard?notificationFilter=${encodeURIComponent(filter)}`;
  }

  function withNotificationFilter(href, filterValue) {
    const filter = String(filterValue || '').trim().toUpperCase();
    if (!filter || filter === 'ALL') return href;
    const separator = href.includes('?') ? '&' : '?';
    return `${href}${separator}notificationFilter=${encodeURIComponent(filter)}`;
  }

  app.post('/notifications/read-all', requireAuth, wrap(async (req, res) => {
    const notificationFilter = String(req.query.notificationFilter || '').trim().toUpperCase();
    const dashboardHref = getDashboardNotificationHref(notificationFilter);
    const user = await currentUser(req);
    if (!user) {
      req.session.userId = null;
      return res.redirect('/login');
    }

    await prisma.userNotification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });

    return res.redirect(user.role === 'ADMIN' ? '/admin' : dashboardHref);
  }));

  app.post('/notifications/:id/read', requireAuth, wrap(async (req, res) => {
    const notificationFilter = String(req.query.notificationFilter || '').trim().toUpperCase();
    const dashboardHref = getDashboardNotificationHref(notificationFilter);
    const user = await currentUser(req);
    const notification = await prisma.userNotification.findUnique({ where: { id: req.params.id } });
    if (!user || !notification || notification.userId !== user.id) {
      setFlash(req, 'Notification not found.');
      return res.redirect(user?.role === 'ADMIN' ? '/admin' : dashboardHref);
    }

    await prisma.userNotification.update({
      where: { id: notification.id },
      data: { isRead: true },
    });

    if (user.role === 'ADMIN') {
      return res.redirect(notification.href || '/admin');
    }

    if (notification.href && notification.href.startsWith('/dashboard')) {
      return res.redirect(withNotificationFilter(notification.href, notificationFilter));
    }

    return res.redirect(notification.href || dashboardHref);
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
