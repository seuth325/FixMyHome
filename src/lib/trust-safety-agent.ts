import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { logOperationsActivity } from '@/lib/operations-intelligence';

type Trigger = 'MANUAL' | 'SCHEDULED';
type Risk = {
  caseKey: string; type: string; severity: 'P0' | 'P1' | 'P2' | 'P3'; confidence: number;
  subjectType: string; subjectId: string | null; title: string; summary: string;
  evidence: Prisma.InputJsonValue; recommendedAction: string; draftWarning?: string;
};

const DAY = 86_400_000;
const paymentRules = [/\bcash\s*app\b/i, /\bvenmo\b/i, /\bzelle\b/i, /\bgift\s*card\b/i, /\bwire\s+transfer\b/i, /\bpay\s+(?:me\s+)?outside\b/i, /\boff[\s-]?platform\b/i];
const contactRules = [/https?:\/\/|www\./i, /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i, /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/];
const urgentPaymentRules = [/\bpay\s+(?:a\s+)?deposit\s+before\b/i, /\bpayment\s+upfront\b/i, /\bfull\s+payment\s+(?:first|before)\b/i, /\bgift\s*card\b/i];
const unsafeJobRules = [/\basbestos\b/i, /\bmold\s+remediation\b/i, /\bremove\s+(?:a\s+)?firearm\b/i, /\billegal\b/i, /\bcontrolled\s+substance\b/i, /\bdisable\s+(?:an?\s+)?alarm\b/i];

function hits(value: string, rules: RegExp[]) { return rules.filter((rule) => rule.test(value)).length; }
function warning(name: string, reason: string) {
  return `Hi ${name}, our marketplace safety review identified activity that may conflict with FixMyHome guidelines: ${reason}. No final determination has been made. Please keep project communication and payment arrangements clear, lawful, and documented through FixMyHome while an administrator reviews the activity.`;
}
export async function getTrustSafetySettings() {
  return db.trustSafetySettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
}

export async function runTrustSafetyAgent({ trigger }: { trigger: Trigger }) {
  const active = await db.trustSafetyRun.findFirst({ where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } } });
  if (active) return { skipped: true, reason: 'already_running', runId: active.id } as const;
  const settings = await getTrustSafetySettings();
  if (!settings.enabled && trigger === 'SCHEDULED') return { skipped: true, reason: 'disabled' } as const;
  const run = await db.trustSafetyRun.create({ data: { trigger } });
  try {
    const since = new Date(Date.now() - settings.scanDays * DAY);
    const [reports, messages, jobs, bids, reviews] = await Promise.all([
      db.report.findMany({ where: { createdAt: { gte: since }, status: { in: ['OPEN', 'REVIEWING'] } }, include: { reporter: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 2000 }),
      db.message.findMany({ where: { createdAt: { gte: since } }, select: { id: true, senderId: true, body: true, jobId: true, bidId: true, createdAt: true, sender: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 5000 }),
      db.job.findMany({ where: { createdAt: { gte: since } }, select: { id: true, homeownerId: true, title: true, description: true, status: true, budget: true, createdAt: true, homeowner: { select: { name: true } } }, take: 5000 }),
      db.bid.findMany({ where: { createdAt: { gte: since } }, select: { id: true, handymanId: true, amount: true, status: true, jobId: true, handyman: { select: { name: true } }, job: { select: { budget: true } } }, take: 10000 }),
      db.review.findMany({ where: { createdAt: { gte: since }, text: { not: null } }, select: { id: true, reviewerId: true, text: true, jobId: true }, take: 5000 }),
    ]);
    const risks: Risk[] = [];

    for (const report of reports) risks.push({
      caseKey: `REPORT:${report.id}`, type: 'USER_REPORT', severity: /threat|fraud|scam|unsafe|harass/i.test(report.reason) ? 'P1' : 'P2', confidence: 100,
      subjectType: report.targetType, subjectId: report.targetId, title: `Open user report: ${report.reason}`,
      summary: `${report.reporter.name} reported a ${report.targetType.toLowerCase()} for administrator review.`,
      evidence: { reportId: report.id, targetType: report.targetType, targetId: report.targetId, reason: report.reason, reportedAt: report.createdAt.toISOString() },
      recommendedAction: 'Review the original report, related marketplace records, and both parties before changing report or account status.',
    });

    const reportGroups = new Map<string, typeof reports>();
    for (const report of reports) { const key = `${report.targetType}:${report.targetId}`; reportGroups.set(key, [...(reportGroups.get(key) ?? []), report]); }
    for (const [key, group] of reportGroups) if (group.length >= settings.repeatReportThreshold) {
      const divider = key.indexOf(':'); const targetType = key.slice(0, divider); const targetId = key.slice(divider + 1);
      risks.push({ caseKey: `REPEAT_REPORTS:${key}`, type: 'REPEAT_REPORTS', severity: group.length >= settings.repeatReportThreshold + 2 ? 'P1' : 'P2', confidence: 90,
        subjectType: targetType, subjectId: targetId, title: `${group.length} open reports reference the same ${targetType.toLowerCase()}`,
        summary: `Multiple reports within ${settings.scanDays} days require a consolidated administrator review.`,
        evidence: { reportIds: group.map((item) => item.id), reasons: [...new Set(group.map((item) => item.reason))], count: group.length },
        recommendedAction: 'Review the reports together, look for corroboration or reporter abuse, and document a proportional manual decision.' });
    }

    for (const message of messages) {
      const payment = hits(message.body, paymentRules), contact = hits(message.body, contactRules), urgent = hits(message.body, urgentPaymentRules);
      if (!urgent && !(payment && contact)) continue;
      risks.push({ caseKey: `MESSAGE_RISK:${message.id}`, type: 'SUSPICIOUS_MESSAGE_PATTERN', severity: urgent ? 'P1' : 'P2', confidence: urgent ? 85 : 70,
        subjectType: 'USER', subjectId: message.senderId, title: 'Message pattern needs safety review',
        summary: `A message by ${message.sender.name} matched ${urgent ? 'urgent payment' : 'off-platform payment/contact'} risk rules. Message contents are not copied into the case.`,
        evidence: { messageId: message.id, jobId: message.jobId, bidId: message.bidId, ruleCategories: { payment, contact, urgentPayment: urgent }, createdAt: message.createdAt.toISOString() },
        recommendedAction: 'Open the source conversation, consider context and project stage, then approve a warning or dismiss the case. Do not act on pattern matching alone.',
        draftWarning: warning(message.sender.name, 'a possible off-platform or advance-payment arrangement') });
    }

    for (const job of jobs) { const ruleCount = hits(`${job.title}\n${job.description}`, unsafeJobRules); if (!ruleCount) continue;
      risks.push({ caseKey: `UNSAFE_JOB:${job.id}`, type: 'POTENTIALLY_UNSAFE_JOB', severity: 'P1', confidence: 75, subjectType: 'JOB', subjectId: job.id,
        title: `Potentially regulated or unsafe project: ${job.title}`, summary: `The project matched ${ruleCount} safety rule${ruleCount === 1 ? '' : 's'} and needs human context review.`,
        evidence: { jobId: job.id, homeownerId: job.homeownerId, ruleMatchCount: ruleCount, status: job.status, createdAt: job.createdAt.toISOString() },
        recommendedAction: 'Review the full project scope and local licensing/safety requirements. Manually pause or remove only if policy requires it.',
        draftWarning: warning(job.homeowner.name, 'a project scope that may require licensed or specialized safety handling') });
    }

    const withdrawals = new Map<string, typeof bids>();
    for (const bid of bids) {
      const budget = Number(bid.job.budget), amount = Number(bid.amount), ratio = budget > 0 ? amount / budget : 1;
      if (ratio >= settings.highBidMultiplier || ratio <= settings.lowBidMultiplier) risks.push({
        caseKey: `ABNORMAL_BID:${bid.id}`, type: 'ABNORMAL_BID_AMOUNT', severity: ratio >= settings.highBidMultiplier * 2 || ratio <= settings.lowBidMultiplier / 2 ? 'P1' : 'P2', confidence: 80,
        subjectType: 'BID', subjectId: bid.id, title: 'Bid amount is outside the expected project range', summary: `${bid.handyman.name}'s bid is ${ratio.toFixed(2)}x the posted budget and needs context review.`,
        evidence: { bidId: bid.id, jobId: bid.jobId, handymanId: bid.handymanId, amount, budget, ratio: Number(ratio.toFixed(2)) },
        recommendedAction: 'Review scope, units, and bid message for a legitimate explanation before contacting or restricting the handyman.',
        draftWarning: warning(bid.handyman.name, 'a bid amount that differs significantly from the posted project budget') });
      if (bid.status === 'WITHDRAWN') withdrawals.set(bid.handymanId, [...(withdrawals.get(bid.handymanId) ?? []), bid]);
    }
    for (const [handymanId, group] of withdrawals) if (group.length >= settings.withdrawalThreshold) risks.push({
      caseKey: `REPEAT_WITHDRAWALS:${handymanId}`, type: 'REPEAT_BID_WITHDRAWALS', severity: 'P2', confidence: 90, subjectType: 'USER', subjectId: handymanId,
      title: `${group.length} withdrawn bids in the review window`, summary: `${group[0].handyman.name} has repeatedly withdrawn bids, which may indicate bid quality or reliability issues.`,
      evidence: { handymanId, bidIds: group.map((item) => item.id), count: group.length, scanDays: settings.scanDays },
      recommendedAction: 'Review related bids and outcomes, then decide whether coaching, a warning, or no action is appropriate.', draftWarning: warning(group[0].handyman.name, 'a repeated pattern of withdrawn bids') });

    const cancellations = new Map<string, typeof jobs>();
    for (const job of jobs) if (job.status === 'CANCELLED') cancellations.set(job.homeownerId, [...(cancellations.get(job.homeownerId) ?? []), job]);
    for (const [homeownerId, group] of cancellations) if (group.length >= settings.cancellationThreshold) risks.push({
      caseKey: `REPEAT_CANCELLATIONS:${homeownerId}`, type: 'REPEAT_JOB_CANCELLATIONS', severity: 'P2', confidence: 90, subjectType: 'USER', subjectId: homeownerId,
      title: `${group.length} cancelled projects in the review window`, summary: `${group[0].homeowner.name} has repeatedly cancelled projects, which may require marketplace-use guidance.`,
      evidence: { homeownerId, jobIds: group.map((item) => item.id), count: group.length, scanDays: settings.scanDays },
      recommendedAction: 'Review timing, bids, and cancellation context before approving guidance or taking any account action.', draftWarning: warning(group[0].homeowner.name, 'a repeated pattern of project cancellations') });

    const duplicateReviews = new Map<string, typeof reviews>();
    for (const review of reviews) { const normalized = review.text?.toLowerCase().replace(/\s+/g, ' ').trim(); if (normalized && normalized.length >= 25) duplicateReviews.set(`${review.reviewerId}:${normalized}`, [...(duplicateReviews.get(`${review.reviewerId}:${normalized}`) ?? []), review]); }
    for (const group of duplicateReviews.values()) if (group.length >= 2) risks.push({
      caseKey: `DUPLICATE_REVIEW:${group[0].reviewerId}:${group[0].id}`, type: 'DUPLICATE_REVIEW_PATTERN', severity: 'P2', confidence: 85, subjectType: 'USER', subjectId: group[0].reviewerId,
      title: `${group.length} reviews use identical text`, summary: 'Repeated review wording across separate projects may indicate inauthentic or low-quality feedback.',
      evidence: { reviewerId: group[0].reviewerId, reviewIds: group.map((item) => item.id), jobIds: group.map((item) => item.jobId), count: group.length },
      recommendedAction: 'Review the projects and reviewer relationship before editing, removing, or discounting any review.' });

    const existing = risks.length ? await db.trustSafetyCase.findMany({ where: { caseKey: { in: risks.map((risk) => risk.caseKey) } }, select: { id: true, caseKey: true } }) : [];
    const existingByKey = new Map(existing.map((item) => [item.caseKey, item])); let created = 0, updated = 0;
    for (const risk of risks) { const previous = existingByKey.get(risk.caseKey);
      if (previous) { await db.trustSafetyCase.update({ where: { id: previous.id }, data: { ...risk, latestRunId: run.id, lastDetectedAt: new Date() } }); updated += 1; }
      else { const safetyCase = await db.trustSafetyCase.create({ data: { ...risk, latestRunId: run.id } }); await db.trustSafetyCaseEvent.create({ data: { caseId: safetyCase.id, eventType: 'CASE_CREATED', metadata: { trigger, runId: run.id } } }); created += 1; }
    }
    const recordsScanned = reports.length + messages.length + jobs.length + bids.length + reviews.length;
    await db.$transaction([
      db.trustSafetyRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', recordsScanned, risksDetected: risks.length, casesCreated: created, casesUpdated: updated, finishedAt: new Date() } }),
      db.trustSafetySettings.update({ where: { id: settings.id }, data: { lastRunAt: new Date() } }),
    ]);
    await logOperationsActivity({ eventType: 'TRUST_SAFETY_SCAN_COMPLETED', summary: `Trust & Safety reviewed ${recordsScanned} records and prepared ${risks.length} approval-only cases.`, entityType: 'TRUST_SAFETY_RUN', entityId: run.id, details: { trigger, recordsScanned, detected: risks.length, created, updated } });
    return { skipped: false, runId: run.id, recordsScanned, detected: risks.length, created, updated } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Trust & Safety error';
    await db.trustSafetyRun.update({ where: { id: run.id }, data: { status: 'FAILED', errorMessage: message.slice(0, 5000), finishedAt: new Date() } });
    throw error;
  }
}