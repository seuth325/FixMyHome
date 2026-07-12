import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { createReviewSchema } from '@/lib/validations/review';

// POST /api/reviews — homeowner submits a review
export async function POST(request: Request) {
  try {
    const user = await requireUser();

    if (user.role !== 'HOMEOWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { jobId } = body as { jobId: string };
    if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

    // Validate job is completed and belongs to this homeowner
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        bids: { where: { status: 'ACCEPTED' }, select: { handymanId: true } },
      },
    });

    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (job.homeownerId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (job.status !== 'COMPLETED') {
      return NextResponse.json({ error: 'Job is not completed' }, { status: 400 });
    }

    const handymanId = job.bids[0]?.handymanId;
    if (!handymanId) return NextResponse.json({ error: 'No accepted bid found' }, { status: 400 });

    // Check for duplicate review
    const existing = await db.review.findFirst({ where: { jobId, reviewerId: user.id } });
    if (existing) return NextResponse.json({ error: 'Already reviewed' }, { status: 409 });

    const review = await db.review.create({
      data: {
        jobId,
        reviewerId: user.id,
        handymanId,
        stars: parsed.data.stars,
        text: parsed.data.text,
      },
    });

    // Recompute handyman rating average
    const allReviews = await db.review.findMany({
      where: { handymanId },
      select: { stars: true },
    });
    const avg = allReviews.reduce((s, r) => s + r.stars, 0) / allReviews.length;
    await db.handymanProfile.updateMany({
      where: { userId: handymanId },
      data: { ratingAvg: avg, ratingCount: allReviews.length },
    });

    return NextResponse.json(review, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
