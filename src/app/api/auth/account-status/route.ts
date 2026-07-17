import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : '';
  if (!email) return NextResponse.json({ verified: true });
  const user = await db.user.findUnique({ where: { email }, select: { emailVerifiedAt: true, role: true } });
  return NextResponse.json({ verified: !user || user.role === 'ADMIN' || Boolean(user.emailVerifiedAt) });
}