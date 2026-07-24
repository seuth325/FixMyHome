import { db } from '@/lib/db';
import { calculateMarketplaceKpis, logOperationsActivity, saveDailyKpis, saveExecutiveBriefing } from '@/lib/operations-intelligence';
import { runHandymanMatchingAgent } from '@/lib/handyman-matching-agent';

type OpsSettings = {
  enabled: boolean;
  timezone: string;
  runHour: number;
  noBidHours: number;
  lowBidHours: number;
  staleJobHours: number;
  awardedStaleHours: number;
  reviewGapHours: number;
  newHandymanGraceDays: number;
  handymanInactiveDays: number;
  lastRunAt: Date | null;
};

type DetectedSignal = {
  signalKey: string;
  type: string;
  priority: 'P1' | 'P2' | 'P3';
  subjectType: 'JOB' | 'HANDYMAN' | 'LOCATION';
  subjectId: string;
  title: string;
  summary: string;
  recommendedAction: string;
  metricValue?: number;
  evidence: Record<string, string | number | boolean | null>;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function hoursSince(value: Date, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / HOUR));
}

function localSlot(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { day: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour) };
}

export function marketplaceOpsRunIsDue(settings: OpsSettings, now = new Date()) {
  if (!settings.enabled) return false;
  const current = localSlot(now, settings.timezone);
  if (current.hour !== settings.runHour) return false;
  if (!settings.lastRunAt) return true;
  return localSlot(settings.lastRunAt, settings.timezone).day !== current.day;
}

export async function getMarketplaceOpsSettings() {
  return db.marketplaceOpsSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });
}

export async function getMarketplaceSnapshot(now = new Date()) {
  const kpis = await calculateMarketplaceKpis(now);
  return kpis;

}

function jobEvidence(job: { id: string; title: string; location: string; category: string; createdAt: Date; status: string; _count: { bids: number; messages: number } }, ageHours: number) {
  return { jobId: job.id, title: job.title, location: job.location, category: job.category, status: job.status, ageHours, bidCount: job._count.bids, messageCount: job._count.messages };
}

export async function runMarketplaceOperations({ trigger, force = false }: { trigger: 'MANUAL' | 'SCHEDULED'; force?: boolean }) {
  const settings = await getMarketplaceOpsSettings();
  if (!settings.enabled && !force) return { skipped: true, reason: 'disabled' } as const;
  if (trigger === 'SCHEDULED' && !force && !marketplaceOpsRunIsDue(settings)) return { skipped: true, reason: 'not_due' } as const;

  const activeRun = await db.marketplaceOpsRun.findFirst({
    where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
    orderBy: { startedAt: 'desc' },
  });
  if (activeRun) return { skipped: true, reason: 'already_running', runId: activeRun.id } as const;

  const run = await db.marketplaceOpsRun.create({ data: { trigger } });
  const now = new Date();
  try {
    const [openJobs, awardedJobs, completedJobs, handymen, snapshot] = await Promise.all([
      db.job.findMany({
        where: { status: { in: ['OPEN', 'IN_REVIEW'] } },
        include: { _count: { select: { bids: true, messages: true } }, homeowner: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      db.job.findMany({
        where: { status: 'AWARDED' },
        include: { _count: { select: { bids: true, messages: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } },
        orderBy: { awardedAt: 'asc' },
      }),
      db.job.findMany({
        where: { status: 'COMPLETED', completedAt: { not: null } },
        include: { _count: { select: { reviews: true, bids: true, messages: true } } },
        orderBy: { completedAt: 'desc' },
        take: 500,
      }),
      db.user.findMany({
        where: { role: 'HANDYMAN', isAvailable: true },
        include: { handymanProfile: true, _count: { select: { bidsSubmitted: true } }, bidsSubmitted: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      getMarketplaceSnapshot(now),
    ]);

    const detected: DetectedSignal[] = [];
    const zeroBidLocations = new Map<string, { label: string; count: number; oldestHours: number }>();

    for (const job of openJobs) {
      const ageHours = hoursSince(job.createdAt, now);
      const evidence = { ...jobEvidence(job, ageHours), homeownerName: job.homeowner.name, homeownerEmail: job.homeowner.email };
      if (job._count.bids === 0 && ageHours >= settings.noBidHours) {
        detected.push({
          signalKey: `OPEN_JOB_NO_BIDS:${job.id}`,
          type: 'OPEN_JOB_NO_BIDS',
          priority: ageHours >= settings.staleJobHours ? 'P1' : 'P2',
          subjectType: 'JOB', subjectId: job.id,
          title: `No bids: ${job.title}`,
          summary: `This ${job.status.toLowerCase().replace('_', ' ')} job has received no bids after ${ageHours} hours.`,
          recommendedAction: 'Review listing quality and service coverage, then invite suitable active handymen. Contact the homeowner only after human approval.',
          metricValue: ageHours, evidence,
        });
        const locationKey = job.location.trim().toLowerCase();
        const location = zeroBidLocations.get(locationKey) ?? { label: job.location.trim(), count: 0, oldestHours: 0 };
        location.count += 1;
        location.oldestHours = Math.max(location.oldestHours, ageHours);
        zeroBidLocations.set(locationKey, location);
      } else if (job._count.bids > 0 && job._count.bids < 3 && ageHours >= settings.lowBidHours) {
        detected.push({
          signalKey: `OPEN_JOB_LOW_BIDS:${job.id}`,
          type: 'OPEN_JOB_LOW_BIDS', priority: 'P2', subjectType: 'JOB', subjectId: job.id,
          title: `Low bid coverage: ${job.title}`,
          summary: `This job has only ${job._count.bids} bid${job._count.bids === 1 ? '' : 's'} after ${ageHours} hours.`,
          recommendedAction: 'Review the available bidder pool and invite additional relevant handymen so the homeowner has a competitive choice.',
          metricValue: job._count.bids, evidence,
        });
      }
      if (ageHours >= settings.staleJobHours) {
        detected.push({
          signalKey: `STALE_OPEN_JOB:${job.id}`,
          type: 'STALE_OPEN_JOB', priority: 'P1', subjectType: 'JOB', subjectId: job.id,
          title: `Stale open job: ${job.title}`,
          summary: `This job remains ${job.status.toLowerCase().replace('_', ' ')} after ${ageHours} hours.`,
          recommendedAction: 'Confirm whether the homeowner still needs service, verify bid quality, and decide whether to refresh or close the listing after review.',
          metricValue: ageHours, evidence,
        });
      }
    }

    for (const [locationKey, location] of zeroBidLocations) {
      if (location.count < 2) continue;
      detected.push({
        signalKey: `LOCATION_COVERAGE_GAP:${locationKey}`,
        type: 'LOCATION_COVERAGE_GAP', priority: location.count >= 3 ? 'P1' : 'P2', subjectType: 'LOCATION', subjectId: location.label,
        title: `Coverage gap: ${location.label}`,
        summary: `${location.count} open jobs in ${location.label} have no bids; the oldest has waited ${location.oldestHours} hours.`,
        recommendedAction: 'Prioritize contractor recruitment and reactivation in this location and review which service categories lack supply.',
        metricValue: location.count,
        evidence: { location: location.label, zeroBidJobCount: location.count, oldestJobHours: location.oldestHours },
      });
    }

    for (const job of awardedJobs) {
      const anchor = job.messages[0]?.createdAt ?? job.awardedAt ?? job.updatedAt;
      const inactiveHours = hoursSince(anchor, now);
      if (inactiveHours < settings.awardedStaleHours) continue;
      detected.push({
        signalKey: `AWARDED_JOB_STALLED:${job.id}`,
        type: 'AWARDED_JOB_STALLED', priority: 'P1', subjectType: 'JOB', subjectId: job.id,
        title: `Awarded job may be stalled: ${job.title}`,
        summary: `No recorded marketplace activity has occurred for ${inactiveHours} hours on this awarded job.`,
        recommendedAction: 'Review the message thread and job status, then ask the parties for an update only after human approval.',
        metricValue: inactiveHours,
        evidence: { ...jobEvidence(job, hoursSince(job.createdAt, now)), inactiveHours, awardedAt: job.awardedAt?.toISOString() ?? null, lastMessageAt: job.messages[0]?.createdAt.toISOString() ?? null },
      });
    }

    for (const job of completedJobs) {
      if (!job.completedAt || job._count.reviews > 0) continue;
      const gapHours = hoursSince(job.completedAt, now);
      if (gapHours < settings.reviewGapHours) continue;
      detected.push({
        signalKey: `COMPLETED_REVIEW_GAP:${job.id}`,
        type: 'COMPLETED_REVIEW_GAP', priority: 'P3', subjectType: 'JOB', subjectId: job.id,
        title: `Review missing: ${job.title}`,
        summary: `This job was completed ${gapHours} hours ago and has no review.`,
        recommendedAction: 'Place this job in the approved review-reminder queue; do not send a reminder automatically in Phase 1.',
        metricValue: gapHours,
        evidence: { jobId: job.id, title: job.title, completedAt: job.completedAt.toISOString(), gapHours },
      });
    }

    for (const handyman of handymen) {
      const accountAgeDays = Math.floor((now.getTime() - handyman.createdAt.getTime()) / DAY);
      const lastBidAt = handyman.bidsSubmitted[0]?.createdAt ?? null;
      const inactiveDays = lastBidAt ? Math.floor((now.getTime() - lastBidAt.getTime()) / DAY) : accountAgeDays;
      if (handyman._count.bidsSubmitted === 0 && accountAgeDays >= settings.newHandymanGraceDays) {
        detected.push({
          signalKey: `HANDYMAN_NOT_ACTIVATED:${handyman.id}`,
          type: 'HANDYMAN_NOT_ACTIVATED', priority: 'P2', subjectType: 'HANDYMAN', subjectId: handyman.id,
          title: `Handyman has not submitted a bid: ${handyman.name}`,
          summary: `${handyman.name} joined ${accountAgeDays} days ago but has not submitted a bid.`,
          recommendedAction: 'Review profile completeness, service coverage, and available matching jobs; prepare onboarding help for approval.',
          metricValue: accountAgeDays,
          evidence: { handymanId: handyman.id, name: handyman.name, email: handyman.email, location: handyman.location, accountAgeDays, hasProfile: Boolean(handyman.handymanProfile), verificationStatus: handyman.handymanProfile?.verificationStatus ?? null },
        });
      } else if (lastBidAt && inactiveDays >= settings.handymanInactiveDays) {
        detected.push({
          signalKey: `HANDYMAN_INACTIVE:${handyman.id}`,
          type: 'HANDYMAN_INACTIVE', priority: 'P2', subjectType: 'HANDYMAN', subjectId: handyman.id,
          title: `Inactive handyman: ${handyman.name}`,
          summary: `${handyman.name} has not submitted a bid for ${inactiveDays} days.`,
          recommendedAction: 'Review matching demand and account quality, then prepare a targeted reactivation message for approval.',
          metricValue: inactiveDays,
          evidence: { handymanId: handyman.id, name: handyman.name, email: handyman.email, location: handyman.location, inactiveDays, lastBidAt: lastBidAt.toISOString(), bidCount: handyman._count.bidsSubmitted },
        });
      }
    }

    const keys = detected.map((item) => item.signalKey);
    const existing = keys.length ? await db.marketplaceOpsSignal.findMany({ where: { signalKey: { in: keys } }, select: { signalKey: true, status: true } }) : [];
    const existingByKey = new Map(existing.map((item) => [item.signalKey, item]));
    let created = 0;
    let refreshed = 0;

    for (const signal of detected) {
      const previous = existingByKey.get(signal.signalKey);
      const status = previous?.status === 'RESOLVED' ? 'OPEN' : previous?.status;
      await db.marketplaceOpsSignal.upsert({
        where: { signalKey: signal.signalKey },
        create: { ...signal, latestRunId: run.id, detectedAt: now, lastSeenAt: now },
        update: { ...signal, latestRunId: run.id, lastSeenAt: now, ...(status ? { status } : {}), resolvedAt: status === 'OPEN' ? null : undefined },
      });
      if (previous) refreshed += 1; else created += 1;
    }

    const resolved = await db.marketplaceOpsSignal.updateMany({
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, ...(keys.length ? { signalKey: { notIn: keys } } : {}) },
      data: { status: 'RESOLVED', resolvedAt: now },
    });

    await db.$transaction([
      db.marketplaceOpsRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', detected: detected.length, created, refreshed, autoResolved: resolved.count, snapshot, finishedAt: new Date() } }),
      db.marketplaceOpsSettings.update({ where: { id: settings.id }, data: { lastRunAt: new Date() } }),
    ]);
    await Promise.all([
      saveDailyKpis(snapshot, run.id, now),
      saveExecutiveBriefing({ kpis: snapshot, runId: run.id, createdSignals: created, resolvedSignals: resolved.count, now }),
      logOperationsActivity({
        eventType: 'MARKETPLACE_SCAN_COMPLETED',
        summary: `Marketplace scan completed with ${detected.length} detected signals.`,
        entityType: 'MARKETPLACE',
        entityId: 'default',
        details: { detected: detected.length, created, refreshed, autoResolved: resolved.count, trigger, snapshot },
        runId: run.id,
      }),
    ]);
    const newNoBidSignals = detected.filter((signal) =>
      signal.type === 'OPEN_JOB_NO_BIDS' && !existingByKey.has(signal.signalKey),
    );
    if (newNoBidSignals.length) {
      await db.operationsActivity.createMany({
        data: newNoBidSignals.map((signal) => ({
          eventType: 'NO_BID_ALERT_CREATED',
          summary: signal.title,
          entityType: signal.subjectType,
          entityId: signal.subjectId,
          details: signal.evidence,
          runId: run.id,
        })),
      });
    }
    const matching = await runHandymanMatchingAgent({ trigger });
    return { skipped: false, runId: run.id, status: 'COMPLETED', detected: detected.length, created, refreshed, autoResolved: resolved.count, snapshot, matching } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown marketplace operations error';
    await db.marketplaceOpsRun.update({ where: { id: run.id }, data: { status: 'FAILED', errorMessage: message.slice(0, 5000), finishedAt: new Date() } });
    throw error;
  }
}