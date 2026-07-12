import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, hashPasswordResetToken } from '@/lib/password';
import { resetPasswordSchema } from '@/lib/validations/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = resetPasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Please enter a valid new password' }, { status: 400 });
    }

    const tokenRecord = await db.passwordResetToken.findUnique({
      where: { tokenHash: hashPasswordResetToken(parsed.data.token) },
    });

    if (!tokenRecord || tokenRecord.usedAt || tokenRecord.expiresAt <= new Date()) {
      return NextResponse.json({ error: 'This reset link is invalid or expired.' }, { status: 400 });
    }

    const passwordHash = await hashPassword(parsed.data.password);

    await db.$transaction([
      db.user.update({ where: { id: tokenRecord.userId }, data: { passwordHash } }),
      db.passwordResetToken.update({ where: { id: tokenRecord.id }, data: { usedAt: new Date() } }),
      db.passwordResetToken.updateMany({
        where: { userId: tokenRecord.userId, usedAt: null, id: { not: tokenRecord.id } },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Password reset failed:', error);
    return NextResponse.json({ error: 'Unable to reset password. Please try again.' }, { status: 500 });
  }
}