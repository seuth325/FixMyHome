const crypto = require('crypto');

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

function createRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

function logRequestEvent(level, message, details = {}) {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...details,
  };
  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
    return;
  }
  console.log(serialized);
}

function buildCsrfFailureRedirect(req) {
  const referer = req.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return url.pathname + url.search;
    } catch (_error) {
      return referer;
    }
  }
  if (req.path.startsWith('/admin')) return '/admin';
  if (req.path.startsWith('/login')) return '/login';
  if (req.path.startsWith('/signup')) return '/signup';
  if (req.path.startsWith('/forgot-password')) return '/forgot-password';
  return '/dashboard';
}

function setFlash(req, message) {
  req.session.flash = message;
}

function popFlash(req) {
  const msg = req.session.flash;
  delete req.session.flash;
  return msg;
}

function setFormState(req, key, values) {
  if (!req.session.formState) {
    req.session.formState = {};
  }
  req.session.formState[key] = values;
}

function popFormState(req, key, fallback = {}) {
  const values = req.session.formState?.[key];
  if (req.session.formState) {
    delete req.session.formState[key];
    if (Object.keys(req.session.formState).length === 0) {
      delete req.session.formState;
    }
  }
  return { ...fallback, ...(values || {}) };
}

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || 'unknown');
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  buildCsrfFailureRedirect,
  createRequestId,
  ensureCsrfToken,
  getClientIp,
  logRequestEvent,
  popFlash,
  popFormState,
  setFlash,
  setFormState,
  wrap,
};
