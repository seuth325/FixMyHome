import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

// GET /api/bids/my — handyman's own bids
export async function GET() {
  try {
    const user = await requireUser();

    if (user.role !== 'HANDYMAN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const bids = await db.bid.findMany({
      where: { handymanId: user.id },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            category: true,
            location: true,
            budget: true,
            status: true,
            homeowner: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      bids.map(b => ({
        ...b,
        amount: Number(b.amount),
        job: { ...b.job, budget: Number(b.job.budget) },
      }))
    );
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
