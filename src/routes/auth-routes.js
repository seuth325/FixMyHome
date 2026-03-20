const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function registerAuthRoutes(app, deps) {
  const {
    prisma,
    createRateLimitMiddleware,
    wrap,
    popFlash,
    popFormState,
    setFormState,
    setFlash,
    getSupportEmail,
    getLegalNavItems,
    getLoginFooterNavItems,
    getAppBaseUrl,
    validatePasswordPolicy,
    geocodeLocation,
    isPasswordResetRateLimited,
    recordPasswordResetAttempt,
    isLikelyBcryptHash,
    sendPasswordResetEmail,
  } = deps;

  app.get('/signup', (req, res) => {
    res.render('signup', {
      flash: popFlash(req),
      formData: popFormState(req, 'signup', {
        name: '',
        email: '',
        location: '',
        role: '',
      }),
      errors: popFormState(req, 'signupErrors', {}),
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      currentYear: new Date().getFullYear(),
    });
  });

  app.post('/signup', createRateLimitMiddleware({
    action: 'signup',
    getIdentifier: (req) => String(req.body.email || '').trim().toLowerCase() || 'signup',
    onLimit: (req, res) => {
      setFormState(req, 'signup', {
        name: String(req.body.name || '').trim(),
        email: String(req.body.email || '').trim(),
        location: String(req.body.location || '').trim(),
        role: String(req.body.role || '').trim(),
      });
      setFormState(req, 'signupErrors', {
        email: 'Too many signup attempts. Please wait a few minutes and try again.',
      });
      return res.redirect('/signup');
    },
  }), wrap(async (req, res) => {
    const { email, password, confirmPassword, name, role, location } = req.body;
    const signupFormState = {
      name: String(name || '').trim(),
      email: String(email || '').trim(),
      location: String(location || '').trim(),
      role: String(role || '').trim(),
    };
    const signupErrors = {};
    if (!email || !password || !name || !role) {
      if (!String(name || '').trim()) signupErrors.name = 'Name is required.';
      if (!String(email || '').trim()) signupErrors.email = 'Email is required.';
      if (!String(password || '')) signupErrors.password = 'Password is required.';
      if (!String(role || '').trim()) signupErrors.role = 'Choose a homeowner or handyman role.';
      setFormState(req, 'signup', signupFormState);
      setFormState(req, 'signupErrors', signupErrors);
      return res.redirect('/signup');
    }

    const passwordPolicyError = validatePasswordPolicy(password);
    if (passwordPolicyError) {
      setFormState(req, 'signup', signupFormState);
      setFormState(req, 'signupErrors', { password: passwordPolicyError });
      return res.redirect('/signup');
    }

    if (password !== String(confirmPassword || '')) {
      setFormState(req, 'signup', signupFormState);
      setFormState(req, 'signupErrors', { confirmPassword: 'Passwords do not match.' });
      return res.redirect('/signup');
    }

    if (!['HOMEOWNER', 'HANDYMAN'].includes(role)) {
      setFormState(req, 'signup', signupFormState);
      setFormState(req, 'signupErrors', { role: 'Choose a valid role.' });
      return res.redirect('/signup');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      setFormState(req, 'login', { email: normalizedEmail });
      setFlash(req, 'Email already exists. Log in instead.');
      return res.redirect('/login');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const normalizedLocation = location ? String(location).trim() : null;
    const signupGeocode = geocodeLocation(normalizedLocation);

    await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: String(name).trim(),
        passwordHash,
        role,
        location: normalizedLocation,
        locationLat: signupGeocode?.latitude ?? null,
        locationLng: signupGeocode?.longitude ?? null,
        handymanProfile: role === 'HANDYMAN'
          ? {
              create: {
                skills: [],
                serviceRadius: 15,
                subscriptionPlan: 'FREE',
                leadCredits: 3,
              },
            }
          : undefined,
      },
    });

    setFormState(req, 'login', { email: normalizedEmail });
    setFlash(req, 'Account created. Please log in.');
    return res.redirect('/login');
  }));

  app.get('/login', (req, res) => {
    res.render('login', {
      flash: popFlash(req) || (String(req.query.accountDeleted || '') === '1' ? 'Account deleted successfully.' : null),
      formData: popFormState(req, 'login', {
        email: '',
      }),
      errors: popFormState(req, 'loginErrors', {}),
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      footerNavItems: getLoginFooterNavItems(),
      showFooterSupportEmail: false,
      currentYear: new Date().getFullYear(),
    });
  });

  app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', {
      flash: popFlash(req),
      message: null,
      email: '',
      errors: {},
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      currentYear: new Date().getFullYear(),
    });
  });

  app.post('/forgot-password', wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.render('forgot-password', {
        flash: null,
        message: null,
        email: '',
        errors: { email: 'Email is required.' },
        supportEmail: getSupportEmail(),
        legalNavItems: getLegalNavItems(),
        currentYear: new Date().getFullYear(),
      });
    }

    if (isPasswordResetRateLimited(req, email)) {
      return res.render('forgot-password', {
        flash: null,
        message: null,
        email,
        errors: { email: 'Too many reset requests. Please wait a few minutes and try again.' },
        supportEmail: getSupportEmail(),
        legalNavItems: getLegalNavItems(),
        currentYear: new Date().getFullYear(),
      });
    }

    recordPasswordResetAttempt(req, email);

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      await prisma.passwordResetToken.deleteMany({
        where: {
          userId: user.id,
          usedAt: null,
        },
      });

      const token = crypto.randomBytes(24).toString('hex');
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token,
          expiresAt: new Date(Date.now() + (60 * 60 * 1000)),
        },
      });

      const resetUrl = `${getAppBaseUrl(req)}/reset-password/${token}`;
      const delivery = await sendPasswordResetEmail({
        to: email,
        resetUrl,
      });

      if (!delivery.delivered) {
        console.log(`[password-reset] ${email} -> ${resetUrl}`);
      }
    }

    return res.render('forgot-password', {
      flash: null,
      message: 'If that account exists, a password reset email has been sent. Please check your inbox and spam folder.',
      email,
      errors: {},
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      currentYear: new Date().getFullYear(),
    });
  }));

  app.get('/reset-password/:token', wrap(async (req, res) => {
    const token = String(req.params.token || '').trim();
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    const tokenValid = Boolean(resetToken && !resetToken.usedAt && resetToken.expiresAt > new Date());

    return res.render('reset-password', {
      flash: popFlash(req),
      token,
      tokenValid,
      errors: {},
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      currentYear: new Date().getFullYear(),
    });
  }));

  app.post('/reset-password/:token', wrap(async (req, res) => {
    const token = String(req.params.token || '').trim();
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    const tokenValid = Boolean(resetToken && !resetToken.usedAt && resetToken.expiresAt > new Date());
    if (!tokenValid) {
      return res.render('reset-password', {
        flash: 'This reset link is invalid or has expired.',
        token,
        tokenValid: false,
        errors: {},
        supportEmail: getSupportEmail(),
        legalNavItems: getLegalNavItems(),
        currentYear: new Date().getFullYear(),
      });
    }

    const passwordPolicyError = validatePasswordPolicy(password);
    if (passwordPolicyError) {
      return res.render('reset-password', {
        flash: null,
        token,
        tokenValid: true,
        errors: { password: passwordPolicyError },
        supportEmail: getSupportEmail(),
        legalNavItems: getLegalNavItems(),
        currentYear: new Date().getFullYear(),
      });
    }

    if (password !== confirmPassword) {
      return res.render('reset-password', {
        flash: null,
        token,
        tokenValid: true,
        errors: { confirmPassword: 'Passwords do not match.' },
        supportEmail: getSupportEmail(),
        legalNavItems: getLegalNavItems(),
        currentYear: new Date().getFullYear(),
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: resetToken.userId },
    });

    if (!user) {
      return res.render('reset-password', {
        flash: 'This reset link is invalid or has expired.',
        token,
        tokenValid: false,
        errors: {},
        supportEmail: getSupportEmail(),
        legalNavItems: getLegalNavItems(),
        currentYear: new Date().getFullYear(),
      });
    }

    const reusingCurrentPassword = isLikelyBcryptHash(user.passwordHash)
      ? await bcrypt.compare(password, user.passwordHash)
      : false;
    if (reusingCurrentPassword) {
      return res.render('reset-password', {
        flash: null,
        token,
        tokenValid: true,
        errors: { password: 'Choose a new password that is different from your current one.' },
        supportEmail: getSupportEmail(),
        legalNavItems: getLegalNavItems(),
        currentYear: new Date().getFullYear(),
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash,
        sessionVersion: {
          increment: 1,
        },
      },
    });

    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    await prisma.passwordResetToken.deleteMany({
      where: {
        userId: resetToken.userId,
        usedAt: null,
      },
    });

    setFlash(req, 'Password reset successfully. Please log in with your new password.');
    return res.redirect('/login');
  }));

  app.post('/login', createRateLimitMiddleware({
    action: 'login',
    getIdentifier: (req) => String(req.body.email || '').trim().toLowerCase() || 'login',
    onLimit: (req, res) => {
      setFormState(req, 'login', {
        email: String(req.body.email || '').trim(),
      });
      setFormState(req, 'loginErrors', {
        email: 'Too many login attempts. Please wait a few minutes and try again.',
      });
      return res.redirect('/login');
    },
  }), wrap(async (req, res) => {
    const { email, password } = req.body;
    const loginFormState = {
      email: String(email || '').trim(),
    };
    if (!email || !password) {
      setFormState(req, 'login', loginFormState);
      setFormState(req, 'loginErrors', {
        ...(String(email || '').trim() ? {} : { email: 'Email is required.' }),
        ...(String(password || '') ? {} : { password: 'Password is required.' }),
      });
      return res.redirect('/login');
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) {
      setFormState(req, 'login', loginFormState);
      setFormState(req, 'loginErrors', {
        email: 'Invalid email or password.',
        password: 'Invalid email or password.',
      });
      return res.redirect('/login');
    }

    if (user.isSuspended) {
      setFormState(req, 'login', loginFormState);
      setFormState(req, 'loginErrors', {
        email: 'This account has been suspended. Contact support if you believe this is a mistake.',
      });
      return res.redirect('/login');
    }

    if (!isLikelyBcryptHash(user.passwordHash)) {
      setFormState(req, 'login', loginFormState);
      setFormState(req, 'loginErrors', {
        email: 'This account needs a password reset before it can be used. Use Forgot password to set a new password.',
      });
      return res.redirect('/login');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      setFormState(req, 'login', loginFormState);
      setFormState(req, 'loginErrors', {
        email: 'Invalid email or password.',
        password: 'Invalid email or password.',
      });
      return res.redirect('/login');
    }

    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.userEmail = user.email;
    req.session.authVersion = user.sessionVersion;
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    delete req.session.formState;
    delete req.session.flash;
    await new Promise((resolve, reject) => {
      req.session.save((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    return res.redirect(user.role === 'ADMIN' ? '/admin' : '/dashboard');
  }));

  app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });
}

module.exports = {
  registerAuthRoutes,
};


