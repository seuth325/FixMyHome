import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sendMarketplaceEmail } from '@/lib/email';
import { checkRateLimit } from '@/lib/rate-limit';

type Params = { params: Promise<{ id: string }> };

async function ownedJob(jobId: string, userId: string) {
  return db.job.findFirst({
    where: { id: jobId, homeownerId: userId },
    select: { id: true, title: true, status: true, homeowner: { select: { name: true } } },
  });
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id: jobId } = await params;
    const job = await ownedJob(jobId, user.id);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    const handymen = await db.user.findMany({
      where: { role: 'HANDYMAN', isAvailable: true, handymanProfile: { isNot: null } },
      select: {
        id: true, name: true, location: true, photoUrl: true,
        handymanProfile: { select: { businessName: true, skills: true, ratingAvg: true, ratingCount: true, verificationStatus: true } },
        bidsSubmitted: { where: { jobId }, select: { id: true }, take: 1 },
        jobInvitations: { where: { jobId }, select: { id: true, createdAt: true, respondedAt: true }, take: 1 },
      },
      orderBy: [{ handymanProfile: { ratingAvg: 'desc' } }, { name: 'asc' }],
      take: 75,
    });

    return NextResponse.json({
      handymen: handymen.map((handyman) => ({
        id: handyman.id, name: handyman.name, location: handyman.location, photoUrl: handyman.photoUrl,
        businessName: handyman.handymanProfile?.businessName,
        skills: handyman.handymanProfile?.skills ?? [],
        ratingAvg: Number(handyman.handymanProfile?.ratingAvg ?? 0),
        ratingCount: handyman.handymanProfile?.ratingCount ?? 0,
        verified: handyman.handymanProfile?.verificationStatus === 'VERIFIED',
        bidSubmitted: handyman.bidsSubmitted.length > 0,
        invitation: handyman.jobInvitations[0] ?? null,
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

export async function POST(request: Request, { params }: Params) {
  const rateLimit = checkRateLimit(request, 'invite-handyman', 30, 60 * 60 * 1000);
  if (!rateLimit.allowed) return NextResponse.json({ error: 'Too many invitations. Please try again later.' }, { status: 429 });

  try {
    const user = await requireUser();
    const { id: jobId } = await params;
    const job = await ownedJob(jobId, user.id);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (job.status !== 'OPEN' && job.status !== 'IN_REVIEW') return NextResponse.json({ error: 'This job is not accepting bids.' }, { status: 400 });

    const body = await request.json() as { handymanId?: string; message?: string };
    const message = body.message?.trim();
    if (!body.handymanId) return NextResponse.json({ error: 'Select a handyman.' }, { status: 400 });
    if (message && message.length > 500) return NextResponse.json({ error: 'Message must be 500 characters or less.' }, { status: 400 });

    const handyman = await db.user.findFirst({
      where: { id: body.handymanId, role: 'HANDYMAN', isAvailable: true },
      select: { id: true, name: true, email: true, emailOptOut: true },
    });
    if (!handyman) return NextResponse.json({ error: 'This handyman is not available.' }, { status: 404 });

    const invitation = await db.$transaction(async (tx) => {
      const created = await tx.jobInvitation.create({ data: { jobId, handymanId: handyman.id, message: message || null } });
      await tx.notification.create({
        data: {
          userId: handyman.id, type: 'BID_INVITATION', title: 'You are invited to bid',
          body: `${job.homeowner.name} invited you to bid on "${job.title}".${message ? ` ${message}` : ''}`,
          linkPath: `/jobs/${jobId}/bid`,
        },
      });
      return created;
    });

    if (!handyman.emailOptOut) {
      await sendMarketplaceEmail({
        to: handyman.email, name: handyman.name, category: 'BID_INVITATION',
        subject: `Invitation to bid: ${job.title}`, title: 'A homeowner invited you to bid',
        body: `${job.homeowner.name} would like you to review "${job.title}" and submit a quote.${message ? ` Personal note: ${message}` : ''}`,
        actionText: 'Review Job & Bid', actionPath: `/jobs/${jobId}/bid`,
      }).catch((error) => console.error('Bid invitation email failed', error));
    }

    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'This handyman has already been invited.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Unable to send invitation.' }, { status: 500 });
  }
}
