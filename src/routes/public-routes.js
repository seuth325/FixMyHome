function registerPublicRoutes(app, deps) {
  const {
    clearAuthSession,
    createRateLimitMiddleware,
    currentUser,
    getAppBaseUrl,
    getLegalNavItems,
    getSupportEmail,
    popFlash,
    sendContactMessageEmail,
    wrap,
  } = deps;

  app.get('/', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) {
      clearAuthSession(req);
      return res.redirect('/login');
    }
    return res.redirect(user.role === 'ADMIN' ? '/admin' : '/dashboard');
  }));

  app.get('/mockup', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (user) {
      return res.redirect(user.role === 'ADMIN' ? '/admin' : '/dashboard');
    }

    clearAuthSession(req);
    return res.redirect('/login');
  }));

  app.get('/terms', (req, res) => {
    res.render('terms', {
      flash: popFlash(req),
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      currentYear: new Date().getFullYear(),
      appBaseUrl: getAppBaseUrl(req),
    });
  });

  app.get('/privacy', (req, res) => {
    res.render('privacy', {
      flash: popFlash(req),
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      currentYear: new Date().getFullYear(),
      appBaseUrl: getAppBaseUrl(req),
    });
  });

  app.get('/refund-policy', (req, res) => {
    res.render('refund-policy', {
      flash: popFlash(req),
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      currentYear: new Date().getFullYear(),
      appBaseUrl: getAppBaseUrl(req),
    });
  });

  app.get('/about', (req, res) => {
    res.render('about', {
      flash: popFlash(req),
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      currentYear: new Date().getFullYear(),
      appBaseUrl: getAppBaseUrl(req),
    });
  });

  app.get('/contact', (req, res) => {
    res.render('contact', {
      flash: popFlash(req),
      message: null,
      formData: {
        name: '',
        email: '',
        subject: '',
        message: '',
      },
      errors: {},
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      currentYear: new Date().getFullYear(),
      appBaseUrl: getAppBaseUrl(req),
    });
  });

  app.post('/contact', createRateLimitMiddleware({
    action: 'contact',
    getIdentifier: (req) => String(req.body.email || '').trim().toLowerCase() || 'contact',
    onLimit: (_req, res) => {
      return res.render('contact', {
        flash: null,
        message: null,
        formData: {
          name: '',
          email: '',
          subject: '',
          message: '',
        },
        errors: { email: 'Too many contact requests. Please wait a few minutes and try again.' },
        supportEmail: getSupportEmail(),
        legalNavItems: getLegalNavItems(),
        currentYear: new Date().getFullYear(),
        appBaseUrl: getAppBaseUrl(_req),
      });
    },
  }), wrap(async (req, res) => {
    const formData = {
      name: String(req.body.name || '').trim(),
      email: String(req.body.email || '').trim(),
      subject: String(req.body.subject || '').trim(),
      message: String(req.body.message || '').trim(),
    };
    const errors = {};

    if (!formData.name) {
      errors.name = 'Name is required.';
    }
    if (!formData.email) {
      errors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (!formData.message) {
      errors.message = 'Message is required.';
    }

    if (Object.keys(errors).length) {
      return res.render('contact', {
        flash: null,
        message: null,
        formData,
        errors,
        supportEmail: getSupportEmail(),
        legalNavItems: getLegalNavItems(),
        currentYear: new Date().getFullYear(),
        appBaseUrl: getAppBaseUrl(req),
      });
    }

    const delivery = await sendContactMessageEmail(formData);
    if (!delivery.delivered) {
      console.log(`[contact-form] ${formData.email} (${formData.name}) -> ${formData.subject || 'No subject'}\n${formData.message}`);
    }

    return res.render('contact', {
      flash: null,
      message: 'Thanks for reaching out. Our team received your message and will follow up soon.',
      formData: {
        name: '',
        email: formData.email,
        subject: '',
        message: '',
      },
      errors: {},
      supportEmail: getSupportEmail(),
      legalNavItems: getLegalNavItems(),
      currentYear: new Date().getFullYear(),
      appBaseUrl: getAppBaseUrl(req),
    });
  }));
}

module.exports = {
  registerPublicRoutes,
};
