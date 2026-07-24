import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { logOperationsActivity, utcDay } from '@/lib/operations-intelligence';

type Trigger = 'MANUAL' | 'SCHEDULED';
type Opportunity = { opportunityKey: string; type: string; priority: 'P1' | 'P2' | 'P3'; subjectType: string; subjectId: string | null; title: string; summary: string; estimatedValue?: number; evidence: Prisma.InputJsonValue; recommendedAction: string; draftPlan?: string };
const DAY = 86_400_000;
const money = (value: number) => Number(value.toFixed(2));
export async function getRevenueOpsSettings() { return db.revenueOpsSettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } }); }

export async function runRevenueOperationsAgent({ trigger }: { trigger: Trigger }) {
  const active = await db.revenueOpsRun.findFirst({ where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } } });
  if (active) return { skipped: true, reason: 'already_running', runId: active.id } as const;
  const settings = await getRevenueOpsSettings();
  if (!settings.enabled && trigger === 'SCHEDULED') return { skipped: true, reason: 'disabled' } as const;
  const run = await db.revenueOpsRun.create({ data: { trigger } });
  try {
    const now = new Date(), since30d = new Date(now.getTime() - 30 * DAY), stalledBefore = new Date(now.getTime() - settings.stalledAwardDays * DAY), staleLeadBefore = new Date(now.getTime() - settings.staleLeadHours * 60 * 60 * 1000);
    const [jobs, growthLeads, recentJobs] = await Promise.all([
      db.job.findMany({ where: { status: { in: ['OPEN', 'IN_REVIEW', 'AWARDED', 'COMPLETED'] } }, include: { bids: { where: { status: 'ACCEPTED' }, select: { id: true, amount: true, handymanId: true }, take: 1 } }, orderBy: { createdAt: 'desc' }, take: 10000 }),
      db.contactSubmission.findMany({ where: { reason: 'Handyman Growth Package', createdAt: { gte: since30d } }, orderBy: { createdAt: 'desc' }, take: 2000 }),
      db.job.findMany({ where: { OR: [{ createdAt: { gte: since30d } }, { awardedAt: { gte: since30d } }, { completedAt: { gte: since30d } }] }, select: { id: true, status: true, campaignSource: true, awardedAt: true, completedAt: true, bids: { where: { status: 'ACCEPTED' }, select: { amount: true }, take: 1 } }, take: 10000 }),
    ]);
    const opportunities: Opportunity[] = [];
    for (const lead of growthLeads) if (lead.status === 'NEW' && lead.createdAt <= staleLeadBefore) opportunities.push({
      opportunityKey: `STALE_GROWTH_LEAD:${lead.id}`, type: 'STALE_GROWTH_PACKAGE_LEAD', priority: 'P1', subjectType: 'CONTACT_SUBMISSION', subjectId: lead.id, title: `Growth Package lead awaiting follow-up: ${lead.name}`, summary: `A $${Number(settings.growthPackagePrice).toFixed(0)} Growth Package inquiry has remained new for more than ${settings.staleLeadHours} hours.`, estimatedValue: Number(settings.growthPackagePrice), evidence: { submissionId: lead.id, email: lead.email, createdAt: lead.createdAt.toISOString(), status: lead.status }, recommendedAction: 'Review the inquiry and prepare a discovery-call follow-up. This agent does not send it or record a sale.', draftPlan: `Review ${lead.name}'s goals, confirm service area and scope, then schedule a discovery call for the Handyman Growth Package.` });
    for (const job of jobs) {
      const accepted = job.bids[0], value = accepted ? Number(accepted.amount) : Number(job.budget);
      if (['OPEN', 'IN_REVIEW'].includes(job.status) && Number(job.budget) >= Number(settings.highValueJobThreshold) && job.bids.length === 0) opportunities.push({
        opportunityKey: `HIGH_VALUE_UNAWARDED:${job.id}`, type: 'HIGH_VALUE_PROJECT_AT_RISK', priority: 'P2', subjectType: 'JOB', subjectId: job.id, title: `High-value project has not converted: ${job.title}`, summary: `The $${Number(job.budget).toFixed(0)} project is still ${job.status.toLowerCase().replaceAll('_', ' ')} with no accepted bid.`, estimatedValue: Number(job.budget), evidence: { jobId: job.id, budget: Number(job.budget), status: job.status, category: job.category, location: job.location, createdAt: job.createdAt.toISOString() }, recommendedAction: 'Review bid supply, matching quality, and homeowner engagement. Coordinate matching or support follow-up without promising a transaction.', draftPlan: 'Review current bids and matching candidates, identify the conversion blocker, and assign a manual next step.' });
      if (job.status === 'AWARDED' && job.awardedAt && job.awardedAt <= stalledBefore) opportunities.push({
        opportunityKey: `STALLED_AWARDED_VALUE:${job.id}`, type: 'STALLED_AWARDED_VALUE', priority: 'P2', subjectType: 'JOB', subjectId: job.id, title: `Awarded marketplace value is stalled: ${job.title}`, summary: `An estimated $${value.toFixed(0)} of marketplace value has remained awarded for at least ${settings.stalledAwardDays} days without completion.`, estimatedValue: value, evidence: { jobId: job.id, acceptedBidId: accepted?.id ?? null, acceptedBidAmount: accepted ? Number(accepted.amount) : null, awardedAt: job.awardedAt.toISOString() }, recommendedAction: 'Review project communication and status. Prepare support outreach only if needed; do not infer payment or revenue.', draftPlan: 'Check whether work started, whether the status is stale, and whether either party needs support.' });
    }
    const unattributed = recentJobs.filter((job) => !job.campaignSource);
    if (recentJobs.length && unattributed.length / recentJobs.length >= 0.25) opportunities.push({ opportunityKey: `ATTRIBUTION_GAP:${utcDay(now).toISOString()}`, type: 'ATTRIBUTION_COVERAGE_GAP', priority: 'P2', subjectType: 'MARKETPLACE', subjectId: 'default', title: 'Marketplace attribution coverage needs attention', summary: `${unattributed.length} of ${recentJobs.length} projects created in the last 30 days have no campaign source.`, evidence: { totalJobs30d: recentJobs.length, unattributedJobs30d: unattributed.length, coverage: money((recentJobs.length - unattributed.length) / recentJobs.length * 100) }, recommendedAction: 'Audit campaign event-to-job attribution and preserve organic as an explicit source rather than leaving it blank.', draftPlan: 'Review acquisition parameters, signup persistence, and job-creation attribution for the largest missing-source segment.' });

    const acceptedValue = (status: 'AWARDED' | 'COMPLETED') => recentJobs.filter((job) => status === 'AWARDED' ? Boolean(job.awardedAt && job.awardedAt >= since30d) : Boolean(job.completedAt && job.completedAt >= since30d)).reduce((sum, job) => sum + Number(job.bids[0]?.amount ?? 0), 0);
    const awardedMarketplaceValue30d = acceptedValue('AWARDED'), completedMarketplaceValue30d = acceptedValue('COMPLETED');
    const attributionCoverage30d = recentJobs.length ? money((recentJobs.length - unattributed.length) / recentJobs.length * 100) : 0;
    const snapshot = { awardedMarketplaceValue30d: money(awardedMarketplaceValue30d), completedMarketplaceValue30d: money(completedMarketplaceValue30d), projectedFeeScenario30d: money(completedMarketplaceValue30d * settings.projectedFeeRate / 100), growthPackageLeads30d: growthLeads.length, growthPackagePipelineValue: money(growthLeads.length * Number(settings.growthPackagePrice)), attributionCoverage30d, openOpportunityCount: opportunities.length };
    const existing = opportunities.length ? await db.revenueOpportunity.findMany({ where: { opportunityKey: { in: opportunities.map((item) => item.opportunityKey) } }, select: { id: true, opportunityKey: true } }) : [];
    const byKey = new Map(existing.map((item) => [item.opportunityKey, item])); let created = 0, updated = 0;
    for (const item of opportunities) { const prior = byKey.get(item.opportunityKey); if (prior) { await db.revenueOpportunity.update({ where: { id: prior.id }, data: { ...item, latestRunId: run.id, lastDetectedAt: now } }); updated += 1; } else { await db.revenueOpportunity.create({ data: { ...item, latestRunId: run.id } }); created += 1; } }
    const keys = opportunities.map((item) => item.opportunityKey); await db.revenueOpportunity.updateMany({ where: { status: { in: ['OPEN', 'REVIEWING'] }, ...(keys.length ? { opportunityKey: { notIn: keys } } : {}) }, data: { status: 'RESOLVED', resolvedAt: now } });
    await db.revenueDailySnapshot.upsert({ where: { snapshotDate: utcDay(now) }, create: { snapshotDate: utcDay(now), ...snapshot }, update: snapshot });
    const recordsScanned = jobs.length + growthLeads.length + recentJobs.length;
    await db.$transaction([db.revenueOpsRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', recordsScanned, opportunitiesDetected: opportunities.length, opportunitiesCreated: created, opportunitiesUpdated: updated, snapshot, finishedAt: new Date() } }), db.revenueOpsSettings.update({ where: { id: settings.id }, data: { lastRunAt: new Date() } })]);
    await logOperationsActivity({ eventType: 'REVENUE_OPERATIONS_SCAN_COMPLETED', summary: `Revenue Operations analyzed ${recordsScanned} records and prepared ${opportunities.length} opportunities.`, entityType: 'REVENUE_OPS_RUN', entityId: run.id, details: { trigger, created, updated, snapshot, actualPaymentRevenueTracked: false } });
    return { skipped: false, runId: run.id, recordsScanned, opportunities: opportunities.length, created, updated, snapshot } as const;
  } catch (error) { const message = error instanceof Error ? error.message : 'Unknown Revenue Operations error'; await db.revenueOpsRun.update({ where: { id: run.id }, data: { status: 'FAILED', errorMessage: message.slice(0, 5000), finishedAt: new Date() } }); throw error; }
}