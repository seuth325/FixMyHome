import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

type Params = { params: Promise<{ userId: string }> };

// GET /api/users/[userId] — public profile (handyman profile + reviews)
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireUser(); // must be signed in to view profiles
    const { userId } = await params;

    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        handymanProfile: true,
        reviewsReceived: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { reviewer: { select: { name: true } } },
        },
        _count: { select: { bidsSubmitted: true } },
      },
    });

    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const completedJobs = await db.bid.count({
      where: { handymanId: userId, status: 'ACCEPTED', job: { status: 'COMPLETED' } },
    });

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      photoUrl: user.photoUrl,
      handymanProfile: user.handymanProfile
        ? {
            ...user.handymanProfile,
            hourlyRate: user.handymanProfile.hourlyRate ? Number(user.handymanProfile.hourlyRate) : null,
            ratingAvg: Number(user.handymanProfile.ratingAvg),
          }
        : null,
      reviews: user.reviewsReceived.map(r => ({ ...r, reviewer: r.reviewer })),
      completedJobs,
    });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
