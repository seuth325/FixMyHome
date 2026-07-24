import { db } from '@/lib/db';
import { logOperationsActivity } from '@/lib/operations-intelligence';

type Trigger = 'MANUAL' | 'SCHEDULED';
const DAY = 24 * 60 * 60 * 1000;

function utcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function completeness(user: {
  location: string | null; phone: string | null; emailVerifiedAt: Date | null;
  handymanProfile: { businessName: string | null; website: string | null; isInsured: boolean; verificationStatus: string; skills: unknown; bio: string | null; serviceRadius: number } | null;
}) {
  const profile = user.handymanProfile;
  if (!profile) return 0;
  const skillCount = Array.isArray(profile.skills) ? profile.skills.length : 0;
  return (user.location ? 15 : 0) + (user.phone ? 10 : 0) + (user.emailVerifiedAt ? 10 : 0) +
    (profile.businessName ? 15 : 0) + (profile.bio ? 15 : 0) + (skillCount ? 20 : 0) +
    (profile.serviceRadius ? 5 : 0) + (profile.website ? 5 : 0) + (profile.isInsured ? 3 : 0) +
    (profile.verificationStatus === 'VERIFIED' ? 2 : 0);
}

export async function runActivationAgent({ trigger }: { trigger: Trigger }) {
  const active = await db.activationAgentRun.findFirst({ where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } } });
  if (active) return { skipped: true, reason: 'already_running', runId: active.id } as const;
  const run = await db.activationAgentRun.create({ data: { trigger } });
  try {
    const users = await db.user.findMany({
      where: { role: 'HANDYMAN' },
      include: {
        handymanProfile: true,
        bidsSubmitted: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, createdAt: true }, take: 500 },
      },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    let created = 0;
    let updated = 0;
    let stalledCount = 0;
    const stageCounts = { SIGNED_UP: 0, PROFILE_STARTED: 0, PROFILE_COMPLETE: 0, FIRST_BID: 0, FIRST_WIN: 0 };
    const campaignCounts = new Map<string, { total: number; complete: number; bid: number; win: number }>();
    for (const user of users) {
      const score = completeness(user);
      const firstBid = user.bidsSubmitted[0]?.createdAt ?? null;
      const firstWin = user.bidsSubmitted.find((bid) => bid.status === 'ACCEPTED')?.createdAt ?? null;
      const stage = firstWin ? 'FIRST_WIN' : firstBid ? 'FIRST_BID' : score >= 80 ? 'PROFILE_COMPLETE' : user.handymanProfile ? 'PROFILE_STARTED' : 'SIGNED_UP';
      stageCounts[stage as keyof typeof stageCounts] += 1;
      const anchor = firstWin ?? firstBid ?? user.handymanProfile?.updatedAt ?? user.createdAt;
      const stalledDays = Math.floor((Date.now() - anchor.getTime()) / DAY);
      const threshold = stage === 'SIGNED_UP' ? 3 : stage === 'PROFILE_STARTED' ? 5 : stage === 'PROFILE_COMPLETE' ? 7 : stage === 'FIRST_BID' ? 14 : 99999;
      const stalled = stalledDays >= threshold;
      if (stalled) stalledCount += 1;
      const next = stage === 'SIGNED_UP' ? 'Complete the handyman business profile.' : stage === 'PROFILE_STARTED' ? `Finish the remaining profile fields (${score}% complete).` : stage === 'PROFILE_COMPLETE' ? 'Review matching local projects and submit a first bid.' : stage === 'FIRST_BID' ? 'Review bid quality and recommend relevant open projects.' : 'Retain this active handyman with relevant project opportunities.';
      const subject = stage === 'SIGNED_UP' || stage === 'PROFILE_STARTED' ? 'Complete your FixMyHome handyman profile' : stage === 'PROFILE_COMPLETE' ? 'Local projects are ready for your bid' : 'More local project opportunities on FixMyHome';
      const body = `Hi ${user.name}, your FixMyHome progress is currently at ${stage.toLowerCase().replaceAll('_', ' ')}. Recommended next step: ${next} Sign in to continue when it fits your schedule.`;
      const existing = await db.handymanActivationJourney.findUnique({ where: { userId: user.id }, select: { id: true, stage: true, status: true } });
      const data = {
        stage, previousStage: existing?.stage !== stage ? existing?.stage : undefined,
        status: stalled && existing?.status !== 'APPROVED' ? 'NEEDS_REVIEW' : existing?.status ?? 'MONITORING',
        profileCompleteness: score, stalled, stalledDays, campaignSource: user.campaignSource, referralCode: user.referralCode,
        nextAction: next, draftSubject: subject, draftBody: body, signedUpAt: user.createdAt,
        profileStartedAt: user.handymanProfile?.createdAt, profileCompletedAt: score >= 80 ? user.handymanProfile?.updatedAt : null,
        firstBidAt: firstBid, firstWinAt: firstWin, lastActivityAt: anchor, lastAnalyzedAt: new Date(),
      };
      if (existing) { await db.handymanActivationJourney.update({ where: { id: existing.id }, data }); updated += 1; }
      else { await db.handymanActivationJourney.create({ data: { userId: user.id, ...data } }); created += 1; }
      const campaign = user.campaignSource || (user.referralCode?.startsWith('supply-') ? 'supply-recruitment' : 'organic');
      const metrics = campaignCounts.get(campaign) ?? { total: 0, complete: 0, bid: 0, win: 0 };
      metrics.total += 1; if (score >= 80) metrics.complete += 1; if (firstBid) metrics.bid += 1; if (firstWin) metrics.win += 1;
      campaignCounts.set(campaign, metrics);
    }
    const total = users.length;
    const campaigns = [...campaignCounts.entries()].map(([campaign, metrics]) => ({ campaign, ...metrics, activationRate: metrics.total ? Number((metrics.bid / metrics.total * 100).toFixed(1)) : 0 }));
    const snapshot = {
      totalHandymen: total, signedUpOnly: stageCounts.SIGNED_UP, profileStarted: stageCounts.PROFILE_STARTED,
      profileComplete: stageCounts.PROFILE_COMPLETE, firstBid: stageCounts.FIRST_BID, firstWin: stageCounts.FIRST_WIN,
      stalled: stalledCount, profileCompletionRate: total ? Number(((stageCounts.PROFILE_COMPLETE + stageCounts.FIRST_BID + stageCounts.FIRST_WIN) / total * 100).toFixed(1)) : 0,
      firstBidRate: total ? Number(((stageCounts.FIRST_BID + stageCounts.FIRST_WIN) / total * 100).toFixed(1)) : 0,
      firstWinRate: total ? Number((stageCounts.FIRST_WIN / total * 100).toFixed(1)) : 0, campaigns,
    };
    await db.activationDailySnapshot.upsert({ where: { snapshotDate: utcDay() }, create: { snapshotDate: utcDay(), ...snapshot }, update: snapshot });
    await db.activationAgentRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', usersAnalyzed: total, journeysCreated: created, journeysUpdated: updated, stalledCount, finishedAt: new Date() } });
    await logOperationsActivity({ eventType: 'ACTIVATION_ANALYSIS_COMPLETED', summary: `Activation analysis reviewed ${total} handymen and flagged ${stalledCount} stalled journeys.`, entityType: 'ACTIVATION_RUN', entityId: run.id, details: { trigger, total, created, updated, stalledCount, snapshot } });
    return { skipped: false, runId: run.id, usersAnalyzed: total, created, updated, stalledCount, snapshot } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown activation error';
    await db.activationAgentRun.update({ where: { id: run.id }, data: { status: 'FAILED', errorMessage: message.slice(0, 5000), finishedAt: new Date() } });
    throw error;
  }
}
