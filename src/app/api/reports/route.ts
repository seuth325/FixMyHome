import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';

const reportSchema = z.object({
  targetType: z.enum(['PROFILE', 'JOB', 'MESSAGE_THREAD']),
  targetId: z.string().min(1).max(120),
  reason: z.string().min(3).max(120),
  details: z.string().max(2000).optional().nullable(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = reportSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please include a report reason.' }, { status: 400 });
  }

  const report = await prisma.report.create({
    data: {
      reporterId: session.user.id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      reason: parsed.data.reason,
      details: parsed.data.details || null,
    },
  });

  return NextResponse.json({ ok: true, reportId: report.id }, { status: 201 });
}
