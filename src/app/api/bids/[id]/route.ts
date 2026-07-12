import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

// GET /api/bids/[id] — bid detail with job info (for messages page header)
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const bid = await db.bid.findUnique({
      where: { id },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            category: true,
            status: true,
            homeownerId: true,
            homeowner: { select: { id: true, name: true } },
          },
        },
        handyman: { select: { id: true, name: true } },
      },
    });

    if (!bid) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Only job owner or bid handyman may view
    if (bid.handymanId !== user.id && bid.job.homeownerId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ ...bid, amount: Number(bid.amount) });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
