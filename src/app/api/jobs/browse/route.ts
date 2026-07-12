import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

// GET /api/jobs/browse — open/in-review jobs for handymen
export async function GET(request: Request) {
  try {
    const user = await requireUser();

    if (user.role !== 'HANDYMAN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const location = searchParams.get('location');
    const minBudget = searchParams.get('minBudget');
    const maxBudget = searchParams.get('maxBudget');

    const jobs = await db.job.findMany({
      where: {
        status: { in: ['OPEN', 'IN_REVIEW'] },
        ...(category && { category }),
        ...(location && { location: { contains: location } }),
        ...(minBudget && { budget: { gte: parseFloat(minBudget) } }),
        ...(maxBudget && { budget: { lte: parseFloat(maxBudget) } }),
      },
      include: {
        photos: { take: 1 },
        homeowner: { select: { name: true } },
        _count: { select: { bids: true } },
        bids: {
          where: { handymanId: user.id },
          select: { id: true, status: true, amount: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      jobs.map(j => ({
        ...j,
        budget: Number(j.budget),
        bids: j.bids.map(b => ({ ...b, amount: Number(b.amount) })),
        myBid: j.bids[0] ? { ...j.bids[0], amount: Number(j.bids[0].amount) } : null,
      }))
    );
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
