import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createPasswordResetToken, hashPasswordResetToken } from '@/lib/password';
import { forgotPasswordSchema } from '@/lib/validations/auth';
import { sendPasswordResetEmail } from '@/lib/email';
import { checkRateLimit } from '@/lib/rate-limit';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const SUCCESS_RESPONSE = { ok: true, message: 'If an account exists for that email, a reset link has been sent.' };

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, 'forgot-password', 5, 15 * 60 * 1000);
  if (!rateLimit.allowed) return NextResponse.json(SUCCESS_RESPONSE, { headers: { 'Retry-After': String(rateLimit.retryAfter) } });

  try {
    const body = await request.json();
    const parsed = forgotPasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const user = await db.user.findUnique({ where: { email } });

    if (!user) {
      return NextResponse.json(SUCCESS_RESPONSE);
    }

    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = createPasswordResetToken();
    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashPasswordResetToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    await sendPasswordResetEmail({ to: user.email, name: user.name, token });

    return NextResponse.json(SUCCESS_RESPONSE);
  } catch (error) {
    console.error('Password reset request failed:', error);
    return NextResponse.json({ error: 'Unable to send reset link. Please try again.' }, { status: 500 });
  }
}