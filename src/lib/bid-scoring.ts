import type { Bid, HandymanProfile, Job } from '@prisma/client';
import { Decimal } from '@prisma/client-runtime-utils';

type BidWithHandyman = Bid & {
  handyman: {
    id: string;
    name: string;
    handymanProfile: Pick<HandymanProfile, 'businessName' | 'ratingAvg' | 'ratingCount'> | null;
  };
};

type JobForScoring = Pick<Job, 'budget' | 'preferredDate'>;

function toNum(d: Decimal | null | undefined): number {
  if (d == null) return 0;
  return Number(d);
}

function scoreBid(bid: BidWithHandyman, job: JobForScoring): number {
  const budget = toNum(job.budget);
  const amount = toNum(bid.amount);
  const rating = toNum(bid.handyman.handymanProfile?.ratingAvg);

  // Price score: 100 when at/below budget, decreases above budget
  const priceDiff = budget > 0 ? (budget - amount) / budget : 0;
  const priceScore = Math.max(0, Math.min(100, 50 + priceDiff * 50));

  // Rating score: 0–100 based on 0–5 stars
  const ratingScore = (rating / 5) * 100;

  // Timeline score: closer to preferred date = better; no date = neutral 50
  let timelineScore = 50;
  if (job.preferredDate) {
    const daysUntilPreferred = Math.max(
      0,
      (job.preferredDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    const diff = Math.abs(bid.etaDays - daysUntilPreferred);
    timelineScore = Math.max(0, 100 - diff * 5);
  }

  return priceScore * 0.3 + ratingScore * 0.4 + timelineScore * 0.2 + 50 * 0.1;
}

/** Returns bids sorted by score with top-3 marked as recommended. */
export function scoreBids(bids: BidWithHandyman[], job: JobForScoring): (BidWithHandyman & { score: number; isRecommended: boolean })[] {
  if (bids.length === 0) return [];

  const scored = bids.map(bid => ({ ...bid, score: scoreBid(bid, job) }));
  scored.sort((a, b) => b.score - a.score);

  return scored.map((bid, i) => ({ ...bid, isRecommended: i < 3 }));
}
