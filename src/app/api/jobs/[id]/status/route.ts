import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

// POST /api/jobs/[id]/status — update job status (homeowner only)
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { status } = await request.json();

    const job = await db.job.findUnique({ where: { id } });
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (job.homeownerId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const validTransitions: Record<string, string[]> = {
      OPEN: ['CANCELLED'],
      IN_REVIEW: ['CANCELLED'],
      AWARDED: ['COMPLETED', 'CANCELLED'],
    };

    if (!validTransitions[job.status]?.includes(status)) {
      return NextResponse.json({ error: 'Invalid status transition' }, { status: 400 });
    }

    const updated = await db.job.update({
      where: { id },
      data: {
        status,
        ...(status === 'COMPLETED' && { completedAt: new Date() }),
      },
    });

    // Notify accepted handyman when job completes
    if (status === 'COMPLETED') {
      const acceptedBid = await db.bid.findFirst({
        where: { jobId: id, status: 'ACCEPTED' },
      });
      if (acceptedBid) {
        await db.notification.create({
          data: {
            userId: acceptedBid.handymanId,
            type: 'JOB_COMPLETED',
            title: 'Job Marked Complete',
            body: `"${job.title}" has been marked as completed.`,
            linkPath: `/jobs/${id}`,
          },
        });
      }
    }

    return NextResponse.json({ ...updated, budget: Number(updated.budget) });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
