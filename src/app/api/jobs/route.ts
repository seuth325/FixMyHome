import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { createJobSchema } from '@/lib/validations/job';

// GET /api/jobs — homeowner's own jobs
export async function GET() {
  try {
    const user = await requireUser();

    const jobs = await db.job.findMany({
      where: { homeownerId: user.id },
      include: {
        photos: true,
        _count: { select: { bids: true } },
        reviews: { where: { reviewerId: user.id }, select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      jobs.map(j => ({
        ...j,
        budget: Number(j.budget),
        hasReview: j.reviews.length > 0,
      }))
    );
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

// POST /api/jobs — create job (homeowner only)
export async function POST(request: Request) {
  try {
    const user = await requireUser();

    if (user.role !== 'HOMEOWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createJobSchema.safeParse({
      ...body,
      preferredDate: body.preferredDate ? new Date(body.preferredDate) : undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { photoUrls = [], ...jobData } = body;

    const job = await db.job.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description,
        category: parsed.data.category,
        location: parsed.data.location,
        budget: parsed.data.budget,
        preferredDate: parsed.data.preferredDate ?? null,
        homeownerId: user.id,
        photos: {
          create: (photoUrls as string[]).map((url: string) => ({ url })),
        },
      },
      include: { photos: true },
    });

    return NextResponse.json({ ...job, budget: Number(job.budget) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
