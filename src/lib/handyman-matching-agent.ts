import { db } from '@/lib/db';
import { logOperationsActivity } from '@/lib/operations-intelligence';

type Trigger = 'MANUAL' | 'SCHEDULED';

function skills(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().toLowerCase())
    : [];
}

function sameLocation(jobLocation: string, handymanLocation: string | null) {
  if (!handymanLocation) return false;
  return jobLocation.trim().toLowerCase() === handymanLocation.trim().toLowerCase();
}

export async function runHandymanMatchingAgent({ trigger }: { trigger: Trigger }) {
  const active = await db.handymanMatchingRun.findFirst({
    where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
  });
  if (active) return { skipped: true, reason: 'already_running', runId: active.id } as const;

  const run = await db.handymanMatchingRun.create({ data: { trigger } });
  try {
    const [jobs, handymen] = await Promise.all([
      db.job.findMany({
        where: { status: { in: ['OPEN', 'IN_REVIEW'] } },
        include: {
          _count: { select: { bids: true } },
          bids: { select: { handymanId: true } },
          invitations: { select: { handymanId: true } },
        },
        orderBy: [{ createdAt: 'asc' }],
        take: 250,
      }),
      db.user.findMany({
        where: { role: 'HANDYMAN', isAvailable: true, handymanProfile: { isNot: null } },
        include: {
          handymanProfile: true,
          bidsSubmitted: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 500,
      }),
    ]);

    let candidatesSeen = 0;
    let matchesCreated = 0;
    let matchesUpdated = 0;
    const evaluatedKeys: Array<{ jobId: string; handymanId: string }> = [];

    for (const job of jobs) {
      const excluded = new Set([
        ...job.bids.map((bid) => bid.handymanId),
        ...job.invitations.map((invitation) => invitation.handymanId),
      ]);
      const ranked = handymen
        .filter((handyman) => !excluded.has(handyman.id) && handyman.handymanProfile)
        .map((handyman) => {
          const profile = handyman.handymanProfile!;
          const profileSkills = skills(profile.skills);
          const category = job.category.trim().toLowerCase();
          const skillMatch = profileSkills.includes(category);
          const generalist = profileSkills.includes('general handyman');
          const skillScore = skillMatch ? 55 : generalist ? 28 : 0;
          const locationMatch = sameLocation(job.location, handyman.location);
          const locationScore = locationMatch ? 25 : handyman.location ? 5 : 0;
          const rating = Number(profile.ratingAvg);
          const qualityScore = Math.min(15, Math.round(rating * 2) + (profile.verificationStatus === 'VERIFIED' ? 5 : 0));
          const lastBidAt = handyman.bidsSubmitted[0]?.createdAt;
          const activeRecently = lastBidAt && Date.now() - lastBidAt.getTime() <= 30 * 24 * 60 * 60 * 1000;
          const activityScore = activeRecently ? 5 : 0;
          const score = skillScore + locationScore + qualityScore + activityScore;
          const reasons = [
            skillMatch ? `Lists ${job.category} as a skill` : generalist ? 'Lists General Handyman as a skill' : null,
            locationMatch ? `Located in project ZIP ${job.location}` : handyman.location ? `Located in ZIP ${handyman.location}` : null,
            profile.verificationStatus === 'VERIFIED' ? 'Verified profile' : null,
            rating > 0 ? `${rating.toFixed(1)} average rating` : null,
            activeRecently ? 'Submitted a bid within 30 days' : null,
          ].filter((reason): reason is string => Boolean(reason));
          return { handyman, score, skillScore, locationScore, qualityScore, activityScore, reasons };
        })
        .filter((candidate) => candidate.score >= 35)
        .sort((a, b) => b.score - a.score)
        .slice(0, job._count.bids === 0 ? 8 : 5);

      candidatesSeen += ranked.length;
      for (const candidate of ranked) {
        const key = { jobId: job.id, handymanId: candidate.handyman.id };
        evaluatedKeys.push(key);
        const existing = await db.handymanJobMatch.findUnique({
          where: { jobId_handymanId: key },
          select: { id: true, status: true },
        });
        const draftMessage = `Hi ${candidate.handyman.name}, your profile looks like a strong match for "${job.title}" in ${job.location}. Please review the project details and submit a bid if it fits your schedule and experience.`;
        const data = {
          score: candidate.score,
          skillScore: candidate.skillScore,
          locationScore: candidate.locationScore,
          qualityScore: candidate.qualityScore,
          activityScore: candidate.activityScore,
          reasons: candidate.reasons,
          draftMessage,
          lastEvaluatedAt: new Date(),
        };
        if (existing) {
          if (!['INVITED', 'DISMISSED'].includes(existing.status)) {
            await db.handymanJobMatch.update({ where: { id: existing.id }, data });
            matchesUpdated += 1;
          }
        } else {
          await db.handymanJobMatch.create({ data: { ...key, ...data } });
          matchesCreated += 1;
        }
      }
    }

    await db.handymanJobMatch.updateMany({
      where: {
        status: 'PENDING_REVIEW',
        NOT: { OR: evaluatedKeys.length ? evaluatedKeys : [{ jobId: '__none__', handymanId: '__none__' }] },
      },
      data: { status: 'STALE' },
    });
    await db.handymanMatchingRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', jobsAnalyzed: jobs.length, candidatesSeen, matchesCreated, matchesUpdated, finishedAt: new Date() },
    });
    await logOperationsActivity({
      eventType: 'HANDYMAN_MATCHING_COMPLETED',
      summary: `Matching analyzed ${jobs.length} open projects and created ${matchesCreated} candidates.`,
      entityType: 'MATCHING_RUN',
      entityId: run.id,
      details: { trigger, jobsAnalyzed: jobs.length, candidatesSeen, matchesCreated, matchesUpdated },
    });
    return { skipped: false, runId: run.id, jobsAnalyzed: jobs.length, candidatesSeen, matchesCreated, matchesUpdated } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown matching error';
    await db.handymanMatchingRun.update({ where: { id: run.id }, data: { status: 'FAILED', errorMessage: message.slice(0, 5000), finishedAt: new Date() } });
    throw error;
  }
}
