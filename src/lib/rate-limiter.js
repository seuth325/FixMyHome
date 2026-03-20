function createRateLimiter({ actionLimits, passwordResetWindowMs, passwordResetMaxAttempts, getClientIp }) {
  const passwordResetAttempts = new Map();
  const actionRateLimitBuckets = new Map();

  function pruneRateLimitBucket(bucket, now) {
    return bucket.filter((timestamp) => (now - timestamp) < passwordResetWindowMs);
  }

  function pruneActionRateLimitBucket(bucket, now, windowMs) {
    return bucket.filter((timestamp) => (now - timestamp) < windowMs);
  }

  function buildActionRateLimitKey(action, req, identifier = '') {
    return [action, getClientIp(req), identifier || 'default'].join(':');
  }

  function isActionRateLimited(action, req, identifier = '') {
    const config = actionLimits[action];
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
    const config = actionLimits[action];
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
      return existing.length >= passwordResetMaxAttempts;
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

  return {
    createRateLimitMiddleware,
    isActionRateLimited,
    isPasswordResetRateLimited,
    recordActionRateLimitAttempt,
    recordPasswordResetAttempt,
  };
}

module.exports = {
  createRateLimiter,
};
