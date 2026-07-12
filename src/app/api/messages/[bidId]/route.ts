import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sendMessageSchema } from '@/lib/validations/message';

type Params = { params: Promise<{ bidId: string }> };

// GET /api/messages/[bidId] — fetch message thread
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { bidId } = await params;

    const bid = await db.bid.findUnique({
      where: { id: bidId },
      include: { job: { select: { homeownerId: true } } },
    });

    if (!bid) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (bid.handymanId !== user.id && bid.job.homeownerId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const messages = await db.message.findMany({
      where: { bidId },
      include: { sender: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(messages);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

// POST /api/messages/[bidId] — send a message
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { bidId } = await params;

    const bid = await db.bid.findUnique({
      where: { id: bidId },
      include: { job: { select: { homeownerId: true, title: true } } },
    });

    if (!bid) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (bid.handymanId !== user.id && bid.job.homeownerId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const message = await db.message.create({
      data: { jobId: bid.jobId, bidId, senderId: user.id, body: parsed.data.body },
      include: { sender: { select: { id: true, name: true } } },
    });

    // Notify the other party
    const recipientId = user.id === bid.job.homeownerId ? bid.handymanId : bid.job.homeownerId;
    await db.notification.create({
      data: {
        userId: recipientId,
        type: 'NEW_MESSAGE',
        title: 'New Message',
        body: `${user.name}: ${parsed.data.body.slice(0, 80)}${parsed.data.body.length > 80 ? '…' : ''}`,
        linkPath: `/messages/${bidId}`,
      },
    });

    return NextResponse.json(message, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
