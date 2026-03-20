function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  return next();
}

function clearAuthSession(req) {
  if (!req.session) {
    return;
  }
  req.session.userId = null;
  req.session.role = null;
  req.session.userEmail = null;
  req.session.authVersion = null;
}

function createRequireAdmin({ prisma }) {
  return function requireAdmin(req, res, next) {
    if (!req.session.userId) {
      return res.redirect('/login');
    }
    if (req.session.role === 'ADMIN') {
      return next();
    }

    prisma.user.findUnique({
      where: { id: req.session.userId },
      select: {
        email: true,
        role: true,
        sessionVersion: true,
      },
    }).then((user) => {
      if (!user) {
        clearAuthSession(req);
        return res.redirect('/login');
      }

      if ((req.session.authVersion ?? 0) !== user.sessionVersion) {
        clearAuthSession(req);
        return res.redirect('/login');
      }

      req.session.role = user.role;
      req.session.userEmail = user.email;
      req.session.authVersion = user.sessionVersion;

      if (user.role !== 'ADMIN') {
        return res.redirect('/dashboard');
      }

      return next();
    }).catch(next);
  };
}

module.exports = {
  clearAuthSession,
  createRequireAdmin,
  requireAuth,
};
