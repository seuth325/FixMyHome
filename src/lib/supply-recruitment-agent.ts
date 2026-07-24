import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { logOperationsActivity } from '@/lib/operations-intelligence';

type Trigger = 'MANUAL' | 'SCHEDULED';

function terms(value: string | null | undefined) {
  return (value ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((item) => item.length > 2);
}

function weekStart(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date;
}

function code(gapId: string, leadId: string) {
  return `supply-${createHash('sha256').update(`${gapId}:${leadId}`).digest('hex').slice(0, 12)}`;
}

export async function runSupplyRecruitmentAgent({ trigger }: { trigger: Trigger }) {
  const active = await db.supplyRecruitmentRun.findFirst({ where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } } });
  if (active) return { skipped: true, reason: 'already_running', runId: active.id } as const;
  const run = await db.supplyRecruitmentRun.create({ data: { trigger } });
  try {
    const [jobs, handymen, leads] = await Promise.all([
      db.job.findMany({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } }, include: { _count: { select: { bids: true } } }, take: 500 }),
      db.user.findMany({ where: { role: 'HANDYMAN', isAvailable: true, handymanProfile: { isNot: null } }, include: { handymanProfile: true }, take: 1000 }),
      db.handymanLead.findMany({ where: { status: { in: ['PROSPECT', 'INTERESTED'] } }, orderBy: { createdAt: 'asc' }, take: 2000 }),
    ]);
    const groups = new Map<string, { location: string; category: string; openJobs: number; noBidJobs: number }>();
    for (const job of jobs) {
      const key = `${job.location.trim().toLowerCase()}:${job.category.trim().toLowerCase()}`;
      const group = groups.get(key) ?? { location: job.location.trim(), category: job.category.trim(), openJobs: 0, noBidJobs: 0 };
      group.openJobs += 1;
      if (job._count.bids === 0) group.noBidJobs += 1;
      groups.set(key, group);
    }
    let candidatesCreated = 0;
    let candidatesUpdated = 0;
    let leadsEvaluated = 0;
    const activeGapKeys: string[] = [];
    for (const [gapKey, demand] of groups) {
      const qualifiedPros = handymen.filter((handyman) => {
        const skills = Array.isArray(handyman.handymanProfile?.skills) ? handyman.handymanProfile.skills : [];
        return handyman.location === demand.location && skills.some((skill) => typeof skill === 'string' && [demand.category.toLowerCase(), 'general handyman'].includes(skill.toLowerCase()));
      }).length;
      const gapScore = Math.min(100, demand.noBidJobs * 40 + demand.openJobs * 15 - qualifiedPros * 20);
      if (gapScore < 25) continue;
      activeGapKeys.push(gapKey);
      const priority = gapScore >= 70 ? 'P1' : gapScore >= 45 ? 'P2' : 'P3';
      const gap = await db.handymanSupplyGap.upsert({
        where: { gapKey },
        create: { gapKey, ...demand, qualifiedPros, gapScore, priority, evidence: { ...demand, qualifiedPros, gapScore } },
        update: { ...demand, qualifiedPros, gapScore, priority, status: 'OPEN', resolvedAt: null, lastSeenAt: new Date(), evidence: { ...demand, qualifiedPros, gapScore } },
      });
      const categoryTerms = new Set(terms(demand.category));
      const ranked = leads.map((lead) => {
        const sameLocation = lead.location?.trim() === demand.location;
        const leadTerms = new Set(terms(`${lead.services ?? ''} ${lead.businessName}`));
        const serviceMatches = [...categoryTerms].filter((term) => leadTerms.has(term)).length;
        const serviceScore = serviceMatches ? Math.min(50, 30 + serviceMatches * 10) : 0;
        const locationScore = sameLocation ? 35 : lead.location ? 5 : 0;
        const qualityScore = Math.min(15, (lead.email ? 5 : 0) + (lead.phone ? 4 : 0) + (lead.website ? 3 : 0) + (lead.sourceRating ? 3 : 0));
        const score = serviceScore + locationScore + qualityScore;
        const reasons = [sameLocation ? `Located in ${demand.location}` : null, serviceMatches ? `Services align with ${demand.category}` : null, lead.sourceRating ? `Source rating ${Number(lead.sourceRating).toFixed(1)}` : null, lead.email ? 'Email available' : null].filter((item): item is string => Boolean(item));
        return { lead, score, locationScore, serviceScore, qualityScore, reasons };
      }).filter((item) => item.score >= 40).sort((a, b) => b.score - a.score).slice(0, 15);
      leadsEvaluated += leads.length;
      for (const item of ranked) {
        const existing = await db.recruitmentCandidate.findUnique({ where: { gapId_leadId: { gapId: gap.id, leadId: item.lead.id } } });
        const draftSubject = `${demand.category} opportunities near ${demand.location}`;
        const draftBody = `Hi ${item.lead.businessName}, FixMyHome.pro is seeing homeowner demand for ${demand.category} services in ${demand.location}. Your business may be a good fit. You can create a free handyman profile, review local projects, and decide which opportunities to bid on.`;
        const data = { score: item.score, locationScore: item.locationScore, serviceScore: item.serviceScore, qualityScore: item.qualityScore, reasons: item.reasons, draftSubject, draftBody, lastEvaluatedAt: new Date() };
        if (existing) {
          if (!['APPROVED', 'DISMISSED', 'CONVERTED'].includes(existing.status)) await db.recruitmentCandidate.update({ where: { id: existing.id }, data });
          candidatesUpdated += 1;
        } else {
          await db.recruitmentCandidate.create({ data: { gapId: gap.id, leadId: item.lead.id, recruitmentCode: code(gap.id, item.lead.id), ...data } });
          candidatesCreated += 1;
        }
      }
    }
    await db.handymanSupplyGap.updateMany({ where: { status: 'OPEN', ...(activeGapKeys.length ? { gapKey: { notIn: activeGapKeys } } : {}) }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    const pendingConversions = await db.recruitmentCandidate.findMany({ where: { status: 'APPROVED', convertedAt: null }, select: { id: true, recruitmentCode: true } });
    for (const candidate of pendingConversions) {
      const user = await db.user.findFirst({ where: { role: 'HANDYMAN', referralCode: candidate.recruitmentCode }, select: { id: true } });
      if (user) await db.recruitmentCandidate.update({ where: { id: candidate.id }, data: { status: 'CONVERTED', convertedUserId: user.id, convertedAt: new Date() } });
    }
    const [openGaps, candidateCount, approvedCount, convertedCount] = await Promise.all([
      db.handymanSupplyGap.findMany({ where: { status: 'OPEN' }, orderBy: { gapScore: 'desc' } }),
      db.recruitmentCandidate.count({ where: { status: 'PENDING_REVIEW' } }),
      db.recruitmentCandidate.count({ where: { status: 'APPROVED' } }),
      db.recruitmentCandidate.count({ where: { status: 'CONVERTED' } }),
    ]);
    await db.supplyWeeklyReport.upsert({
      where: { weekStart: weekStart() },
      create: { weekStart: weekStart(), headline: openGaps.length ? `${openGaps.length} handyman supply gaps need attention` : 'Handyman supply coverage is stable', summary: `${candidateCount} prospects await review; ${approvedCount} are approved and ${convertedCount} have converted.`, openGapCount: openGaps.length, criticalGapCount: openGaps.filter((gap) => gap.priority === 'P1').length, candidateCount, approvedCount, convertedCount, topGaps: openGaps.slice(0, 10), recommendedActions: openGaps.slice(0, 5).map((gap) => `Recruit ${gap.category} professionals in ${gap.location}.`) },
      update: { headline: openGaps.length ? `${openGaps.length} handyman supply gaps need attention` : 'Handyman supply coverage is stable', summary: `${candidateCount} prospects await review; ${approvedCount} are approved and ${convertedCount} have converted.`, openGapCount: openGaps.length, criticalGapCount: openGaps.filter((gap) => gap.priority === 'P1').length, candidateCount, approvedCount, convertedCount, topGaps: openGaps.slice(0, 10), recommendedActions: openGaps.slice(0, 5).map((gap) => `Recruit ${gap.category} professionals in ${gap.location}.`) },
    });
    await db.supplyRecruitmentRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', gapsDetected: openGaps.length, leadsEvaluated, candidatesCreated, candidatesUpdated, finishedAt: new Date() } });
    await logOperationsActivity({ eventType: 'SUPPLY_RECRUITMENT_COMPLETED', summary: `Supply analysis found ${openGaps.length} coverage gaps and created ${candidatesCreated} recruitment candidates.`, entityType: 'RECRUITMENT_RUN', entityId: run.id, details: { trigger, gaps: openGaps.length, leadsEvaluated, candidatesCreated, candidatesUpdated } });
    return { skipped: false, runId: run.id, gapsDetected: openGaps.length, leadsEvaluated, candidatesCreated, candidatesUpdated } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown recruitment error';
    await db.supplyRecruitmentRun.update({ where: { id: run.id }, data: { status: 'FAILED', errorMessage: message.slice(0, 5000), finishedAt: new Date() } });
    throw error;
  }
}
