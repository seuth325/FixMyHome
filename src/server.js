const express = require('express');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const { prisma } = require('./lib/prisma');
const { PrismaSessionStore } = require('./lib/session-store');
const { saveJobPhoto, saveSupportCaseAttachment, getSupportCaseAttachmentLocalPath } = require('./lib/storage');
const { extractZip, geocodeLocation, haversineDistanceMiles, normalizeLocation } = require('./lib/geocode');
const { sendPasswordResetEmail, sendContactMessageEmail } = require('./lib/mailer');
const { STRIPE_PROVIDER_NAME, buildWebhookEvent, createBillingPortalSession, createCheckoutSession, getPaymentProvider, signPayload, verifyWebhookRequest } = require('./lib/payments');
const { initializeMonitoring, setMonitoringUser, clearMonitoringUser, captureAppError } = require('./lib/monitoring');

const app = express();
const PORT = process.env.PORT || 3000;
const monitoringStatus = initializeMonitoring({
  app,
  release: process.env.SENTRY_RELEASE || 'fixmyhome-web',
});
const PLAN_CONFIG = {
  FREE: { name: 'Free', monthlyCredits: 3, unlimitedBids: false, cta: 'Stay free' },
  PLUS: { name: 'Plus', monthlyCredits: 12, unlimitedBids: false, cta: 'Upgrade to Plus' },
  PRO: { name: 'Pro', monthlyCredits: null, unlimitedBids: true, cta: 'Upgrade to Pro' },
};

const CREDIT_PACKS = {
  STARTER: { credits: 5, label: 'Starter pack', amount: 2900 },
  GROWTH: { credits: 15, label: 'Growth pack', amount: 6900 },
};

const PLAN_PRICING = {
  FREE: 0,
  PLUS: 2900,
  PRO: 7900,
};

const PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RESET_RATE_LIMIT_MAX_ATTEMPTS = 5;
const passwordResetAttempts = new Map();
const ACTION_RATE_LIMITS = {
  login: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
  signup: { windowMs: 30 * 60 * 1000, maxAttempts: 5 },
  contact: { windowMs: 15 * 60 * 1000, maxAttempts: 6 },
  jobPost: { windowMs: 15 * 60 * 1000, maxAttempts: 8 },
  bidSubmit: { windowMs: 15 * 60 * 1000, maxAttempts: 15 },
  adminPost: { windowMs: 10 * 60 * 1000, maxAttempts: 120 },
};
const actionRateLimitBuckets = new Map();
const REQUEST_LOG_SKIP_PREFIXES = ['/public/', '/uploads/'];
const REQUEST_LOG_SKIP_PATHS = new Set(['/favicon.ico', '/health', '/healthz']);
const DEFAULT_SUPPORT_EMAIL = 'support@fixmyhome.pro';

const JOB_CATEGORIES = [
  'General Handyman',
  'Painting',
  'Furniture Assembly',
  'Electrical',
  'Plumbing',
  'Yard Help',
  'Installations',
  'Repairs',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 5,
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    return cb(new Error('Only image uploads are allowed.'));
  },
});

const supportCaseAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 3,
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = new Set([
      'application/pdf',
      'text/plain',
      'application/json',
      'text/csv',
      'application/vnd.ms-excel',
    ]);
    if ((file.mimetype && file.mimetype.startsWith('image/')) || allowedMimeTypes.has(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only images, PDFs, text, JSON, and CSV attachments are allowed.'));
  },
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
}));
app.use(express.static(path.join(__dirname, '..', 'public')));
const sessionSecret = process.env.SESSION_SECRET || 'change-me-in-production';
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && sessionSecret === 'change-me-in-production') {
  throw new Error('SESSION_SECRET must be set in production.');
}
const trustProxy = Number.parseInt(String(process.env.TRUST_PROXY || '0'), 10);
if (Number.isFinite(trustProxy) && trustProxy > 0) {
  app.set('trust proxy', trustProxy);
}
app.use(
  session({
    store: new PrismaSessionStore(prisma),
    name: process.env.SESSION_COOKIE_NAME || 'fixmyhome.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: isProduction,
    rolling: true,
    unset: 'destroy',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.SESSION_COOKIE_SECURE
        ? process.env.SESSION_COOKIE_SECURE === 'true'
        : isProduction,
      maxAge: Number.parseInt(String(process.env.SESSION_COOKIE_MAX_AGE_MS || ''), 10) || (7 * 24 * 60 * 60 * 1000),
    },
  })
);

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

function createRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

function shouldSkipRequestLog(req) {
  if (REQUEST_LOG_SKIP_PATHS.has(req.path)) {
    return true;
  }
  return REQUEST_LOG_SKIP_PREFIXES.some((prefix) => req.path.startsWith(prefix));
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

function getAppBaseUrl(req) {
  const configured = String(process.env.APP_BASE_URL || '').trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  if (req) {
    const protocol = req.protocol || 'http';
    const host = req.get('host');
    if (host) {
      return `${protocol}://${host}`.replace(/\/+$/, '');
    }
  }
  return `http://localhost:${PORT}`;
}

function getSupportEmail() {
  return String(process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL).trim() || DEFAULT_SUPPORT_EMAIL;
}

function getLegalNavItems() {
  return [
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/refund-policy', label: 'Refund policy' },
  ];
}

function isLikelyBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

function getLoginFooterNavItems() {
  return [
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/about', label: 'About Us' },
    { href: '/contact', label: 'Contact Us' },
  ];
}

function buildSupportCaseAttachmentHref(supportCaseId, attachmentId) {
  return `/admin/support-cases/${supportCaseId}/attachments/${attachmentId}/file`;
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

app.use((req, res, next) => {
  req.requestId = createRequestId();
  res.locals.requestId = req.requestId;
  res.setHeader('X-Request-Id', req.requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    if (shouldSkipRequestLog(req)) {
      return;
    }
    logRequestEvent('info', 'request.completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.session?.userId || null,
      monitoringEnabled: monitoringStatus.enabled,
      ip: getClientIp(req),
    });
  });

  next();
});

app.use((req, _res, next) => {
  if (req.session?.userId) {
    setMonitoringUser({
      id: req.session.userId,
      email: req.session.userEmail || null,
      role: req.session.role || null,
    });
  } else {
    clearMonitoringUser();
  }
  next();
});

app.use('/admin', (req, res, next) => {
  if (req.method !== 'POST') {
    return next();
  }
  const identifier = req.session?.userId || 'guest-admin';
  if (isActionRateLimited('adminPost', req, String(identifier))) {
    setFlash(req, 'Too many admin changes too quickly. Please wait a moment and try again.');
    const referer = req.get('referer');
    if (referer) {
      return res.redirect(referer);
    }
    return res.redirect('/admin');
  }
  recordActionRateLimitAttempt('adminPost', req, String(identifier));
  return next();
});

app.use((req, res, next) => {
  res.locals.csrfToken = ensureCsrfToken(req);
  next();
});

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  if (process.env.DISABLE_CSRF === 'true' || process.env.NODE_ENV === 'test') {
    return next();
  }
  if (req.path === '/webhooks/payments') {
    return next();
  }

  const requestToken = String(req.body?._csrf || req.query?._csrf || req.headers['x-csrf-token'] || '').trim();
  const sessionToken = ensureCsrfToken(req);
  if (requestToken && requestToken === sessionToken) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Security check failed. Refresh the page and try again.' });
  }

  setFlash(req, 'Security check failed. Please try again.');
  return res.redirect(buildCsrfFailureRedirect(req));
});

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

function pruneRateLimitBucket(bucket, now) {
  return bucket.filter((timestamp) => (now - timestamp) < PASSWORD_RESET_RATE_LIMIT_WINDOW_MS);
}

function pruneActionRateLimitBucket(bucket, now, windowMs) {
  return bucket.filter((timestamp) => (now - timestamp) < windowMs);
}

function buildActionRateLimitKey(action, req, identifier = '') {
  return [action, getClientIp(req), identifier || 'default'].join(':');
}

function isActionRateLimited(action, req, identifier = '') {
  const config = ACTION_RATE_LIMITS[action];
  if (!config) return false;
  const key = buildActionRateLimitKey(action, req, identifier);
  const now = Date.now();
  const existing = pruneActionRateLimitBucket(actionRateLimitBuckets.get(key) || [], now, config.windowMs);
  if (existing.length === 0) {
    actionRateLimitBuckets.delete(key);
    return false;
  }
  actionRateLimitBuckets.set(key, existing);
  return existing.length >= config.maxAttempts;
}

function recordActionRateLimitAttempt(action, req, identifier = '') {
  const config = ACTION_RATE_LIMITS[action];
  if (!config) return;
  const key = buildActionRateLimitKey(action, req, identifier);
  const now = Date.now();
  const existing = pruneActionRateLimitBucket(actionRateLimitBuckets.get(key) || [], now, config.windowMs);
  existing.push(now);
  actionRateLimitBuckets.set(key, existing);
}

function createRateLimitMiddleware({ action, getIdentifier, onLimit }) {
  return (req, res, next) => {
    const identifier = typeof getIdentifier === 'function' ? getIdentifier(req) : '';
    if (isActionRateLimited(action, req, identifier)) {
      return onLimit(req, res);
    }
    recordActionRateLimitAttempt(action, req, identifier);
    return next();
  };
}

function isPasswordResetRateLimited(req, email) {
  const now = Date.now();
  const keys = [
    `ip:${getClientIp(req)}`,
    `email:${String(email || '').toLowerCase().trim() || 'blank'}`,
  ];

  return keys.some((key) => {
    const existing = pruneRateLimitBucket(passwordResetAttempts.get(key) || [], now);
    if (existing.length === 0) {
      passwordResetAttempts.delete(key);
      return false;
    }
    passwordResetAttempts.set(key, existing);
    return existing.length >= PASSWORD_RESET_RATE_LIMIT_MAX_ATTEMPTS;
  });
}

function recordPasswordResetAttempt(req, email) {
  const now = Date.now();
  const keys = [
    `ip:${getClientIp(req)}`,
    `email:${String(email || '').toLowerCase().trim() || 'blank'}`,
  ];

  keys.forEach((key) => {
    const existing = pruneRateLimitBucket(passwordResetAttempts.get(key) || [], now);
    existing.push(now);
    passwordResetAttempts.set(key, existing);
  });
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

function requireAdmin(req, res, next) {
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
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function validatePasswordPolicy(password) {
  const value = String(password || '');
  if (value.length < 8) {
    return 'Password must be at least 8 characters.';
  }

  const checks = [
    /[A-Z]/.test(value),
    /[a-z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ];

  const passedChecks = checks.filter(Boolean).length;
  if (passedChecks < 3) {
    return 'Password must include at least 3 of these: uppercase letter, lowercase letter, number, symbol.';
  }

  return null;
}

function getRoleLabel(role) {
  if (role === 'HOMEOWNER') return 'Homeowner';
  if (role === 'HANDYMAN') return 'Handyman';
  return 'Admin';
}

function getStatusTone(status) {
  switch (status) {
    case 'OPEN':
    case 'PENDING':
      return 'neutral';
    case 'IN_REVIEW':
    case 'SHORTLISTED':
    case 'PENDING_FUNDING':
    case 'DISPUTED':
      return 'review';
    case 'AWARDED':
    case 'ACCEPTED':
    case 'COMPLETED':
    case 'FUNDED':
    case 'RELEASED':
      return 'success';
    case 'DECLINED':
    case 'REFUNDED':
      return 'muted';
    default:
      return 'neutral';
  }
}

function formatPaymentStatus(status) {
  return String(status || '').replaceAll('_', ' ');
}

function formatDisputeStatus(status) {
  return String(status || '').replaceAll('_', ' ');
}

function formatReportStatus(status) {
  return String(status || '').replaceAll('_', ' ');
}

function formatAuditAction(action) {
  return String(action || '').replaceAll('_', ' ');
}

function formatVerificationStatus(status) {
  return String(status || '').replaceAll('_', ' ');
}

function formatSubscriptionPlan(plan) {
  return PLAN_CONFIG[plan]?.name || String(plan || '').replaceAll('_', ' ');
}

function formatNotificationType(type) {
  return String(type || '').replaceAll('_', ' ');
}

function formatCheckoutStatus(status) {
  return String(status || '').replaceAll('_', ' ');
}

function formatBillingStatus(status) {
  return String(status || 'INACTIVE').replaceAll('_', ' ');
}

function formatBillingSupportStatus(status) {
  return String(status || 'NEW').replaceAll('_', ' ');
}

function getBillingSupportTone(status) {
  switch (status) {
    case 'RESOLVED':
      return 'success';
    case 'WAITING_ON_PROVIDER':
      return 'review';
    case 'NEEDS_FOLLOW_UP':
      return 'neutral';
    default:
      return 'muted';
  }
}

function formatBillingEventType(type) {
  const labels = {
    'checkout.session.completed': 'Checkout completed',
    'customer.subscription.updated': 'Subscription updated',
    'customer.subscription.deleted': 'Subscription canceled',
    'invoice.paid': 'Invoice paid',
    'invoice.payment_failed': 'Invoice payment failed',
  };
  return labels[type] || String(type || '').replaceAll('.', ' ').replaceAll('_', ' ');
}

function normalizeBillingPlaybookHistoryFilters(query = {}) {
  const actionFilter = String(query.action || '').trim().toUpperCase();
  const actorFilter = String(query.actorAdminUserId || '').trim();
  const dateRangeFilter = String(query.dateRange || '').trim().toUpperCase();
  const pageRaw = Number.parseInt(String(query.page || '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  return {
    action: ['CREATED', 'UPDATED', 'ARCHIVED', 'RESTORED', 'DELETED'].includes(actionFilter) ? actionFilter : '',
    actorAdminUserId: actorFilter,
    dateRange: ['7D', '30D', 'ALL'].includes(dateRangeFilter) ? dateRangeFilter : 'ALL',
    page,
  };
}

function buildBillingPlaybookHistoryCreatedAtFilter(dateRange) {
  const now = new Date();
  if (dateRange === '7D') {
    return { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
  }
  if (dateRange === '30D') {
    return { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
  }
  return undefined;
}

function buildBillingPlaybookSummary({ playbook, latestHistory, historyEntries, filters, pagination, actorAdminName = '' }) {
  const historyLabels = { CREATED: 'Created', UPDATED: 'Updated', ARCHIVED: 'Archived', RESTORED: 'Restored', DELETED: 'Deleted' };
  const playbookName = playbook ? playbook.name : (latestHistory?.playbookName || 'Unknown playbook');
  const lines = [];
  lines.push('Playbook: ' + playbookName);
  if (playbook) {
    lines.push('State: ' + (playbook.scope === 'SHARED' ? 'Shared team' : 'Personal') + ' / ' + (playbook.status === 'ARCHIVED' ? 'Archived' : 'Active'));
    lines.push('Support status: ' + formatBillingSupportStatus(playbook.supportStatus));
    const providerParts = [playbook.provider || 'Any provider'];
    if (playbook.eventType) providerParts.push(playbook.eventType);
    if (playbook.targetType) providerParts.push(playbook.targetType.replaceAll('_', ' '));
    lines.push('Provider match: ' + providerParts.join(' | '));
    lines.push('Usage: ' + (playbook.usageCount || 0) + ' runs' + (playbook.lastUsedAt ? ' | Last used ' + new Date(playbook.lastUsedAt).toLocaleString() : ''));
  } else {
    lines.push('State: Deleted / history only');
  }
  lines.push('Filters: Action=' + (filters.action || 'ALL') + ', Admin=' + (actorAdminName || 'ALL') + ', Date range=' + (filters.dateRange || 'ALL'));
  if (pagination) {
    lines.push('Page: ' + pagination.page + ' of ' + pagination.totalPages);
    lines.push('Entries shown: ' + historyEntries.length + ' of ' + pagination.totalCount);
  } else {
    lines.push('Entries shown: ' + historyEntries.length);
  }
  lines.push('');
  lines.push('Timeline:');
  if (historyEntries.length === 0) {
    lines.push('- No playbook activity matches the current filters.');
  } else {
    historyEntries.forEach((entry) => {
      lines.push('- ' + (historyLabels[entry.action] || entry.action) + ' | ' + (entry.actorAdmin ? entry.actorAdmin.name : 'Admin') + ' | ' + new Date(entry.createdAt).toLocaleString() + (entry.notes ? ' | ' + entry.notes : ''));
    });
  }
  return lines.join('\n');
}

function buildBillingPlaybookExportFilename({ playbook, latestHistory, extension }) {
  const playbookName = playbook ? playbook.name : (latestHistory?.playbookName || 'billing-playbook');
  const slug = playbookName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'billing-playbook';
  return slug + '-history.' + extension;
}

function buildBillingPlaybookSummaryPayload({ playbook, latestHistory, historyEntries, filters, pagination, actorAdminName = '' }) {
  const playbookName = playbook ? playbook.name : (latestHistory?.playbookName || 'Unknown playbook');
  return {
    playbook: {
      id: playbook?.id || latestHistory?.playbookId || null,
      name: playbookName,
      state: playbook
        ? {
            scope: playbook.scope,
            status: playbook.status,
            supportStatus: playbook.supportStatus,
            provider: playbook.provider,
            eventType: playbook.eventType,
            targetType: playbook.targetType,
            usageCount: playbook.usageCount || 0,
            lastUsedAt: playbook.lastUsedAt ? playbook.lastUsedAt.toISOString() : null,
          }
        : {
            scope: null,
            status: 'DELETED',
            supportStatus: null,
            provider: null,
            eventType: null,
            targetType: null,
            usageCount: null,
            lastUsedAt: null,
          },
    },
    filters: {
      action: filters.action || 'ALL',
      actorAdminUserId: filters.actorAdminUserId || null,
      actorAdminName: actorAdminName || null,
      dateRange: filters.dateRange || 'ALL',
      page: pagination ? pagination.page : null,
    },
    pagination: pagination ? {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalCount: pagination.totalCount,
      totalPages: pagination.totalPages,
    } : null,
    entries: historyEntries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actorAdminUserId: entry.actorAdminUserId,
      actorAdminName: entry.actorAdmin ? entry.actorAdmin.name : null,
      notes: entry.notes || null,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

function buildSupportCaseExportFilename(supportCase, extension) {
  const slug = String(supportCase?.title || 'support-case')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'support-case';
  return slug + '-handoff.' + extension;
}

function buildSupportCasePackagePayload(supportCase) {
  return {
    exportedAt: new Date().toISOString(),
    supportCase: {
      id: supportCase.id,
      title: supportCase.title,
      status: supportCase.status,
      sourcePlaybookId: supportCase.sourcePlaybookId || null,
      sourcePlaybookName: supportCase.sourcePlaybookName,
      createdAt: supportCase.createdAt.toISOString(),
      updatedAt: supportCase.updatedAt.toISOString(),
      createdByAdminName: supportCase.createdByAdmin?.name || 'Admin',
      assignedAdminName: supportCase.assignedAdmin?.name || null,
      notes: supportCase.notes || null,
      summaryText: supportCase.summaryText,
    },
    comments: supportCase.comments.map((comment) => ({
      id: comment.id,
      authorAdminName: comment.authorAdmin?.name || 'Admin',
      body: comment.body,
      isResolution: Boolean(comment.isResolution),
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    })),
    attachments: supportCase.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      url: buildSupportCaseAttachmentHref(supportCase.id, attachment.id),
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      note: attachment.note || null,
      archivedAt: attachment.archivedAt ? attachment.archivedAt.toISOString() : null,
      uploadedByAdminName: attachment.uploadedByAdmin?.name || 'Admin',
      archivedByAdminName: attachment.archivedByAdmin?.name || null,
      createdAt: attachment.createdAt.toISOString(),
    })),
    activity: supportCase.activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      label: String(activity.type || '').replaceAll('_', ' '),
      message: activity.message,
      actorAdminName: activity.actorAdmin?.name || 'Admin',
      createdAt: activity.createdAt.toISOString(),
    })),
  };
}

function buildSupportCasePackageText(supportCase) {
  const payload = buildSupportCasePackagePayload(supportCase);
  const lines = [
    'Support Case: ' + payload.supportCase.title,
    'Status: ' + payload.supportCase.status,
    'Source playbook: ' + payload.supportCase.sourcePlaybookName,
    'Created by: ' + payload.supportCase.createdByAdminName,
    'Owner: ' + (payload.supportCase.assignedAdminName || 'Unassigned'),
    'Created at: ' + new Date(payload.supportCase.createdAt).toLocaleString(),
    '',
    'Summary',
    payload.supportCase.summaryText,
    '',
    'Internal notes',
    payload.supportCase.notes || 'None',
    '',
    'Comments',
  ];

  if (payload.comments.length === 0) {
    lines.push('None');
  } else {
    payload.comments.forEach((comment) => {
      lines.push('- ' + comment.authorAdminName + ' @ ' + new Date(comment.createdAt).toLocaleString() + (comment.isResolution ? ' [Current answer]' : ''));
      lines.push('  ' + comment.body);
    });
  }

  lines.push('', 'Attachments');
  if (payload.attachments.length === 0) {
    lines.push('None');
  } else {
    payload.attachments.forEach((attachment) => {
      lines.push('- ' + attachment.filename + ' (' + (attachment.archivedAt ? 'Archived' : 'Active') + ', ' + attachment.mimeType + ', ' + Math.max(1, Math.round(attachment.sizeBytes / 1024)) + ' KB)');
      lines.push('  URL: ' + attachment.url);
      if (attachment.note) lines.push('  Note: ' + attachment.note);
    });
  }

  lines.push('', 'Activity');
  if (payload.activity.length === 0) {
    lines.push('None');
  } else {
    payload.activity.forEach((activity) => {
      lines.push('- ' + activity.label + ': ' + activity.message + ' (' + activity.actorAdminName + ', ' + new Date(activity.createdAt).toLocaleString() + ')');
    });
  }

  return lines.join('\n');
}

function getBillingEventTone(status) {
  switch (status) {
    case 'PROCESSED':
      return 'success';
    case 'FAILED':
      return 'muted';
    case 'RECEIVED':
      return 'review';
    default:
      return 'neutral';
  }
}

function getBillingEventAmount(eventData, checkoutSession) {
  if (typeof eventData?.amountPaid === 'number' && Number.isFinite(eventData.amountPaid)) {
    return eventData.amountPaid;
  }
  if (typeof checkoutSession?.amount === 'number' && Number.isFinite(checkoutSession.amount)) {
    return checkoutSession.amount;
  }
  return null;
}

function buildBillingEventSummary(event, checkoutSession) {
  const eventData = event.payload?.data || {};
  const detail = [];
  const context = [];
  const actorName = checkoutSession?.user?.name || checkoutSession?.user?.email || null;
  const jobTitle = checkoutSession?.job?.title || null;
  const planKey = checkoutSession?.planKey || eventData?.metadata?.planKey || null;
  const creditPack = checkoutSession?.creditPack || eventData?.metadata?.creditPack || null;
  const amount = getBillingEventAmount(eventData, checkoutSession);
  const quantity = Number.isFinite(eventData?.quantity) ? eventData.quantity : null;

  if (actorName) {
    context.push(actorName);
  }
  if (jobTitle) {
    context.push(jobTitle);
  }
  if (planKey) {
    detail.push(formatSubscriptionPlan(planKey) + ' plan');
  }
  if (creditPack) {
    detail.push(creditPack.replaceAll('_', ' ').toLowerCase() + ' credit pack');
  }
  if (checkoutSession?.targetType === 'ESCROW_FUNDING') {
    detail.push('Escrow funding');
  }
  if (quantity && quantity > 1) {
    detail.push('Qty ' + quantity);
  }
  if (amount !== null) {
    detail.push(formatCurrency(amount));
  }
  if (eventData?.billingReason === 'subscription_cycle') {
    detail.push('Renewal cycle');
  }
  if (!checkoutSession && eventData?.customerId) {
    context.push('Customer ' + eventData.customerId);
  }

  return {
    title: formatBillingEventType(event.eventType),
    tone: getBillingEventTone(event.status),
    context: context.join(' - '),
    detail: detail.join(' - '),
    hasSupportNotes: Boolean(event.supportNotes && event.supportNotes.trim()),
    supportStatus: event.supportStatus || 'NEW',
    supportTone: getBillingSupportTone(event.supportStatus || 'NEW'),
    assignedAdminName: event.assignedAdmin?.name || null,
  };
}

function parseBillingEventPayload(payloadJson) {
  if (!payloadJson) return null;
  try {
    return JSON.parse(payloadJson);
  } catch (_error) {
    return null;
  }
}

async function loadCheckoutSessionsByIds(checkoutSessionIds) {
  if (!checkoutSessionIds || checkoutSessionIds.length === 0) {
    return new Map();
  }

  const sessions = await prisma.checkoutSession.findMany({
    where: { id: { in: checkoutSessionIds } },
    include: {
      user: { include: { handymanProfile: true } },
      job: {
        include: {
          homeowner: true,
          acceptedBid: { include: { handyman: true } },
          payment: true,
        },
      },
    },
  });

  return new Map(sessions.map((session) => [session.id, session]));
}

function decorateBillingEvent(event, checkoutSession) {
  const payload = parseBillingEventPayload(event.payloadJson);
  return {
    ...event,
    payload,
    checkoutSession,
    summary: buildBillingEventSummary({ ...event, payload }, checkoutSession),
  };
}

function getBillingQueueAgeSummary(createdAt) {
  const created = createdAt ? new Date(createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) {
    return { label: 'Age unknown', stale: false, ageHours: null };
  }

  const ageHours = Math.max(0, (Date.now() - created.getTime()) / (1000 * 60 * 60));
  if (ageHours >= 48) {
    return {
      label: 'Older than 24h (' + Math.floor(ageHours / 24) + ' days old)',
      stale: true,
      ageHours,
    };
  }
  if (ageHours >= 24) {
    return { label: 'Older than 24h', stale: true, ageHours };
  }
  if (ageHours >= 1) {
    return { label: Math.floor(ageHours) + 'h old', stale: false, ageHours };
  }
  return { label: 'Under 1h old', stale: false, ageHours };
}

function buildBillingQueue(billingEvents) {
  const statuses = ['NEW', 'NEEDS_FOLLOW_UP', 'WAITING_ON_PROVIDER', 'RESOLVED'];
  return statuses.map((status) => {
    const items = billingEvents
      .filter((event) => event.supportStatus === status)
      .map((event) => ({
        ...event,
        queueAge: getBillingQueueAgeSummary(event.createdAt),
      }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return {
      status,
      label: formatBillingSupportStatus(status),
      tone: getBillingSupportTone(status),
      items,
      staleCount: items.filter((event) => event.queueAge.stale).length,
      oldestCreatedAt: items.length > 0 ? items[0].createdAt : null,
    };
  });
}

function getBillingGroupLabel(group) {
  if (group.eventType === 'invoice.payment_failed') {
    return 'Recurring invoice failures';
  }
  if (group.eventType === 'checkout.session.completed' && group.targetTypes.includes('ESCROW_FUNDING')) {
    return 'Escrow funding activity';
  }
  if (group.eventType === 'checkout.session.completed' && group.targetTypes.includes('PLAN')) {
    return 'Plan checkout activations';
  }
  if (group.eventType === 'customer.subscription.updated') {
    return 'Subscription sync updates';
  }
  if (group.eventType === 'customer.subscription.deleted') {
    return 'Subscription cancellations';
  }
  if (group.eventType === 'invoice.paid') {
    return 'Successful renewal payments';
  }
  return formatBillingEventType(group.eventType);
}

function getBillingGroupTargetTypes(group) {
  return [...new Set(group.samples.map((event) => event.checkoutSession?.targetType).filter(Boolean))];
}

function buildCustomBillingGroupPlaybooks(group, customPlaybooks = []) {
  return customPlaybooks
    .filter((playbook) => {
      if (playbook.provider && playbook.provider !== group.provider) {
        return false;
      }
      if (playbook.eventType && playbook.eventType !== group.eventType) {
        return false;
      }
      if (playbook.targetType && !group.targetTypes.includes(playbook.targetType)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (Number(b.isFavorite) !== Number(a.isFavorite)) {
        return Number(b.isFavorite) - Number(a.isFavorite);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    })
    .map((playbook) => ({
      id: playbook.id,
      label: playbook.name,
      supportStatus: playbook.supportStatus,
      assignToCurrentAdmin: playbook.assignToCreator,
      isCustom: true,
      creatorName: playbook.createdByAdmin?.name || null,
      provider: playbook.provider || null,
      eventType: playbook.eventType || null,
      targetType: playbook.targetType || null,
      scope: playbook.scope,
      status: playbook.status,
      isFavorite: playbook.isFavorite,
      usageCount: playbook.usageCount || 0,
      lastUsedAt: playbook.lastUsedAt || null,
      archivedAt: playbook.archivedAt || null,
      cleanupReason: playbook.cleanupReason || null,
      archivedByAdminName: playbook.archivedByAdmin?.name || null,
    }));
}

function isStaleBillingPlaybook(playbook) {
  if (playbook.status !== 'ACTIVE') {
    return false;
  }
  if ((playbook.usageCount || 0) > 0) {
    return false;
  }
  const ageDays = (Date.now() - new Date(playbook.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= 7;
}

function buildScopedBillingPlaybooks(playbooks, currentAdminId) {
  const visiblePlaybooks = playbooks.filter((playbook) => playbook.scope === 'SHARED' || playbook.createdByAdminUserId === currentAdminId);
  const activePlaybooks = visiblePlaybooks.filter((playbook) => playbook.status === 'ACTIVE');
  const archivedBillingPlaybooks = visiblePlaybooks.filter((playbook) => playbook.status === 'ARCHIVED');
  const staleBillingPlaybooks = activePlaybooks.filter((playbook) => isStaleBillingPlaybook(playbook));

  const favoriteBillingPlaybooks = activePlaybooks
    .filter((playbook) => playbook.isFavorite)
    .sort((a, b) => {
      if ((b.usageCount || 0) !== (a.usageCount || 0)) {
        return (b.usageCount || 0) - (a.usageCount || 0);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  const personalBillingPlaybooks = activePlaybooks
    .filter((playbook) => playbook.scope === 'PERSONAL' && playbook.createdByAdminUserId === currentAdminId)
    .sort((a, b) => {
      if ((b.usageCount || 0) !== (a.usageCount || 0)) {
        return (b.usageCount || 0) - (a.usageCount || 0);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  const sharedBillingPlaybooks = activePlaybooks
    .filter((playbook) => playbook.scope === 'SHARED')
    .sort((a, b) => {
      if ((b.usageCount || 0) !== (a.usageCount || 0)) {
        return (b.usageCount || 0) - (a.usageCount || 0);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

  return {
    billingPlaybooks: visiblePlaybooks,
    activeBillingPlaybooks: activePlaybooks,
    favoriteBillingPlaybooks,
    personalBillingPlaybooks,
    sharedBillingPlaybooks,
    archivedBillingPlaybooks,
    staleBillingPlaybooks,
  };
}

function buildBillingGroupPlaybooks(group, customPlaybooks = []) {
  const builtInPlaybooks = [];
  if (group.eventType === 'invoice.payment_failed') {
    builtInPlaybooks.push(
      { label: 'Own invoice failures', supportStatus: 'WAITING_ON_PROVIDER', assignToCurrentAdmin: true },
    );
  }
  if (group.eventType === 'checkout.session.completed' && group.targetTypes.includes('ESCROW_FUNDING')) {
    builtInPlaybooks.push(
      { label: 'Own escrow batch', supportStatus: 'WAITING_ON_PROVIDER', assignToCurrentAdmin: true },
    );
  }
  if (group.eventType === 'checkout.session.completed' && group.targetTypes.includes('PLAN')) {
    builtInPlaybooks.push(
      { label: 'Resolve plan activations', supportStatus: 'RESOLVED', assignToCurrentAdmin: true },
    );
  }
  if (group.eventType === 'customer.subscription.updated') {
    builtInPlaybooks.push(
      { label: 'Review subscription sync', supportStatus: 'NEEDS_FOLLOW_UP', assignToCurrentAdmin: true },
    );
  }
  return [...builtInPlaybooks, ...buildCustomBillingGroupPlaybooks(group, customPlaybooks.filter((playbook) => playbook.status === 'ACTIVE'))];
}

function buildBillingGroups(billingEvents, customPlaybooks = []) {
  const groups = new Map();
  for (const event of billingEvents) {
    const key = [event.provider, event.eventType, event.supportStatus].join('::');
    const existing = groups.get(key) || {
      id: key,
      provider: event.provider,
      eventType: event.eventType,
      supportStatus: event.supportStatus,
      count: 0,
      latestCreatedAt: event.createdAt,
      samples: [],
      eventIds: [],
    };
    existing.count += 1;
    existing.eventIds.push(event.id);
    if (new Date(event.createdAt) > new Date(existing.latestCreatedAt)) {
      existing.latestCreatedAt = event.createdAt;
    }
    if (existing.samples.length < 3) {
      existing.samples.push(event);
    }
    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return new Date(b.latestCreatedAt) - new Date(a.latestCreatedAt);
    })
    .slice(0, 8)
    .map((group) => {
      const targetTypes = getBillingGroupTargetTypes(group);
      return {
        ...group,
        targetTypes,
        groupLabel: getBillingGroupLabel({ ...group, targetTypes }),
        playbooks: buildBillingGroupPlaybooks({ ...group, targetTypes }, customPlaybooks),
        eventTypeLabel: formatBillingEventType(group.eventType),
        supportStatusLabel: formatBillingSupportStatus(group.supportStatus),
        supportTone: getBillingSupportTone(group.supportStatus),
      };
    });
}

function getPlanSummary(profile) {
  const plan = PLAN_CONFIG[profile?.subscriptionPlan || 'FREE'] || PLAN_CONFIG.FREE;
  return {
    key: profile?.subscriptionPlan || 'FREE',
    name: plan.name,
    monthlyCredits: plan.monthlyCredits,
    unlimitedBids: plan.unlimitedBids,
    cta: plan.cta,
    leadCredits: profile?.leadCredits || 0,
    renewsAt: profile?.subscriptionRenewsAt || null,
    billingStatus: profile?.billingStatus || 'INACTIVE',
    billingPeriodEndsAt: profile?.billingPeriodEndsAt || null,
    billingQuantity: profile?.billingQuantity || 1,
    hasCustomer: Boolean(profile?.stripeCustomerId),
    hasSubscription: Boolean(profile?.stripeSubscriptionId),
  };
}

function parseAdminBillingFilters(query = {}) {
  const billingSearch = String(query.billingSearch || '').trim();
  const billingProvider = String(query.billingProvider || '').trim();
  const billingEventType = String(query.billingEventType || '').trim();
  const billingStatus = String(query.billingStatus || '').trim();
  const billingSupportStatus = String(query.billingSupportStatus || '').trim();
  const selectedBillingGroup = String(query.selectedBillingGroup || '').trim();
  const supportCaseSearch = String(query.supportCaseSearch || '').trim();
  const supportCaseStatus = String(query.supportCaseStatus || '').trim().toUpperCase();
  const supportCaseOwner = String(query.supportCaseOwner || '').trim();
  const supportCaseQueue = String(query.supportCaseQueue || '').trim().toLowerCase();
  const supportCaseViewId = String(query.supportCaseViewId || '').trim();
  const adminJobView = ['all', 'funded', 'needsAction', 'unread', 'pending', 'completed'].includes(String(query.adminJobView || ''))
    ? String(query.adminJobView)
    : 'all';
  const adminJobCategory = String(query.adminJobCategory || '').trim();
  const adminJobDateRange = ['7d', '30d', 'all'].includes(String(query.adminJobDateRange || '').trim().toLowerCase())
    ? String(query.adminJobDateRange || '').trim().toLowerCase()
    : 'all';
  const adminJobStatus = ['OPEN', 'IN_REVIEW', 'AWARDED', 'COMPLETED'].includes(String(query.adminJobStatus || '').trim().toUpperCase())
    ? String(query.adminJobStatus || '').trim().toUpperCase()
    : '';

  return {
    billingSearch,
    billingProvider,
    billingEventType,
    billingStatus,
    billingSupportStatus,
    selectedBillingGroup,
    supportCaseSearch,
    supportCaseStatus,
    supportCaseOwner,
    supportCaseQueue,
    supportCaseViewId,
    adminJobView,
    adminJobCategory,
    adminJobDateRange,
    adminJobStatus,
    hasFilters: Boolean(
      billingSearch || billingProvider || billingEventType || billingStatus || billingSupportStatus || selectedBillingGroup
      || supportCaseSearch || supportCaseStatus || supportCaseOwner || supportCaseQueue || (adminJobView && adminJobView !== 'all')
      || adminJobCategory || (adminJobDateRange && adminJobDateRange !== 'all') || adminJobStatus
    ),
  };
}

function buildAdminJobCreatedAtFilter(adminJobDateRange) {
  const now = new Date();
  if (adminJobDateRange === '7d') {
    return { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
  }
  if (adminJobDateRange === '30d') {
    return { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
  }
  return undefined;
}

function parseHandymanFilters(query = {}) {
  const search = String(query.search || '').trim();
  const category = String(query.category || '').trim();
  const minBudget = parsePositiveInt(query.minBudget);
  const maxBudget = parsePositiveInt(query.maxBudget);
  const sort = ['newest', 'budget_asc', 'budget_desc'].includes(String(query.sort || ''))
    ? String(query.sort)
    : 'newest';
  const photosOnly = String(query.photosOnly || '') === '1';
  const nearMeOnly = String(query.nearMeOnly || '') === '1';
  const myJobsView = ['all', 'activeFunded', 'needsAction', 'unread', 'pending', 'completed'].includes(String(query.myJobsView || ''))
    ? String(query.myJobsView)
    : 'all';

  return {
    search,
    category,
    minBudget,
    maxBudget,
    sort,
    photosOnly,
    nearMeOnly,
    myJobsView,
  };
}

function getLocationTokens(value) {
  const ignored = new Set(['oh', 'st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 'ct', 'court', 'blvd', 'boulevard']);
  return normalizeLocation(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !ignored.has(token) && !/^\d+$/.test(token));
}

function formatDistanceMiles(distanceMiles) {
  if (!Number.isFinite(distanceMiles)) return null;
  if (distanceMiles < 0.2) return 'Under 1 mile away';
  if (distanceMiles < 10) return distanceMiles.toFixed(1) + ' miles away';
  return Math.round(distanceMiles) + ' miles away';
}

function getTextLocationMatch(jobLocation, userLocation) {
  const normalizedJob = normalizeLocation(jobLocation);
  const normalizedUser = normalizeLocation(userLocation);
  if (!normalizedJob || !normalizedUser) {
    return {
      score: 0,
      label: 'Location not matched',
      secondaryLabel: 'Add a city or ZIP to unlock radius matching.',
      distanceMiles: null,
      withinRadius: false,
      nearMeEligible: false,
      method: 'text',
    };
  }

  if (normalizedJob === normalizedUser) {
    return {
      score: 4,
      label: 'Exact area match',
      secondaryLabel: 'Matched from the same saved location text.',
      distanceMiles: null,
      withinRadius: true,
      nearMeEligible: true,
      method: 'text',
    };
  }

  const jobZip = extractZip(jobLocation);
  const userZip = extractZip(userLocation);
  if (jobZip && userZip && jobZip === userZip) {
    return {
      score: 3,
      label: 'Same ZIP area',
      secondaryLabel: 'Matched from shared ZIP coverage.',
      distanceMiles: null,
      withinRadius: true,
      nearMeEligible: true,
      method: 'text',
    };
  }

  const jobTokens = getLocationTokens(jobLocation);
  const userTokens = getLocationTokens(userLocation);
  const overlap = jobTokens.filter((token) => userTokens.includes(token));
  if (overlap.length >= 1) {
    return {
      score: 2,
      label: 'Same city area',
      secondaryLabel: 'Matched from overlapping city text.',
      distanceMiles: null,
      withinRadius: true,
      nearMeEligible: true,
      method: 'text',
    };
  }

  return {
    score: 0,
    label: 'Outside your usual area',
    secondaryLabel: 'No strong city or ZIP match found.',
    distanceMiles: null,
    withinRadius: false,
    nearMeEligible: false,
    method: 'text',
  };
}

function getLocationMatch(job, user, serviceRadius) {
  const effectiveRadius = serviceRadius || 15;
  const fallbackMatch = getTextLocationMatch(job.location, user.location || '');

  if (job.locationLat != null && job.locationLng != null && user.locationLat != null && user.locationLng != null) {
    const distanceMiles = haversineDistanceMiles(
      { latitude: user.locationLat, longitude: user.locationLng },
      { latitude: job.locationLat, longitude: job.locationLng }
    );

    if (Number.isFinite(distanceMiles)) {
      const withinRadius = distanceMiles <= effectiveRadius;
      const softMatch = distanceMiles <= Math.max(effectiveRadius * 1.5, 25);
      return {
        score: withinRadius ? (distanceMiles <= 5 ? 4 : 3) : softMatch ? 1 : 0,
        label: formatDistanceMiles(distanceMiles),
        secondaryLabel: withinRadius
          ? 'Within your ' + effectiveRadius + '-mile radius'
          : 'Outside your ' + effectiveRadius + '-mile radius',
        distanceMiles,
        withinRadius,
        nearMeEligible: withinRadius,
        method: 'distance',
      };
    }
  }

  return fallbackMatch;
}

function sortJobsWithLocationFit(jobs, sort) {
  const compareBase = (left, right) => {
    if (sort === 'budget_asc') {
      if (left.budget !== right.budget) return left.budget - right.budget;
    } else if (sort === 'budget_desc') {
      if (left.budget !== right.budget) return right.budget - left.budget;
    } else if (new Date(left.createdAt).getTime() !== new Date(right.createdAt).getTime()) {
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    }
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  };

  return [...jobs].sort((left, right) => {
    if (Number.isFinite(left.locationMatch.distanceMiles) && Number.isFinite(right.locationMatch.distanceMiles)) {
      if (left.locationMatch.withinRadius !== right.locationMatch.withinRadius) {
        return Number(right.locationMatch.withinRadius) - Number(left.locationMatch.withinRadius);
      }
      if (left.locationMatch.distanceMiles !== right.locationMatch.distanceMiles) {
        return left.locationMatch.distanceMiles - right.locationMatch.distanceMiles;
      }
    }

    if (right.locationMatch.score !== left.locationMatch.score) {
      return right.locationMatch.score - left.locationMatch.score;
    }
    return compareBase(left, right);
  });
}

function buildSavedSearchQuery(savedSearch) {
  const params = new URLSearchParams();
  if (savedSearch.search) params.set('search', savedSearch.search);
  if (savedSearch.category) params.set('category', savedSearch.category);
  if (savedSearch.minBudget) params.set('minBudget', String(savedSearch.minBudget));
  if (savedSearch.maxBudget) params.set('maxBudget', String(savedSearch.maxBudget));
  if (savedSearch.sort && savedSearch.sort !== 'newest') params.set('sort', savedSearch.sort);
  if (savedSearch.photosOnly) params.set('photosOnly', '1');
  if (savedSearch.nearMeOnly) params.set('nearMeOnly', '1');
  const query = params.toString();
  return query ? '/dashboard?' + query : '/dashboard';
}

function getHandymanBidStage(bid) {
  if (bid.job?.status === 'COMPLETED' || bid.job?.payment?.status === 'RELEASED' || bid.job?.review) {
    return 'completed';
  }

  if (bid.status === 'ACCEPTED' && ['FUNDED', 'DISPUTED'].includes(bid.job?.payment?.status || '')) {
    return 'activeFunded';
  }

  if (['PENDING', 'SHORTLISTED', 'ACCEPTED'].includes(bid.status)) {
    return 'pending';
  }

  return 'other';
}

function getHandymanBidSortTime(bid) {
  return new Date(
    bid.job?.payment?.fundedAt
    || bid.job?.completedAt
    || bid.updatedAt
    || bid.createdAt
    || Date.now()
  ).getTime();
}

function buildHandymanBidSections(myBids) {
  const sections = [
    {
      key: 'activeFunded',
      title: 'Latest active funded jobs',
      description: 'Escrow is funded and the homeowner is ready for work to move forward.',
      bids: [],
    },
    {
      key: 'pending',
      title: 'Pending jobs',
      description: 'These bids are still waiting on homeowner review, award, or escrow funding.',
      bids: [],
    },
    {
      key: 'completed',
      title: 'Completed jobs',
      description: 'Finished work, released payments, and recent homeowner feedback live here.',
      bids: [],
    },
    {
      key: 'other',
      title: 'Other bid updates',
      description: 'Older or closed bid outcomes that are not currently active.',
      bids: [],
    },
  ];

  const sectionMap = new Map(sections.map((section) => [section.key, section]));
  myBids.forEach((bid) => {
    const key = getHandymanBidStage(bid);
    sectionMap.get(key).bids.push(bid);
  });

  sections.forEach((section) => {
    section.bids.sort((left, right) => getHandymanBidSortTime(right) - getHandymanBidSortTime(left));
  });

  return sections.filter((section) => section.bids.length > 0);
}

function buildHandymanJobSummary(myBids) {
  return {
    activeFunded: myBids.filter((bid) => getHandymanBidStage(bid) === 'activeFunded').length,
    pending: myBids.filter((bid) => getHandymanBidStage(bid) === 'pending').length,
    completed: myBids.filter((bid) => getHandymanBidStage(bid) === 'completed').length,
    other: myBids.filter((bid) => getHandymanBidStage(bid) === 'other').length,
  };
}

function getHandymanReplyWaitingCount(bid, userId) {
  const messages = bid.messages || [];
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].senderId === userId) {
      break;
    }
    count += 1;
  }
  return count;
}

function getHandymanActionBadge(bid, userId) {
  const replyWaitingCount = getHandymanReplyWaitingCount(bid, userId);
  if (bid.status === 'ACCEPTED' && bid.job?.payment?.status === 'FUNDED') {
    return {
      label: 'Funded - start now',
      tone: 'success',
    };
  }

  if (replyWaitingCount > 0) {
    return {
      label: replyWaitingCount === 1 ? 'Homeowner replied' : `${replyWaitingCount} new messages`,
      tone: 'review',
    };
  }

  if (bid.status === 'ACCEPTED' && bid.job?.payment?.status === 'PENDING_FUNDING') {
    return {
      label: 'Escrow not funded',
      tone: 'warning',
    };
  }

  if (bid.job?.review && getHandymanBidStage(bid) === 'completed') {
    return {
      label: 'Review available',
      tone: 'neutral',
    };
  }

  if (bid.status === 'SHORTLISTED') {
    return {
      label: 'Shortlisted',
      tone: 'review',
    };
  }

  if (bid.status === 'PENDING') {
    return {
      label: 'Awaiting review',
      tone: 'neutral',
    };
  }

  return null;
}

function enrichHandymanBid(bid, userId) {
  const replyWaitingCount = getHandymanReplyWaitingCount(bid, userId);
  const latestMessage = bid.messages?.[bid.messages.length - 1] || null;
  return {
    ...bid,
    bidStage: getHandymanBidStage(bid),
    replyWaitingCount,
    hasUnreadMessages: replyWaitingCount > 0,
    latestMessage,
    actionBadge: getHandymanActionBadge(bid, userId),
  };
}

function filterHandymanBids(myBids, myJobsView) {
  if (myJobsView === 'activeFunded') {
    return myBids.filter((bid) => bid.bidStage === 'activeFunded');
  }
  if (myJobsView === 'needsAction') {
    return myBids.filter((bid) => Boolean(bid.actionBadge));
  }
  if (myJobsView === 'unread') {
    return myBids.filter((bid) => bid.hasUnreadMessages);
  }
  if (myJobsView === 'pending') {
    return myBids.filter((bid) => bid.bidStage === 'pending');
  }
  if (myJobsView === 'completed') {
    return myBids.filter((bid) => bid.bidStage === 'completed');
  }
  return myBids;
}

function buildHandymanJobsViewHref(filters, myJobsView) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.category) params.set('category', filters.category);
  if (filters.minBudget) params.set('minBudget', String(filters.minBudget));
  if (filters.maxBudget) params.set('maxBudget', String(filters.maxBudget));
  if (filters.sort && filters.sort !== 'newest') params.set('sort', filters.sort);
  if (filters.photosOnly) params.set('photosOnly', '1');
  if (filters.nearMeOnly) params.set('nearMeOnly', '1');
  if (myJobsView && myJobsView !== 'all') params.set('myJobsView', myJobsView);
  const query = params.toString();
  return query ? `/dashboard?${query}` : '/dashboard';
}

function getAdminJobReplyWaitingCount(job) {
  const bids = job.bids || [];
  return bids.reduce((maxCount, bid) => {
    const latestMessage = bid.messages?.[0];
    if (!latestMessage) {
      return maxCount;
    }

    let count = 0;
    for (const message of bid.messages) {
      if (message.senderId !== latestMessage.senderId) {
        break;
      }
      count += 1;
    }

    return Math.max(maxCount, count);
  }, 0);
}

function getAdminJobLatestMessage(job) {
  return (job.bids || [])
    .flatMap((bid) => bid.messages || [])
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))[0] || null;
}

function enrichAdminJob(job) {
  const latestMessage = getAdminJobLatestMessage(job);
  const replyWaitingCount = getAdminJobReplyWaitingCount(job);
  const isCompleted = job.status === 'COMPLETED' || job.payment?.status === 'RELEASED' || Boolean(job.review);
  const isFunded = ['FUNDED', 'DISPUTED'].includes(job.payment?.status || '') && !isCompleted;
  const isUnread = Boolean(latestMessage) && replyWaitingCount > 0 && !isCompleted;
  const isPending = !isCompleted && !isFunded;
  const needsActionReason = job.dispute?.status === 'OPEN'
    ? 'Open dispute'
    : job.acceptedBid && job.payment?.status === 'PENDING_FUNDING'
      ? 'Escrow not funded'
      : isUnread
        ? latestMessage.sender?.role === 'HOMEOWNER'
          ? 'Homeowner replied'
          : 'Handyman replied'
        : null;

  return {
    ...job,
    isCompleted,
    isFunded,
    isUnread,
    isPending,
    needsActionReason,
    latestMessage,
    replyWaitingCount,
  };
}

function matchesAdminJobView(job, adminJobView) {
  switch (adminJobView) {
    case 'funded':
      return job.isFunded;
    case 'needsAction':
      return Boolean(job.needsActionReason);
    case 'unread':
      return job.isUnread;
    case 'pending':
      return job.isPending;
    case 'completed':
      return job.isCompleted;
    case 'all':
    default:
      return true;
  }
}

function matchesAdminJobCategory(job, adminJobCategory) {
  if (!adminJobCategory) return true;
  return String(job.category || '').toLowerCase() === String(adminJobCategory || '').toLowerCase();
}

function matchesAdminJobStatus(job, adminJobStatus) {
  if (!adminJobStatus) return true;
  return String(job.status || '').toUpperCase() === String(adminJobStatus || '').toUpperCase();
}

function buildAdminJobViewHref(
  filters,
  adminJobView,
  adminJobCategory = filters.adminJobCategory || '',
  adminJobDateRange = filters.adminJobDateRange || 'all',
  adminJobStatus = filters.adminJobStatus || ''
) {
  const params = new URLSearchParams();
  if (filters.billingSearch) params.set('billingSearch', filters.billingSearch);
  if (filters.billingProvider) params.set('billingProvider', filters.billingProvider);
  if (filters.billingEventType) params.set('billingEventType', filters.billingEventType);
  if (filters.billingStatus) params.set('billingStatus', filters.billingStatus);
  if (filters.billingSupportStatus) params.set('billingSupportStatus', filters.billingSupportStatus);
  if (filters.selectedBillingGroup) params.set('selectedBillingGroup', filters.selectedBillingGroup);
  if (filters.supportCaseSearch) params.set('supportCaseSearch', filters.supportCaseSearch);
  if (filters.supportCaseStatus) params.set('supportCaseStatus', filters.supportCaseStatus);
  if (filters.supportCaseOwner) params.set('supportCaseOwner', filters.supportCaseOwner);
  if (filters.supportCaseQueue) params.set('supportCaseQueue', filters.supportCaseQueue);
  if (filters.supportCaseViewId) params.set('supportCaseViewId', filters.supportCaseViewId);
  if (adminJobView && adminJobView !== 'all') params.set('adminJobView', adminJobView);
  if (adminJobCategory) params.set('adminJobCategory', adminJobCategory);
  if (adminJobDateRange && adminJobDateRange !== 'all') params.set('adminJobDateRange', adminJobDateRange);
  if (adminJobStatus) params.set('adminJobStatus', adminJobStatus);
  const query = params.toString();
  return query ? `/admin?${query}` : '/admin';
}

function buildAdminJobTimeline(job) {
  const events = [
    {
      label: 'Job posted',
      detail: `${job.homeowner?.name || 'Homeowner'} created ${job.title}.`,
      tone: 'neutral',
      at: job.createdAt,
    },
  ];

  (job.bids || []).forEach((bid) => {
    events.push({
      label: 'Bid submitted',
      detail: `${bid.handyman?.name || 'Handyman'} quoted ${formatCurrency(bid.amount)} with ETA ${bid.etaDays} day${bid.etaDays === 1 ? '' : 's'}.`,
      tone: bid.status === 'ACCEPTED' ? 'success' : bid.status === 'SHORTLISTED' ? 'review' : 'neutral',
      at: bid.createdAt,
    });

    if (bid.status === 'ACCEPTED') {
      events.push({
        label: 'Bid accepted',
        detail: `${bid.handyman?.name || 'Handyman'} was awarded the job.`,
        tone: 'success',
        at: bid.updatedAt,
      });
    } else if (bid.status === 'SHORTLISTED') {
      events.push({
        label: 'Bid shortlisted',
        detail: `${bid.handyman?.name || 'Handyman'} is on the homeowner shortlist.`,
        tone: 'review',
        at: bid.updatedAt,
      });
    } else if (bid.status === 'DECLINED') {
      events.push({
        label: 'Bid declined',
        detail: `${bid.handyman?.name || 'Handyman'} was not selected.`,
        tone: 'muted',
        at: bid.updatedAt,
      });
    }
  });

  if (job.payment?.fundedAt) {
    events.push({
      label: 'Escrow funded',
      detail: `Escrow was funded for ${formatCurrency(job.payment.amount)}.`,
      tone: 'success',
      at: job.payment.fundedAt,
    });
  }

  if (job.dispute?.createdAt) {
    events.push({
      label: 'Dispute opened',
      detail: `${job.dispute.openedBy?.name || 'A user'} opened a dispute: ${job.dispute.reason}.`,
      tone: 'warning',
      at: job.dispute.createdAt,
    });
  }

  if (job.dispute?.status === 'RESOLVED' && job.dispute.resolvedAt) {
    events.push({
      label: 'Dispute resolved',
      detail: job.dispute.resolutionNotes || 'The dispute was resolved.',
      tone: 'success',
      at: job.dispute.resolvedAt,
    });
  }

  if (job.completedAt) {
    events.push({
      label: 'Job completed',
      detail: 'The homeowner marked the job complete.',
      tone: 'success',
      at: job.completedAt,
    });
  }

  if (job.review?.createdAt) {
    events.push({
      label: 'Review left',
      detail: `${job.review.stars}/5 stars${job.review.text ? `: ${job.review.text}` : ''}`,
      tone: 'neutral',
      at: job.review.createdAt,
    });
  }

  return events
    .filter((event) => event.at)
    .sort((left, right) => new Date(left.at) - new Date(right.at));
}

function buildSupportCaseViewQuery(savedView) {
  const params = new URLSearchParams();
  if (savedView.supportCaseSearch) params.set('supportCaseSearch', savedView.supportCaseSearch);
  if (savedView.supportCaseStatus) params.set('supportCaseStatus', savedView.supportCaseStatus);
  if (savedView.supportCaseOwner) params.set('supportCaseOwner', savedView.supportCaseOwner);
  if (savedView.supportCaseQueue) params.set('supportCaseQueue', savedView.supportCaseQueue);
  if (savedView.id) params.set('supportCaseViewId', savedView.id);
  const query = params.toString();
  return query ? '/admin?' + query : '/admin';
}

function hasSupportCaseFilterSelection(filters) {
  return Boolean(filters.supportCaseViewId || filters.supportCaseSearch || filters.supportCaseStatus || filters.supportCaseOwner || filters.supportCaseQueue);
}

const SUPPORT_CASE_AUTO_ROUTE_MESSAGE_PREFIX = 'Auto-assigned support case from preset view: ';

function parseSupportCaseAutoRouteActivity(activity) {
  if (!activity || typeof activity.message !== 'string' || !activity.message.startsWith(SUPPORT_CASE_AUTO_ROUTE_MESSAGE_PREFIX)) {
    return null;
  }

  const viewIdMatch = activity.message.match(/\[view:([^\]]+)\]$/);
  const routedViewId = viewIdMatch ? String(viewIdMatch[1]).trim() : '';
  let routedViewName = activity.message.slice(SUPPORT_CASE_AUTO_ROUTE_MESSAGE_PREFIX.length).trim();
  if (viewIdMatch) {
    routedViewName = routedViewName.replace(/\s*\[view:[^\]]+\]$/, '').trim();
  }
  if (routedViewName.endsWith('.')) {
    routedViewName = routedViewName.slice(0, -1);
  }

  return {
    routedViewId,
    routedViewName,
  };
}

function supportCaseMatchesSavedView(supportCase, savedView, currentAdminId = '') {
  if (savedView.supportCaseSearch) {
    const haystack = [
      supportCase.title,
      supportCase.sourcePlaybookName,
      supportCase.summaryText,
      supportCase.notes,
      supportCase.createdByAdmin?.name,
      supportCase.assignedAdmin?.name,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(String(savedView.supportCaseSearch).toLowerCase())) {
      return false;
    }
  }
  if (savedView.supportCaseStatus && supportCase.status !== savedView.supportCaseStatus) {
    return false;
  }
  if (savedView.supportCaseOwner) {
    if (savedView.supportCaseOwner === 'unassigned') {
      if (supportCase.assignedAdminUserId) return false;
    } else if (supportCase.assignedAdminUserId !== savedView.supportCaseOwner) {
      return false;
    }
  }
  if (savedView.supportCaseQueue && !matchesSupportCaseQueue(supportCase, savedView.supportCaseQueue, currentAdminId)) {
    return false;
  }
  return true;
}

async function applySupportCaseAutoRouting(supportCaseId, currentAdminId) {
  const supportCase = await prisma.supportCase.findUnique({
    where: { id: supportCaseId },
    include: { createdByAdmin: true, assignedAdmin: true },
  });
  if (!supportCase) return;

  const matchingViews = await prisma.savedSupportCaseView.findMany({
    where: {
      autoApplyOnCreate: true,
      autoAssignAdminUserId: { not: null },
      OR: [
        { userId: currentAdminId },
        { scope: 'SHARED' },
      ],
    },
    include: { autoAssignAdmin: true, user: true },
    orderBy: [
      { scope: 'desc' },
      { isPinned: 'desc' },
      { updatedAt: 'desc' },
    ],
  });

  const matchedView = matchingViews.find((savedView) => supportCaseMatchesSavedView(supportCase, savedView, currentAdminId));
  if (!matchedView || !matchedView.autoAssignAdminUserId) return;
  if (supportCase.assignedAdminUserId === matchedView.autoAssignAdminUserId) return;

  await prisma.supportCase.update({
    where: { id: supportCase.id },
    data: { assignedAdminUserId: matchedView.autoAssignAdminUserId },
  });

  await logSupportCaseActivity({
    supportCaseId: supportCase.id,
    actorAdminUserId: currentAdminId,
    type: 'REASSIGNED',
    message: SUPPORT_CASE_AUTO_ROUTE_MESSAGE_PREFIX + matchedView.name + '. [view:' + matchedView.id + ']',
  });

  await notifySupportCaseAdmins({
    actorAdminUserId: currentAdminId,
    supportCaseId: supportCase.id,
    title: 'Support case auto-assigned',
    body: supportCase.title + ' was routed by preset view ' + matchedView.name + '.',
    href: '/admin/support-cases/' + supportCase.id,
    mode: 'all_admins',
  });
}

function buildSupportCaseRoutingInsights({ supportCases, savedSupportCaseViews, autoRouteActivities, currentAdminId }) {
  const autoRoutingViews = savedSupportCaseViews.filter((savedView) => savedView.autoApplyOnCreate && savedView.autoAssignAdminUserId);
  const routedEventsByViewId = new Map();
  const routedEventsByViewName = new Map();
  const autoRoutedCaseIds = new Set();

  autoRouteActivities.forEach((activity) => {
    const parsedActivity = parseSupportCaseAutoRouteActivity(activity);
    if (!parsedActivity) return;
    autoRoutedCaseIds.add(activity.supportCaseId);
    if (parsedActivity.routedViewId) {
      const viewEvents = routedEventsByViewId.get(parsedActivity.routedViewId) || [];
      viewEvents.push(activity);
      routedEventsByViewId.set(parsedActivity.routedViewId, viewEvents);
    }
    if (parsedActivity.routedViewName) {
      const viewEvents = routedEventsByViewName.get(parsedActivity.routedViewName) || [];
      viewEvents.push(activity);
      routedEventsByViewName.set(parsedActivity.routedViewName, viewEvents);
    }
  });

  const presetAnalytics = autoRoutingViews.map((savedView) => {
    const matchedCases = supportCases.filter((supportCase) => supportCaseMatchesSavedView(supportCase, savedView, currentAdminId));
    const routedEvents = routedEventsByViewId.get(savedView.id) || routedEventsByViewName.get(savedView.name) || [];
    const uniqueRoutedCaseIds = [...new Set(routedEvents.map((activity) => activity.supportCaseId))];
    return {
      ...savedView,
      openMatchesNow: matchedCases.filter((supportCase) => supportCase.status === 'OPEN').length,
      recentMatches: matchedCases.length,
      recentRoutedCount: uniqueRoutedCaseIds.length,
      lastRoutedAt: routedEvents[0]?.createdAt || null,
    };
  });

  const routingExceptions = supportCases
    .filter((supportCase) => supportCase.status === 'OPEN')
    .map((supportCase) => {
      const matchedViews = autoRoutingViews.filter((savedView) => supportCaseMatchesSavedView(supportCase, savedView, currentAdminId));
      const autoRouted = autoRoutedCaseIds.has(supportCase.id);
      if (autoRouted) {
        return null;
      }

      if (matchedViews.length === 0) {
        return {
          id: supportCase.id,
          title: supportCase.title,
          href: '/admin/support-cases/' + supportCase.id,
          reason: 'No preset matched this case.',
          ownerLabel: supportCase.assignedAdmin?.name || 'Unassigned',
          matchedViewNames: [],
          updatedAt: supportCase.updatedAt,
        };
      }

      const matchingOwnerView = matchedViews.find((savedView) => savedView.autoAssignAdminUserId === supportCase.assignedAdminUserId);
      if (!supportCase.assignedAdminUserId) {
        return {
          id: supportCase.id,
          title: supportCase.title,
          href: '/admin/support-cases/' + supportCase.id,
          reason: 'Matches preset filters but is still unassigned.',
          ownerLabel: 'Unassigned',
          matchedViewNames: matchedViews.map((savedView) => savedView.name),
          updatedAt: supportCase.updatedAt,
        };
      }

      if (!matchingOwnerView) {
        return {
          id: supportCase.id,
          title: supportCase.title,
          href: '/admin/support-cases/' + supportCase.id,
          reason: 'Matches a preset, but the current owner differs from the routing target.',
          ownerLabel: supportCase.assignedAdmin?.name || 'Assigned',
          matchedViewNames: matchedViews.map((savedView) => savedView.name),
          updatedAt: supportCase.updatedAt,
        };
      }

      return null;
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 6);

  return {
    presetAnalytics,
    routingExceptions,
    autoRoutingViewCount: autoRoutingViews.length,
  };
}

function getOpenJobsOrderBy(sort) {
  if (sort === 'budget_asc') {
    return [{ budget: 'asc' }, { createdAt: 'desc' }];
  }
  if (sort === 'budget_desc') {
    return [{ budget: 'desc' }, { createdAt: 'desc' }];
  }
  return [{ createdAt: 'desc' }];
}

const JOB_ASSIST_CATEGORY_KEYWORDS = {
  Plumbing: ['plumb', 'pipe', 'faucet', 'sink', 'toilet', 'drain', 'leak', 'shower', 'garbage disposal'],
  Electrical: ['electrical', 'outlet', 'switch', 'breaker', 'ceiling fan', 'light fixture', 'rewire', 'wiring'],
  Painting: ['paint', 'repaint', 'primer', 'drywall patch', 'wall color', 'trim paint'],
  'Furniture Assembly': ['assemble', 'assembly', 'dresser', 'desk', 'bed frame', 'ikea', 'bookshelf', 'cabinet'],
  'Yard Help': ['yard', 'lawn', 'mulch', 'weed', 'hedge', 'rake', 'leaves', 'garden', 'brush'],
  Installations: ['install', 'mount', 'hang', 'tv', 'shelving', 'blinds', 'curtain', 'doorbell', 'appliance'],
  Repairs: ['repair', 'fix', 'broken', 'patch', 'replace', 'loose', 'crack', 'damaged'],
  'General Handyman': ['handyman', 'odd jobs', 'misc', 'small jobs', 'general'],
};

const JOB_ASSIST_BUDGET_BASE = {
  'General Handyman': [125, 275],
  Painting: [180, 450],
  'Furniture Assembly': [90, 260],
  Electrical: [160, 380],
  Plumbing: [170, 420],
  'Yard Help': [95, 280],
  Installations: [120, 340],
  Repairs: [110, 320],
};

const JOB_ASSIST_AREA_RATE_RULES = [
  { pattern: /(san francisco|san jose|oakland|palo alto|mountain view|new york, ny|manhattan|brooklyn|seattle|boston|los angeles)/i, multiplier: 1.3, label: 'higher-cost local labor market' },
  { pattern: /(chicago|denver|austin|portland|miami|atlanta|philadelphia|washington, dc|northern virginia)/i, multiplier: 1.15, label: 'above-average local labor market' },
  { pattern: /(columbus|cincinnati|cleveland|indianapolis|kansas city|louisville|milwaukee|pittsburgh|st louis|charlotte|nashville|phoenix|tampa)/i, multiplier: 1, label: 'typical metro labor market' },
  { pattern: /(rural|small town|suburb|suburbs|outside the city)/i, multiplier: 0.9, label: 'lower-density local labor market' },
];

function roundBudgetSuggestion(amount) {
  return Math.max(50, Math.round(amount / 25) * 25);
}

function inferJobCategoryFromText(text) {
  const haystack = String(text || '').toLowerCase();
  let bestCategory = 'General Handyman';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(JOB_ASSIST_CATEGORY_KEYWORDS)) {
    const score = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

function inferPreferredDateSuggestion(text, preferredDate) {
  if (preferredDate) return preferredDate;
  const haystack = String(text || '').toLowerCase();
  if (haystack.includes('urgent') || haystack.includes('asap') || haystack.includes('today')) {
    return 'ASAP or within the next 2 days';
  }
  if (haystack.includes('weekend')) {
    return 'This weekend preferred';
  }
  if (haystack.includes('next week')) {
    return 'Sometime next week';
  }
  return 'Flexible this week or next';
}

function inferAreaRate(location) {
  const normalizedLocation = String(location || '').trim();
  if (!normalizedLocation) {
    return { multiplier: 1, label: 'typical local labor market' };
  }

  const zip = extractZip(normalizedLocation);
  if (zip) {
    const zipPrefix = Number.parseInt(zip.slice(0, 3), 10);
    if (!Number.isNaN(zipPrefix)) {
      if (zipPrefix >= 900 || zipPrefix <= 129) {
        return { multiplier: 1.18, label: 'higher-cost ZIP market' };
      }
      if (zipPrefix >= 430 && zipPrefix <= 459) {
        return { multiplier: 1, label: 'typical Ohio-area labor market' };
      }
      if (zipPrefix >= 150 && zipPrefix <= 299) {
        return { multiplier: 1.08, label: 'mid-Atlantic metro labor market' };
      }
      if (zipPrefix >= 580 && zipPrefix <= 799) {
        return { multiplier: 0.95, label: 'lower-cost central market' };
      }
    }
  }

  const matchedRule = JOB_ASSIST_AREA_RATE_RULES.find((rule) => rule.pattern.test(normalizedLocation));
  if (matchedRule) {
    return { multiplier: matchedRule.multiplier, label: matchedRule.label };
  }

  return { multiplier: 1, label: 'typical local labor market' };
}

function buildJobTitle(category, prompt, description, currentTitle) {
  if (currentTitle) return currentTitle;
  const source = String(prompt || description || '').trim();
  const cleaned = source.replace(/\s+/g, ' ').trim();
  const phrase = cleaned
    .replace(/^(need help with|looking for help with|looking for someone to|need someone to)\s+/i, '')
    .split(/[.!?]/)[0]
    .trim();

  if (phrase) {
    const shortPhrase = phrase.length > 56 ? phrase.slice(0, 56).trim() + '...' : phrase;
    return shortPhrase.charAt(0).toUpperCase() + shortPhrase.slice(1);
  }

  const fallbackByCategory = {
    Plumbing: 'Fix plumbing issue in home',
    Electrical: 'Electrical repair or installation help needed',
    Painting: 'Interior painting help needed',
    'Furniture Assembly': 'Furniture assembly help needed',
    'Yard Help': 'Yard cleanup and outdoor help needed',
    Installations: 'Home installation help needed',
    Repairs: 'Home repair help needed',
    'General Handyman': 'Handyman help needed around the house',
  };

  return fallbackByCategory[category] || 'Home task help needed';
}

function buildJobDescription({ prompt, description, category, location, preferredDate }) {
  const source = String(prompt || description || '').trim();
  const cleaned = source.replace(/\s+/g, ' ').trim();
  const intro = cleaned || ('I need help with a ' + category.toLowerCase() + ' project at my home.');
  const scopeLine = category === 'Painting'
    ? 'Please include surface prep, patching if needed, and a clean finish.'
    : category === 'Furniture Assembly'
      ? 'Please bring the tools needed for assembly and cleanup.'
      : category === 'Yard Help'
        ? 'Please include bagging or cleanup details in your bid.'
        : 'Please share your approach, estimated timeline, and anything you would need from me before starting.';

  const locationLine = location ? ('Location: ' + location + '.') : '';
  const dateLine = preferredDate ? ('Preferred timing: ' + preferredDate + '.') : '';

  return [
    intro,
    scopeLine,
    locationLine,
    dateLine,
    'When you bid, please include your availability, estimated duration, and whether you see any materials or follow-up work I should expect.',
  ].filter(Boolean).join('\n\n');
}

function buildJobAssistSuggestion(input) {
  const prompt = String(input.prompt || '').trim();
  const mode = String(input.mode || 'draft').trim().toLowerCase();
  const currentTitle = String(input.title || '').trim();
  const currentDescription = String(input.description || '').trim();
  const location = String(input.location || '').trim();
  const preferredDate = String(input.preferredDate || '').trim();
  const chosenCategory = String(input.category || '').trim();
  const textForInference = [prompt, currentTitle, currentDescription].filter(Boolean).join(' ');
  const category = JOB_CATEGORIES.includes(chosenCategory) ? chosenCategory : inferJobCategoryFromText(textForInference);

  const complexityText = textForInference.toLowerCase();
  let [minBudget, maxBudget] = JOB_ASSIST_BUDGET_BASE[category] || JOB_ASSIST_BUDGET_BASE['General Handyman'];
  if (/(large|multiple|several|full room|whole|replace all|two rooms|three rooms)/.test(complexityText)) {
    minBudget += 100;
    maxBudget += 250;
  }
  if (/(small|minor|quick|simple|basic)/.test(complexityText)) {
    minBudget = Math.max(75, minBudget - 40);
    maxBudget = Math.max(minBudget + 75, maxBudget - 60);
  }
  if (/(urgent|asap|same day|today)/.test(complexityText)) {
    maxBudget += 75;
  }

  const areaRate = inferAreaRate(location);
  minBudget = roundBudgetSuggestion(minBudget * areaRate.multiplier);
  maxBudget = roundBudgetSuggestion(maxBudget * areaRate.multiplier);

  const suggestedBudget = roundBudgetSuggestion((minBudget + maxBudget) / 2);
  const recommendedDate = inferPreferredDateSuggestion(textForInference, preferredDate);
  const title = buildJobTitle(category, prompt, currentDescription, currentTitle);
  const description = buildJobDescription({
    prompt,
    description: currentDescription,
    category,
    location,
    preferredDate: recommendedDate,
  });

  const checklist = [
    'Mention the exact room, wall, fixture, or area that needs work.',
    'Say whether materials are already on site or the handyman should bring them.',
    'Call out anything urgent, access-related, or safety-related before bids come in.',
  ];
  if (category === 'Painting') checklist.unshift('Share approximate wall count, room size, and whether patching is needed.');
  if (category === 'Electrical') checklist.unshift('Note whether power is currently off, flickering, or unsafe.');
  if (category === 'Plumbing') checklist.unshift('Mention whether the leak, clog, or fixture issue is active right now.');
  if (location) checklist.unshift('Budget is tuned for ' + location + ' using a ' + areaRate.label + '.');

  const modeSummaryPrefix = mode === 'budget-only'
    ? 'Suggested a target budget'
    : mode === 'polish'
      ? 'Polished the job details'
      : 'Drafted the job details';

  return {
    title,
    category,
    description,
    budget: suggestedBudget,
    budgetRangeLabel: '$' + minBudget + '-$' + maxBudget,
    areaRateLabel: areaRate.label,
    preferredDate: recommendedDate,
    checklist: checklist.slice(0, 4),
    summary: modeSummaryPrefix + ' for a ' + category.toLowerCase() + ' post with a suggested local budget range of $' + minBudget + ' to $' + maxBudget + '.',
    source: 'local-smart-assist',
  };
}

const BID_ASSIST_TYPICAL_HOURS = {
  'General Handyman': 4,
  Painting: 8,
  'Furniture Assembly': 3,
  Electrical: 4,
  Plumbing: 4,
  'Yard Help': 5,
  Installations: 3,
  Repairs: 3,
};

function buildBidAssistSuggestion({ job, profile, currentBid, mode = 'recommend', currentMessage = '' }) {
  const category = job.category || 'General Handyman';
  const areaRate = inferAreaRate(job.location);
  const baseRange = JOB_ASSIST_BUDGET_BASE[category] || JOB_ASSIST_BUDGET_BASE['General Handyman'];
  const localizedLow = roundBudgetSuggestion(baseRange[0] * areaRate.multiplier);
  const localizedHigh = roundBudgetSuggestion(baseRange[1] * areaRate.multiplier);
  const typicalHours = BID_ASSIST_TYPICAL_HOURS[category] || 4;
  const hourlyGuideline = profile?.hourlyGuideline || 0;
  const hourlyFloor = hourlyGuideline ? roundBudgetSuggestion(hourlyGuideline * typicalHours * 0.85) : localizedLow;
  const homeownerBudget = job.budget || localizedHigh;
  const competitionCount = job._count?.bids || 0;
  const hasPhotos = (job.photos || []).length > 0;
  const verifiedCount = [profile?.insuranceStatus === 'APPROVED', profile?.licenseStatus === 'APPROVED'].filter(Boolean).length;
  const ratingBoost = profile?.ratingCount ? Math.min(25, Math.round(profile.ratingAvg || 0) * 5) : 0;
  const competitionDiscount = competitionCount >= 4 ? 0.88 : competitionCount >= 2 ? 0.94 : competitionCount >= 1 ? 0.97 : 1;
  const confidenceFloor = verifiedCount > 0 ? 15 * verifiedCount : 0;

  let suggestedAmount = Math.min(homeownerBudget, roundBudgetSuggestion(Math.min(localizedHigh, homeownerBudget) * competitionDiscount));
  suggestedAmount = Math.max(suggestedAmount, hourlyFloor);
  suggestedAmount = Math.min(homeownerBudget, suggestedAmount + ratingBoost + confidenceFloor);
  suggestedAmount = roundBudgetSuggestion(suggestedAmount);

  if (currentBid?.amount) {
    suggestedAmount = currentBid.amount;
  }

  const urgentText = String(job.preferredDate || '').toLowerCase();
  let etaDays = category === 'Painting' ? 2 : category === 'Yard Help' ? 2 : 1;
  if (hasPhotos && category === 'Painting') etaDays = 3;
  if (urgentText.includes('asap') || urgentText.includes('today')) etaDays = 1;
  if (urgentText.includes('weekend') && etaDays < 2) etaDays = 2;
  if (currentBid?.etaDays) etaDays = currentBid.etaDays;

  const opener = competitionCount >= 3
    ? 'I can take this on with a clear plan and a competitive quote.'
    : 'I can help with this and keep the scope straightforward.';
  const proofPoints = [
    profile?.businessName ? `${profile.businessName} handles ${category.toLowerCase()} work regularly.` : `I handle ${category.toLowerCase()} work regularly.`,
    profile?.serviceRadius ? `I serve jobs within about ${profile.serviceRadius} miles, so I can plan this efficiently.` : '',
    verifiedCount > 0 ? `My profile includes ${verifiedCount === 2 ? 'insurance and license' : profile?.insuranceStatus === 'APPROVED' ? 'insurance' : 'license'} verification.` : '',
    hasPhotos ? 'The photos help, and I would confirm the exact scope before starting.' : 'I can confirm scope details with you before starting so there are no surprises.',
  ].filter(Boolean);
  const close = `I’m estimating about ${etaDays} day${etaDays === 1 ? '' : 's'} for the work. If awarded, I can share the exact start window and any materials I’d want to confirm first.`;

  const recommendedMessage = [opener, ...proofPoints, close].join(' ');

  return {
    amount: mode === 'polish' && currentBid?.amount ? currentBid.amount : suggestedAmount,
    etaDays: mode === 'polish' && currentBid?.etaDays ? currentBid.etaDays : etaDays,
    message: mode === 'polish' && currentMessage ? `${currentMessage.trim()} ${close}`.trim() : recommendedMessage,
    targetRangeLabel: '$' + localizedLow + '-$' + Math.min(localizedHigh, homeownerBudget),
    competitivenessLabel: competitionCount >= 3 ? 'Tighter market with several bids already in.' : competitionCount >= 1 ? 'Active job with at least one competing bid.' : 'Early bid window with a chance to stand out first.',
    strategy: `Aim near ${formatCurrency(suggestedAmount)} to stay competitive for ${job.location || 'this area'} without dropping below a reasonable local rate.`,
    tips: [
      hasPhotos ? 'Reference the photos so the homeowner knows you reviewed the details.' : 'Call out one or two questions that would help you confirm scope quickly.',
      competitionCount >= 2 ? 'Keep your message specific and confident so you stand out from other bidders.' : 'A fast, specific bid can make a strong first impression here.',
      verifiedCount > 0 ? 'Mention your verification status to reinforce trust.' : 'If you have verifications pending, keep the message extra clear and professional.',
    ],
    source: 'local-bid-assist',
  };
}

async function currentUser(req) {
  if (!req.session.userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    include: {
      handymanProfile: true,
      notifications: {
        orderBy: { createdAt: 'desc' },
        take: 8,
      },
    },
  });

  if (!user) return null;

  if ((req.session.authVersion ?? 0) !== user.sessionVersion) {
    clearAuthSession(req);
    return null;
  }

  if (req.session.role !== user.role) {
    req.session.role = user.role;
  }
  if (req.session.userEmail !== user.email) {
    req.session.userEmail = user.email;
  }
  if ((req.session.authVersion ?? 0) !== user.sessionVersion) {
    req.session.authVersion = user.sessionVersion;
  }

  return user;
}

async function getUserDeletionEligibility(targetUserOrId) {
  const targetUser = typeof targetUserOrId === 'string'
    ? await prisma.user.findUnique({ where: { id: targetUserOrId } })
    : targetUserOrId;

  if (!targetUser) {
    return {
      allowed: false,
      reason: 'User not found.',
      summary: 'Account not found.',
    };
  }

  if (targetUser.role === 'ADMIN') {
    return {
      allowed: false,
      reason: 'Admin accounts cannot be deleted from this workflow.',
      summary: 'Admin accounts are protected.',
    };
  }

  if (targetUser.role === 'HOMEOWNER') {
    const [blockingJobsCount, draftJobsCount] = await Promise.all([
      prisma.job.count({
        where: {
          homeownerId: targetUser.id,
          OR: [
            { bids: { some: {} } },
            { status: { in: ['IN_REVIEW', 'AWARDED', 'COMPLETED'] } },
            { payment: { isNot: null } },
            { dispute: { isNot: null } },
            { review: { isNot: null } },
          ],
        },
      }),
      prisma.job.count({
        where: {
          homeownerId: targetUser.id,
          status: 'OPEN',
          bids: { none: {} },
        },
      }),
    ]);

    if (blockingJobsCount > 0) {
      return {
        allowed: false,
        reason: 'This homeowner has jobs with bids or work history. Suspend the account instead to preserve marketplace records.',
        summary: `${blockingJobsCount} protected job${blockingJobsCount === 1 ? '' : 's'} with bidding or work history.`,
      };
    }

    return {
      allowed: true,
      reason: 'This homeowner only has draft-style activity and can be deleted safely.',
      summary: draftJobsCount > 0
        ? `${draftJobsCount} draft job${draftJobsCount === 1 ? '' : 's'} will be removed.`
        : 'No posted jobs will be left behind.',
    };
  }

  const [acceptedBidCount, openBidCount] = await Promise.all([
    prisma.bid.count({
      where: {
        handymanId: targetUser.id,
        status: 'ACCEPTED',
      },
    }),
    prisma.bid.count({
      where: {
        handymanId: targetUser.id,
        status: { in: ['PENDING', 'SHORTLISTED'] },
      },
    }),
  ]);

  if (acceptedBidCount > 0) {
    return {
      allowed: false,
      reason: 'This handyman is tied to awarded or completed work. Suspend the account instead so homeowner job history stays intact.',
      summary: `${acceptedBidCount} accepted job${acceptedBidCount === 1 ? '' : 's'} must stay attached to this account.`,
    };
  }

  return {
    allowed: true,
    reason: 'This handyman has no awarded work attached and can be deleted safely.',
    summary: openBidCount > 0
      ? `${openBidCount} open bid${openBidCount === 1 ? '' : 's'} will be removed.`
      : 'No active bids will be left behind.',
  };
}

function baseViewModel(req, user) {
  return {
    flash: popFlash(req),
    user,
    csrfToken: ensureCsrfToken(req),
    categories: JOB_CATEGORIES,
    formatCurrency,
    getRoleLabel,
    getStatusTone,
    currentPath: req.path,
    formatPaymentStatus,
    formatDisputeStatus,
    formatReportStatus,
    formatAuditAction,
    formatVerificationStatus,
    formatSubscriptionPlan,
    formatNotificationType,
    formatCheckoutStatus,
    formatBillingStatus,
    formatBillingSupportStatus,
    formatBillingEventType,
    buildSupportCaseViewQuery,
    buildAdminJobViewHref,
    planConfig: PLAN_CONFIG,
    paymentProvider: getPaymentProvider(),
    notifications: user?.notifications || [],
    unreadNotificationCount: (user?.notifications || []).filter((notification) => !notification.isRead).length,
    appBaseUrl: getAppBaseUrl(req),
    supportEmail: getSupportEmail(),
    legalNavItems: getLegalNavItems(),
    currentYear: new Date().getFullYear(),
  };
}

async function logLeadCreditTransaction(handymanProfileId, amount, type, note) {
  return prisma.leadCreditTransaction.create({
    data: {
      handymanProfileId,
      amount,
      type,
      note,
    },
  });
}

async function createNotification(userId, type, title, body, href = '/dashboard') {
  return prisma.userNotification.create({
    data: {
      userId,
      type,
      title,
      body,
      href,
    },
  });
}

async function notifyAdmins(type, title, body, href = '/admin') {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
  if (admins.length === 0) return;
  await prisma.userNotification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      type,
      title,
      body,
      href,
    })),
  });
}

async function recordWebhookEvent({ provider, providerEventId, eventType, checkoutSessionId = null, payloadJson, status, processedAt = null }) {
  return prisma.paymentWebhookEvent.create({
    data: {
      provider,
      providerEventId,
      eventType,
      checkoutSessionId,
      payloadJson,
      status,
      processedAt,
    },
  });
}

function getBillingStatusFromStripeStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'active':
    case 'trialing':
      return 'ACTIVE';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'PAST_DUE';
    case 'canceled':
    case 'cancelled':
    case 'incomplete_expired':
      return 'CANCELED';
    default:
      return 'INACTIVE';
  }
}

function getBillingDate(value) {
  if (!value) return null;
  if (typeof value === 'number') {
    return new Date(value * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getPlanCreditRefresh(profile, plan, quantity = 1) {
  const config = PLAN_CONFIG[plan] || PLAN_CONFIG.FREE;
  const normalizedQuantity = Math.max(1, Number.parseInt(quantity, 10) || 1);
  if (config.unlimitedBids || !config.monthlyCredits) {
    return {
      nextCredits: profile.leadCredits,
      grantedCredits: 0,
    };
  }

  const includedCredits = config.monthlyCredits * normalizedQuantity;
  const nextCredits = Math.max(profile.leadCredits, includedCredits);
  return {
    nextCredits,
    grantedCredits: Math.max(0, nextCredits - profile.leadCredits),
  };
}

async function applyPlanBillingState({ profile, plan, quantity = 1, billingStatus, billingPeriodEndsAt, customerId, subscriptionId, creditNote }) {
  const normalizedQuantity = Math.max(1, Number.parseInt(quantity, 10) || 1);
  const refresh = getPlanCreditRefresh(profile, plan, normalizedQuantity);
  const updated = await prisma.handymanProfile.update({
    where: { id: profile.id },
    data: {
      subscriptionPlan: plan,
      leadCredits: refresh.nextCredits,
      subscriptionRenewsAt: billingPeriodEndsAt,
      billingStatus,
      billingPeriodEndsAt,
      billingQuantity: normalizedQuantity,
      stripeCustomerId: customerId || profile.stripeCustomerId,
      stripeSubscriptionId: subscriptionId || profile.stripeSubscriptionId,
    },
  });

  if (creditNote) {
    await logLeadCreditTransaction(updated.id, refresh.grantedCredits, 'PLAN_GRANT', creditNote);
  }

  return updated;
}

async function processCheckoutWebhook(event, provider = getPaymentProvider()) {
  if (!event) {
    return { ok: false, reason: 'missing_event' };
  }

  const payloadJson = JSON.stringify(event);
  const existingEvent = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } });
  if (existingEvent) {
    return { ok: true, ignored: true, duplicate: true };
  }

  let checkoutSessionId = null;

  try {
    if (event.type === 'checkout.session.completed') {
      const session = await prisma.checkoutSession.findUnique({
        where: { providerSessionId: event.data.sessionId },
        include: { user: { include: { handymanProfile: true } }, job: { include: { acceptedBid: true, payment: true } } },
      });
      checkoutSessionId = session?.id || null;

      if (!session || session.status === 'COMPLETED') {
        await recordWebhookEvent({
          provider,
          providerEventId: event.id,
          eventType: event.type,
          checkoutSessionId,
          payloadJson,
          status: 'IGNORED',
          processedAt: new Date(),
        });
        return { ok: true, ignored: true };
      }

      if (session.targetType === 'PLAN') {
        const plan = session.planKey;
        const profile = session.user.handymanProfile;
        const periodEnd = getBillingDate(event.data.currentPeriodEnd) || (plan === 'FREE' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
        const billingStatus = provider === STRIPE_PROVIDER_NAME ? 'ACTIVE' : plan === 'FREE' ? 'INACTIVE' : 'ACTIVE';
        await applyPlanBillingState({
          profile,
          plan,
          quantity: event.data.quantity,
          billingStatus,
          billingPeriodEndsAt: periodEnd,
          customerId: event.data.customerId,
          subscriptionId: event.data.subscriptionId,
          creditNote: formatSubscriptionPlan(plan) + ' plan credits applied via checkout.',
        });
        await createNotification(session.userId, 'ACCOUNT_STATUS', 'Plan updated', formatSubscriptionPlan(plan) + ' is now active on your account.', '/dashboard');
      }

      if (session.targetType === 'CREDIT_PACK') {
        const pack = CREDIT_PACKS[session.creditPack];
        const updated = await prisma.handymanProfile.update({
          where: { userId: session.userId },
          data: { leadCredits: { increment: pack.credits } },
        });
        await logLeadCreditTransaction(updated.id, pack.credits, 'CREDIT_PURCHASE', pack.label + ' purchased via checkout.');
        await createNotification(session.userId, 'ACCOUNT_STATUS', 'Lead credits added', pack.credits + ' lead credits were added to your balance.', '/dashboard');
      }

      if (session.targetType === 'ESCROW_FUNDING' && session.job) {
        await prisma.payment.update({
          where: { jobId: session.jobId },
          data: {
            status: 'FUNDED',
            fundedAt: new Date(),
          },
        });
        await createNotification(
          session.job.acceptedBid.handymanId,
          'ESCROW_FUNDED',
          'Escrow funded',
          'Escrow is funded for ' + session.job.title + '. You can begin the work.',
          '/dashboard'
        );
      }

      await prisma.checkoutSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      await recordWebhookEvent({
        provider,
        providerEventId: event.id,
        eventType: event.type,
        checkoutSessionId: session.id,
        payloadJson,
        status: 'PROCESSED',
        processedAt: new Date(),
      });

      return { ok: true };
    }

    if (['customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed', 'invoice.paid'].includes(event.type)) {
      const profileWhere = [
        event.data.subscriptionId ? { stripeSubscriptionId: event.data.subscriptionId } : null,
        event.data.customerId ? { stripeCustomerId: event.data.customerId } : null,
      ].filter(Boolean);
      const profile = profileWhere.length === 0
        ? null
        : await prisma.handymanProfile.findFirst({
            where: {
              OR: profileWhere,
            },
          });

      if (!profile) {
        await recordWebhookEvent({
          provider,
          providerEventId: event.id,
          eventType: event.type,
          payloadJson,
          status: 'IGNORED',
          processedAt: new Date(),
        });
        return { ok: true, ignored: true };
      }

      const billingPeriodEndsAt = getBillingDate(event.data.currentPeriodEnd) || profile.billingPeriodEndsAt;
      const nextPlan = event.type === 'customer.subscription.deleted'
        ? 'FREE'
        : (event.data.metadata?.planKey || profile.subscriptionPlan);
      const nextQuantity = Math.max(1, Number.parseInt(event.data.quantity, 10) || profile.billingQuantity || 1);
      const nextRenewal = event.type === 'customer.subscription.deleted' ? null : billingPeriodEndsAt;

      if (event.type === 'invoice.paid') {
        const billingReason = String(event.data.billingReason || '').toLowerCase();
        const shouldRefreshCredits = ['subscription_cycle', 'subscription_update', 'manual', 'upcoming'].includes(billingReason)
          && Number(event.data.amountPaid || 0) > 0;
        await applyPlanBillingState({
          profile,
          plan: nextPlan,
          quantity: nextQuantity,
          billingStatus: 'ACTIVE',
          billingPeriodEndsAt: nextRenewal,
          customerId: event.data.customerId,
          subscriptionId: event.data.subscriptionId,
          creditNote: shouldRefreshCredits
            ? formatSubscriptionPlan(nextPlan) + ' monthly credits refreshed after Stripe invoice payment.'
            : null,
        });
        await createNotification(profile.userId, 'ACCOUNT_STATUS', 'Subscription payment received', 'Your Stripe subscription payment went through successfully.', '/dashboard');
      } else {
        const billingStatus = event.type === 'invoice.payment_failed'
          ? 'PAST_DUE'
          : getBillingStatusFromStripeStatus(event.data.status);

        await prisma.handymanProfile.update({
          where: { id: profile.id },
          data: {
            subscriptionPlan: nextPlan,
            billingStatus,
            billingPeriodEndsAt: nextRenewal,
            billingQuantity: event.type === 'customer.subscription.deleted' ? 1 : nextQuantity,
            subscriptionRenewsAt: nextRenewal,
            stripeCustomerId: event.data.customerId || profile.stripeCustomerId,
            stripeSubscriptionId: event.type === 'customer.subscription.deleted'
              ? null
              : (event.data.subscriptionId || profile.stripeSubscriptionId),
          },
        });

        const title = event.type === 'invoice.payment_failed'
          ? 'Billing issue detected'
          : event.type === 'customer.subscription.deleted'
            ? 'Subscription ended'
            : 'Subscription updated';
        const body = event.type === 'invoice.payment_failed'
          ? 'Stripe reported a payment issue for your handyman plan. Update your payment method to keep bidding without interruption.'
          : event.type === 'customer.subscription.deleted'
            ? 'Your Stripe subscription ended. Your account moved back to the Free plan.'
            : 'Your Stripe subscription details were refreshed successfully.';

        await createNotification(profile.userId, 'ACCOUNT_STATUS', title, body, '/dashboard');
      }

      await recordWebhookEvent({
        provider,
        providerEventId: event.id,
        eventType: event.type,
        payloadJson,
        status: 'PROCESSED',
        processedAt: new Date(),
      });
      return { ok: true };
    }

    await recordWebhookEvent({
      provider,
      providerEventId: event.id,
      eventType: event.type,
      payloadJson,
      status: 'IGNORED',
      processedAt: new Date(),
    });
    return { ok: true, ignored: true, reason: 'unsupported_event' };
  } catch (error) {
    await recordWebhookEvent({
      provider,
      providerEventId: event.id,
      eventType: event.type,
      checkoutSessionId,
      payloadJson,
      status: 'FAILED',
      processedAt: new Date(),
    });
    throw error;
  }
}

async function completeMockCheckout(session) {
  const event = buildWebhookEvent(session);
  const payload = JSON.stringify(event);
  const expectedSignature = signPayload(payload);
  if (!expectedSignature) {
    throw new Error('Mock webhook signature generation failed.');
  }
  return processCheckoutWebhook(event, session.provider);
}

async function logModerationAction({ actorAdminUserId, moderationReportId = null, disputeId = null, targetUserId = null, action, notes = null }) {
  return prisma.moderationAuditLog.create({
    data: {
      actorAdminUserId,
      moderationReportId,
      disputeId,
      targetUserId,
      action,
      notes,
    },
  });
}

async function logBillingPlaybookHistory({ actorAdminUserId, playbookId = null, playbookName, action, notes = null }) {
  return prisma.billingPlaybookHistory.create({
    data: {
      actorAdminUserId,
      playbookId,
      playbookName,
      action,
      notes,
    },
  });
}


async function logSupportCaseActivity({ supportCaseId, actorAdminUserId, type, message }) {
  return prisma.supportCaseActivity.create({
    data: {
      supportCaseId,
      actorAdminUserId,
      type,
      message,
    },
  });
}

function getSupportCaseAgeHours(supportCase) {
  const anchor = supportCase.updatedAt || supportCase.createdAt;
  return Math.max(0, Math.floor((Date.now() - new Date(anchor).getTime()) / (60 * 60 * 1000)));
}

function getSupportCaseQueueKey(supportCase, currentAdminId) {
  const isOpen = supportCase.status === 'OPEN';
  const ageHours = getSupportCaseAgeHours(supportCase);
  if (isOpen && ageHours >= 72) return 'overdue_72h';
  if (isOpen && ageHours >= 24) return 'overdue_24h';
  if (isOpen && !supportCase.assignedAdminUserId) return 'unassigned';
  if (isOpen && supportCase.assignedAdminUserId === currentAdminId) return 'my_open';
  if (isOpen) return 'team_open';
  return 'closed';
}

function matchesSupportCaseQueue(supportCase, queueKey, currentAdminId) {
  if (!queueKey) return true;
  return getSupportCaseQueueKey(supportCase, currentAdminId) === queueKey;
}

function buildSupportCaseQueue(supportCases, currentAdminId) {
  const buckets = {
    my_open: { id: 'my_open', label: 'My open cases', items: [] },
    unassigned: { id: 'unassigned', label: 'Unassigned', items: [] },
    overdue_24h: { id: 'overdue_24h', label: 'Over 24 hours', items: [] },
    overdue_72h: { id: 'overdue_72h', label: 'Over 72 hours', items: [] },
    team_open: { id: 'team_open', label: 'Team open cases', items: [] },
  };

  supportCases.forEach((supportCase) => {
    const key = getSupportCaseQueueKey(supportCase, currentAdminId);
    if (buckets[key]) {
      buckets[key].items.push(supportCase);
    }
  });

  Object.values(buckets).forEach((bucket) => {
    bucket.items.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    bucket.count = bucket.items.length;
    bucket.oldestUpdatedAt = bucket.items[0]?.updatedAt || null;
    bucket.preview = bucket.items.slice(0, 4);
  });

  return buckets;
}

async function notifySupportCaseAdmins({ actorAdminUserId, supportCaseId, title, body, href, mode = 'watchers' }) {
  const supportCase = await prisma.supportCase.findUnique({
    where: { id: supportCaseId },
    select: { createdByAdminUserId: true, assignedAdminUserId: true },
  });
  if (!supportCase) return;

  let recipientIds = [];
  if (mode === 'all_admins') {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    recipientIds = admins.map((admin) => admin.id);
  } else {
    recipientIds = [supportCase.createdByAdminUserId, supportCase.assignedAdminUserId].filter(Boolean);
  }

  const uniqueRecipientIds = [...new Set(recipientIds)].filter(Boolean);
  if (uniqueRecipientIds.length === 0) return;

  await prisma.userNotification.createMany({
    data: uniqueRecipientIds.map((userId) => ({
      userId,
      type: 'SUPPORT_CASE',
      title,
      body,
      href,
    })),
  });
}

async function loadAdminData(currentAdmin, filters = parseAdminBillingFilters()) {
  const jobCreatedAtFilter = buildAdminJobCreatedAtFilter(filters.adminJobDateRange);
  const [openReports, openDisputes, users, recentJobsRaw, adminUsers, auditLogs, pendingVerifications, webhookEvents, billingPlaybooksRaw, billingPlaybookHistory, supportCases, savedSupportCaseViews, autoRouteActivities, jobCategoryCounts] = await Promise.all([
    prisma.moderationReport.findMany({
      where: { status: 'OPEN' },
      include: {
        filedBy: true,
        reportedUser: true,
        assignedAdmin: true,
        job: true,
        dispute: { include: { openedBy: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.dispute.findMany({
      where: { status: 'OPEN' },
      include: {
        openedBy: true,
        assignedAdmin: true,
        job: { include: { payment: true, homeowner: true, acceptedBid: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.job.findMany({
      where: jobCreatedAtFilter ? { createdAt: jobCreatedAtFilter } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        homeowner: true,
        acceptedBid: true,
        payment: true,
        review: true,
        dispute: true,
        bids: {
          include: {
            handyman: true,
            messages: {
              include: { sender: true },
              orderBy: { createdAt: 'desc' },
              take: 6,
            },
          },
          orderBy: { updatedAt: 'desc' },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { name: 'asc' },
    }),
    prisma.moderationAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 16,
      include: {
        actorAdmin: true,
        moderationReport: true,
        dispute: true,
      },
    }),
    prisma.handymanProfile.findMany({
      where: {
        OR: [
          { insuranceStatus: 'PENDING' },
          { licenseStatus: 'PENDING' },
        ],
      },
      include: { user: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.paymentWebhookEvent.findMany({
      where: {
        provider: filters.billingProvider || undefined,
        eventType: filters.billingEventType || undefined,
        status: filters.billingStatus || undefined,
        supportStatus: filters.billingSupportStatus || undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: {
        assignedAdmin: true,
      },
    }),
    prisma.billingSupportPlaybook.findMany({
      where: {
        OR: [
          { scope: 'SHARED' },
          { createdByAdminUserId: currentAdmin.id },
        ],
      },
      orderBy: [
        { isFavorite: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        createdByAdmin: true,
        archivedByAdmin: true,
      },
    }),
    prisma.billingPlaybookHistory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 16,
      include: { actorAdmin: true },
    }),
    prisma.supportCase.findMany({
      orderBy: [
        { status: 'asc' },
        { updatedAt: 'desc' },
      ],
      take: 40,
      include: { createdByAdmin: true, assignedAdmin: true },
    }),
    prisma.savedSupportCaseView.findMany({
      where: {
        OR: [
          { userId: currentAdmin.id },
          { scope: 'SHARED' },
        ],
      },
      include: { user: true, autoAssignAdmin: true },
      orderBy: [
        { isDefaultLanding: 'desc' },
        { isPinned: 'desc' },
        { scope: 'desc' },
        { createdAt: 'desc' },
      ],
    }),
    prisma.supportCaseActivity.findMany({
      where: {
        type: 'REASSIGNED',
        message: { startsWith: SUPPORT_CASE_AUTO_ROUTE_MESSAGE_PREFIX },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.job.groupBy({
      where: jobCreatedAtFilter ? { createdAt: jobCreatedAtFilter } : undefined,
      by: ['category'],
      _count: { category: true },
      orderBy: {
        _count: {
          category: 'desc',
        },
      },
      take: 6,
    }),
  ]);

  const { billingPlaybooks, activeBillingPlaybooks, favoriteBillingPlaybooks, personalBillingPlaybooks, sharedBillingPlaybooks, archivedBillingPlaybooks, staleBillingPlaybooks } = buildScopedBillingPlaybooks(billingPlaybooksRaw, currentAdmin.id);
  const usersWithDeletionState = await Promise.all(users.map(async (account) => ({
    ...account,
    deletionState: await getUserDeletionEligibility(account),
  })));

  const checkoutSessionIds = [...new Set(webhookEvents.map((event) => event.checkoutSessionId).filter(Boolean))];
  const checkoutSessionMap = await loadCheckoutSessionsByIds(checkoutSessionIds);
  const billingEvents = webhookEvents.map((event) => {
    const checkoutSession = event.checkoutSessionId ? checkoutSessionMap.get(event.checkoutSessionId) || null : null;
    return decorateBillingEvent(event, checkoutSession);
  }).filter((event) => {
    if (!filters.billingSearch) {
      return true;
    }

    const haystack = [
      event.summary.title,
      event.summary.context,
      event.summary.detail,
      event.provider,
      event.providerEventId,
      event.checkoutSession?.providerSessionId,
    ].filter(Boolean).join(' ').toLowerCase();

    return haystack.includes(filters.billingSearch.toLowerCase());
  }).slice(0, 16);

  const billingQueue = buildBillingQueue(billingEvents);
  const billingGroups = buildBillingGroups(billingEvents, billingPlaybooks);
  const selectedBillingGroup = filters.selectedBillingGroup
    ? billingGroups.find((group) => group.id === filters.selectedBillingGroup) || null
    : null;
  const selectedBillingEventIds = selectedBillingGroup ? selectedBillingGroup.eventIds : [];

  const supportCaseQueue = buildSupportCaseQueue(supportCases, currentAdmin.id);
  const filteredSupportCases = supportCases.filter((supportCase) => {
    if (filters.supportCaseSearch) {
      const haystack = [
        supportCase.title,
        supportCase.sourcePlaybookName,
        supportCase.summaryText,
        supportCase.notes,
        supportCase.createdByAdmin?.name,
        supportCase.assignedAdmin?.name,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(filters.supportCaseSearch.toLowerCase())) {
        return false;
      }
    }

    if (filters.supportCaseStatus && supportCase.status !== filters.supportCaseStatus) {
      return false;
    }

    if (filters.supportCaseOwner) {
      if (filters.supportCaseOwner === 'unassigned') {
        if (supportCase.assignedAdminUserId) return false;
      } else if (supportCase.assignedAdminUserId !== filters.supportCaseOwner) {
        return false;
      }
    }

    if (!matchesSupportCaseQueue(supportCase, filters.supportCaseQueue, currentAdmin.id)) {
      return false;
    }

    return true;
  });

  const supportCaseRoutingInsights = buildSupportCaseRoutingInsights({
    supportCases,
    savedSupportCaseViews,
    autoRouteActivities,
    currentAdminId: currentAdmin.id,
  });

  const supportCaseMetrics = {
    total: supportCases.length,
    open: supportCases.filter((supportCase) => supportCase.status === 'OPEN').length,
    closed: supportCases.filter((supportCase) => supportCase.status === 'CLOSED').length,
    unassigned: supportCaseQueue.unassigned.count,
    myOpen: supportCaseQueue.my_open.count,
    overdue24: supportCaseQueue.overdue_24h.count,
    overdue72: supportCaseQueue.overdue_72h.count,
    autoRoutedRecently: supportCaseRoutingInsights.presetAnalytics.reduce((sum, preset) => sum + preset.recentRoutedCount, 0),
    routingExceptions: supportCaseRoutingInsights.routingExceptions.length,
  };

  const enrichedAdminJobs = recentJobsRaw.map(enrichAdminJob);
  const filteredAdminJobs = enrichedAdminJobs
    .filter((job) => matchesAdminJobView(job, filters.adminJobView)
      && matchesAdminJobCategory(job, filters.adminJobCategory)
      && matchesAdminJobStatus(job, filters.adminJobStatus))
    .slice(0, 16);
  const categoryChartColors = ['#3ab9c2', '#0e7c86', '#f0a552', '#8ed081', '#f26d85', '#8b7cf6'];
  const totalCategoryJobs = jobCategoryCounts.reduce((sum, entry) => sum + entry._count.category, 0);
  let categoryOffset = 0;
  const jobCategoryChart = jobCategoryCounts.map((entry, index) => {
    const count = entry._count.category;
    const start = totalCategoryJobs > 0 ? Math.round((categoryOffset / totalCategoryJobs) * 360) : 0;
    categoryOffset += count;
    const end = totalCategoryJobs > 0 ? Math.round((categoryOffset / totalCategoryJobs) * 360) : 0;
    return {
      category: entry.category || 'Uncategorized',
      count,
      color: categoryChartColors[index % categoryChartColors.length],
      percent: totalCategoryJobs > 0 ? Math.round((count / totalCategoryJobs) * 100) : 0,
      slice: `${categoryChartColors[index % categoryChartColors.length]} ${start}deg ${end}deg`,
      href: buildAdminJobViewHref(filters, filters.adminJobView, entry.category || ''),
      active: String(filters.adminJobCategory || '').toLowerCase() === String(entry.category || '').toLowerCase(),
    };
  });
  const jobCategoryChartStyle = jobCategoryChart.length > 0
    ? `background: conic-gradient(${jobCategoryChart.map((entry) => entry.slice).join(', ')});`
    : '';
  const adminJobStats = [
    { key: 'all', label: 'All jobs', count: enrichedAdminJobs.length },
    { key: 'funded', label: 'Funded', count: enrichedAdminJobs.filter((job) => job.isFunded).length },
    { key: 'needsAction', label: 'Needs action', count: enrichedAdminJobs.filter((job) => Boolean(job.needsActionReason)).length },
    { key: 'unread', label: 'Unread', count: enrichedAdminJobs.filter((job) => job.isUnread).length },
    { key: 'pending', label: 'Pending', count: enrichedAdminJobs.filter((job) => job.isPending).length },
    { key: 'completed', label: 'Completed', count: enrichedAdminJobs.filter((job) => job.isCompleted).length },
  ].map((entry) => ({
    ...entry,
    href: buildAdminJobViewHref(filters, entry.key),
    active: filters.adminJobView === entry.key,
  }));
  const adminJobDateRangeOptions = [
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: 'all', label: 'All time' },
  ].map((entry) => ({
    ...entry,
    href: buildAdminJobViewHref(filters, filters.adminJobView, filters.adminJobCategory, entry.key, filters.adminJobStatus),
    active: filters.adminJobDateRange === entry.key,
  }));
  const statusChartColors = {
    OPEN: '#3ab9c2',
    IN_REVIEW: '#f0a552',
    AWARDED: '#8b7cf6',
    COMPLETED: '#8ed081',
  };
  const adminJobStatusChart = ['OPEN', 'IN_REVIEW', 'AWARDED', 'COMPLETED'].map((status) => {
    const count = enrichedAdminJobs.filter((job) => job.status === status).length;
    const percent = enrichedAdminJobs.length > 0 ? Math.round((count / enrichedAdminJobs.length) * 100) : 0;
    return {
      key: status,
      label: status.replaceAll('_', ' '),
      count,
      percent,
      color: statusChartColors[status],
      href: buildAdminJobViewHref(filters, filters.adminJobView, filters.adminJobCategory, filters.adminJobDateRange, status),
      active: filters.adminJobStatus === status,
    };
  });
  const adminJobFilterSummary = [
    filters.adminJobDateRange === '7d'
      ? { label: 'Last 7 days', tone: 'neutral' }
      : filters.adminJobDateRange === '30d'
        ? { label: 'Last 30 days', tone: 'neutral' }
        : null,
    filters.adminJobCategory
      ? { label: filters.adminJobCategory, tone: 'review' }
      : null,
    filters.adminJobStatus
      ? { label: filters.adminJobStatus.replaceAll('_', ' '), tone: 'success' }
      : null,
    filters.adminJobView !== 'all'
      ? { label: adminJobStats.find((entry) => entry.key === filters.adminJobView)?.label || filters.adminJobView, tone: 'warning' }
      : null,
  ].filter(Boolean);
  const clearAdminJobFiltersHref = buildAdminJobViewHref(filters, 'all', '', 'all', '');

  return {
    roleData: {
      openReports,
      openDisputes,
      users: usersWithDeletionState,
      recentJobs: filteredAdminJobs,
      jobCategoryChart,
      jobCategoryChartStyle,
      totalCategoryJobs,
      adminJobStats,
      adminJobDateRangeOptions,
      adminJobStatusChart,
      adminJobFilterSummary,
      clearAdminJobFiltersHref,
      adminUsers,
      auditLogs,
      pendingVerifications,
      billingEvents,
      billingQueue,
      billingGroups,
      billingPlaybooks,
      activeBillingPlaybooks,
      favoriteBillingPlaybooks,
      personalBillingPlaybooks,
      sharedBillingPlaybooks,
      archivedBillingPlaybooks,
      staleBillingPlaybooks,
      billingPlaybookHistory,
      supportCases: filteredSupportCases,
      supportCaseQueue,
      supportCaseMetrics,
      supportCaseRoutingInsights,
      savedSupportCaseViews,
      selectedSupportCaseViewId: filters.supportCaseViewId || '',
      selectedBillingGroup,
      selectedBillingEventIds,
      billingFilters: filters,
      adminJobView: filters.adminJobView,
      adminJobCategory: filters.adminJobCategory,
      adminJobDateRange: filters.adminJobDateRange,
      adminJobStatus: filters.adminJobStatus,
      suspendedCount: users.filter((user) => user.isSuspended).length,
    },
  };
}

async function loadDashboardData(user, filters = parseHandymanFilters()) {
  if (user.role === 'HOMEOWNER') {
    const jobs = await prisma.job.findMany({
      where: { homeownerId: user.id },
      include: {
        photos: { orderBy: { sortOrder: 'asc' } },
        bids: {
          include: {
            handyman: {
              include: { handymanProfile: true },
            },
            messages: {
              include: { sender: true },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: [{ status: 'asc' }, { amount: 'asc' }, { createdAt: 'asc' }],
        },
        review: true,
        payment: true,
        dispute: {
          include: { openedBy: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      roleData: {
        jobs,
        jobCount: jobs.length,
        activeCount: jobs.filter((job) => job.status !== 'COMPLETED').length,
      },
    };
  }

  const jobWhere = {
    status: { in: ['OPEN', 'IN_REVIEW'] },
    NOT: { homeownerId: user.id },
  };

  if (filters.category) {
    jobWhere.category = filters.category;
  }
  if (filters.minBudget || filters.maxBudget) {
    jobWhere.budget = {};
    if (filters.minBudget) jobWhere.budget.gte = filters.minBudget;
    if (filters.maxBudget) jobWhere.budget.lte = filters.maxBudget;
  }
  if (filters.search) {
    jobWhere.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
      { location: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  if (filters.photosOnly) {
    jobWhere.photos = { some: {} };
  }

  const [openJobsRaw, myBids, profile, savedSearches] = await Promise.all([
    prisma.job.findMany({
      where: jobWhere,
      include: {
        photos: { orderBy: { sortOrder: 'asc' } },
        bids: {
          where: { handymanId: user.id },
          take: 1,
        },
      },
      orderBy: getOpenJobsOrderBy(filters.sort),
    }),
    prisma.bid.findMany({
      where: { handymanId: user.id },
      include: {
        job: {
          include: {
            photos: { orderBy: { sortOrder: 'asc' } },
            homeowner: true,
            review: true,
            payment: true,
            dispute: {
              include: { openedBy: true },
            },
          },
        },
        messages: {
          include: { sender: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.handymanProfile.findUnique({ where: { userId: user.id } }),
    prisma.savedSearch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const leadTransactions = profile
    ? await prisma.leadCreditTransaction.findMany({
        where: { handymanProfileId: profile.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
      })
    : [];

  const openJobsWithLocation = openJobsRaw.map((job) => ({
    ...job,
    locationMatch: getLocationMatch(job, user, profile?.serviceRadius || 15),
  }));

  const filteredOpenJobs = filters.nearMeOnly
    ? openJobsWithLocation.filter((job) => job.locationMatch.nearMeEligible)
    : openJobsWithLocation;

  const enrichedMyBids = myBids.map((bid) => enrichHandymanBid(bid, user.id));
  const filteredMyBids = filterHandymanBids(enrichedMyBids, filters.myJobsView);
  const handymanBidSections = buildHandymanBidSections(filteredMyBids);
  const handymanJobSummary = buildHandymanJobSummary(enrichedMyBids);
  const handymanJobsViewOptions = [
    { key: 'all', label: 'All jobs', count: enrichedMyBids.length },
    { key: 'activeFunded', label: 'Funded', count: handymanJobSummary.activeFunded },
    { key: 'needsAction', label: 'Needs action', count: enrichedMyBids.filter((bid) => Boolean(bid.actionBadge)).length },
    { key: 'unread', label: 'Unread', count: enrichedMyBids.filter((bid) => bid.hasUnreadMessages).length },
    { key: 'pending', label: 'Pending', count: handymanJobSummary.pending },
    { key: 'completed', label: 'Completed', count: handymanJobSummary.completed },
  ].map((option) => ({
    ...option,
    href: buildHandymanJobsViewHref(filters, option.key),
    active: filters.myJobsView === option.key,
  }));

  return {
    roleData: {
      openJobs: sortJobsWithLocationFit(filteredOpenJobs, filters.sort),
      myBids: enrichedMyBids,
      handymanBidSections,
      handymanJobSummary,
      handymanJobsViewOptions,
      profile,
      billing: {
        planSummary: getPlanSummary(profile),
        transactions: leadTransactions,
      },
      savedSearches: savedSearches.map((savedSearch) => ({
        ...savedSearch,
        href: buildSavedSearchQuery(savedSearch),
      })),
      awardedCount: myBids.filter((bid) => bid.status === 'ACCEPTED').length,
      filters,
    },
  };
}

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

  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.userEmail = user.email;
  req.session.authVersion = user.sessionVersion;
  req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  return res.redirect('/dashboard');
}));

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

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
    setFlash(req, 'Checkout was cancelled. No changes were applied.');
    return res.redirect('/dashboard');
  }

  if (!session || session.userId !== user.id) {
    setFlash(req, 'Checkout session not found.');
    return res.redirect('/dashboard');
  }

  if (session.status === 'COMPLETED') {
    setFlash(req, 'Checkout completed successfully.');
  } else {
    setFlash(req, 'Checkout is still processing. Refresh in a moment if the update has not appeared yet.');
  }

  return res.redirect('/dashboard');
}));

app.get('/admin', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.isSuspended || user.role !== 'ADMIN') {
    req.session.userId = null;
    req.session.role = null;
    return res.redirect('/login');
  }

  const filters = parseAdminBillingFilters(req.query);
  if (!filters.hasFilters) {
    const defaultView = await prisma.savedSupportCaseView.findFirst({
      where: {
        isDefaultLanding: true,
        OR: [
          { userId: user.id },
          { scope: 'SHARED' },
        ],
      },
      orderBy: [
        { userId: 'desc' },
        { scope: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
    if (defaultView) {
      return res.redirect(buildSupportCaseViewQuery(defaultView));
    }
  }

  const filtersWithDefault = filters;
  const data = await loadAdminData(user, filtersWithDefault);
  return res.render('admin', {
    ...baseViewModel(req, user),
    ...data,
  });
}));

app.get('/admin/jobs/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.isSuspended || user.role !== 'ADMIN') {
    req.session.userId = null;
    req.session.role = null;
    return res.redirect('/login');
  }

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      homeowner: true,
      photos: { orderBy: { sortOrder: 'asc' } },
      acceptedBid: {
        include: {
          handyman: {
            include: { handymanProfile: true },
          },
        },
      },
      bids: {
        include: {
          handyman: {
            include: { handymanProfile: true },
          },
          messages: {
            include: { sender: true },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: [
          { status: 'asc' },
          { amount: 'asc' },
          { createdAt: 'asc' },
        ],
      },
      payment: true,
      dispute: {
        include: {
          openedBy: true,
          assignedAdmin: true,
        },
      },
      review: true,
      reports: {
        include: {
          filedBy: true,
          assignedAdmin: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!job) {
    setFlash(req, 'Job not found.');
    return res.redirect('/admin');
  }

  const adminJob = enrichAdminJob(job);
  const jobTimeline = buildAdminJobTimeline(job);

  return res.render('admin-job', {
    ...baseViewModel(req, user),
    adminJob,
    jobTimeline,
  });
}));

app.get('/admin/users/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.isSuspended || user.role !== 'ADMIN') {
    req.session.userId = null;
    req.session.role = null;
    return res.redirect('/login');
  }

  const account = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      handymanProfile: true,
      homeownerJobs: {
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          payment: true,
          dispute: true,
          review: true,
          photos: {
            orderBy: { sortOrder: 'asc' },
            take: 1,
          },
          bids: {
            include: {
              handyman: {
                include: {
                  handymanProfile: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
      bids: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          job: {
            include: {
              homeowner: true,
              payment: true,
              dispute: true,
              review: true,
            },
          },
          messages: {
            include: { sender: true },
            orderBy: { createdAt: 'desc' },
            take: 3,
          },
        },
      },
      reviewsReceived: {
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          reviewer: true,
          job: true,
        },
      },
      reportsFiled: {
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          reportedUser: true,
          job: true,
          dispute: true,
          assignedAdmin: true,
        },
      },
      reportsAgainst: {
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          filedBy: true,
          job: true,
          dispute: true,
          assignedAdmin: true,
        },
      },
      disputesOpened: {
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: {
          job: {
            include: {
              payment: true,
              homeowner: true,
              acceptedBid: {
                include: {
                  handyman: true,
                },
              },
            },
          },
          assignedAdmin: true,
        },
      },
      notifications: {
        orderBy: { createdAt: 'desc' },
        take: 8,
      },
    },
  });

  if (!account) {
    setFlash(req, 'User not found.');
    return res.redirect('/admin');
  }

  const deletionState = await getUserDeletionEligibility(account);

  const homeownerJobs = account.homeownerJobs.map((job) => {
    const acceptedBid = job.bids.find((bid) => bid.id === job.acceptedBidId) || null;
    return {
      ...job,
      acceptedBid,
    };
  });

  const homeownerMetrics = {
    totalJobs: homeownerJobs.length,
    fundedJobs: homeownerJobs.filter((job) => Boolean(job.payment && ['FUNDED', 'RELEASED', 'DISPUTED'].includes(job.payment.status))).length,
    completedJobs: homeownerJobs.filter((job) => job.status === 'COMPLETED').length,
    openJobs: homeownerJobs.filter((job) => ['OPEN', 'IN_REVIEW', 'AWARDED'].includes(job.status)).length,
  };

  const handymanMetrics = {
    totalBids: account.bids.length,
    acceptedBids: account.bids.filter((bid) => bid.status === 'ACCEPTED').length,
    pendingBids: account.bids.filter((bid) => ['PENDING', 'SHORTLISTED'].includes(bid.status)).length,
    completedJobs: account.bids.filter((bid) => bid.job?.status === 'COMPLETED').length,
  };

  const recentActivity = [
    ...account.notifications.map((notification) => ({
      id: `notification-${notification.id}`,
      label: notification.title,
      detail: notification.body,
      tone: notification.isRead ? 'muted' : 'review',
      at: notification.createdAt,
    })),
    ...homeownerJobs.map((job) => ({
      id: `job-${job.id}`,
      label: `Job posted: ${job.title}`,
      detail: `${job.category} in ${job.location} - ${job.status.replaceAll('_', ' ')}`,
      tone: getStatusTone(job.status),
      at: job.updatedAt,
    })),
    ...account.bids.map((bid) => ({
      id: `bid-${bid.id}`,
      label: `Bid on ${bid.job?.title || 'job'}`,
      detail: `${formatCurrency(bid.amount)} - ${bid.status.replaceAll('_', ' ')}`,
      tone: getStatusTone(bid.status),
      at: bid.updatedAt,
    })),
    ...account.reportsAgainst.map((report) => ({
      id: `report-${report.id}`,
      label: `Reported for ${report.reason}`,
      detail: `Status ${report.status.replaceAll('_', ' ')}${report.job ? ` on ${report.job.title}` : ''}`,
      tone: report.status === 'OPEN' ? 'review' : 'muted',
      at: report.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 12);

  return res.render('admin-user', {
    ...baseViewModel(req, user),
    adminAccount: account,
    deletionState,
    homeownerJobs,
    homeownerMetrics,
    handymanMetrics,
    recentActivity,
  });
}));

app.get('/admin/billing-events/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.isSuspended || user.role !== 'ADMIN') {
    req.session.userId = null;
    req.session.role = null;
    return res.redirect('/login');
  }

  const event = await prisma.paymentWebhookEvent.findUnique({
    where: { id: req.params.id },
    include: { assignedAdmin: true },
  });
  if (!event) {
    setFlash(req, 'Billing event not found.');
    return res.redirect('/admin');
  }

  const checkoutSessionMap = await loadCheckoutSessionsByIds(event.checkoutSessionId ? [event.checkoutSessionId] : []);
  const checkoutSession = event.checkoutSessionId ? checkoutSessionMap.get(event.checkoutSessionId) || null : null;
  const billingEvent = decorateBillingEvent(event, checkoutSession);

  const adminUsers = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    orderBy: { name: 'asc' },
  });

  return res.render('admin-billing-event', {
    ...baseViewModel(req, user),
    billingEvent,
    adminUsers,
  });
}));

app.get('/admin/billing-playbooks/:id/history', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.isSuspended || user.role !== 'ADMIN') {
    req.session.userId = null;
    req.session.role = null;
    return res.redirect('/login');
  }

  const filters = normalizeBillingPlaybookHistoryFilters(req.query);
  const pageSize = 2;
  const historyWhere = {
    playbookId: req.params.id,
    action: filters.action || undefined,
    actorAdminUserId: filters.actorAdminUserId || undefined,
    createdAt: buildBillingPlaybookHistoryCreatedAtFilter(filters.dateRange),
  };

  const [playbook, playbookHistory, filteredHistoryCount, allPlaybookHistory, adminUsers] = await Promise.all([
    prisma.billingSupportPlaybook.findUnique({
      where: { id: req.params.id },
      include: {
        createdByAdmin: true,
        archivedByAdmin: true,
      },
    }),
    prisma.billingPlaybookHistory.findMany({
      where: historyWhere,
      include: { actorAdmin: true },
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.billingPlaybookHistory.count({ where: historyWhere }),
    prisma.billingPlaybookHistory.findMany({
      where: { playbookId: req.params.id },
      include: { actorAdmin: true },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { name: 'asc' },
    }),
  ]);

  if (!playbook && allPlaybookHistory.length === 0) {
    setFlash(req, 'Billing playbook history not found.');
    return res.redirect('/admin');
  }

  const latestHistory = allPlaybookHistory[0] || null;
  const pagination = {
    page: filters.page,
    pageSize,
    totalCount: filteredHistoryCount,
    totalPages: Math.max(1, Math.ceil(filteredHistoryCount / pageSize)),
    hasPreviousPage: filters.page > 1,
    hasNextPage: filters.page * pageSize < filteredHistoryCount,
  };
  const actorAdminName = filters.actorAdminUserId ? (adminUsers.find((adminUser) => adminUser.id === filters.actorAdminUserId)?.name || '') : '';
  const historyQueryString = 'action=' + encodeURIComponent(filters.action || '') + '&actorAdminUserId=' + encodeURIComponent(filters.actorAdminUserId || '') + '&dateRange=' + encodeURIComponent(filters.dateRange || 'ALL') + '&page=' + encodeURIComponent(String(filters.page));
  const playbookSummaryText = buildBillingPlaybookSummary({
    playbook,
    latestHistory,
    historyEntries: playbookHistory,
    filters,
    pagination,
    actorAdminName,
  });

  return res.render('admin-billing-playbook', {
    ...baseViewModel(req, user),
    playbook,
    playbookHistory,
    latestHistory,
    adminUsers,
    playbookHistoryFilters: filters,
    playbookHistoryPagination: pagination,
    playbookHistoryQueryString: historyQueryString,
    playbookSummaryText,
  });
}));

app.get('/admin/billing-playbooks/:id/history/summary', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.isSuspended || user.role !== 'ADMIN') {
    req.session.userId = null;
    req.session.role = null;
    return res.redirect('/login');
  }

  const filters = normalizeBillingPlaybookHistoryFilters(req.query);
  const historyWhere = {
    playbookId: req.params.id,
    action: filters.action || undefined,
    actorAdminUserId: filters.actorAdminUserId || undefined,
    createdAt: buildBillingPlaybookHistoryCreatedAtFilter(filters.dateRange),
  };

  const [playbook, playbookHistory, allPlaybookHistory, adminUsers] = await Promise.all([
    prisma.billingSupportPlaybook.findUnique({
      where: { id: req.params.id },
      include: {
        createdByAdmin: true,
        archivedByAdmin: true,
      },
    }),
    prisma.billingPlaybookHistory.findMany({
      where: historyWhere,
      include: { actorAdmin: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.billingPlaybookHistory.findMany({
      where: { playbookId: req.params.id },
      include: { actorAdmin: true },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { name: 'asc' },
    }),
  ]);

  if (!playbook && allPlaybookHistory.length === 0) {
    setFlash(req, 'Billing playbook history not found.');
    return res.redirect('/admin');
  }

  const latestHistory = allPlaybookHistory[0] || null;
  const actorAdminName = filters.actorAdminUserId ? (adminUsers.find((adminUser) => adminUser.id === filters.actorAdminUserId)?.name || '') : '';
  const summaryText = buildBillingPlaybookSummary({
    playbook,
    latestHistory,
    historyEntries: playbookHistory,
    filters,
    pagination: null,
    actorAdminName,
  });
  const exportFilename = buildBillingPlaybookExportFilename({ playbook, latestHistory, extension: 'txt' });

  res.type('text/plain');
  res.attachment(exportFilename);
  return res.send(summaryText + '\n');
}));

app.get('/admin/billing-playbooks/:id/history/summary.json', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.isSuspended || user.role !== 'ADMIN') {
    req.session.userId = null;
    req.session.role = null;
    return res.redirect('/login');
  }

  const filters = normalizeBillingPlaybookHistoryFilters(req.query);
  const historyWhere = {
    playbookId: req.params.id,
    action: filters.action || undefined,
    actorAdminUserId: filters.actorAdminUserId || undefined,
    createdAt: buildBillingPlaybookHistoryCreatedAtFilter(filters.dateRange),
  };

  const [playbook, playbookHistory, filteredHistoryCount, allPlaybookHistory, adminUsers] = await Promise.all([
    prisma.billingSupportPlaybook.findUnique({
      where: { id: req.params.id },
      include: {
        createdByAdmin: true,
        archivedByAdmin: true,
      },
    }),
    prisma.billingPlaybookHistory.findMany({
      where: historyWhere,
      include: { actorAdmin: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.billingPlaybookHistory.count({ where: historyWhere }),
    prisma.billingPlaybookHistory.findMany({
      where: { playbookId: req.params.id },
      include: { actorAdmin: true },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { name: 'asc' },
    }),
  ]);

  if (!playbook && allPlaybookHistory.length === 0) {
    setFlash(req, 'Billing playbook history not found.');
    return res.redirect('/admin');
  }

  const latestHistory = allPlaybookHistory[0] || null;
  const actorAdminName = filters.actorAdminUserId ? (adminUsers.find((adminUser) => adminUser.id === filters.actorAdminUserId)?.name || '') : '';
  const payload = buildBillingPlaybookSummaryPayload({
    playbook,
    latestHistory,
    historyEntries: playbookHistory,
    filters,
    pagination: {
      page: filters.page,
      pageSize: 100,
      totalCount: filteredHistoryCount,
      totalPages: Math.max(1, Math.ceil(filteredHistoryCount / 100)),
    },
    actorAdminName,
  });
  const exportFilename = buildBillingPlaybookExportFilename({ playbook, latestHistory, extension: 'json' });

  res.type('application/json');
  res.attachment(exportFilename);
  return res.send(JSON.stringify(payload, null, 2) + '\n');
}));

app.post('/admin/billing-playbooks/:id/history/cases', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.isSuspended || user.role !== 'ADMIN') {
    req.session.userId = null;
    req.session.role = null;
    return res.redirect('/login');
  }

  const filters = normalizeBillingPlaybookHistoryFilters(req.body);
  const historyWhere = {
    playbookId: req.params.id,
    action: filters.action || undefined,
    actorAdminUserId: filters.actorAdminUserId || undefined,
    createdAt: buildBillingPlaybookHistoryCreatedAtFilter(filters.dateRange),
  };

  const [playbook, playbookHistory, allPlaybookHistory, adminUsers] = await Promise.all([
    prisma.billingSupportPlaybook.findUnique({
      where: { id: req.params.id },
      include: {
        createdByAdmin: true,
        archivedByAdmin: true,
      },
    }),
    prisma.billingPlaybookHistory.findMany({
      where: historyWhere,
      include: { actorAdmin: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.billingPlaybookHistory.findMany({
      where: { playbookId: req.params.id },
      include: { actorAdmin: true },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { name: 'asc' },
    }),
  ]);

  if (!playbook && allPlaybookHistory.length === 0) {
    setFlash(req, 'Billing playbook history not found.');
    return res.redirect('/admin');
  }

  const latestHistory = allPlaybookHistory[0] || null;
  const actorAdminName = filters.actorAdminUserId ? (adminUsers.find((adminUser) => adminUser.id === filters.actorAdminUserId)?.name || '') : '';
  const summaryText = buildBillingPlaybookSummary({
    playbook,
    latestHistory,
    historyEntries: playbookHistory,
    filters,
    pagination: null,
    actorAdminName,
  });
  const summaryJson = buildBillingPlaybookSummaryPayload({
    playbook,
    latestHistory,
    historyEntries: playbookHistory,
    filters,
    pagination: null,
    actorAdminName,
  });
  const playbookName = playbook ? playbook.name : (latestHistory?.playbookName || 'Unknown playbook');
  const title = String(req.body.caseTitle || '').trim() || (playbookName + ' handoff case');

  const createdSupportCase = await prisma.supportCase.create({
    data: {
      title,
      summaryText,
      summaryJson: JSON.stringify(summaryJson, null, 2),
      sourcePlaybookId: playbook?.id || latestHistory?.playbookId || null,
      sourcePlaybookName: playbookName,
      createdByAdminUserId: req.session.userId,
    },
  });

  await logSupportCaseActivity({
    supportCaseId: createdSupportCase.id,
    actorAdminUserId: req.session.userId,
    type: 'CREATED',
    message: 'Created support case from playbook summary.',
  });

  await notifySupportCaseAdmins({
    actorAdminUserId: req.session.userId,
    supportCaseId: createdSupportCase.id,
    title: 'New support case created',
    body: createdSupportCase.title + ' is ready for admin review.',
    href: '/admin/support-cases/' + createdSupportCase.id,
    mode: 'all_admins',
  });

  await applySupportCaseAutoRouting(createdSupportCase.id, req.session.userId);

  setFlash(req, 'Support case created from playbook summary.');
  const historyQueryString = 'action=' + encodeURIComponent(filters.action || '') + '&actorAdminUserId=' + encodeURIComponent(filters.actorAdminUserId || '') + '&dateRange=' + encodeURIComponent(filters.dateRange || 'ALL') + '&page=1';
  return res.redirect('/admin/billing-playbooks/' + req.params.id + '/history?' + historyQueryString);
}));

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

app.post('/admin/billing-events/:id/support', requireAuth, requireAdmin, wrap(async (req, res) => {
  const notes = String(req.body.supportNotes || '').trim();
  const supportStatus = String(req.body.supportStatus || '').trim();
  const assignedAdminUserId = String(req.body.assignedAdminUserId || '').trim() || null;
  const returnTo = String(req.body.returnTo || '').trim();
  const nextPath = returnTo.startsWith('/admin') ? returnTo : '/admin/billing-events/' + req.params.id;
  const event = await prisma.paymentWebhookEvent.findUnique({ where: { id: req.params.id } });
  if (!event) {
    setFlash(req, 'Billing event not found.');
    return res.redirect('/admin');
  }

  if (!['NEW', 'NEEDS_FOLLOW_UP', 'WAITING_ON_PROVIDER', 'RESOLVED'].includes(supportStatus)) {
    setFlash(req, 'Choose a valid billing support status.');
    return res.redirect(nextPath);
  }

  if (assignedAdminUserId) {
    const adminUser = await prisma.user.findUnique({ where: { id: assignedAdminUserId } });
    if (!adminUser || adminUser.role !== 'ADMIN') {
      setFlash(req, 'Choose a valid admin owner.');
      return res.redirect(nextPath);
    }
  }

  await prisma.paymentWebhookEvent.update({
    where: { id: event.id },
    data: {
      supportNotes: notes || null,
      supportNotesUpdatedAt: notes ? new Date() : null,
      supportStatus,
      assignedAdminUserId,
    },
  });

  setFlash(req, 'Billing support details saved.');
  return res.redirect(nextPath);
}));

app.post('/admin/billing-playbooks', requireAuth, requireAdmin, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const provider = String(req.body.provider || '').trim() || null;
  const eventType = String(req.body.eventType || '').trim() || null;
  const targetType = String(req.body.targetType || '').trim() || null;
  const supportStatus = String(req.body.supportStatus || '').trim();
  const scope = String(req.body.scope || 'PERSONAL').trim();
  const status = String(req.body.status || 'ACTIVE').trim();
  const isFavorite = String(req.body.isFavorite || '') === '1';
  const assignToCreator = String(req.body.assignToCreator || '') === '1';
  const cleanupReason = String(req.body.cleanupReason || '').trim() || null;

  if (!name || !supportStatus) {
    setFlash(req, 'Playbook name and support status are required.');
    return res.redirect('/admin');
  }

  if (!['NEW', 'NEEDS_FOLLOW_UP', 'WAITING_ON_PROVIDER', 'RESOLVED'].includes(supportStatus)) {
    setFlash(req, 'Choose a valid playbook support status.');
    return res.redirect('/admin');
  }

  if (!['PERSONAL', 'SHARED'].includes(scope)) {
    setFlash(req, 'Choose a valid playbook scope.');
    return res.redirect('/admin');
  }

  if (!['ACTIVE', 'ARCHIVED'].includes(status)) {
    setFlash(req, 'Choose a valid playbook status.');
    return res.redirect('/admin');
  }

  const createdPlaybook = await prisma.billingSupportPlaybook.create({
    data: {
      createdByAdminUserId: req.session.userId,
      name,
      provider,
      eventType,
      targetType,
      supportStatus,
      scope,
      status,
      isFavorite,
      archivedAt: status === 'ARCHIVED' ? new Date() : null,
      archivedByAdminUserId: status === 'ARCHIVED' ? req.session.userId : null,
      cleanupReason,
      assignToCreator,
    },
  });

  await logBillingPlaybookHistory({
    actorAdminUserId: req.session.userId,
    playbookId: createdPlaybook.id,
    playbookName: createdPlaybook.name,
    action: 'CREATED',
    notes: status === 'ARCHIVED' ? (cleanupReason || 'Created directly in archived state.') : 'Created billing playbook.',
  });

  setFlash(req, 'Billing playbook created.');
  return res.redirect('/admin');
}));

app.post('/admin/billing-playbooks/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const playbook = await prisma.billingSupportPlaybook.findUnique({ where: { id: req.params.id } });
  if (!playbook) {
    setFlash(req, 'Billing playbook not found.');
    return res.redirect('/admin');
  }

  if (playbook.scope === 'PERSONAL' && playbook.createdByAdminUserId !== req.session.userId) {
    setFlash(req, 'Only the creator can edit a personal billing playbook.');
    return res.redirect('/admin');
  }

  const name = String(req.body.name || '').trim();
  const provider = String(req.body.provider || '').trim() || null;
  const eventType = String(req.body.eventType || '').trim() || null;
  const targetType = String(req.body.targetType || '').trim() || null;
  const supportStatus = String(req.body.supportStatus || '').trim();
  const scope = String(req.body.scope || 'PERSONAL').trim();
  const status = String(req.body.status || 'ACTIVE').trim();
  const isFavorite = String(req.body.isFavorite || '') === '1';
  const assignToCreator = String(req.body.assignToCreator || '') === '1';
  const cleanupReason = String(req.body.cleanupReason || '').trim() || null;

  if (!name || !supportStatus) {
    setFlash(req, 'Playbook name and support status are required.');
    return res.redirect('/admin');
  }

  if (!['NEW', 'NEEDS_FOLLOW_UP', 'WAITING_ON_PROVIDER', 'RESOLVED'].includes(supportStatus)) {
    setFlash(req, 'Choose a valid playbook support status.');
    return res.redirect('/admin');
  }

  if (!['PERSONAL', 'SHARED'].includes(scope)) {
    setFlash(req, 'Choose a valid playbook scope.');
    return res.redirect('/admin');
  }

  if (!['ACTIVE', 'ARCHIVED'].includes(status)) {
    setFlash(req, 'Choose a valid playbook status.');
    return res.redirect('/admin');
  }

  const updatedPlaybook = await prisma.billingSupportPlaybook.update({
    where: { id: playbook.id },
    data: {
      name,
      provider,
      eventType,
      targetType,
      supportStatus,
      scope,
      status,
      isFavorite,
      archivedAt: status === 'ARCHIVED' ? (playbook.archivedAt || new Date()) : null,
      archivedByAdminUserId: status === 'ARCHIVED' ? (playbook.archivedByAdminUserId || req.session.userId) : null,
      cleanupReason,
      assignToCreator,
    },
  });

  const historyEntries = [{
    actorAdminUserId: req.session.userId,
    playbookId: updatedPlaybook.id,
    playbookName: updatedPlaybook.name,
    action: 'UPDATED',
    notes: 'Updated billing playbook settings.',
  }];

  if (playbook.status !== updatedPlaybook.status) {
    historyEntries.push({
      actorAdminUserId: req.session.userId,
      playbookId: updatedPlaybook.id,
      playbookName: updatedPlaybook.name,
      action: updatedPlaybook.status === 'ARCHIVED' ? 'ARCHIVED' : 'RESTORED',
      notes: updatedPlaybook.status === 'ARCHIVED'
        ? (cleanupReason || 'Archived from playbook editor.')
        : 'Restored from playbook editor.',
    });
  }

  await Promise.all(historyEntries.map((entry) => logBillingPlaybookHistory(entry)));

  setFlash(req, 'Billing playbook updated.');
  return res.redirect('/admin');
}));


app.post('/admin/billing-playbooks/actions/bulk-status', requireAuth, requireAdmin, wrap(async (req, res) => {
  const playbookIdsRaw = req.body.playbookIds;
  const playbookIds = Array.isArray(playbookIdsRaw)
    ? playbookIdsRaw.flatMap((value) => String(value || '').split(',')).map((value) => value.trim()).filter(Boolean)
    : String(playbookIdsRaw || '').split(',').map((value) => value.trim()).filter(Boolean);
  const action = String(req.body.action || '').trim().toUpperCase();
  const cleanupReason = String(req.body.cleanupReason || '').trim() || null;

  if (playbookIds.length === 0) {
    setFlash(req, 'Select at least one billing playbook.');
    return res.redirect('/admin');
  }

  if (!['ARCHIVE', 'RESTORE', 'DELETE'].includes(action)) {
    setFlash(req, 'Choose a valid billing playbook bulk action.');
    return res.redirect('/admin');
  }

  const playbooks = await prisma.billingSupportPlaybook.findMany({
    where: { id: { in: playbookIds } },
  });
  const allowedPlaybooks = playbooks.filter((playbook) => playbook.scope === 'SHARED' || playbook.createdByAdminUserId === req.session.userId);

  if (allowedPlaybooks.length === 0) {
    setFlash(req, 'No eligible billing playbooks were selected.');
    return res.redirect('/admin');
  }

  const allowedIds = allowedPlaybooks.map((playbook) => playbook.id);
  if (action === 'ARCHIVE') {
    await prisma.billingSupportPlaybook.updateMany({
      where: { id: { in: allowedIds } },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
        archivedByAdminUserId: req.session.userId,
        cleanupReason,
      },
    });
    await Promise.all(allowedPlaybooks.map((playbook) => logBillingPlaybookHistory({
      actorAdminUserId: req.session.userId,
      playbookId: playbook.id,
      playbookName: playbook.name,
      action: 'ARCHIVED',
      notes: cleanupReason || 'Archived from bulk cleanup.',
    })));
    setFlash(req, 'Archived ' + allowedIds.length + ' billing playbooks.');
    return res.redirect('/admin');
  }

  if (action === 'RESTORE') {
    await prisma.billingSupportPlaybook.updateMany({
      where: { id: { in: allowedIds } },
      data: {
        status: 'ACTIVE',
        archivedAt: null,
        archivedByAdminUserId: null,
      },
    });
    await Promise.all(allowedPlaybooks.map((playbook) => logBillingPlaybookHistory({
      actorAdminUserId: req.session.userId,
      playbookId: playbook.id,
      playbookName: playbook.name,
      action: 'RESTORED',
      notes: 'Restored from bulk cleanup.',
    })));
    setFlash(req, 'Restored ' + allowedIds.length + ' billing playbooks.');
    return res.redirect('/admin');
  }

  await Promise.all(allowedPlaybooks.map((playbook) => logBillingPlaybookHistory({
    actorAdminUserId: req.session.userId,
    playbookId: playbook.id,
    playbookName: playbook.name,
    action: 'DELETED',
    notes: 'Deleted from bulk cleanup.',
  })));
  await prisma.billingSupportPlaybook.deleteMany({
    where: { id: { in: allowedIds } },
  });
  setFlash(req, 'Deleted ' + allowedIds.length + ' billing playbooks.');
  return res.redirect('/admin');
}));

app.post('/admin/billing-playbooks/:id/archive', requireAuth, requireAdmin, wrap(async (req, res) => {
  const playbook = await prisma.billingSupportPlaybook.findUnique({ where: { id: req.params.id } });
  if (!playbook) {
    setFlash(req, 'Billing playbook not found.');
    return res.redirect('/admin');
  }

  if (playbook.scope === 'PERSONAL' && playbook.createdByAdminUserId !== req.session.userId) {
    setFlash(req, 'Only the creator can archive a personal billing playbook.');
    return res.redirect('/admin');
  }

  const cleanupReason = String(req.body.cleanupReason || '').trim() || null;

  await prisma.billingSupportPlaybook.update({
    where: { id: playbook.id },
    data: {
      status: 'ARCHIVED',
      archivedAt: new Date(),
      archivedByAdminUserId: req.session.userId,
      cleanupReason,
    },
  });

  await logBillingPlaybookHistory({
    actorAdminUserId: req.session.userId,
    playbookId: playbook.id,
    playbookName: playbook.name,
    action: 'ARCHIVED',
    notes: cleanupReason || 'Archived billing playbook.',
  });

  setFlash(req, 'Billing playbook archived.');
  return res.redirect('/admin');
}));

app.post('/admin/billing-playbooks/:id/restore', requireAuth, requireAdmin, wrap(async (req, res) => {
  const playbook = await prisma.billingSupportPlaybook.findUnique({ where: { id: req.params.id } });
  if (!playbook) {
    setFlash(req, 'Billing playbook not found.');
    return res.redirect('/admin');
  }

  if (playbook.scope === 'PERSONAL' && playbook.createdByAdminUserId !== req.session.userId) {
    setFlash(req, 'Only the creator can restore a personal billing playbook.');
    return res.redirect('/admin');
  }

  await prisma.billingSupportPlaybook.update({
    where: { id: playbook.id },
    data: {
      status: 'ACTIVE',
      archivedAt: null,
      archivedByAdminUserId: null,
    },
  });

  await logBillingPlaybookHistory({
    actorAdminUserId: req.session.userId,
    playbookId: playbook.id,
    playbookName: playbook.name,
    action: 'RESTORED',
    notes: 'Restored billing playbook.',
  });

  setFlash(req, 'Billing playbook restored.');
  return res.redirect('/admin');
}));

app.post('/admin/billing-playbooks/:id/delete', requireAuth, requireAdmin, wrap(async (req, res) => {
  const playbook = await prisma.billingSupportPlaybook.findUnique({ where: { id: req.params.id } });
  if (!playbook) {
    setFlash(req, 'Billing playbook not found.');
    return res.redirect('/admin');
  }

  if (playbook.scope === 'PERSONAL' && playbook.createdByAdminUserId !== req.session.userId) {
    setFlash(req, 'Only the creator can delete a personal billing playbook.');
    return res.redirect('/admin');
  }

  await logBillingPlaybookHistory({
    actorAdminUserId: req.session.userId,
    playbookId: playbook.id,
    playbookName: playbook.name,
    action: 'DELETED',
    notes: 'Deleted billing playbook.',
  });
  await prisma.billingSupportPlaybook.delete({ where: { id: playbook.id } });
  setFlash(req, 'Billing playbook deleted.');
  return res.redirect('/admin');
}));

app.post('/admin/billing-events/bulk-support', requireAuth, requireAdmin, wrap(async (req, res) => {
  const eventIdsRaw = req.body.eventIds;
  const eventIds = Array.isArray(eventIdsRaw)
    ? eventIdsRaw.flatMap((value) => String(value || '').split(',')).map((value) => value.trim()).filter(Boolean)
    : String(eventIdsRaw || '').split(',').map((value) => value.trim()).filter(Boolean);
  const supportStatus = String(req.body.supportStatus || '').trim();
  const assignedAdminUserId = String(req.body.assignedAdminUserId || '').trim() || null;
  const playbookId = String(req.body.playbookId || '').trim() || null;
  const returnTo = String(req.body.returnTo || '').trim();
  const nextPath = returnTo.startsWith('/admin') ? returnTo : '/admin';

  if (eventIds.length === 0) {
    setFlash(req, 'Select at least one billing event to update.');
    return res.redirect(nextPath);
  }

  if (!['NEW', 'NEEDS_FOLLOW_UP', 'WAITING_ON_PROVIDER', 'RESOLVED'].includes(supportStatus)) {
    setFlash(req, 'Choose a valid billing support status.');
    return res.redirect(nextPath);
  }

  if (assignedAdminUserId) {
    const adminUser = await prisma.user.findUnique({ where: { id: assignedAdminUserId } });
    if (!adminUser || adminUser.role !== 'ADMIN') {
      setFlash(req, 'Choose a valid admin owner.');
      return res.redirect(nextPath);
    }
  }

  await prisma.paymentWebhookEvent.updateMany({
    where: { id: { in: eventIds } },
    data: {
      supportStatus,
      assignedAdminUserId,
    },
  });

  if (playbookId) {
    const playbook = await prisma.billingSupportPlaybook.findUnique({ where: { id: playbookId } });
    if (playbook && (playbook.scope === 'SHARED' || playbook.createdByAdminUserId === req.session.userId)) {
      await prisma.billingSupportPlaybook.update({
        where: { id: playbookId },
        data: {
          usageCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
    }
  }

  setFlash(req, 'Updated ' + eventIds.length + ' billing events.');
  return res.redirect(nextPath);
}));

app.get('/dashboard', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.isSuspended) {
    req.session.userId = null;
    req.session.role = null;
    return res.redirect('/login');
  }

  if (user.role === 'ADMIN') {
    return res.redirect('/admin');
  }

  const filters = user.role === 'HANDYMAN' ? parseHandymanFilters(req.query) : undefined;
  const data = await loadDashboardData(user, filters);
  data.roleData.accountDeletion = await getUserDeletionEligibility(user);

  return res.render('dashboard', {
    ...baseViewModel(req, user),
    ...data,
  });
}));

app.post('/profile', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const name = String(req.body.name || '').trim();
  const location = String(req.body.location || '').trim();
  if (!name || !location) {
    setFlash(req, 'Name and location are required.');
    return res.redirect('/dashboard');
  }

  const locationGeocode = geocodeLocation(location);

  if (user.role === 'HOMEOWNER') {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        name,
        location,
        locationLat: locationGeocode?.latitude ?? null,
        locationLng: locationGeocode?.longitude ?? null,
      },
    });
    setFlash(req, 'Homeowner profile updated.');
    return res.redirect('/dashboard');
  }

  const skills = String(req.body.skills || '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean);
  const serviceRadius = parsePositiveInt(req.body.serviceRadius);
  const hourlyGuideline = req.body.hourlyGuideline ? parsePositiveInt(req.body.hourlyGuideline) : null;

  if (!serviceRadius) {
    setFlash(req, 'Service radius must be a positive number.');
    return res.redirect('/dashboard');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      location,
      locationLat: locationGeocode?.latitude ?? null,
      locationLng: locationGeocode?.longitude ?? null,
      handymanProfile: {
        upsert: {
          create: {
            businessName: String(req.body.businessName || '').trim() || null,
            skills,
            bio: String(req.body.bio || '').trim() || null,
            serviceRadius,
            hourlyGuideline,
            subscriptionPlan: user.handymanProfile?.subscriptionPlan || 'FREE',
            leadCredits: user.handymanProfile?.leadCredits ?? 3,
            subscriptionRenewsAt: user.handymanProfile?.subscriptionRenewsAt || null,
            insuranceVerified: user.handymanProfile?.insuranceVerified || false,
            insuranceStatus: user.handymanProfile?.insuranceStatus || 'NOT_SUBMITTED',
            insuranceProofDetails: user.handymanProfile?.insuranceProofDetails || null,
            insuranceSubmittedAt: user.handymanProfile?.insuranceSubmittedAt || null,
            insuranceAdminNotes: user.handymanProfile?.insuranceAdminNotes || null,
            licenseVerified: user.handymanProfile?.licenseVerified || false,
            licenseStatus: user.handymanProfile?.licenseStatus || 'NOT_SUBMITTED',
            licenseProofDetails: user.handymanProfile?.licenseProofDetails || null,
            licenseSubmittedAt: user.handymanProfile?.licenseSubmittedAt || null,
            licenseAdminNotes: user.handymanProfile?.licenseAdminNotes || null,
          },
          update: {
            businessName: String(req.body.businessName || '').trim() || null,
            skills,
            bio: String(req.body.bio || '').trim() || null,
            serviceRadius,
            hourlyGuideline,
          },
        },
      },
    },
  });

  setFlash(req, 'Handyman profile updated.');
  return res.redirect('/dashboard');
}));

app.post('/account/delete', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    req.session.role = null;
    return res.redirect('/login');
  }

  if (user.role === 'ADMIN') {
    setFlash(req, 'Admin accounts cannot be deleted from the self-serve dashboard.');
    return res.redirect('/admin');
  }

  const confirmation = String(req.body.confirmation || '').trim().toUpperCase();
  if (confirmation !== 'DELETE') {
    setFlash(req, 'Type DELETE to confirm account deletion.');
    return res.redirect('/dashboard');
  }

  const deletionState = await getUserDeletionEligibility(user);
  if (!deletionState.allowed) {
    setFlash(req, deletionState.reason);
    return res.redirect('/dashboard');
  }

  await prisma.user.delete({ where: { id: user.id } });
  return req.session.destroy(() => res.redirect('/login?accountDeleted=1'));
}));

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

app.post('/saved-searches', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== 'HANDYMAN') {
    setFlash(req, 'Only handymen can save job searches.');
    return res.redirect('/dashboard');
  }

  const filters = parseHandymanFilters(req.body);
  const name = String(req.body.name || '').trim();
  if (!name) {
    setFlash(req, 'Add a name for this saved search.');
    return res.redirect('/dashboard');
  }

  await prisma.savedSearch.create({
    data: {
      userId: user.id,
      name,
      search: filters.search || null,
      category: filters.category || null,
      minBudget: filters.minBudget,
      maxBudget: filters.maxBudget,
      sort: filters.sort,
      photosOnly: filters.photosOnly,
      nearMeOnly: filters.nearMeOnly,
    },
  });

  setFlash(req, 'Saved search created.');
  return res.redirect(buildSavedSearchQuery({
    search: filters.search,
    category: filters.category,
    minBudget: filters.minBudget,
    maxBudget: filters.maxBudget,
    sort: filters.sort,
    photosOnly: filters.photosOnly,
    nearMeOnly: filters.nearMeOnly,
  }));
}));

app.post('/saved-searches/:id/delete', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const savedSearch = await prisma.savedSearch.findUnique({ where: { id: req.params.id } });
  if (!user || !savedSearch || savedSearch.userId !== user.id || user.role !== 'HANDYMAN') {
    setFlash(req, 'Saved search not found.');
    return res.redirect('/dashboard');
  }

  await prisma.savedSearch.delete({ where: { id: savedSearch.id } });
  setFlash(req, 'Saved search removed.');
  return res.redirect('/dashboard');
}));

app.post('/admin/support-case-views', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== 'ADMIN') {
    setFlash(req, 'Only admins can save support case views.');
    return res.redirect('/dashboard');
  }

  const filters = parseAdminBillingFilters(req.body);
  const name = String(req.body.name || '').trim();
  if (!name) {
    setFlash(req, 'Add a name for this saved support case view.');
    return res.redirect('/admin');
  }

  const scope = String(req.body.scope || 'PERSONAL').trim().toUpperCase();
  const isPinned = String(req.body.isPinned || '') === '1';
  const autoApplyOnCreate = String(req.body.autoApplyOnCreate || '') === '1';
  const autoAssignAdminUserId = String(req.body.autoAssignAdminUserId || '').trim() || null;
  if (!['PERSONAL', 'SHARED'].includes(scope)) {
    setFlash(req, 'Choose a valid support case view scope.');
    return res.redirect('/admin');
  }

  if (autoAssignAdminUserId) {
    const adminUser = await prisma.user.findUnique({ where: { id: autoAssignAdminUserId } });
    if (!adminUser || adminUser.role !== 'ADMIN') {
      setFlash(req, 'Choose a valid routing owner for this support case view.');
      return res.redirect('/admin');
    }
  }

  await prisma.savedSupportCaseView.create({
    data: {
      userId: user.id,
      name,
      scope,
      isPinned,
      isDefaultLanding: false,
      autoApplyOnCreate,
      autoAssignAdminUserId,
      supportCaseSearch: filters.supportCaseSearch || null,
      supportCaseStatus: filters.supportCaseStatus || null,
      supportCaseOwner: filters.supportCaseOwner || null,
      supportCaseQueue: filters.supportCaseQueue || null,
    },
  });

  setFlash(req, 'Saved support case view created.');
  return res.redirect(buildSupportCaseViewQuery({
    supportCaseSearch: filters.supportCaseSearch,
    supportCaseStatus: filters.supportCaseStatus,
    supportCaseOwner: filters.supportCaseOwner,
    supportCaseQueue: filters.supportCaseQueue,
  }));
}));

app.post('/admin/support-case-views/:id/delete', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  const savedView = await prisma.savedSupportCaseView.findUnique({ where: { id: req.params.id } });
  if (!user || !savedView || savedView.userId !== user.id || user.role !== 'ADMIN') {
    setFlash(req, 'Saved support case view not found.');
    return res.redirect('/admin');
  }

  await prisma.savedSupportCaseView.delete({ where: { id: savedView.id } });
  setFlash(req, 'Saved support case view removed.');
  return res.redirect('/admin');
}));

app.post('/admin/support-case-views/:id/pin', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  const savedView = await prisma.savedSupportCaseView.findUnique({ where: { id: req.params.id } });
  if (!user || !savedView || user.role !== 'ADMIN') {
    setFlash(req, 'Saved support case view not found.');
    return res.redirect('/admin');
  }
  if (savedView.scope !== 'SHARED' && savedView.userId !== user.id) {
    setFlash(req, 'You can only pin your own personal views or shared team views.');
    return res.redirect('/admin');
  }

  const action = String(req.body.action || '').trim().toLowerCase();
  await prisma.savedSupportCaseView.update({
    where: { id: savedView.id },
    data: { isPinned: action === 'pin' },
  });
  setFlash(req, action === 'pin' ? 'Support case view pinned.' : 'Support case view unpinned.');
  return res.redirect('/admin');
}));

app.post('/admin/support-case-views/:id/default', requireAuth, requireAdmin, wrap(async (req, res) => {
  const user = await currentUser(req);
  const savedView = await prisma.savedSupportCaseView.findUnique({ where: { id: req.params.id } });
  if (!user || !savedView || user.role !== 'ADMIN') {
    setFlash(req, 'Saved support case view not found.');
    return res.redirect('/admin');
  }
  if (savedView.scope !== 'SHARED' && savedView.userId !== user.id) {
    setFlash(req, 'You can only set your own personal views or shared team views as the admin default.');
    return res.redirect('/admin');
  }

  const action = String(req.body.action || '').trim().toLowerCase();
  if (action === 'set') {
    if (savedView.scope === 'SHARED') {
      await prisma.savedSupportCaseView.updateMany({
        where: { scope: 'SHARED', isDefaultLanding: true },
        data: { isDefaultLanding: false },
      });
    } else {
      await prisma.savedSupportCaseView.updateMany({
        where: { userId: user.id, scope: 'PERSONAL', isDefaultLanding: true },
        data: { isDefaultLanding: false },
      });
    }
    await prisma.savedSupportCaseView.update({
      where: { id: savedView.id },
      data: { isDefaultLanding: true },
    });
    setFlash(req, 'Support case view set as the admin landing default.');
    return res.redirect('/admin');
  }

  await prisma.savedSupportCaseView.update({
    where: { id: savedView.id },
    data: { isDefaultLanding: false },
  });
  setFlash(req, 'Support case view removed as the admin landing default.');
  return res.redirect('/admin');
}));

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

app.post('/billing/plan', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== 'HANDYMAN') {
    setFlash(req, 'Only handymen can manage plans.');
    return res.redirect('/dashboard');
  }

  const plan = String(req.body.plan || '').trim();
  if (!PLAN_CONFIG[plan]) {
    setFlash(req, 'Choose a valid plan.');
    return res.redirect('/dashboard');
  }

  const profile = await prisma.handymanProfile.findUnique({ where: { userId: user.id } });
  if (!profile) {
    setFlash(req, 'Billing profile not found.');
    return res.redirect('/dashboard');
  }

  const provider = getPaymentProvider();
  if (plan === 'FREE') {
    if (provider === STRIPE_PROVIDER_NAME && profile.stripeSubscriptionId) {
      setFlash(req, 'Use Manage billing to cancel or downgrade your Stripe subscription safely.');
      return res.redirect('/dashboard');
    }

    await prisma.handymanProfile.update({
      where: { userId: user.id },
      data: {
        subscriptionPlan: 'FREE',
        subscriptionRenewsAt: null,
        billingStatus: 'INACTIVE',
        billingPeriodEndsAt: null,
        stripeSubscriptionId: null,
      },
    });
    setFlash(req, 'Free plan is now active on your account.');
    return res.redirect('/dashboard');
  }

  const session = await createCheckoutSession({
    prisma,
    req,
    userId: user.id,
    targetType: 'PLAN',
    planKey: plan,
    amount: PLAN_PRICING[plan] || 0,
  });

  if (session.provider === STRIPE_PROVIDER_NAME && session.checkoutUrl) {
    return res.redirect(session.checkoutUrl);
  }

  await completeMockCheckout(session);

  setFlash(req, formatSubscriptionPlan(plan) + ' plan activated via provider checkout.');
  return res.redirect('/dashboard');
}));

app.post('/billing/portal', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== 'HANDYMAN') {
    setFlash(req, 'Only handymen can manage billing.');
    return res.redirect('/dashboard');
  }

  const profile = await prisma.handymanProfile.findUnique({ where: { userId: user.id } });
  if (!profile?.stripeCustomerId) {
    setFlash(req, 'Stripe billing is not active on this account yet.');
    return res.redirect('/dashboard');
  }

  if (getPaymentProvider() !== STRIPE_PROVIDER_NAME) {
    setFlash(req, 'Customer portal is only available in Stripe billing mode.');
    return res.redirect('/dashboard');
  }

  const portal = await createBillingPortalSession({
    customerId: profile.stripeCustomerId,
    returnUrl: `${req.protocol}://${req.get('host')}/dashboard`,
  });

  return res.redirect(portal.url);
}));

app.post('/billing/credits', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== 'HANDYMAN') {
    setFlash(req, 'Only handymen can buy lead credits.');
    return res.redirect('/dashboard');
  }

  const packKey = String(req.body.pack || '').trim();
  const pack = CREDIT_PACKS[packKey];
  if (!pack) {
    setFlash(req, 'Choose a valid credit pack.');
    return res.redirect('/dashboard');
  }

  const session = await createCheckoutSession({
    prisma,
    req,
    userId: user.id,
    targetType: 'CREDIT_PACK',
    creditPack: packKey,
    amount: pack.amount,
  });

  if (session.provider === STRIPE_PROVIDER_NAME && session.checkoutUrl) {
    return res.redirect(session.checkoutUrl);
  }

  await completeMockCheckout(session);

  setFlash(req, pack.credits + ' lead credits added via provider checkout.');
  return res.redirect('/dashboard');
}));

app.post('/jobs/:id/bids', requireAuth, createRateLimitMiddleware({
  action: 'bidSubmit',
  getIdentifier: (req) => [req.session?.userId || 'bidder', req.params.id].join(':'),
  onLimit: (req, res) => {
    setFlash(req, 'Too many bid attempts too quickly. Please wait a few minutes and try again.');
    return res.redirect('/dashboard');
  },
}), wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== 'HANDYMAN') {
    setFlash(req, 'Only handymen can submit bids.');
    return res.redirect('/dashboard');
  }

  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job || !['OPEN', 'IN_REVIEW'].includes(job.status)) {
    setFlash(req, 'This job is not accepting bids right now.');
    return res.redirect('/dashboard');
  }

  const amount = parsePositiveInt(req.body.amount);
  const etaDays = parsePositiveInt(req.body.etaDays);
  const message = String(req.body.message || '').trim();
  const profile = await prisma.handymanProfile.findUnique({ where: { userId: user.id } });

  if (!profile) {
    setFlash(req, 'Create your handyman profile before bidding.');
    return res.redirect('/dashboard');
  }

  if (!amount || !etaDays || !message) {
    setFlash(req, 'Amount, ETA, and message are required to submit a bid.');
    return res.redirect('/dashboard');
  }

  const existingBid = await prisma.bid.findUnique({
    where: {
      jobId_handymanId: {
        jobId: job.id,
        handymanId: user.id,
      },
    },
  });

  if (!existingBid && profile.subscriptionPlan !== 'PRO' && profile.leadCredits <= 0) {
    setFlash(req, 'You are out of lead credits. Buy a pack or upgrade your plan to keep bidding.');
    return res.redirect('/dashboard');
  }

  const homeowner = await prisma.user.findUnique({
    where: { id: job.homeownerId },
    select: { id: true },
  });

  await prisma.bid.upsert({
    where: {
      jobId_handymanId: {
        jobId: job.id,
        handymanId: user.id,
      },
    },
    create: {
      jobId: job.id,
      handymanId: user.id,
      amount,
      etaDays,
      message,
    },
    update: {
      amount,
      etaDays,
      message,
      status: 'PENDING',
      shortlisted: false,
    },
  });

  if (!existingBid && profile.subscriptionPlan !== 'PRO') {
    const updatedProfile = await prisma.handymanProfile.update({
      where: { userId: user.id },
      data: { leadCredits: { decrement: 1 } },
    });
    await logLeadCreditTransaction(updatedProfile.id, -1, 'BID_UNLOCK', 'Unlocked bidding for job: ' + job.title);
  }

  if (!existingBid && homeowner) {
    await createNotification(
      homeowner.id,
      'NEW_BID',
      'New bid received',
      user.name + ' submitted a bid on ' + job.title + '.',
      '/dashboard'
    );
  }

  const bidCount = await prisma.bid.count({ where: { jobId: job.id } });
  if (job.status === 'OPEN' && bidCount > 0) {
    await prisma.job.update({ where: { id: job.id }, data: { status: 'IN_REVIEW' } });
  }

  const bidFlash = existingBid
    ? 'Bid updated. You can keep refining it until the homeowner awards the job.'
    : profile.subscriptionPlan === 'PRO'
      ? 'Bid saved on your Pro plan.'
      : 'Bid saved and 1 lead credit was used.';

  setFlash(req, bidFlash);
  return res.redirect('/dashboard');
}));

app.post('/bids/:id/shortlist', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const bid = await prisma.bid.findUnique({
    where: { id: req.params.id },
    include: { job: true },
  });

  if (!user || !bid || bid.job.homeownerId !== user.id) {
    setFlash(req, 'Bid not found.');
    return res.redirect('/dashboard');
  }

  await prisma.bid.update({
    where: { id: bid.id },
    data: { shortlisted: true, status: 'SHORTLISTED' },
  });

  if (bid.job.status === 'OPEN') {
    await prisma.job.update({ where: { id: bid.jobId }, data: { status: 'IN_REVIEW' } });
  }

  setFlash(req, 'Bid shortlisted.');
  return res.redirect('/dashboard');
}));

app.post('/bids/:id/accept', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const bid = await prisma.bid.findUnique({
    where: { id: req.params.id },
    include: { job: { include: { bids: true, payment: true, homeowner: true } } },
  });

  if (!user || !bid || bid.job.homeownerId !== user.id) {
    setFlash(req, 'Bid not found.');
    return res.redirect('/dashboard');
  }

  if (['AWARDED', 'COMPLETED'].includes(bid.job.status)) {
    setFlash(req, 'This job has already been awarded.');
    return res.redirect('/dashboard');
  }

  const declinedBidderIds = bid.job.bids
    .filter((candidate) => candidate.id !== bid.id)
    .map((candidate) => candidate.handymanId);

  await prisma.$transaction([
    prisma.bid.updateMany({
      where: { jobId: bid.jobId, NOT: { id: bid.id } },
      data: { status: 'DECLINED', shortlisted: false },
    }),
    prisma.bid.update({
      where: { id: bid.id },
      data: { status: 'ACCEPTED', shortlisted: true },
    }),
    prisma.job.update({
      where: { id: bid.jobId },
      data: {
        status: 'AWARDED',
        acceptedBidId: bid.id,
        awardedAt: new Date(),
      },
    }),
    prisma.payment.upsert({
      where: { jobId: bid.jobId },
      create: {
        jobId: bid.jobId,
        amount: bid.amount,
        status: 'PENDING_FUNDING',
      },
      update: {
        amount: bid.amount,
        status: 'PENDING_FUNDING',
        fundedAt: null,
        releasedAt: null,
      },
    }),
  ]);

  await createNotification(
    bid.handymanId,
    'BID_AWARDED',
    'Your bid was accepted',
    'You were awarded ' + bid.job.title + '. Escrow is ready for funding.',
    '/dashboard'
  );
  if (declinedBidderIds.length > 0) {
    await prisma.userNotification.createMany({
      data: declinedBidderIds.map((handymanId) => ({
        userId: handymanId,
        type: 'BID_DECLINED',
        title: 'Another handyman was chosen',
        body: 'The homeowner awarded a different bid for ' + bid.job.title + '.',
        href: '/dashboard',
      })),
    });
  }

  setFlash(req, 'Bid accepted and escrow is ready to fund.');
  return res.redirect('/dashboard');
}));

app.post('/bids/:id/messages', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const bid = await prisma.bid.findUnique({
    where: { id: req.params.id },
    include: { job: true },
  });
  if (!bid) {
    setFlash(req, 'Conversation not found.');
    return res.redirect('/dashboard');
  }

  const allowed = bid.job.homeownerId === user.id || bid.handymanId === user.id;
  if (!allowed) {
    setFlash(req, 'You do not have access to that conversation.');
    return res.redirect('/dashboard');
  }

  const body = String(req.body.body || '').trim();
  const recipientId = bid.job.homeownerId === user.id ? bid.handymanId : bid.job.homeownerId;
  if (!body) {
    setFlash(req, 'Message cannot be empty.');
    return res.redirect('/dashboard');
  }

  await prisma.message.create({
    data: {
      jobId: bid.jobId,
      bidId: bid.id,
      senderId: user.id,
      body,
    },
  });

  await createNotification(
    recipientId,
    'NEW_MESSAGE',
    'New message on ' + bid.job.title,
    user.name + ' sent you a message.',
    '/dashboard'
  );

  setFlash(req, 'Message sent.');
  return res.redirect('/dashboard');
}));

app.post('/jobs/:id/disputes', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { acceptedBid: true, payment: true, dispute: true },
  });

  if (!user || !job) {
    setFlash(req, 'Job not found.');
    return res.redirect('/dashboard');
  }

  const allowed = job.homeownerId === user.id || job.acceptedBid?.handymanId === user.id;
  if (!allowed) {
    setFlash(req, 'You do not have access to that dispute.');
    return res.redirect('/dashboard');
  }

  if (!job.payment || !['FUNDED', 'DISPUTED'].includes(job.payment.status)) {
    setFlash(req, 'Disputes are only available while funds are being held.');
    return res.redirect('/dashboard');
  }

  if (job.dispute && job.dispute.status === 'OPEN') {
    setFlash(req, 'A dispute is already open for this job.');
    return res.redirect('/dashboard');
  }

  const reason = String(req.body.reason || '').trim();
  const details = String(req.body.details || '').trim();
  if (!reason || !details) {
    setFlash(req, 'Add a reason and details for the dispute.');
    return res.redirect('/dashboard');
  }

  await prisma.$transaction([
    prisma.dispute.upsert({
      where: { jobId: job.id },
      create: {
        jobId: job.id,
        openedByUserId: user.id,
        reason,
        details,
        status: 'OPEN',
      },
      update: {
        openedByUserId: user.id,
        reason,
        details,
        status: 'OPEN',
        resolution: null,
        resolutionNotes: null,
        resolvedAt: null,
      },
    }),
    prisma.payment.update({
      where: { jobId: job.id },
      data: { status: 'DISPUTED' },
    }),
  ]);

  const counterpartyId = job.homeownerId === user.id ? job.acceptedBid?.handymanId : job.homeownerId;
  if (counterpartyId) {
    await createNotification(
      counterpartyId,
      'DISPUTE_OPENED',
      'A dispute was opened',
      user.name + ' opened a dispute on ' + job.title + '.',
      '/dashboard'
    );
  }
  await notifyAdmins('DISPUTE_OPENED', 'New dispute needs review', 'A dispute was opened on ' + job.title + '.', '/admin');

  setFlash(req, 'Dispute opened. Payment is now on hold.');
  return res.redirect('/dashboard');
}));

app.post('/disputes/:id/resolve', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const dispute = await prisma.dispute.findUnique({
    where: { id: req.params.id },
    include: { job: { include: { payment: true, acceptedBid: true } } },
  });

  if (!user || !dispute || dispute.job.homeownerId !== user.id) {
    setFlash(req, 'Dispute not found.');
    return res.redirect('/dashboard');
  }

  if (dispute.status !== 'OPEN' || !dispute.job.payment) {
    setFlash(req, 'This dispute is already resolved.');
    return res.redirect('/dashboard');
  }

  const resolution = String(req.body.resolution || '').trim();
  const resolutionNotes = String(req.body.resolutionNotes || '').trim();
  if (!['RELEASE_PAYMENT', 'REFUND_HOMEOWNER'].includes(resolution) || !resolutionNotes) {
    setFlash(req, 'Choose a resolution and add a note.');
    return res.redirect('/dashboard');
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
        ? {
            status: 'RELEASED',
            releasedAt: new Date(),
          }
        : {
            status: 'REFUNDED',
          },
    }),
  ]);

  const resolutionBody = resolution === 'RELEASE_PAYMENT'
    ? 'The dispute on ' + dispute.job.title + ' was resolved and payment was released.'
    : 'The dispute on ' + dispute.job.title + ' was resolved and escrow was refunded.';
  await prisma.userNotification.createMany({
    data: [dispute.job.homeownerId, dispute.job.acceptedBid.handymanId].map((userId) => ({
      userId,
      type: 'DISPUTE_RESOLVED',
      title: 'Dispute resolved',
      body: resolutionBody,
      href: '/dashboard',
    })),
  });

  setFlash(req, resolution === 'RELEASE_PAYMENT'
    ? 'Dispute resolved and payment released.'
    : 'Dispute resolved and escrow refunded.');
  return res.redirect('/dashboard');
}));

app.post('/jobs/:id/reviews', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { acceptedBid: true, review: true, payment: true, dispute: true },
  });

  if (!user || !job || job.homeownerId !== user.id) {
    setFlash(req, 'Job not found.');
    return res.redirect('/dashboard');
  }

  if (job.status !== 'COMPLETED' || !job.acceptedBid || job.review || !job.payment || job.payment.status !== 'RELEASED') {
    setFlash(req, 'Review is not available for this job.');
    return res.redirect('/dashboard');
  }

  const stars = parsePositiveInt(req.body.stars);
  const text = String(req.body.text || '').trim();
  if (!stars || stars > 5 || !text) {
    setFlash(req, 'Provide a 1-5 star rating and a short review.');
    return res.redirect('/dashboard');
  }

  await prisma.review.create({
    data: {
      jobId: job.id,
      reviewerId: user.id,
      handymanId: job.acceptedBid.handymanId,
      stars,
      text,
    },
  });

  const reviews = await prisma.review.findMany({
    where: { handymanId: job.acceptedBid.handymanId },
    select: { stars: true },
  });
  const ratingCount = reviews.length;
  const ratingAvg = ratingCount === 0
    ? 0
    : reviews.reduce((sum, review) => sum + review.stars, 0) / ratingCount;

  await prisma.handymanProfile.update({
    where: { userId: job.acceptedBid.handymanId },
    data: { ratingAvg, ratingCount },
  });

  setFlash(req, 'Review submitted.');
  return res.redirect('/dashboard');
}));

app.post('/jobs/:id/payment/fund', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { acceptedBid: true, payment: true, dispute: true },
  });

  if (!user || !job || job.homeownerId !== user.id) {
    setFlash(req, 'Job not found.');
    return res.redirect('/dashboard');
  }

  if (job.status !== 'AWARDED' || !job.acceptedBid || !job.payment) {
    setFlash(req, 'Escrow is not available for this job yet.');
    return res.redirect('/dashboard');
  }

  if (job.dispute && job.dispute.status === 'OPEN') {
    setFlash(req, 'Resolve the open dispute before funding escrow again.');
    return res.redirect('/dashboard');
  }

  if (job.payment.status !== 'PENDING_FUNDING') {
    setFlash(req, 'Escrow has already been funded.');
    return res.redirect('/dashboard');
  }

  const session = await createCheckoutSession({
    prisma,
    req,
    userId: user.id,
    jobId: job.id,
    targetType: 'ESCROW_FUNDING',
    amount: job.payment.amount,
  });

  if (session.provider === STRIPE_PROVIDER_NAME && session.checkoutUrl) {
    return res.redirect(session.checkoutUrl);
  }

  await completeMockCheckout(session);

  setFlash(req, 'Escrow funded through provider checkout. Your handyman can now begin the work.');
  return res.redirect('/dashboard');
}));

app.post('/webhooks/payments', wrap(async (req, res) => {
  try {
    const { event } = verifyWebhookRequest(req);
    const result = await processCheckoutWebhook(event);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(401).json({ error: error.message || 'Invalid webhook signature.' });
  }
}));

app.get(['/health', '/healthz'], wrap(async (_req, res) => {
  const startedAt = Date.now();
  let database = 'ok';

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (_error) {
    database = 'error';
  }

  const ok = database === 'ok';
  return res.status(ok ? 200 : 503).json({
    ok,
    service: 'fixmyhome',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      database,
    },
    responseTimeMs: Date.now() - startedAt,
  });
}));

app.post('/jobs/:id/payment/release', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { acceptedBid: true, payment: true, dispute: true },
  });

  if (!user || !job || job.homeownerId !== user.id) {
    setFlash(req, 'Job not found.');
    return res.redirect('/dashboard');
  }

  if (job.status !== 'COMPLETED' || !job.payment) {
    setFlash(req, 'Payment release is not available yet.');
    return res.redirect('/dashboard');
  }

  if (job.dispute && job.dispute.status === 'OPEN') {
    setFlash(req, 'Resolve the open dispute before releasing payment.');
    return res.redirect('/dashboard');
  }

  if (job.payment.status !== 'FUNDED') {
    setFlash(req, 'This payment is not ready to release.');
    return res.redirect('/dashboard');
  }

  await prisma.payment.update({
    where: { jobId: job.id },
    data: {
      status: 'RELEASED',
      releasedAt: new Date(),
    },
  });

  setFlash(req, 'Payment released to the handyman. You can now leave a review.');
  return res.redirect('/dashboard');
}));

app.use((err, req, res, next) => {
  captureAppError(err, {
    request: {
      requestId: req.requestId || null,
      method: req.method,
      path: req.originalUrl || req.url,
      ip: getClientIp(req),
    },
    user: {
      id: req.session?.userId || null,
      role: req.session?.role || null,
    },
  });
  logRequestEvent('error', 'request.failed', {
    requestId: req.requestId || null,
    method: req.method,
    path: req.originalUrl || req.url,
    userId: req.session?.userId || null,
    ip: getClientIp(req),
    errorName: err?.name || 'Error',
    errorMessage: err?.message || 'Unknown error',
    stack: err?.stack || null,
  });
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({
      error: 'Server error. Please try again.',
      requestId: req.requestId || null,
    });
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    setFlash(req, req.path.includes('/attachments') ? 'Each support case attachment must be 10MB or smaller.' : 'Each photo must be 5MB or smaller.');
  } else if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') {
    setFlash(req, req.path.includes('/attachments') ? 'You can upload up to 3 attachments per support case update.' : 'You can upload up to 5 photos per job.');
  } else if (err.message === 'Only image uploads are allowed.' || err.message === 'Only images, PDFs, text, JSON, and CSV attachments are allowed.') {
    setFlash(req, err.message);
  } else {
    setFlash(req, `Server error. Please try again. Reference: ${req.requestId || 'unknown'}`);
  }
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/admin/support-cases/')) {
    const supportCasePath = req.path.split('/attachments')[0] || req.path.split('/comments')[0] || req.path;
    return res.redirect(supportCasePath);
  }
  return res.redirect('/dashboard');
});

app.listen(PORT, () => {
  console.log(`FixMyHome web app running at http://localhost:${PORT}`);
  console.log(`[monitoring] provider=${monitoringStatus.provider} enabled=${monitoringStatus.enabled}`);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
