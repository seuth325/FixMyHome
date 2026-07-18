import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

const eventSchema = z.object({
  sessionId: z.string().min(8).max(100),
  eventName: z.enum(['landing_view', 'form_started', 'short_form_completed', 'signup_started', 'job_submitted']),
  campaign: z.string().max(80).optional(),
  referralCode: z.string().max(64).optional(),
  path: z.string().max(200).optional(),
  zipCode: z.string().regex(/^\d{5}$/).optional(),
  jobId: z.string().max(40).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, 'campaign-event', 60, 60_000);
  if (!rateLimit.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const parsed = eventSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const session = await auth();
  const event = await prisma.campaignEvent.create({
    data: {
      ...parsed.data,
      campaign: parsed.data.campaign || null,
      referralCode: parsed.data.referralCode || null,
      path: parsed.data.path || null,
      zipCode: parsed.data.zipCode || null,
      jobId: parsed.data.jobId || null,
      metadata: parsed.data.metadata || undefined,
      userId: session?.user?.id || null,
    },
    select: { id: true },
  });
  return NextResponse.json(event, { status: 201 });
}
