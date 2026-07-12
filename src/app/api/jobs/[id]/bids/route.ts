import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { createBidSchema } from '@/lib/validations/bid';

type Params = { params: Promise<{ id: string }> };

// POST /api/jobs/[id]/bids — handyman submits or updates a bid
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id: jobId } = await params;

    if (user.role !== 'HANDYMAN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createBidSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const job = await db.job.findUnique({ where: { id: jobId } });
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (job.status !== 'OPEN' && job.status !== 'IN_REVIEW') {
      return NextResponse.json({ error: 'Bidding is closed' }, { status: 400 });
    }

    const existing = await db.bid.findFirst({
      where: { jobId, handymanId: user.id },
    });

    const bid = await db.bid.upsert({
      where: { id: existing?.id ?? '__new__' },
      create: {
        jobId,
        handymanId: user.id,
        amount: parsed.data.amount,
        message: parsed.data.message,
        etaDays: parsed.data.etaDays,
        status: 'PENDING',
      },
      update: {
        amount: parsed.data.amount,
        message: parsed.data.message,
        etaDays: parsed.data.etaDays,
      },
    });

    // Transition OPEN job → IN_REVIEW on first bid
    if (!existing && job.status === 'OPEN') {
      await db.job.update({ where: { id: jobId }, data: { status: 'IN_REVIEW' } });
    }

    // Notify homeowner of new bid
    if (!existing) {
      await db.notification.create({
        data: {
          userId: job.homeownerId,
          type: 'NEW_BID',
          title: 'New Bid Received',
          body: `${user.name} submitted a bid of $${parsed.data.amount} on "${job.title}"`,
          linkPath: `/jobs/${jobId}`,
        },
      });
    }

    return NextResponse.json({ ...bid, amount: Number(bid.amount) }, { status: existing ? 200 : 201 });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
