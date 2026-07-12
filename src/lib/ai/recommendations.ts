// Legacy scoring logic — the active implementation is in src/lib/bid-scoring.ts

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyBid = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyJob = any;

export interface BidScore {
  bid: LegacyBid;
  total: number;          // 0–100 composite score
  priceScore: number;     // 0–100
  ratingScore: number;    // 0–100
  timelineScore: number;  // 0–100
  capacityScore: number;  // 0–100
  reason: string;         // Human-readable explanation
  isRecommended: boolean;
}

/** How many top bids get the "AI Recommended" label */
const TOP_N = 2;

/** Weights must sum to 1 */
const WEIGHTS = {
  price: 0.30,
  rating: 0.40,
  timeline: 0.20,
  capacity: 0.10,
};

/**
 * Price score: 100 when bid equals budget, rises when under, falls when over.
 * Bids 50%+ over budget score 0.
 */
function calcPriceScore(bidAmount: number, budget: number): number {
  if (budget <= 0) return 50;
  // Normalise: bid at budget → 100, each % under budget → bonus, each % over → penalty
  const ratio = bidAmount / budget; // 0.8 = 20% under, 1.2 = 20% over
  const score = 100 - (ratio - 1) * 200; // linear scale around budget
  return Math.max(0, Math.min(100, score));
}

/**
 * Rating score: linear mapping from 1–5 stars → 0–100.
 * Unknown rating defaults to 60 (neutral).
 */
function calcRatingScore(rating: number): number {
  if (!rating || rating < 1) return 60;
  return Math.min(100, ((rating - 1) / 4) * 100);
}

/**
 * Timeline score: shorter ETAs score higher.
 * 1 day → ~100, 7 days → ~77, 14 days → ~53, 30 days → ~0.
 * If the job has a preferred date we factor in urgency.
 */
function calcTimelineScore(
  etaDays: number,
  preferredDate: string | undefined,
  jobCreatedAt: string,
): number {
  const cap = 30; // bids beyond 30 days score 0
  let baseScore = Math.max(0, 100 - (etaDays / cap) * 100);

  if (preferredDate) {
    const created = new Date(jobCreatedAt);
    const preferred = new Date(preferredDate);
    const daysUntilPreferred = Math.max(
      0,
      (preferred.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
    );
    // If eta fits within the preferred window, add a 10-point bonus
    if (etaDays <= daysUntilPreferred) baseScore = Math.min(100, baseScore + 10);
  }

  return baseScore;
}

/**
 * Capacity score: counts how many PENDING + ACCEPTED bids the handyman currently
 * has across all jobs. Each active commitment reduces the score by 15 points.
 * 0 active → 100, 1 → 85, 2 → 70, … ≥7 → 0.
 */
function calcCapacityScore(handymanId: string, allBids: LegacyBid[]): number {
  const active = allBids.filter(
    b =>
      b.handymanId === handymanId &&
      (b.status === 'PENDING' || b.status === 'ACCEPTED'),
  ).length;
  return Math.max(0, 100 - active * 15);
}

/**
 * Build a short, human-readable explanation for the top recommendation.
 */
function buildReason(score: Omit<BidScore, 'reason' | 'isRecommended'>): string {
  const parts: string[] = [];

  if (score.priceScore >= 85) parts.push('competitive price');
  else if (score.priceScore >= 65) parts.push('fair price');
  else if (score.priceScore < 40) parts.push('above budget');

  if (score.ratingScore >= 90) parts.push('top-rated handyman');
  else if (score.ratingScore >= 75) parts.push('highly rated');

  if (score.timelineScore >= 85) parts.push('fast turnaround');
  else if (score.timelineScore >= 60) parts.push('reasonable timeline');

  if (score.capacityScore >= 90) parts.push('available immediately');
  else if (score.capacityScore <= 40) parts.push('high workload');

  if (parts.length === 0) return 'Good overall balance of price, rating, and timeline';
  return parts.map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(' · ');
}

/**
 * Score and rank all bids for a job.
 * Returns BidScore[] sorted best → worst, with `isRecommended` set on the top N.
 */
export function scoreBids(
  bids: LegacyBid[],
  job: LegacyJob,
  allBids: LegacyBid[],
): BidScore[] {
  if (bids.length === 0) return [];

  const scored = bids.map(bid => {
    const priceScore = calcPriceScore(bid.amount, job.budget);
    const ratingScore = calcRatingScore(bid.handymanRating);
    const timelineScore = calcTimelineScore(bid.etaDays, job.preferredDate, job.createdAt);
    const capacityScore = calcCapacityScore(bid.handymanId, allBids);

    const total =
      priceScore * WEIGHTS.price +
      ratingScore * WEIGHTS.rating +
      timelineScore * WEIGHTS.timeline +
      capacityScore * WEIGHTS.capacity;

    const partial = { bid, total, priceScore, ratingScore, timelineScore, capacityScore };
    return {
      ...partial,
      reason: buildReason(partial),
      isRecommended: false as boolean,
    } satisfies BidScore;
  });

  // Sort best → worst
  scored.sort((a, b) => b.total - a.total);

  // Mark top N as recommended (only PENDING bids qualify)
  let marked = 0;
  for (const s of scored) {
    if (marked >= TOP_N) break;
    if (s.bid.status === 'PENDING') {
      s.isRecommended = true;
      marked++;
    }
  }

  return scored;
}
