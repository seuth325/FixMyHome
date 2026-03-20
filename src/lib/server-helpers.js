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

function formatDistanceMiles(distanceMiles) {
  if (!Number.isFinite(distanceMiles)) return null;
  if (distanceMiles < 0.2) return 'Under 1 mile away';
  if (distanceMiles < 10) return distanceMiles.toFixed(1) + ' miles away';
  return Math.round(distanceMiles) + ' miles away';
}

module.exports = {
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
};
