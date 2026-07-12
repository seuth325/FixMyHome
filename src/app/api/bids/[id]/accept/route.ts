import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

// POST /api/bids/[id]/accept — homeowner accepts a bid
export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id: bidId } = await params;

    const bid = await db.bid.findUnique({
      where: { id: bidId },
      include: { job: true },
    });

    if (!bid) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (bid.job.homeownerId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Accept this bid, decline all others, award the job
    await db.$transaction([
      db.bid.update({ where: { id: bidId }, data: { status: 'ACCEPTED' } }),
      db.bid.updateMany({
        where: { jobId: bid.jobId, id: { not: bidId }, status: 'PENDING' },
        data: { status: 'DECLINED' },
      }),
      db.job.update({ where: { id: bid.jobId }, data: { status: 'AWARDED' } }),
    ]);

    // Notify accepted handyman
    await db.notification.create({
      data: {
        userId: bid.handymanId,
        type: 'BID_ACCEPTED',
        title: 'Your Bid Was Accepted!',
        body: `Your bid of $${bid.amount} on "${bid.job.title}" was accepted!`,
        linkPath: `/jobs/${bid.jobId}`,
      },
    });

    // Notify declined handymen
    const declinedBids = await db.bid.findMany({
      where: { jobId: bid.jobId, status: 'DECLINED', id: { not: bidId } },
    });
    await db.notification.createMany({
      data: declinedBids.map(b => ({
        userId: b.handymanId,
        type: 'BID_DECLINED' as const,
        title: 'Bid Not Selected',
        body: `Another bid was chosen for "${bid.job.title}".`,
        linkPath: `/jobs/${bid.jobId}`,
      })),
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
