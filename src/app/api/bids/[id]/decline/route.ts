import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

// POST /api/bids/[id]/decline — homeowner declines a single bid
export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id: bidId } = await params;

    const bid = await db.bid.findUnique({
      where: { id: bidId },
      include: { job: { select: { homeownerId: true, title: true } } },
    });

    if (!bid) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (bid.job.homeownerId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (bid.status !== 'PENDING') {
      return NextResponse.json({ error: 'Bid is not pending' }, { status: 400 });
    }

    await db.bid.update({ where: { id: bidId }, data: { status: 'DECLINED' } });

    await db.notification.create({
      data: {
        userId: bid.handymanId,
        type: 'BID_DECLINED',
        title: 'Bid Not Selected',
        body: `Your bid on "${bid.job.title}" was not selected.`,
        linkPath: `/jobs/${bid.jobId}`,
      },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
