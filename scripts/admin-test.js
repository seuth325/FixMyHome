const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const port = process.env.ADMIN_PORT || '3107';
const baseUrl = `http://127.0.0.1:${port}`;

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  apply(headers = {}) {
    const cookieHeader = Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

    return cookieHeader ? { ...headers, cookie: cookieHeader } : headers;
  }

  store(response) {
    const setCookie = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];

    for (const entry of setCookie) {
      const [pair] = entry.split(';');
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;
      this.cookies.set(pair.slice(0, eqIndex).trim(), pair.slice(eqIndex + 1).trim());
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logStep(message) {
  process.stdout.write(`\n[admin] ${message}\n`);
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch (_error) {
      await sleep(300);
      continue;
    }
    await sleep(300);
  }
  throw new Error('Server did not become ready in time.');
}

async function request(path, { method = 'GET', jar, form, multipart, redirect = 'manual' } = {}) {
  const headers = jar ? jar.apply({}) : {};
  let body;
  if (multipart) {
    body = new FormData();
    for (const [key, value] of Object.entries(multipart)) {
      if (Array.isArray(value)) {
        value.forEach((entry) => body.append(key, entry.value, entry.filename));
      } else {
        body.append(key, value);
      }
    }
  } else if (form) {
    body = new URLSearchParams(form);
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body, redirect });
  if (jar) jar.store(response);
  return response;
}

async function login(email, password) {
  const jar = new CookieJar();
  const page = await request('/login', { jar });
  if (page.status !== 200) throw new Error(`Expected login page 200, received ${page.status}`);
  const response = await request('/login', { method: 'POST', jar, form: { email, password } });
  return { jar, response };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function findBidWithRetry(jobId, handymanId, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const bid = await prisma.bid.findUnique({
      where: { jobId_handymanId: { jobId, handymanId } },
    });
    if (bid) return bid;
    await sleep(250);
  }
  return null;
}

async function main() {
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    logStep(`Starting app on port ${port}`);
    await waitForServer();

    const admin = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });
    const handyman = await prisma.user.findUnique({ where: { email: 'alex@example.com' } });
    await prisma.user.update({
      where: { id: handyman.id },
      data: { isSuspended: false },
    });

    const adminLogin = await login('admin@example.com', 'password123');
    const homeownerLogin = await login('homeowner@example.com', 'password123');
    const handymanLogin = await login('alex@example.com', 'password123');
    assert(adminLogin.response.status === 302, `Expected admin login redirect, received ${adminLogin.response.status}`);
    assert(homeownerLogin.response.status === 302, `Expected homeowner login redirect, received ${homeownerLogin.response.status}`);
    assert(handymanLogin.response.status === 302, `Expected handyman login redirect, received ${handymanLogin.response.status}`);
    assert((adminLogin.response.headers.get('location') || '').includes('/dashboard'), 'Expected admin login to redirect into the app.');
    assert((homeownerLogin.response.headers.get('location') || '').includes('/dashboard'), 'Expected homeowner login to redirect into the app.');
    assert((handymanLogin.response.headers.get('location') || '').includes('/dashboard'), 'Expected handyman login to redirect into the app.');

    const adminJar = adminLogin.jar;
    const homeownerJar = homeownerLogin.jar;
    const handymanJar = handymanLogin.jar;
    await prisma.handymanProfile.updateMany({
      where: { userId: handyman.id },
      data: {
        subscriptionPlan: 'PLUS',
        leadCredits: 5,
      },
    });

    const suffix = Date.now();
    const title = `Admin moderation job ${suffix}`;
    const secondTitle = `Admin billing batch job ${suffix}`;

    logStep('Creating a reported and disputed job');
    await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title,
        category: 'Repairs',
        description: 'Admin moderation coverage job.',
        location: 'Columbus, OH 43215',
        budget: '240',
        preferredDate: 'This week',
      },
    });

    const job = await prisma.job.findFirst({ where: { title }, orderBy: { createdAt: 'desc' } });
    assert(job, 'Expected moderation job to exist.');

    await request(`/jobs/${job.id}/bids`, {
      method: 'POST',
      jar: handymanJar,
      form: {
        amount: '220',
        etaDays: '2',
        message: 'Admin test bid.',
      },
    });

    const bid = await findBidWithRetry(job.id, handyman.id);
    assert(bid, 'Expected moderation bid to exist.');

    await request(`/bids/${bid.id}/accept`, { method: 'POST', jar: homeownerJar });
    await request(`/jobs/${job.id}/payment/fund`, { method: 'POST', jar: homeownerJar });
    await request(`/jobs/${job.id}/disputes`, {
      method: 'POST',
      jar: handymanJar,
      form: {
        reason: 'Unexpected extra work',
        details: 'Handyman escalated a scope change issue.',
      },
    });

    logStep('Creating a second billing event for bulk queue coverage');
    await request('/jobs', {
      method: 'POST',
      jar: homeownerJar,
      form: {
        title: secondTitle,
        category: 'Painting',
        description: 'Second billing event coverage job.',
        location: 'Columbus, OH 43215',
        budget: '315',
        preferredDate: 'Next week',
      },
    });

    const secondJob = await prisma.job.findFirst({ where: { title: secondTitle }, orderBy: { createdAt: 'desc' } });
    assert(secondJob, 'Expected second billing coverage job to exist.');

    await request(`/jobs/${secondJob.id}/bids`, {
      method: 'POST',
      jar: handymanJar,
      form: {
        amount: '295',
        etaDays: '3',
        message: 'Second admin billing test bid.',
      },
    });

    const secondBid = await findBidWithRetry(secondJob.id, handyman.id);
    assert(secondBid, 'Expected second billing bid to exist.');

    await request(`/bids/${secondBid.id}/accept`, { method: 'POST', jar: homeownerJar });
    await request(`/jobs/${secondJob.id}/payment/fund`, { method: 'POST', jar: homeownerJar });

    logStep('Submitting job and user reports');
    await request(`/jobs/${job.id}/report`, {
      method: 'POST',
      jar: handymanJar,
      form: {
        reason: 'Job mismatch',
        details: 'Reported to test the admin queue.',
      },
    });
    await request(`/users/${handyman.id}/report`, {
      method: 'POST',
      jar: homeownerJar,
      form: {
        reason: 'Profile concern',
        details: 'Reported to test user moderation.',
      },
    });

    const reports = await prisma.moderationReport.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' } });
    const dispute = await prisma.dispute.findUnique({ where: { jobId: job.id } });
    assert(reports.length >= 2, 'Expected at least two open moderation reports.');
    assert(dispute && dispute.status === 'OPEN', 'Expected an open dispute for admin review.');

    logStep('Verifying admin dashboard loads queue items');
    const adminDashboard = await request('/admin', { jar: adminJar, redirect: 'follow' });
    const adminHtml = await adminDashboard.text();
    assert(adminDashboard.status === 200, `Expected admin dashboard 200, received ${adminDashboard.status}`);
    assert(adminHtml.includes('Open reports'), 'Expected admin dashboard to show moderation reports.');
    assert(adminHtml.includes('Open disputes'), 'Expected admin dashboard to show disputes.');
    assert(adminHtml.includes('Billing support queue'), 'Expected admin dashboard to show billing support queue.');
    assert(adminHtml.includes('Related billing groups'), 'Expected admin dashboard to show related billing groups.');
    assert(adminHtml.includes('Billing timeline'), 'Expected admin dashboard to show billing timeline.');
    assert(adminHtml.includes('Checkout completed'), 'Expected admin dashboard to show a billing event.');
    assert(adminHtml.includes(title), 'Expected billing timeline to include the job context.');
    assert(adminHtml.includes('Audit log'), 'Expected admin dashboard to show audit logs.');

    logStep('Checking billing timeline filters');
    const filteredDashboard = await request(
      '/admin?billingSearch=' + encodeURIComponent(title) + '&billingProvider=mockpay&billingEventType=checkout.session.completed&billingStatus=PROCESSED&billingSupportStatus=NEW',
      { jar: adminJar, redirect: 'follow' }
    );
    const filteredHtml = await filteredDashboard.text();
    assert(filteredDashboard.status === 200, 'Expected filtered admin dashboard 200, received ' + filteredDashboard.status);
    assert(filteredHtml.includes(title), 'Expected filtered billing timeline to keep the matching event.');
    assert(filteredHtml.includes('value="mockpay" selected'), 'Expected billing provider filter to stay selected.');
    assert(filteredHtml.includes('value="NEW" selected'), 'Expected billing support filter to stay selected.');

    const emptyFilteredDashboard = await request('/admin?billingSearch=__admin_billing_no_match__', { jar: adminJar, redirect: 'follow' });
    const emptyFilteredHtml = await emptyFilteredDashboard.text();
    assert(emptyFilteredDashboard.status === 200, 'Expected empty filtered admin dashboard 200, received ' + emptyFilteredDashboard.status);
    assert(emptyFilteredHtml.includes('No billing events match this filter set.'), 'Expected empty billing filter state to render.');

    logStep('Opening billing event detail');
    const billingEvent = await prisma.paymentWebhookEvent.findFirst({
      where: { eventType: 'checkout.session.completed', status: 'PROCESSED' },
      orderBy: { createdAt: 'desc' },
    });
    assert(billingEvent, 'Expected at least one processed checkout billing event.');
    const billingDetail = await request('/admin/billing-events/' + billingEvent.id, { jar: adminJar, redirect: 'follow' });
    const billingDetailHtml = await billingDetail.text();
    assert(billingDetail.status === 200, 'Expected billing detail page 200, received ' + billingDetail.status);
    assert(billingDetailHtml.includes('Billing event'), 'Expected billing detail page heading.');
    assert(billingDetailHtml.includes('Event summary') || billingDetailHtml.includes('Checkout session') || billingDetailHtml.includes('Linked job'), 'Expected billing detail page to include event context.');
    assert(billingDetailHtml.includes('Raw payload'), 'Expected billing detail page to show the raw payload section.');
    assert(billingDetailHtml.includes(billingEvent.providerEventId), 'Expected billing detail page to include the provider event id.');

    logStep('Saving billing support notes');
    await request('/admin/billing-events/' + billingEvent.id + '/support', {
      method: 'POST',
      jar: adminJar,
      form: {
        assignedAdminUserId: admin.id,
        supportStatus: 'NEEDS_FOLLOW_UP',
        supportNotes: 'Support confirmed the homeowner-funded escrow matches the checkout amount.',
      },
    });
    let notedEvent = await prisma.paymentWebhookEvent.findUnique({ where: { id: billingEvent.id } });
    assert(notedEvent.supportNotes === 'Support confirmed the homeowner-funded escrow matches the checkout amount.', 'Expected billing event support notes to persist.');
    assert(Boolean(notedEvent.supportNotesUpdatedAt), 'Expected billing event support notes timestamp to persist.');
    assert(notedEvent.supportStatus === 'NEEDS_FOLLOW_UP', 'Expected billing support status to persist.');
    assert(notedEvent.assignedAdminUserId === admin.id, 'Expected billing event owner to persist.');

    await prisma.paymentWebhookEvent.update({
      where: { id: billingEvent.id },
      data: {
        createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
      },
    });
    notedEvent = await prisma.paymentWebhookEvent.findUnique({ where: { id: billingEvent.id } });

    const billingDetailWithNotes = await request('/admin/billing-events/' + billingEvent.id, { jar: adminJar, redirect: 'follow' });
    const billingDetailWithNotesHtml = await billingDetailWithNotes.text();
    assert(billingDetailWithNotesHtml.includes('Internal investigation context'), 'Expected billing detail page to show support notes panel.');
    assert(billingDetailWithNotesHtml.includes('Support confirmed the homeowner-funded escrow matches the checkout amount.'), 'Expected billing detail page to render saved support notes.');
    assert(billingDetailWithNotesHtml.includes('Needs follow-up'), 'Expected billing detail page to render support status.');
    assert(billingDetailWithNotesHtml.includes(admin.name), 'Expected billing detail page to render the assigned owner.');

    const adminDashboardWithNotes = await request('/admin?billingSupportStatus=NEEDS_FOLLOW_UP', { jar: adminJar, redirect: 'follow' });
    const adminDashboardWithNotesHtml = await adminDashboardWithNotes.text();
    assert(adminDashboardWithNotesHtml.includes('Internal notes saved'), 'Expected billing timeline to show note presence.');
    assert(adminDashboardWithNotesHtml.includes('Needs follow-up'), 'Expected billing timeline to show support status.');
    assert(adminDashboardWithNotesHtml.includes(admin.name), 'Expected billing timeline to show the assigned owner.');
    assert(adminDashboardWithNotesHtml.includes('Billing support queue'), 'Expected support queue section to render.');
    assert(adminDashboardWithNotesHtml.includes('Owner: ' + admin.name), 'Expected support queue to show the assigned owner.');
    assert(adminDashboardWithNotesHtml.includes('Older than 24h'), 'Expected support queue to show stale billing work.');
    assert(adminDashboardWithNotesHtml.includes('Quick update'), 'Expected support queue quick action to render.');
    assert(adminDashboardWithNotesHtml.includes('Bulk update selected'), 'Expected support queue bulk action to render.');

    logStep('Bulk-updating billing queue items');
    const bulkBillingEvents = await prisma.paymentWebhookEvent.findMany({
      where: { eventType: 'checkout.session.completed', status: 'PROCESSED' },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    assert(bulkBillingEvents.length >= 2, 'Expected two billing events for bulk support update coverage.');
    const bulkUpdateResponse = await request('/admin/billing-events/bulk-support', {
      method: 'POST',
      jar: adminJar,
      form: {
        eventIds: bulkBillingEvents.map((entry) => entry.id),
        assignedAdminUserId: admin.id,
        supportStatus: 'WAITING_ON_PROVIDER',
        returnTo: '/admin?billingSupportStatus=WAITING_ON_PROVIDER',
      },
    });
    assert(bulkUpdateResponse.status === 302, 'Expected bulk support update to redirect, received ' + bulkUpdateResponse.status);
    const updatedBulkEvents = await prisma.paymentWebhookEvent.findMany({ where: { id: { in: bulkBillingEvents.map((entry) => entry.id) } } });
    assert(updatedBulkEvents.every((entry) => entry.supportStatus === 'WAITING_ON_PROVIDER'), 'Expected bulk support update to persist the new status.');
    assert(updatedBulkEvents.every((entry) => entry.assignedAdminUserId === admin.id), 'Expected bulk support update to persist the owner.');

    logStep('Creating a custom billing playbook');
    const customPlaybookName = 'Escalate escrow follow-up';
    const updatedPlaybookName = 'Resolve escrow batch quickly';
    const createPlaybookResponse = await request('/admin/billing-playbooks', {
      method: 'POST',
      jar: adminJar,
      form: {
        name: customPlaybookName,
        provider: 'mockpay',
        eventType: 'checkout.session.completed',
        targetType: 'ESCROW_FUNDING',
        supportStatus: 'WAITING_ON_PROVIDER',
        scope: 'PERSONAL',
        isFavorite: '1',
        assignToCreator: '1',
      },
    });
    assert(createPlaybookResponse.status === 302, 'Expected billing playbook creation to redirect, received ' + createPlaybookResponse.status);
    let customPlaybook = await prisma.billingSupportPlaybook.findFirst({
      where: {
        name: customPlaybookName,
        createdByAdminUserId: admin.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(customPlaybook, 'Expected custom billing playbook to be saved.');
    assert(customPlaybook.scope === 'PERSONAL', 'Expected new custom billing playbook to default to personal scope from the form.');
    assert(customPlaybook.isFavorite === true, 'Expected new custom billing playbook favorite flag to persist.');
    assert(customPlaybook.usageCount === 0, 'Expected new custom billing playbook to start with zero usage.');
    assert(!customPlaybook.lastUsedAt, 'Expected new custom billing playbook to start without a last-used timestamp.');
    await prisma.billingSupportPlaybook.update({
      where: { id: customPlaybook.id },
      data: { createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });

    const secondPlaybookName = 'Second stale cleanup playbook';
    const secondPlaybookResponse = await request('/admin/billing-playbooks', {
      method: 'POST',
      jar: adminJar,
      form: {
        name: secondPlaybookName,
        provider: 'mockpay',
        eventType: 'checkout.session.completed',
        targetType: 'ESCROW_FUNDING',
        supportStatus: 'WAITING_ON_PROVIDER',
        scope: 'PERSONAL',
        isFavorite: '0',
        status: 'ACTIVE',
        assignToCreator: '1',
      },
    });
    assert(secondPlaybookResponse.status === 302, 'Expected second cleanup playbook creation to redirect, received ' + secondPlaybookResponse.status);
    let secondPlaybook = await prisma.billingSupportPlaybook.findFirst({
      where: {
        name: secondPlaybookName,
        createdByAdminUserId: admin.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(secondPlaybook, 'Expected second cleanup playbook to be saved.');
    await prisma.billingSupportPlaybook.update({
      where: { id: secondPlaybook.id },
      data: { createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000) },
    });

    const personalPlaybookDashboard = await request('/admin', { jar: adminJar, redirect: 'follow' });
    const personalPlaybookHtml = await personalPlaybookDashboard.text();
    assert(personalPlaybookHtml.includes('Favorite playbooks'), 'Expected favorite billing playbooks section to render.');
    assert(personalPlaybookHtml.includes('My personal playbooks'), 'Expected personal billing playbooks section to render.');
    assert(personalPlaybookHtml.includes('Stale cleanup candidates'), 'Expected stale cleanup candidates section to render.');
    assert(personalPlaybookHtml.includes(customPlaybookName), 'Expected personal billing playbook to render in the admin dashboard.');
    assert(personalPlaybookHtml.includes(secondPlaybookName), 'Expected second stale cleanup playbook to render in the admin dashboard.');
    assert(personalPlaybookHtml.includes('Archive selected'), 'Expected bulk stale cleanup action to render.');

    logStep('Updating the custom billing playbook');
    const updatePlaybookResponse = await request('/admin/billing-playbooks/' + customPlaybook.id, {
      method: 'POST',
      jar: adminJar,
      form: {
        name: updatedPlaybookName,
        provider: 'mockpay',
        eventType: 'checkout.session.completed',
        targetType: 'ESCROW_FUNDING',
        supportStatus: 'RESOLVED',
        scope: 'SHARED',
        isFavorite: '1',
        assignToCreator: '0',
      },
    });
    assert(updatePlaybookResponse.status === 302, 'Expected billing playbook update to redirect, received ' + updatePlaybookResponse.status);
    customPlaybook = await prisma.billingSupportPlaybook.findUnique({ where: { id: customPlaybook.id } });
    assert(customPlaybook.name === updatedPlaybookName, 'Expected billing playbook name update to persist.');
    assert(customPlaybook.supportStatus === 'RESOLVED', 'Expected billing playbook status update to persist.');
    assert(customPlaybook.scope === 'SHARED', 'Expected billing playbook scope update to persist.');
    assert(customPlaybook.isFavorite === true, 'Expected billing playbook favorite flag to persist after update.');
    assert(customPlaybook.assignToCreator === false, 'Expected billing playbook ownership preference update to persist.');

    const waitingQueueDashboard = await request('/admin?billingSupportStatus=WAITING_ON_PROVIDER', { jar: adminJar, redirect: 'follow' });
    const waitingQueueHtml = await waitingQueueDashboard.text();
    assert(waitingQueueHtml.includes('Waiting on provider'), 'Expected waiting-on-provider queue to render.');
    assert(waitingQueueHtml.includes(secondTitle), 'Expected second billing event to appear in the waiting queue.');
    assert(waitingQueueHtml.includes('Related billing groups'), 'Expected grouped billing patterns to render.');
    assert(waitingQueueHtml.includes('Escrow funding activity') || waitingQueueHtml.includes('Plan checkout activations'), 'Expected grouped billing patterns to use a smart support label.');
    assert(waitingQueueHtml.includes('Select this group'), 'Expected grouped billing patterns to offer one-click selection.');
    assert(waitingQueueHtml.includes('Custom billing playbooks'), 'Expected admin dashboard to show the custom billing playbook form.');
    assert(waitingQueueHtml.includes('Favorite playbooks'), 'Expected favorite playbooks summary to render.');
    assert(waitingQueueHtml.includes('0 runs'), 'Expected playbook analytics to show zero runs before first use.');
    assert(waitingQueueHtml.includes('Shared team playbooks'), 'Expected shared playbooks section to render after promotion.');
    assert(waitingQueueHtml.includes('Update this batch'), 'Expected grouped billing patterns to offer a direct batch action.');
    assert(waitingQueueHtml.includes('Own escrow batch') || waitingQueueHtml.includes('Resolve plan activations'), 'Expected grouped billing patterns to offer a saved playbook.');
    assert(waitingQueueHtml.includes(updatedPlaybookName), 'Expected grouped billing patterns to include the updated custom playbook.');
    assert(waitingQueueHtml.includes('Custom shared favorite by ' + admin.name), 'Expected grouped billing patterns to show shared favorite custom playbook metadata.');
    assert(waitingQueueHtml.includes('Update playbook'), 'Expected saved playbook update control to render.');
    assert(waitingQueueHtml.includes('Delete playbook'), 'Expected saved playbook delete control to render.');

    logStep('Running a billing playbook');
    const playbookResponse = await request('/admin/billing-events/bulk-support', {
      method: 'POST',
      jar: adminJar,
      form: {
        eventIds: bulkBillingEvents.map((entry) => entry.id).join(','),
        playbookId: customPlaybook.id,
        assignedAdminUserId: admin.id,
        supportStatus: 'WAITING_ON_PROVIDER',
        returnTo: '/admin?billingSupportStatus=WAITING_ON_PROVIDER',
      },
    });
    assert(playbookResponse.status === 302, 'Expected billing playbook action to redirect, received ' + playbookResponse.status);
    const playbookUpdatedEvents = await prisma.paymentWebhookEvent.findMany({ where: { id: { in: bulkBillingEvents.map((entry) => entry.id) } } });
    assert(playbookUpdatedEvents.every((entry) => entry.assignedAdminUserId === admin.id), 'Expected billing playbook action to assign the batch owner.');
    assert(playbookUpdatedEvents.every((entry) => entry.supportStatus === 'WAITING_ON_PROVIDER'), 'Expected billing playbook action to keep the batch in the expected status.');
    customPlaybook = await prisma.billingSupportPlaybook.findUnique({ where: { id: customPlaybook.id } });
    assert(customPlaybook.usageCount === 1, 'Expected billing playbook usage count to increment after use.');
    assert(Boolean(customPlaybook.lastUsedAt), 'Expected billing playbook last-used timestamp to persist after use.');
    const analyticsDashboard = await request('/admin?billingSupportStatus=WAITING_ON_PROVIDER', { jar: adminJar, redirect: 'follow' });
    const analyticsHtml = await analyticsDashboard.text();
    assert(analyticsHtml.includes('1 runs'), 'Expected billing playbook analytics to show the updated usage count.');
    assert(analyticsHtml.includes('Last used'), 'Expected billing playbook analytics to show the last-used timestamp.');

    logStep('Bulk-archiving stale billing playbooks');
    const cleanupReason = 'Low usage duplicate cleanup';
    const bulkArchiveResponse = await request('/admin/billing-playbooks/actions/bulk-status', {
      method: 'POST',
      jar: adminJar,
      form: {
        playbookIds: secondPlaybook.id,
        action: 'ARCHIVE',
        cleanupReason,
      },
    });
    assert(bulkArchiveResponse.status === 302, 'Expected bulk billing playbook archive to redirect, received ' + bulkArchiveResponse.status);
    customPlaybook = await prisma.billingSupportPlaybook.findUnique({ where: { id: customPlaybook.id } });
    secondPlaybook = await prisma.billingSupportPlaybook.findUnique({ where: { id: secondPlaybook.id } });
    assert(secondPlaybook.status === 'ARCHIVED', 'Expected bulk archive to update the selected cleanup playbook status.');
    assert(secondPlaybook.cleanupReason === cleanupReason, 'Expected bulk archive cleanup reason to persist.');
    assert(secondPlaybook.archivedByAdminUserId === admin.id, 'Expected bulk archive actor to persist.');
    const archivedDashboard = await request('/admin?billingSupportStatus=WAITING_ON_PROVIDER', { jar: adminJar, redirect: 'follow' });
    const archivedDashboardHtml = await archivedDashboard.text();
    assert(archivedDashboardHtml.includes('Archived playbooks'), 'Expected archived playbook section to render.');
    assert(archivedDashboardHtml.includes('Restore playbook'), 'Expected archived playbook restore control to render.');
    assert(archivedDashboardHtml.includes('Restore selected'), 'Expected archived playbook bulk restore action to render.');
    assert(archivedDashboardHtml.includes(cleanupReason), 'Expected archived playbook cleanup reason to render in the admin dashboard.');
    assert(archivedDashboardHtml.includes('Archived by ' + admin.name), 'Expected archived playbook actor to render in the admin dashboard.');

    logStep('Bulk-restoring stale billing playbooks');
    const bulkRestoreResponse = await request('/admin/billing-playbooks/actions/bulk-status', {
      method: 'POST',
      jar: adminJar,
      form: {
        playbookIds: secondPlaybook.id,
        action: 'RESTORE',
      },
    });
    assert(bulkRestoreResponse.status === 302, 'Expected bulk billing playbook restore to redirect, received ' + bulkRestoreResponse.status);
    customPlaybook = await prisma.billingSupportPlaybook.findUnique({ where: { id: customPlaybook.id } });
    secondPlaybook = await prisma.billingSupportPlaybook.findUnique({ where: { id: secondPlaybook.id } });
    assert(secondPlaybook.status === 'ACTIVE', 'Expected bulk restore to reactivate the selected cleanup playbook.');
    assert(secondPlaybook.archivedByAdminUserId === null, 'Expected bulk restore to clear the archived-by actor.');

    const bulkDeleteResponse = await request('/admin/billing-playbooks/actions/bulk-status', {
      method: 'POST',
      jar: adminJar,
      form: {
        playbookIds: secondPlaybook.id,
        action: 'DELETE',
      },
    });
    assert(bulkDeleteResponse.status === 302, 'Expected bulk billing playbook delete to redirect, received ' + bulkDeleteResponse.status);
    secondPlaybook = await prisma.billingSupportPlaybook.findUnique({ where: { id: secondPlaybook.id } });
    assert(!secondPlaybook, 'Expected bulk delete to remove the second cleanup playbook.');

    logStep('Deleting the custom billing playbook');
    const deletePlaybookResponse = await request('/admin/billing-playbooks/' + customPlaybook.id + '/delete', {
      method: 'POST',
      jar: adminJar,
    });
    assert(deletePlaybookResponse.status === 302, 'Expected billing playbook delete to redirect, received ' + deletePlaybookResponse.status);
    const deletedPlaybook = await prisma.billingSupportPlaybook.findUnique({ where: { id: customPlaybook.id } });
    assert(!deletedPlaybook, 'Expected custom billing playbook to be deleted.');
    const playbookHistory = await prisma.billingPlaybookHistory.findMany({
      where: { playbookName: { in: [customPlaybookName, updatedPlaybookName, secondPlaybookName] } },
      orderBy: { createdAt: 'asc' },
    });
    assert(playbookHistory.some((entry) => entry.action === 'CREATED' && entry.playbookName === customPlaybookName), 'Expected playbook history to record the original playbook creation.');
    assert(playbookHistory.some((entry) => entry.action === 'UPDATED' && entry.playbookName === updatedPlaybookName), 'Expected playbook history to record playbook updates.');
    assert(playbookHistory.some((entry) => entry.action === 'ARCHIVED' && entry.playbookName === secondPlaybookName && entry.notes === cleanupReason), 'Expected playbook history to record bulk archive cleanup notes.');
    assert(playbookHistory.some((entry) => entry.action === 'RESTORED' && entry.playbookName === secondPlaybookName), 'Expected playbook history to record bulk restore activity.');
    assert(playbookHistory.some((entry) => entry.action === 'DELETED' && entry.playbookName === updatedPlaybookName), 'Expected playbook history to record playbook deletion.');
    const playbookDetailResponse = await request('/admin/billing-playbooks/' + customPlaybook.id + '/history', { jar: adminJar, redirect: 'follow' });
    const playbookDetailHtml = await playbookDetailResponse.text();
    assert(playbookDetailResponse.status === 200, 'Expected playbook history detail page to load, received ' + playbookDetailResponse.status);
    assert(playbookDetailHtml.includes('Billing playbook'), 'Expected playbook history detail heading to render.');
    assert(playbookDetailHtml.includes(updatedPlaybookName), 'Expected deleted playbook detail page to show the latest playbook name.');
    assert(playbookDetailHtml.includes('Activity timeline'), 'Expected playbook history detail page to show the activity timeline.');
    assert(playbookDetailHtml.includes('This playbook has been deleted, but its activity history is still available.'), 'Expected deleted playbook detail page to explain the current state.');
    assert(playbookDetailHtml.includes('Deleted'), 'Expected playbook history detail page to show delete activity.');
    assert(playbookDetailHtml.includes('Date range'), 'Expected playbook history detail page to render the date range filter.');
    assert(playbookDetailHtml.includes('Copyable handoff summary'), 'Expected playbook history detail page to render the support summary section.');
    assert(playbookDetailHtml.includes('Download TXT'), 'Expected playbook history detail page to render the text export action.');
    assert(playbookDetailHtml.includes('Download JSON'), 'Expected playbook history detail page to render the JSON export action.');
    const playbookSummaryResponse = await request('/admin/billing-playbooks/' + customPlaybook.id + '/history/summary', { jar: adminJar, redirect: 'follow' });
    const playbookSummaryText = await playbookSummaryResponse.text();
    assert(playbookSummaryResponse.status === 200, 'Expected playbook summary export to load, received ' + playbookSummaryResponse.status);
    assert(playbookSummaryText.includes('Playbook: ' + updatedPlaybookName), 'Expected playbook summary export to include the playbook name.');
    assert(playbookSummaryText.includes('State: Deleted / history only'), 'Expected playbook summary export to describe the deleted state.');
    assert(String(playbookSummaryResponse.headers.get('content-disposition') || '').includes('.txt'), 'Expected playbook summary export to download as a text file.');
    const playbookSummaryJsonResponse = await request('/admin/billing-playbooks/' + customPlaybook.id + '/history/summary.json', { jar: adminJar, redirect: 'follow' });
    const playbookSummaryJsonText = await playbookSummaryJsonResponse.text();
    const playbookSummaryJson = JSON.parse(playbookSummaryJsonText);
    assert(playbookSummaryJsonResponse.status === 200, 'Expected playbook summary JSON export to load, received ' + playbookSummaryJsonResponse.status);
    assert(String(playbookSummaryJsonResponse.headers.get('content-disposition') || '').includes('.json'), 'Expected playbook summary JSON export to download as a JSON file.');
    assert(playbookSummaryJson.playbook.name === updatedPlaybookName, 'Expected playbook summary JSON export to include the playbook name.');
    assert(playbookSummaryJson.playbook.state.status === 'DELETED', 'Expected playbook summary JSON export to describe the deleted state.');

    logStep('Creating a support case from the playbook summary');
    const createSupportCaseResponse = await request('/admin/billing-playbooks/' + customPlaybook.id + '/history/cases', {
      method: 'POST',
      jar: adminJar,
      form: {
        caseTitle: updatedPlaybookName + ' support handoff',
        action: '',
        actorAdminUserId: '',
        dateRange: 'ALL',
      },
    });
    assert(createSupportCaseResponse.status === 302, 'Expected support case creation to redirect, received ' + createSupportCaseResponse.status);
    const supportCase = await prisma.supportCase.findFirst({
      where: { title: updatedPlaybookName + ' support handoff' },
      orderBy: { createdAt: 'desc' },
    });
    assert(supportCase, 'Expected support case to be created from the playbook summary.');
    assert(supportCase.sourcePlaybookName === updatedPlaybookName, 'Expected support case to keep the source playbook name.');
    assert(supportCase.summaryText.includes('Playbook: ' + updatedPlaybookName), 'Expected support case to persist the exported summary text.');

    logStep('Opening the support case detail page');
    const supportCaseDetailResponse = await request('/admin/support-cases/' + supportCase.id, { jar: adminJar, redirect: 'follow' });
    const supportCaseDetailHtml = await supportCaseDetailResponse.text();
    assert(supportCaseDetailResponse.status === 200, 'Expected support case detail page to load, received ' + supportCaseDetailResponse.status);
    assert(supportCaseDetailHtml.includes('Case overview'), 'Expected support case detail page to render the overview section.');
    assert(supportCaseDetailHtml.includes('Case summary snapshot'), 'Expected support case detail page to render the summary snapshot.');
    assert(supportCaseDetailHtml.includes('Activity log'), 'Expected support case detail page to render the activity log.');
    assert(supportCaseDetailHtml.includes('Case comments'), 'Expected support case detail page to render the comments section.');

    logStep('Updating support case ownership and notes');
    const updateSupportCaseResponse = await request('/admin/support-cases/' + supportCase.id, {
      method: 'POST',
      jar: adminJar,
      form: {
        assignedAdminUserId: admin.id,
        status: 'OPEN',
        notes: 'Assigned to billing ops for follow-up.',
      },
    });
    assert(updateSupportCaseResponse.status === 302, 'Expected support case detail update to redirect, received ' + updateSupportCaseResponse.status);
    const updatedSupportCase = await prisma.supportCase.findUnique({ where: { id: supportCase.id } });
    assert(updatedSupportCase.assignedAdminUserId === admin.id, 'Expected support case owner update to persist.');
    assert(updatedSupportCase.notes === 'Assigned to billing ops for follow-up.', 'Expected support case notes update to persist.');
    const filteredSupportCaseDashboard = await request('/admin?supportCaseSearch=' + encodeURIComponent(updatedPlaybookName) + '&supportCaseOwner=' + admin.id + '&supportCaseStatus=OPEN', { jar: adminJar, redirect: 'follow' });
    const filteredSupportCaseDashboardHtml = await filteredSupportCaseDashboard.text();
    assert(filteredSupportCaseDashboard.status === 200, 'Expected support case filtered admin dashboard to load, received ' + filteredSupportCaseDashboard.status);
    assert(filteredSupportCaseDashboardHtml.includes(updatedPlaybookName + ' support handoff'), 'Expected support case search and owner filters to include the created case.');
    logStep('Saving a reusable support case admin view');
    const saveSupportCaseViewResponse = await request('/admin/support-case-views', {
      method: 'POST',
      jar: adminJar,
      form: {
        name: 'My ' + updatedPlaybookName + ' queue',
        scope: 'SHARED',
        isPinned: '1',
        autoApplyOnCreate: '1',
        autoAssignAdminUserId: admin.id,
        supportCaseSearch: updatedPlaybookName,
        supportCaseOwner: '',
        supportCaseStatus: 'OPEN',
        supportCaseQueue: '',
      },
    });
    assert(saveSupportCaseViewResponse.status === 302, 'Expected support case view save to redirect, received ' + saveSupportCaseViewResponse.status);
    const savedSupportCaseView = await prisma.savedSupportCaseView.findFirst({
      where: { userId: admin.id, name: 'My ' + updatedPlaybookName + ' queue' },
      orderBy: { createdAt: 'desc' },
    });
    assert(savedSupportCaseView, 'Expected saved support case view to persist.');
    assert(savedSupportCaseView.scope === 'SHARED', 'Expected saved support case view scope to persist.');
    assert(savedSupportCaseView.isPinned === true, 'Expected saved support case view pin state to persist.');
    assert(savedSupportCaseView.autoApplyOnCreate === true, 'Expected saved support case view auto-apply state to persist.');
    assert(savedSupportCaseView.autoAssignAdminUserId === admin.id, 'Expected saved support case view auto-assignment owner to persist.');
    const setDefaultSupportCaseViewResponse = await request('/admin/support-case-views/' + savedSupportCaseView.id + '/default', {
      method: 'POST',
      jar: adminJar,
      form: { action: 'set' },
    });
    assert(setDefaultSupportCaseViewResponse.status === 302, 'Expected support case view default action to redirect, received ' + setDefaultSupportCaseViewResponse.status);
    const defaultedSupportCaseView = await prisma.savedSupportCaseView.findUnique({ where: { id: savedSupportCaseView.id } });
    assert(defaultedSupportCaseView.isDefaultLanding === true, 'Expected support case view default landing state to persist.');
    const savedSupportCaseViewDashboard = await request('/admin?supportCaseViewId=' + savedSupportCaseView.id + '&supportCaseSearch=' + encodeURIComponent(updatedPlaybookName) + '&supportCaseOwner=' + admin.id + '&supportCaseStatus=OPEN', { jar: adminJar, redirect: 'follow' });
    const savedSupportCaseViewDashboardHtml = await savedSupportCaseViewDashboard.text();
    assert(savedSupportCaseViewDashboard.status === 200, 'Expected saved support case view dashboard to load, received ' + savedSupportCaseViewDashboard.status);
    assert(savedSupportCaseViewDashboardHtml.includes('Reusable case filters'), 'Expected saved support case views panel to render on the admin dashboard.');
    assert(savedSupportCaseViewDashboardHtml.includes('My ' + updatedPlaybookName + ' queue'), 'Expected the saved support case view name to render on the admin dashboard.');
    assert(savedSupportCaseViewDashboardHtml.includes('Shared team view'), 'Expected saved support case view scope labels to render on the admin dashboard.');
    assert(savedSupportCaseViewDashboardHtml.includes('Unpin'), 'Expected pinned support case views to render pin controls on the admin dashboard.');
    assert(savedSupportCaseViewDashboardHtml.includes('Clear default') || savedSupportCaseViewDashboardHtml.includes('default landing'), 'Expected saved support case views to render default landing controls or labels.');
    const defaultLandingAdminResponse = await request('/admin', { jar: adminJar, redirect: 'manual' });
    assert(defaultLandingAdminResponse.status === 302, 'Expected default landing admin request to redirect, received ' + defaultLandingAdminResponse.status);
    assert(String(defaultLandingAdminResponse.headers.get('location') || '').includes('supportCaseViewId=' + savedSupportCaseView.id), 'Expected /admin to redirect into the saved default support case view.');
    await prisma.$executeRawUnsafe(`UPDATE "SupportCase" SET "updatedAt" = NOW() - interval '30 hours' WHERE id = '${supportCase.id}'`);
    const overdueSupportCaseDashboard = await request('/admin?supportCaseQueue=overdue_24h', { jar: adminJar, redirect: 'follow' });
    const overdueSupportCaseDashboardHtml = await overdueSupportCaseDashboard.text();
    assert(overdueSupportCaseDashboardHtml.includes(updatedPlaybookName + ' support handoff'), 'Expected overdue support case queue to include the aged case.');
    const supportCaseActivities = await prisma.supportCaseActivity.findMany({ where: { supportCaseId: supportCase.id }, orderBy: { createdAt: 'asc' } });
    assert(supportCaseActivities.some((entry) => entry.type === 'CREATED'), 'Expected support case activity log to include creation.');
    assert(supportCaseActivities.some((entry) => entry.type === 'REASSIGNED'), 'Expected support case activity log to include reassignment.');
    assert(supportCaseActivities.some((entry) => entry.type === 'UPDATED_NOTES'), 'Expected support case activity log to include notes updates.');

    logStep('Posting an internal support case comment');
    const createSupportCaseCommentResponse = await request('/admin/support-cases/' + supportCase.id + '/comments', {
      method: 'POST',
      jar: adminJar,
      form: { body: 'Looping in billing support for provider-side confirmation.' },
    });
    assert(createSupportCaseCommentResponse.status === 302, 'Expected support case comment post to redirect, received ' + createSupportCaseCommentResponse.status);
    const supportCaseComment = await prisma.supportCaseComment.findFirst({
      where: { supportCaseId: supportCase.id },
      orderBy: { createdAt: 'desc' },
    });
    assert(supportCaseComment, 'Expected support case comment to persist.');
    assert(supportCaseComment.body === 'Looping in billing support for provider-side confirmation.', 'Expected support case comment body to persist.');
    const supportCaseDetailAfterComment = await request('/admin/support-cases/' + supportCase.id, { jar: adminJar, redirect: 'follow' });
    const supportCaseDetailAfterCommentHtml = await supportCaseDetailAfterComment.text();
    assert(supportCaseDetailAfterCommentHtml.includes('Looping in billing support for provider-side confirmation.'), 'Expected support case detail page to render the new comment.');
    const supportCaseActivitiesAfterComment = await prisma.supportCaseActivity.findMany({ where: { supportCaseId: supportCase.id } });
    assert(supportCaseActivitiesAfterComment.some((entry) => entry.type === 'COMMENTED'), 'Expected support case activity log to include comment activity.');

    logStep('Editing the support case comment and marking it as the current answer');
    const editSupportCaseCommentResponse = await request('/admin/support-cases/' + supportCase.id + '/comments/' + supportCaseComment.id, {
      method: 'POST',
      jar: adminJar,
      form: { body: 'Billing ops confirmed this is a provider delay and will monitor retries.' },
    });
    assert(editSupportCaseCommentResponse.status === 302, 'Expected support case comment edit to redirect, received ' + editSupportCaseCommentResponse.status);
    const markSupportCaseCommentResponse = await request('/admin/support-cases/' + supportCase.id + '/comments/' + supportCaseComment.id + '/resolution', {
      method: 'POST',
      jar: adminJar,
      form: { action: 'mark' },
    });
    assert(markSupportCaseCommentResponse.status === 302, 'Expected support case comment mark action to redirect, received ' + markSupportCaseCommentResponse.status);
    const refreshedSupportCaseComment = await prisma.supportCaseComment.findUnique({ where: { id: supportCaseComment.id } });
    assert(refreshedSupportCaseComment.body === 'Billing ops confirmed this is a provider delay and will monitor retries.', 'Expected support case comment edits to persist.');
    assert(refreshedSupportCaseComment.isResolution === true, 'Expected support case comment to be marked as the current answer.');
    const supportCaseDetailAfterResolution = await request('/admin/support-cases/' + supportCase.id, { jar: adminJar, redirect: 'follow' });
    const supportCaseDetailAfterResolutionHtml = await supportCaseDetailAfterResolution.text();
    assert(supportCaseDetailAfterResolutionHtml.includes('Current answer'), 'Expected support case detail page to show the current answer marker.');
    assert(supportCaseDetailAfterResolutionHtml.includes('Billing ops confirmed this is a provider delay and will monitor retries.'), 'Expected support case detail page to show the edited comment body.');
    const supportCaseActivitiesAfterResolution = await prisma.supportCaseActivity.findMany({ where: { supportCaseId: supportCase.id } });
    assert(supportCaseActivitiesAfterResolution.some((entry) => entry.type === 'COMMENT_EDITED'), 'Expected support case activity log to include edited comment activity.');
    assert(supportCaseActivitiesAfterResolution.some((entry) => entry.type === 'COMMENT_MARKED'), 'Expected support case activity log to include current-answer markers.');

    logStep('Uploading support case evidence');
    const attachmentUploadResponse = await request('/admin/support-cases/' + supportCase.id + '/attachments', {
      method: 'POST',
      jar: adminJar,
      multipart: {
        attachments: [
          {
            value: new Blob(['provider retry log'], { type: 'text/plain' }),
            filename: 'provider-retry-log.txt',
          },
        ],
      },
    });
    assert(attachmentUploadResponse.status === 302, 'Expected support case attachment upload to redirect, received ' + attachmentUploadResponse.status);
    const supportCaseAttachment = await prisma.supportCaseAttachment.findFirst({
      where: { supportCaseId: supportCase.id },
      orderBy: { createdAt: 'desc' },
    });
    assert(supportCaseAttachment, 'Expected support case attachment to persist.');
    assert(supportCaseAttachment.filename === 'provider-retry-log.txt', 'Expected support case attachment filename to persist.');
    const supportCaseDetailAfterAttachment = await request('/admin/support-cases/' + supportCase.id, { jar: adminJar, redirect: 'follow' });
    const supportCaseDetailAfterAttachmentHtml = await supportCaseDetailAfterAttachment.text();
    assert(supportCaseDetailAfterAttachmentHtml.includes('Attachments'), 'Expected support case detail page to render attachments.');
    assert(supportCaseDetailAfterAttachmentHtml.includes('provider-retry-log.txt'), 'Expected support case detail page to render the uploaded attachment.');
    const supportCaseActivitiesAfterAttachment = await prisma.supportCaseActivity.findMany({ where: { supportCaseId: supportCase.id } });
    assert(supportCaseActivitiesAfterAttachment.some((entry) => entry.type === 'ATTACHMENT_UPLOADED'), 'Expected support case activity log to include uploaded attachments.');

    logStep('Updating, archiving, restoring, and deleting support case evidence');
    const updateAttachmentNoteResponse = await request('/admin/support-cases/' + supportCase.id + '/attachments/' + supportCaseAttachment.id, {
      method: 'POST',
      jar: adminJar,
      form: { note: 'Provider response showing retry backoff.' },
    });
    assert(updateAttachmentNoteResponse.status === 302, 'Expected attachment note update to redirect, received ' + updateAttachmentNoteResponse.status);
    const archiveAttachmentResponse = await request('/admin/support-cases/' + supportCase.id + '/attachments/' + supportCaseAttachment.id + '/archive', {
      method: 'POST',
      jar: adminJar,
      form: { action: 'archive' },
    });
    assert(archiveAttachmentResponse.status === 302, 'Expected attachment archive to redirect, received ' + archiveAttachmentResponse.status);
    let refreshedAttachment = await prisma.supportCaseAttachment.findUnique({ where: { id: supportCaseAttachment.id } });
    assert(refreshedAttachment.note === 'Provider response showing retry backoff.', 'Expected attachment note to persist.');
    assert(Boolean(refreshedAttachment.archivedAt), 'Expected attachment archive timestamp to persist.');
    const restoreAttachmentResponse = await request('/admin/support-cases/' + supportCase.id + '/attachments/' + supportCaseAttachment.id + '/archive', {
      method: 'POST',
      jar: adminJar,
      form: { action: 'restore' },
    });
    assert(restoreAttachmentResponse.status === 302, 'Expected attachment restore to redirect, received ' + restoreAttachmentResponse.status);
    refreshedAttachment = await prisma.supportCaseAttachment.findUnique({ where: { id: supportCaseAttachment.id } });
    assert(!refreshedAttachment.archivedAt, 'Expected attachment restore to clear archive timestamp.');
    const deleteAttachmentResponse = await request('/admin/support-cases/' + supportCase.id + '/attachments/' + supportCaseAttachment.id + '/delete', {
      method: 'POST',
      jar: adminJar,
    });
    assert(deleteAttachmentResponse.status === 302, 'Expected attachment delete to redirect, received ' + deleteAttachmentResponse.status);
    const deletedAttachment = await prisma.supportCaseAttachment.findUnique({ where: { id: supportCaseAttachment.id } });
    assert(!deletedAttachment, 'Expected attachment delete to remove the support case evidence record.');
    const supportCaseDetailAfterAttachmentLifecycle = await request('/admin/support-cases/' + supportCase.id, { jar: adminJar, redirect: 'follow' });
    const supportCaseDetailAfterAttachmentLifecycleHtml = await supportCaseDetailAfterAttachmentLifecycle.text();
    assert(supportCaseDetailAfterAttachmentLifecycleHtml.includes('Archived attachments'), 'Expected support case detail page to render archived attachments section.');
    assert(supportCaseDetailAfterAttachmentLifecycleHtml.includes('Download TXT'), 'Expected support case detail page to render TXT handoff export.');
    assert(supportCaseDetailAfterAttachmentLifecycleHtml.includes('Download JSON'), 'Expected support case detail page to render JSON handoff export.');
    const supportCaseActivitiesAfterAttachmentLifecycle = await prisma.supportCaseActivity.findMany({ where: { supportCaseId: supportCase.id } });
    assert(supportCaseActivitiesAfterAttachmentLifecycle.some((entry) => entry.type === 'ATTACHMENT_UPDATED'), 'Expected support case activity log to include attachment note updates.');
    assert(supportCaseActivitiesAfterAttachmentLifecycle.some((entry) => entry.type === 'ATTACHMENT_ARCHIVED'), 'Expected support case activity log to include attachment archive actions.');
    assert(supportCaseActivitiesAfterAttachmentLifecycle.some((entry) => entry.type === 'ATTACHMENT_DELETED'), 'Expected support case activity log to include attachment deletes.');

    const supportCaseExportTextResponse = await request('/admin/support-cases/' + supportCase.id + '/export.txt', { jar: adminJar, redirect: 'follow' });
    const supportCaseExportText = await supportCaseExportTextResponse.text();
    assert(supportCaseExportTextResponse.status === 200, 'Expected support case TXT export to load, received ' + supportCaseExportTextResponse.status);
    assert(String(supportCaseExportTextResponse.headers.get('content-disposition') || '').includes('.txt'), 'Expected support case TXT export to download as a text file.');
    assert(supportCaseExportText.includes('Support Case: ' + updatedPlaybookName + ' support handoff'), 'Expected support case TXT export to include the case title.');
    assert(supportCaseExportText.includes('Billing ops confirmed this is a provider delay and will monitor retries.'), 'Expected support case TXT export to include comment content.');

    const supportCaseExportJsonResponse = await request('/admin/support-cases/' + supportCase.id + '/export.json', { jar: adminJar, redirect: 'follow' });
    const supportCaseExportJsonText = await supportCaseExportJsonResponse.text();
    const supportCaseExportJson = JSON.parse(supportCaseExportJsonText);
    assert(supportCaseExportJsonResponse.status === 200, 'Expected support case JSON export to load, received ' + supportCaseExportJsonResponse.status);
    assert(String(supportCaseExportJsonResponse.headers.get('content-disposition') || '').includes('.json'), 'Expected support case JSON export to download as a JSON file.');
    assert(supportCaseExportJson.supportCase.title === updatedPlaybookName + ' support handoff', 'Expected support case JSON export to include the case title.');
    assert(Array.isArray(supportCaseExportJson.comments) && supportCaseExportJson.comments.length > 0, 'Expected support case JSON export to include comments.');
    assert(Array.isArray(supportCaseExportJson.attachments), 'Expected support case JSON export to include attachments manifest.');

    const closeSupportCaseResponse = await request('/admin/support-cases/' + supportCase.id + '/status', {
      method: 'POST',
      jar: adminJar,
      form: { status: 'CLOSED' },
    });
    assert(closeSupportCaseResponse.status === 302, 'Expected support case close action to redirect, received ' + closeSupportCaseResponse.status);
    const closedSupportCase = await prisma.supportCase.findUnique({ where: { id: supportCase.id } });
    assert(closedSupportCase.status === 'CLOSED', 'Expected support case status update to persist.');

    logStep('Creating an auto-routed support case from the preset view');
    const autoRoutedSupportCaseResponse = await request('/admin/billing-playbooks/' + customPlaybook.id + '/history/cases', {
      method: 'POST',
      jar: adminJar,
      form: {
        caseTitle: updatedPlaybookName + ' routed support handoff',
        action: '',
        actorAdminUserId: '',
        dateRange: 'ALL',
      },
    });
    assert(autoRoutedSupportCaseResponse.status === 302, 'Expected auto-routed support case creation to redirect, received ' + autoRoutedSupportCaseResponse.status);
    const autoRoutedSupportCase = await prisma.supportCase.findFirst({
      where: { title: updatedPlaybookName + ' routed support handoff' },
      orderBy: { createdAt: 'desc' },
    });
    assert(autoRoutedSupportCase, 'Expected auto-routed support case to persist.');
    assert(autoRoutedSupportCase.assignedAdminUserId === admin.id, 'Expected auto-routed support case owner to persist from the preset view.');
    const supportCaseDetailAfterClose = await request('/admin/support-cases/' + supportCase.id, { jar: adminJar, redirect: 'follow' });
    const supportCaseDetailAfterCloseHtml = await supportCaseDetailAfterClose.text();
    assert(supportCaseDetailAfterCloseHtml.includes('Closed support case.'), 'Expected support case activity log to render status changes.');
    logStep('Bulk updating support cases from the admin dashboard');
    const batchSupportCaseOne = await prisma.supportCase.create({
      data: {
        title: updatedPlaybookName + ' queue follow-up A',
        summaryText: 'Bulk queue follow-up A',
        summaryJson: JSON.stringify({ source: 'admin-test', bucket: 'A' }),
        sourcePlaybookName: updatedPlaybookName,
        createdByAdminUserId: admin.id,
      },
    });
    const batchSupportCaseTwo = await prisma.supportCase.create({
      data: {
        title: updatedPlaybookName + ' queue follow-up B',
        summaryText: 'Bulk queue follow-up B',
        summaryJson: JSON.stringify({ source: 'admin-test', bucket: 'B' }),
        sourcePlaybookName: updatedPlaybookName,
        createdByAdminUserId: admin.id,
      },
    });
    const routingInsightsDashboard = await request('/admin?billingSupportStatus=WAITING_ON_PROVIDER', { jar: adminJar, redirect: 'follow' });
    const routingInsightsDashboardHtml = await routingInsightsDashboard.text();
    assert(routingInsightsDashboard.status === 200, 'Expected admin dashboard to load routing insights, received ' + routingInsightsDashboard.status);
    assert(routingInsightsDashboardHtml.includes('Preset routing analytics'), 'Expected support case routing analytics panel to render on the admin dashboard.');
    assert(routingInsightsDashboardHtml.includes('Recent routing exceptions'), 'Expected support case routing exceptions panel to render on the admin dashboard.');
    assert(routingInsightsDashboardHtml.includes('1 routed recently'), 'Expected routing analytics to show a recent preset auto-route.');
    assert(routingInsightsDashboardHtml.includes('Matches preset filters but is still unassigned.'), 'Expected routing exceptions to call out unmatched manual cases that fit a preset.');
    assert(routingInsightsDashboardHtml.includes(updatedPlaybookName + ' queue follow-up A'), 'Expected routing exceptions to include recent unrouted support cases.');
    const bulkSupportCaseResponse = await request('/admin/support-cases/bulk', {
      method: 'POST',
      jar: adminJar,
      form: {
        supportCaseIds: [batchSupportCaseOne.id, batchSupportCaseTwo.id].join(','),
        bulkAssignedAdminUserId: admin.id,
        bulkStatus: 'CLOSED',
        returnTo: '/admin?supportCaseStatus=CLOSED&supportCaseOwner=' + admin.id,
      },
    });
    assert(bulkSupportCaseResponse.status === 302, 'Expected bulk support case update to redirect, received ' + bulkSupportCaseResponse.status);
    const bulkSupportCases = await prisma.supportCase.findMany({
      where: { id: { in: [batchSupportCaseOne.id, batchSupportCaseTwo.id] } },
      orderBy: { createdAt: 'asc' },
    });
    assert(bulkSupportCases.every((entry) => entry.assignedAdminUserId === admin.id), 'Expected bulk support case owner updates to persist.');
    assert(bulkSupportCases.every((entry) => entry.status === 'CLOSED'), 'Expected bulk support case status updates to persist.');
    const bulkSupportCaseActivities = await prisma.supportCaseActivity.findMany({
      where: { supportCaseId: { in: [batchSupportCaseOne.id, batchSupportCaseTwo.id] } },
    });
    assert(bulkSupportCaseActivities.some((entry) => entry.message.includes('bulk queue')), 'Expected bulk support case activity log entries to persist.');
    const bulkSupportCaseDashboard = await request('/admin?supportCaseStatus=CLOSED&supportCaseOwner=' + admin.id, { jar: adminJar, redirect: 'follow' });
    const bulkSupportCaseDashboardHtml = await bulkSupportCaseDashboard.text();
    assert(bulkSupportCaseDashboard.status === 200, 'Expected filtered bulk support case dashboard to load, received ' + bulkSupportCaseDashboard.status);
    assert(bulkSupportCaseDashboardHtml.includes('Bulk update selected cases'), 'Expected support case bulk action controls to render on the admin dashboard.');
    assert(bulkSupportCaseDashboardHtml.includes(updatedPlaybookName + ' queue follow-up A'), 'Expected the first bulk-updated support case to render on the admin dashboard.');
    assert(bulkSupportCaseDashboardHtml.includes(updatedPlaybookName + ' queue follow-up B'), 'Expected the second bulk-updated support case to render on the admin dashboard.');

    logStep('Bulk updating an SLA queue directly from the support case queue card');
    await prisma.$executeRawUnsafe(`UPDATE "SupportCase" SET "status" = 'OPEN', "assignedAdminUserId" = NULL, "updatedAt" = NOW() - interval '80 hours' WHERE id IN ('${batchSupportCaseOne.id}', '${batchSupportCaseTwo.id}')`);
    const queueBulkResponse = await request('/admin/support-cases/bulk', {
      method: 'POST',
      jar: adminJar,
      form: {
        supportCaseIds: [batchSupportCaseOne.id, batchSupportCaseTwo.id].join(','),
        bulkAssignedAdminUserId: admin.id,
        bulkStatus: 'CLOSED',
        returnTo: '/admin?supportCaseQueue=overdue_72h',
      },
    });
    assert(queueBulkResponse.status === 302, 'Expected support case queue quick action to redirect, received ' + queueBulkResponse.status);
    const queueUpdatedSupportCases = await prisma.supportCase.findMany({
      where: { id: { in: [batchSupportCaseOne.id, batchSupportCaseTwo.id] } },
      orderBy: { createdAt: 'asc' },
    });
    assert(queueUpdatedSupportCases.every((entry) => entry.assignedAdminUserId === admin.id), 'Expected queue-level support case owner updates to persist.');
    assert(queueUpdatedSupportCases.every((entry) => entry.status === 'CLOSED'), 'Expected queue-level support case status updates to persist.');
    const queueBulkDashboard = await request('/admin?supportCaseQueue=overdue_72h', { jar: adminJar, redirect: 'follow' });
    const queueBulkDashboardHtml = await queueBulkDashboard.text();
    assert(queueBulkDashboard.status === 200, 'Expected overdue queue dashboard to load after the queue quick action, received ' + queueBulkDashboard.status);
    assert(queueBulkDashboardHtml.includes('No support cases match the current filters.') || queueBulkDashboardHtml.includes('Nothing queued.'), 'Expected the overdue queue filter to reflect that the selected cases moved out of the SLA bucket.');

    const supportCaseNotificationDashboard = await request('/admin', { jar: adminJar, redirect: 'follow' });
    const supportCaseNotificationDashboardHtml = await supportCaseNotificationDashboard.text();
    assert(supportCaseNotificationDashboardHtml.includes('Support case closed') || supportCaseNotificationDashboardHtml.includes('Support case updated') || supportCaseNotificationDashboardHtml.includes('New support case created'), 'Expected admin notifications to include support case updates.');
    const filteredPlaybookSummaryResponse = await request('/admin/billing-playbooks/' + customPlaybook.id + '/history/summary?action=DELETED', { jar: adminJar, redirect: 'follow' });
    const filteredPlaybookSummaryText = await filteredPlaybookSummaryResponse.text();
    assert(filteredPlaybookSummaryText.includes('Filters: Action=DELETED'), 'Expected filtered playbook summary export to reflect the applied action filter.');
    const pagedPlaybookDetailResponse = await request('/admin/billing-playbooks/' + customPlaybook.id + '/history?page=2', { jar: adminJar, redirect: 'follow' });
    const pagedPlaybookDetailHtml = await pagedPlaybookDetailResponse.text();
    assert(pagedPlaybookDetailResponse.status === 200, 'Expected paginated playbook history detail page to load, received ' + pagedPlaybookDetailResponse.status);
    assert(pagedPlaybookDetailHtml.includes('Page 2 of'), 'Expected playbook history detail page to show pagination state.');
    const rangedPlaybookDetailResponse = await request('/admin/billing-playbooks/' + customPlaybook.id + '/history?dateRange=7D&action=ARCHIVED', { jar: adminJar, redirect: 'follow' });
    const rangedPlaybookDetailHtml = await rangedPlaybookDetailResponse.text();
    assert(rangedPlaybookDetailResponse.status === 200, 'Expected date-ranged playbook history detail page to load, received ' + rangedPlaybookDetailResponse.status);
    assert(rangedPlaybookDetailHtml.includes('No playbook activity matches the current filters.'), 'Expected filtered date range and action combination to allow an empty state.');
    const adminDashboardAfterDelete = await request('/admin?billingSupportStatus=WAITING_ON_PROVIDER', { jar: adminJar, redirect: 'follow' });
    const adminDashboardAfterDeleteHtml = await adminDashboardAfterDelete.text();
    assert(adminDashboardAfterDeleteHtml.includes('My personal playbooks'), 'Expected playbook management sections to continue rendering after delete.');
    assert(adminDashboardAfterDeleteHtml.includes('Support case ops'), 'Expected support cases panel to render on the admin dashboard.');
    assert(adminDashboardAfterDeleteHtml.includes(updatedPlaybookName + ' support handoff'), 'Expected created support case to render on the admin dashboard.');
    assert(adminDashboardAfterDeleteHtml.includes('Open case'), 'Expected support case detail link to render on the admin dashboard.');
    assert(adminDashboardAfterDeleteHtml.includes('Owner: ' + admin.name), 'Expected support case owner to render on the admin dashboard.');
    assert(adminDashboardAfterDeleteHtml.includes('Close case') || adminDashboardAfterDeleteHtml.includes('Reopen case'), 'Expected support case status actions to render on the admin dashboard.');
    assert(adminDashboardAfterDeleteHtml.includes('Playbook history'), 'Expected playbook history section to render.');
    assert(adminDashboardAfterDeleteHtml.includes('Recent cleanup activity'), 'Expected playbook history heading to render.');
    assert(adminDashboardAfterDeleteHtml.includes('Deleted'), 'Expected playbook history to render delete actions.');
    assert(adminDashboardAfterDeleteHtml.includes(cleanupReason), 'Expected playbook history to render cleanup notes.');

    logStep('Updating a related billing group directly');
    const groupBatchResponse = await request('/admin/billing-events/bulk-support', {
      method: 'POST',
      jar: adminJar,
      form: {
        eventIds: bulkBillingEvents.map((entry) => entry.id).join(','),
        assignedAdminUserId: admin.id,
        supportStatus: 'NEEDS_FOLLOW_UP',
        returnTo: '/admin?billingSupportStatus=NEEDS_FOLLOW_UP',
      },
    });
    assert(groupBatchResponse.status === 302, 'Expected related-group batch action to redirect, received ' + groupBatchResponse.status);
    const groupUpdatedEvents = await prisma.paymentWebhookEvent.findMany({ where: { id: { in: bulkBillingEvents.map((entry) => entry.id) } } });
    assert(groupUpdatedEvents.every((entry) => entry.supportStatus === 'NEEDS_FOLLOW_UP'), 'Expected related-group batch action to persist the new status.');

    logStep('Selecting a related billing group');
    const selectedGroupDashboard = await request('/admin?selectedBillingGroup=' + encodeURIComponent('mockpay::checkout.session.completed::NEEDS_FOLLOW_UP'), { jar: adminJar, redirect: 'follow' });
    const selectedGroupHtml = await selectedGroupDashboard.text();
    assert(selectedGroupHtml.includes('Group selected:'), 'Expected queue bulk form to show selected group context.');
    assert(selectedGroupHtml.includes('events preselected'), 'Expected queue bulk form to show the number of preselected events.');
    assert((selectedGroupHtml.match(/checked/g) || []).length >= 2, 'Expected selected group to precheck multiple queue events.');

    logStep('Quick-updating billing queue item');
    const quickUpdateResponse = await request('/admin/billing-events/' + billingEvent.id + '/support', {
      method: 'POST',
      jar: adminJar,
      form: {
        assignedAdminUserId: admin.id,
        supportStatus: 'RESOLVED',
        supportNotes: notedEvent.supportNotes,
        returnTo: '/admin?billingSupportStatus=NEEDS_FOLLOW_UP',
      },
    });
    assert(quickUpdateResponse.status === 302, 'Expected quick support update to redirect, received ' + quickUpdateResponse.status);
    assert((quickUpdateResponse.headers.get('location') || '').includes('/admin'), 'Expected quick support update to return to an admin view.');
    const quickUpdatedEvent = await prisma.paymentWebhookEvent.findUnique({ where: { id: billingEvent.id } });
    assert(quickUpdatedEvent.supportStatus === 'RESOLVED', 'Expected quick support update to persist the new status.');

    const resolvedQueueDashboard = await request('/admin?billingSupportStatus=RESOLVED', { jar: adminJar, redirect: 'follow' });
    const resolvedQueueHtml = await resolvedQueueDashboard.text();
    assert(resolvedQueueHtml.includes('Resolved'), 'Expected resolved queue filter results to render.');
    assert(resolvedQueueHtml.includes(title) || resolvedQueueHtml.includes(secondTitle), 'Expected quick-updated event to appear in the resolved queue.');

    logStep('Assigning moderation work, resolving a report, and suspending the handyman');
    await request(`/admin/reports/${reports[0].id}/assign`, {
      method: 'POST',
      jar: adminJar,
      form: { adminUserId: admin.id },
    });
    await request(`/admin/disputes/${dispute.id}/assign`, {
      method: 'POST',
      jar: adminJar,
      form: { adminUserId: admin.id },
    });
    await request(`/admin/reports/${reports[0].id}/resolve`, {
      method: 'POST',
      jar: adminJar,
      form: { resolutionNotes: 'Reviewed and closed in admin test.' },
    });
    await request(`/admin/users/${handyman.id}/toggle-suspension`, {
      method: 'POST',
      jar: adminJar,
    });

    const refreshedHandyman = await prisma.user.findUnique({ where: { id: handyman.id } });
    const resolvedReport = await prisma.moderationReport.findUnique({ where: { id: reports[0].id } });
    const assignedDispute = await prisma.dispute.findUnique({ where: { id: dispute.id } });
    assert(refreshedHandyman.isSuspended === true, 'Expected handyman to be suspended by admin.');
    assert(resolvedReport.status === 'RESOLVED', 'Expected report to be resolved by admin.');
    assert(resolvedReport.assignedAdminUserId === admin.id, 'Expected report assignment to persist.');
    assert(assignedDispute.assignedAdminUserId === admin.id, 'Expected dispute assignment to persist.');

    logStep('Blocked login for suspended user');
    const suspendedLogin = await login('alex@example.com', 'password123');
    assert(suspendedLogin.response.status === 302, `Expected suspended login redirect, received ${suspendedLogin.response.status}`);
    assert((suspendedLogin.response.headers.get('location') || '').includes('/login'), 'Expected suspended user to stay on login.');

    logStep('Resolving dispute as admin');
    await request(`/admin/disputes/${dispute.id}/resolve`, {
      method: 'POST',
      jar: adminJar,
      form: {
        resolution: 'RELEASE_PAYMENT',
        resolutionNotes: 'Admin approved payment after review.',
      },
    });

    const resolvedDispute = await prisma.dispute.findUnique({ where: { id: dispute.id } });
    const resolvedJob = await prisma.job.findUnique({ where: { id: job.id }, include: { payment: true } });
    const auditLogs = await prisma.moderationAuditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const actions = auditLogs.map((entry) => entry.action);
    assert(resolvedDispute.status === 'RESOLVED', 'Expected dispute to be resolved by admin.');
    assert(resolvedJob.payment.status === 'RELEASED', 'Expected payment to be released after admin dispute resolution.');
    assert(actions.includes('ASSIGNED_REPORT'), 'Expected audit log to record report assignment.');
    assert(actions.includes('ASSIGNED_DISPUTE'), 'Expected audit log to record dispute assignment.');
    assert(actions.includes('RESOLVED_REPORT'), 'Expected audit log to record report resolution.');
    assert(actions.includes('SUSPENDED_USER'), 'Expected audit log to record user suspension.');
    assert(actions.includes('RESOLVED_DISPUTE'), 'Expected audit log to record dispute resolution.');

    logStep('Admin test passed');
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();
    if (stderr.trim()) {
      process.stderr.write(`\n[admin] server stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`\n[admin] FAILED: ${error.message}\n`);
  process.exit(1);
});








