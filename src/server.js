const express = require('express');
const path = require('path');
const session = require('express-session');
const multer = require('multer');

const { prisma } = require('./lib/prisma');
const { PrismaSessionStore } = require('./lib/session-store');
const { saveJobPhoto, saveSupportCaseAttachment, getSupportCaseAttachmentLocalPath } = require('./lib/storage');
const { extractZip, geocodeLocation, haversineDistanceMiles, normalizeLocation } = require('./lib/geocode');
const { sendPasswordResetEmail, sendContactMessageEmail } = require('./lib/mailer');
const { STRIPE_PROVIDER_NAME, buildWebhookEvent, createBillingPortalSession, createCheckoutSession, getPaymentProvider, signPayload, verifyWebhookRequest } = require('./lib/payments');
const { initializeMonitoring, setMonitoringUser, clearMonitoringUser, captureAppError } = require('./lib/monitoring');
const {
  buildAdminJobCreatedAtFilter,
  formatAuditAction,
  formatBillingEventType,
  formatBillingStatus,
  formatBillingSupportStatus,
  formatCheckoutStatus,
  formatCurrency,
  formatDisputeStatus,
  formatDistanceMiles,
  formatNotificationType,
  formatPaymentStatus,
  formatReportStatus,
  formatVerificationStatus,
  getBillingSupportTone,
  getRoleLabel,
  getStatusTone,
  parseAdminBillingFilters,
  parseHandymanFilters,
  parsePositiveInt,
  validatePasswordPolicy,
} = require('./lib/server-helpers');
const {
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
} = require('./lib/request-helpers');
const { clearAuthSession, createRequireAdmin, requireAuth } = require('./lib/auth-middleware');
const { createRateLimiter } = require('./lib/rate-limiter');
const { createBillingSupportServices } = require('./lib/billing-support-services');
const { registerAuthRoutes } = require('./routes/auth-routes');
const { registerAccountRoutes } = require('./routes/account-routes');
const { registerPublicRoutes } = require('./routes/public-routes');
const { registerAdminCoreRoutes } = require('./routes/admin-core-routes');
const { registerAdminBillingRoutes } = require('./routes/admin-billing-routes');
const { registerAdminSupportReadRoutes } = require('./routes/admin-support-read-routes');
const { registerAdminSupportWriteRoutes } = require('./routes/admin-support-write-routes');
const { registerAdminBillingActionRoutes } = require('./routes/admin-billing-actions-routes');
const { registerDashboardAccountRoutes } = require('./routes/dashboard-account-routes');
const { registerJobsAiRoutes } = require('./routes/jobs-ai-routes');
const { registerSavedViewsRoutes } = require('./routes/saved-views-routes');
const { registerVerificationModerationRoutes } = require('./routes/verification-moderation-routes');
const { registerBillingUserRoutes } = require('./routes/billing-user-routes');
const { registerMarketplaceRoutes } = require('./routes/marketplace-routes');

const app = express();
const requireAdmin = createRequireAdmin({ prisma });
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
const ACTION_RATE_LIMITS = {
  login: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
  signup: { windowMs: 30 * 60 * 1000, maxAttempts: 5 },
  contact: { windowMs: 15 * 60 * 1000, maxAttempts: 6 },
  jobPost: { windowMs: 15 * 60 * 1000, maxAttempts: 8 },
  bidSubmit: { windowMs: 15 * 60 * 1000, maxAttempts: 15 },
  adminPost: { windowMs: 10 * 60 * 1000, maxAttempts: 120 },
};
const {
  createRateLimitMiddleware,
  isActionRateLimited,
  isPasswordResetRateLimited,
  recordActionRateLimitAttempt,
  recordPasswordResetAttempt,
} = createRateLimiter({
  actionLimits: ACTION_RATE_LIMITS,
  passwordResetWindowMs: PASSWORD_RESET_RATE_LIMIT_WINDOW_MS,
  passwordResetMaxAttempts: PASSWORD_RESET_RATE_LIMIT_MAX_ATTEMPTS,
  getClientIp,
});
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

function shouldSkipRequestLog(req) {
  if (REQUEST_LOG_SKIP_PATHS.has(req.path)) {
    return true;
  }
  return REQUEST_LOG_SKIP_PREFIXES.some((prefix) => req.path.startsWith(prefix));
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
  return getAppFooterNavItems();
}

function isLikelyBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

function getLoginFooterNavItems() {
  return getAppFooterNavItems();
}

function getAppFooterNavItems() {
  return [
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/refund-policy', label: 'Refund policy' },
    { href: '/about', label: 'About Us' },
    { href: '/contact', label: 'Contact Us' },
  ];
}

function buildSupportCaseAttachmentHref(supportCaseId, attachmentId) {
  return `/admin/support-cases/${supportCaseId}/attachments/${attachmentId}/file`;
}

const {
  buildBillingGroups,
  buildBillingPlaybookExportFilename,
  buildBillingPlaybookHistoryCreatedAtFilter,
  buildBillingPlaybookSummary,
  buildBillingPlaybookSummaryPayload,
  buildBillingQueue,
  buildScopedBillingPlaybooks,
  buildSupportCaseExportFilename,
  buildSupportCasePackagePayload,
  buildSupportCasePackageText,
  decorateBillingEvent,
  formatSubscriptionPlan,
  getPlanSummary,
  loadCheckoutSessionsByIds,
  normalizeBillingPlaybookHistoryFilters,
} = createBillingSupportServices({
  PLAN_CONFIG,
  buildSupportCaseAttachmentHref,
  formatBillingEventType,
  formatBillingSupportStatus,
  formatCurrency,
  getBillingSupportTone,
  prisma,
});
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

function getLocationTokens(value) {
  const ignored = new Set(['oh', 'st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 'ct', 'court', 'blvd', 'boulevard']);
  return normalizeLocation(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !ignored.has(token) && !/^\d+$/.test(token));
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
    footerNavItems: getAppFooterNavItems(),
    showFooterSupportEmail: false,
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

registerPublicRoutes(app, {
  clearAuthSession,
  createRateLimitMiddleware,
  currentUser,
  getAppBaseUrl,
  getLegalNavItems,
  getSupportEmail,
  popFlash,
  sendContactMessageEmail,
  wrap,
});
registerAuthRoutes(app, {
  createRateLimitMiddleware,
  geocodeLocation,
  getAppBaseUrl,
  getLegalNavItems,
  getLoginFooterNavItems,
  getSupportEmail,
  isLikelyBcryptHash,
  isPasswordResetRateLimited,
  popFlash,
  popFormState,
  prisma,
  recordPasswordResetAttempt,
  sendPasswordResetEmail,
  setFlash,
  setFormState,
  validatePasswordPolicy,
  wrap,
});
registerAccountRoutes(app, {
  currentUser,
  prisma,
  requireAuth,
  setFlash,
  wrap,
});

registerAdminCoreRoutes(app, {
  baseViewModel,
  buildAdminJobTimeline,
  buildSupportCaseViewQuery,
  currentUser,
  enrichAdminJob,
  formatCurrency,
  getStatusTone,
  getUserDeletionEligibility,
  loadAdminData,
  parseAdminBillingFilters,
  prisma,
  requireAdmin,
  requireAuth,
  setFlash,
  wrap,
});
registerAdminBillingRoutes(app, {
  applySupportCaseAutoRouting,
  baseViewModel,
  buildBillingPlaybookExportFilename,
  buildBillingPlaybookHistoryCreatedAtFilter,
  buildBillingPlaybookSummary,
  buildBillingPlaybookSummaryPayload,
  currentUser,
  decorateBillingEvent,
  loadCheckoutSessionsByIds,
  logSupportCaseActivity,
  normalizeBillingPlaybookHistoryFilters,
  notifySupportCaseAdmins,
  prisma,
  requireAdmin,
  requireAuth,
  setFlash,
  wrap,
});

registerAdminSupportReadRoutes(app, {
  baseViewModel,
  buildSupportCaseAttachmentHref,
  buildSupportCaseExportFilename,
  buildSupportCasePackagePayload,
  buildSupportCasePackageText,
  currentUser,
  getSupportCaseAttachmentLocalPath,
  logSupportCaseActivity,
  notifySupportCaseAdmins,
  prisma,
  requireAdmin,
  requireAuth,
  setFlash,
  wrap,
});

registerAdminSupportWriteRoutes(app, {
  logSupportCaseActivity,
  notifySupportCaseAdmins,
  prisma,
  requireAdmin,
  requireAuth,
  saveSupportCaseAttachment,
  setFlash,
  supportCaseAttachmentUpload,
  wrap,
});

registerAdminBillingActionRoutes(app, {
  logBillingPlaybookHistory,
  prisma,
  requireAdmin,
  requireAuth,
  setFlash,
  wrap,
});

registerDashboardAccountRoutes(app, {
  baseViewModel,
  currentUser,
  geocodeLocation,
  getUserDeletionEligibility,
  loadDashboardData,
  parseHandymanFilters,
  parsePositiveInt,
  prisma,
  requireAuth,
  setFlash,
  wrap,
});

registerJobsAiRoutes(app, {
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
});

registerSavedViewsRoutes(app, {
  buildSavedSearchQuery,
  buildSupportCaseViewQuery,
  currentUser,
  parseAdminBillingFilters,
  parseHandymanFilters,
  prisma,
  requireAdmin,
  requireAuth,
  setFlash,
  wrap,
});

registerVerificationModerationRoutes(app, {
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
});

registerBillingUserRoutes(app, {
  completeMockCheckout,
  createBillingPortalSession,
  createCheckoutSession,
  CREDIT_PACKS,
  currentUser,
  formatSubscriptionPlan,
  getPaymentProvider,
  PLAN_CONFIG,
  PLAN_PRICING,
  prisma,
  requireAuth,
  setFlash,
  STRIPE_PROVIDER_NAME,
  wrap,
});

registerMarketplaceRoutes(app, {
  completeMockCheckout,
  createCheckoutSession,
  createNotification,
  createRateLimitMiddleware,
  currentUser,
  logLeadCreditTransaction,
  notifyAdmins,
  parsePositiveInt,
  prisma,
  requireAuth,
  setFlash,
  STRIPE_PROVIDER_NAME,
  wrap,
});

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
  if (req.path === '/dashboard' || req.path.startsWith('/dashboard/')) {
    clearAuthSession(req);
    return res.redirect('/login');
  }
  if (req.path === '/admin' || req.path.startsWith('/admin/')) {
    clearAuthSession(req);
    return res.redirect('/login');
  }
  return res.redirect('/dashboard');
});

function createApp() {
  return app;
}

function registerShutdownHandlers() {
  if (registerShutdownHandlers.registered) {
    return;
  }
  registerShutdownHandlers.registered = true;

  const shutdown = async () => {
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function startServer(port = PORT) {
  const server = app.listen(port, () => {
    console.log(`FixMyHome web app running at http://localhost:${port}`);
    console.log(`[monitoring] provider=${monitoringStatus.provider} enabled=${monitoringStatus.enabled}`);
  });

  registerShutdownHandlers();
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  createApp,
  startServer,
};
