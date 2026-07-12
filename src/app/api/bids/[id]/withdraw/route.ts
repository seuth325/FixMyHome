import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const bid = await db.bid.findUnique({ where: { id } });
    if (!bid) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (bid.handymanId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (bid.status !== 'PENDING') return NextResponse.json({ error: 'Can only withdraw pending bids' }, { status: 400 });

    const updated = await db.bid.update({
      where: { id },
      data: { status: 'WITHDRAWN' },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
