import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

const DAY = 24 * 60 * 60 * 1000;

export type MarketplaceKpis = {
  openJobs: number;
  jobsCreated30d: number;
  jobsAwarded30d: number;
  jobsCompleted30d: number;
  jobsCancelled30d: number;
  bids30d: number;
  openJobsWithoutBids: number;
  noBidRate: number;
  averageBidsPerOpenJob: number;
  activeHandymen: number;
  homeowners30d: number;
  handymen30d: number;
  awardRate30d: number;
  completionRate30d: number;
};

export function utcDay(value = new Date()) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

export async function calculateMarketplaceKpis(now = new Date()): Promise<MarketplaceKpis> {
  const since30Days = new Date(now.getTime() - 30 * DAY);
  const [
    openJobs,
    jobsCreated30d,
    jobsAwarded30d,
    jobsCompleted30d,
    jobsCancelled30d,
    bids30d,
    openJobsWithoutBids,
    openBidAggregate,
    activeHandymen,
    homeowners30d,
    handymen30d,
  ] = await Promise.all([
    db.job.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
    db.job.count({ where: { createdAt: { gte: since30Days } } }),
    db.job.count({ where: { awardedAt: { gte: since30Days } } }),
    db.job.count({ where: { completedAt: { gte: since30Days } } }),
    db.job.count({ where: { status: 'CANCELLED', updatedAt: { gte: since30Days } } }),
    db.bid.count({ where: { createdAt: { gte: since30Days } } }),
    db.job.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] }, bids: { none: {} } } }),
    db.bid.groupBy({
      by: ['jobId'],
      where: { job: { status: { in: ['OPEN', 'IN_REVIEW'] } } },
      _count: { _all: true },
    }),
    db.user.count({ where: { role: 'HANDYMAN', isAvailable: true } }),
    db.user.count({ where: { role: 'HOMEOWNER', createdAt: { gte: since30Days } } }),
    db.user.count({ where: { role: 'HANDYMAN', createdAt: { gte: since30Days } } }),
  ]);

  const openBidTotal = openBidAggregate.reduce((sum, item) => sum + item._count._all, 0);
  return {
    openJobs,
    jobsCreated30d,
    jobsAwarded30d,
    jobsCompleted30d,
    jobsCancelled30d,
    bids30d,
    openJobsWithoutBids,
    noBidRate: rate(openJobsWithoutBids, openJobs),
    averageBidsPerOpenJob: openJobs ? Number((openBidTotal / openJobs).toFixed(1)) : 0,
    activeHandymen,
    homeowners30d,
    handymen30d,
    awardRate30d: rate(jobsAwarded30d, jobsCreated30d),
    completionRate30d: rate(jobsCompleted30d, jobsAwarded30d),
  };
}

export async function logOperationsActivity(input: {
  eventType: string;
  summary: string;
  actorType?: string;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  details?: Prisma.InputJsonValue;
  runId?: string | null;
}) {
  return db.operationsActivity.create({
    data: {
      eventType: input.eventType,
      summary: input.summary,
      actorType: input.actorType ?? 'SYSTEM',
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      details: input.details,
      runId: input.runId,
    },
  });
}

export async function saveDailyKpis(kpis: MarketplaceKpis, runId: string, now = new Date()) {
  return db.marketplaceKpiSnapshot.upsert({
    where: { snapshotDate: utcDay(now) },
    create: { snapshotDate: utcDay(now), ...kpis, runId },
    update: { ...kpis, runId },
  });
}

export async function saveExecutiveBriefing({
  kpis,
  runId,
  createdSignals,
  resolvedSignals,
  now = new Date(),
}: {
  kpis: MarketplaceKpis;
  runId: string;
  createdSignals: number;
  resolvedSignals: number;
  now?: Date;
}) {
  const active = await db.marketplaceOpsSignal.findMany({
    where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    orderBy: [{ priority: 'asc' }, { lastSeenAt: 'desc' }],
    take: 20,
    select: { priority: true, title: true, summary: true, recommendedAction: true, type: true },
  });
  const criticalCount = active.filter((signal) => signal.priority === 'P1').length;
  const wins = [
    `${kpis.jobsCompleted30d} projects completed in the last 30 days`,
    `${kpis.jobsAwarded30d} projects awarded in the last 30 days`,
    `${resolvedSignals} operational alert${resolvedSignals === 1 ? '' : 's'} cleared in this run`,
  ];
  const risks = active.slice(0, 5).map((signal) => `${signal.priority}: ${signal.title} — ${signal.summary}`);
  if (risks.length === 0) risks.push('No active marketplace risks detected.');
  const actions = [...new Set(active.slice(0, 5).map((signal) => signal.recommendedAction))];
  if (actions.length === 0) actions.push('Continue monitoring marketplace supply, demand, and project completion.');
  const headline = criticalCount
    ? `${criticalCount} critical marketplace issue${criticalCount === 1 ? '' : 's'} need attention`
    : kpis.openJobsWithoutBids
      ? `${kpis.openJobsWithoutBids} open project${kpis.openJobsWithoutBids === 1 ? '' : 's'} currently have no bids`
      : 'Marketplace operations are stable';
  const summary = `${kpis.openJobs} projects are open, with ${kpis.averageBidsPerOpenJob} bids per open project on average. The 30-day award rate is ${kpis.awardRate30d}% and completion rate is ${kpis.completionRate30d}%. This run created ${createdSignals} and resolved ${resolvedSignals} alerts.`;
  const data = {
    headline,
    summary,
    wins,
    risks,
    recommendedActions: actions,
    kpis,
    openAlertCount: active.length,
    criticalCount,
    runId,
  };

  return db.executiveBriefing.upsert({
    where: { briefingDate: utcDay(now) },
    create: { briefingDate: utcDay(now), ...data },
    update: data,
  });
}
