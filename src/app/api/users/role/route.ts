import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { role } = await req.json();
  if (role !== 'HOMEOWNER' && role !== 'HANDYMAN') {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { role },
  });

  // Ensure a blank HandymanProfile exists for handymen
  if (role === 'HANDYMAN') {
    await prisma.handymanProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, skills: [], serviceRadius: 25 },
    });
  }

  return NextResponse.json(user);
}
