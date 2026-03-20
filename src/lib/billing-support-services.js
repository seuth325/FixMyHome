function createBillingSupportServices(deps) {
  const {
    PLAN_CONFIG,
    buildSupportCaseAttachmentHref,
    formatBillingEventType,
    formatBillingSupportStatus,
    formatCurrency,
    getBillingSupportTone,
    prisma,
  } = deps;

  function formatSubscriptionPlan(plan) {
    return PLAN_CONFIG[plan]?.name || String(plan || '').replaceAll('_', ' ');
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

  return {
    buildBillingGroups,
    buildBillingPlaybookExportFilename,
    buildBillingPlaybookHistoryCreatedAtFilter,
    buildBillingPlaybookSummary,
    buildBillingPlaybookSummaryPayload,
    buildBillingQueue,
    buildSupportCaseExportFilename,
    buildSupportCasePackagePayload,
    buildSupportCasePackageText,
    decorateBillingEvent,
    formatSubscriptionPlan,
    getPlanSummary,
    loadCheckoutSessionsByIds,
    normalizeBillingPlaybookHistoryFilters,
    parseBillingEventPayload,
    buildScopedBillingPlaybooks,
  };
}

module.exports = {
  createBillingSupportServices,
};
