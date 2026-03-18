let sentryInstance = null;
let sentryEnabled = false;

function safeRequireSentry() {
  try {
    // Optional dependency for production monitoring.
    // The app still runs cleanly when it is not installed.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require('@sentry/node');
  } catch (_error) {
    return null;
  }
}

function initializeMonitoring({ app, release = '' } = {}) {
  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn) {
    return { enabled: false, provider: 'none' };
  }

  const Sentry = safeRequireSentry();
  if (!Sentry) {
    console.warn('[monitoring] SENTRY_DSN is set but @sentry/node is not installed. Monitoring is disabled.');
    return { enabled: false, provider: 'missing-sentry-sdk' };
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: release || process.env.SENTRY_RELEASE || 'fixmyhome-web',
    tracesSampleRate: Number.parseFloat(String(process.env.SENTRY_TRACES_SAMPLE_RATE || '0')),
  });

  if (app && typeof Sentry.setupExpressErrorHandler === 'function') {
    Sentry.setupExpressErrorHandler(app);
  }

  sentryInstance = Sentry;
  sentryEnabled = true;
  return { enabled: true, provider: 'sentry' };
}

function setMonitoringUser(user) {
  if (!sentryEnabled || !sentryInstance || !user) return;
  sentryInstance.setUser({
    id: user.id,
    email: user.email,
    role: user.role,
  });
}

function clearMonitoringUser() {
  if (!sentryEnabled || !sentryInstance) return;
  sentryInstance.setUser(null);
}

function captureAppError(error, context = {}) {
  if (sentryEnabled && sentryInstance) {
    sentryInstance.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        if (value !== undefined) {
          scope.setContext(key, typeof value === 'object' && value !== null ? value : { value });
        }
      });
      sentryInstance.captureException(error);
    });
  }
}

module.exports = {
  initializeMonitoring,
  setMonitoringUser,
  clearMonitoringUser,
  captureAppError,
};
