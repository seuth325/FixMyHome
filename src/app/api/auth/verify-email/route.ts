import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashEmailVerificationToken } from '@/lib/email-verification';
import { sendWelcomeEmail } from '@/lib/email';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const destination = new URL('/verify-email', url.origin);

  if (!token) {
    destination.searchParams.set('error', 'missing');
    return NextResponse.redirect(destination);
  }

  const record = await db.emailVerificationToken.findUnique({
    where: { tokenHash: hashEmailVerificationToken(token) },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    destination.searchParams.set('error', 'expired');
    return NextResponse.redirect(destination);
  }

  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    db.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    db.emailVerificationToken.updateMany({ where: { userId: record.userId, usedAt: null, id: { not: record.id } }, data: { usedAt: new Date() } }),
  ]);

  await sendWelcomeEmail({ to: record.user.email, name: record.user.name }).catch((error) => console.error('Welcome email failed', error));
  destination.searchParams.set('verified', '1');
  return NextResponse.redirect(destination);
}