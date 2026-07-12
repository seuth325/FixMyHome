import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { updateJobSchema } from '@/lib/validations/job';
import { scoreBids } from '@/lib/bid-scoring';

type Params = { params: Promise<{ id: string }> };

// GET /api/jobs/[id] — job detail with bids
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const job = await db.job.findUnique({
      where: { id },
      include: {
        photos: true,
        homeowner: { select: { id: true, name: true } },
        bids: {
          include: {
            handyman: {
              select: {
                id: true,
                name: true,
                handymanProfile: {
                  select: { businessName: true, ratingAvg: true, ratingCount: true, skills: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        reviews: { select: { id: true, reviewerId: true } },
      },
    });

    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const scoredBids = scoreBids(job.bids, job);
    const myBid = user.role === 'HANDYMAN'
      ? (scoredBids.find(b => b.handymanId === user.id) ?? null)
      : null;

    return NextResponse.json({
      ...job,
      budget: Number(job.budget),
      bids: scoredBids.map(b => ({
        ...b,
        amount: Number(b.amount),
        handyman: {
          ...b.handyman,
          handymanProfile: b.handyman.handymanProfile
            ? { ...b.handyman.handymanProfile, ratingAvg: Number(b.handyman.handymanProfile.ratingAvg) }
            : null,
        },
      })),
      myBid: myBid ? { ...myBid, amount: Number(myBid.amount) } : null,
      hasReview: job.reviews.some(r => r.reviewerId === user.id),
    });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

// PATCH /api/jobs/[id] — update job fields (homeowner, OPEN status only)
export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const job = await db.job.findUnique({ where: { id } });
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (job.homeownerId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (job.status !== 'OPEN') return NextResponse.json({ error: 'Job cannot be edited' }, { status: 400 });

    const body = await request.json();
    const { photoUrls, ...rest } = body;
    const parsed = updateJobSchema.safeParse({
      ...rest,
      preferredDate: rest.preferredDate ? new Date(rest.preferredDate) : undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const updated = await db.job.update({
      where: { id },
      data: {
        ...parsed.data,
        ...(Array.isArray(photoUrls) && {
          photos: {
            deleteMany: {},
            create: (photoUrls as string[]).map((url: string) => ({ url })),
          },
        }),
      },
      include: { photos: true },
    });

    return NextResponse.json({ ...updated, budget: Number(updated.budget) });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
