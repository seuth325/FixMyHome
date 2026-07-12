import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET /api/messages — list all conversations (bids with messages) for current user
export async function GET() {
  try {
    const user = await requireUser();

    const bids = await prisma.bid.findMany({
      where:
        user.role === 'HANDYMAN'
          ? { handymanId: user.id }
          : { job: { homeownerId: user.id } },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            homeowner: { select: { id: true, name: true } },
          },
        },
        handyman: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sender: { select: { id: true, name: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const conversations = bids
      .filter(bid => bid.messages.length > 0)
      .map(bid => {
        const otherUser =
          user.role === 'HANDYMAN'
            ? bid.job.homeowner
            : bid.handyman;
        return {
          bidId: bid.id,
          jobId: bid.job.id,
          jobTitle: bid.job.title,
          bidStatus: bid.status,
          otherUser,
          lastMessage: {
            id: bid.messages[0].id,
            body: bid.messages[0].body,
            senderId: bid.messages[0].senderId,
            createdAt: bid.messages[0].createdAt,
          },
        };
      });

    return NextResponse.json(conversations);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
