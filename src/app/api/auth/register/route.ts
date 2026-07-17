import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { registerSchema } from '@/lib/validations/auth';
import { hashPassword } from '@/lib/password';
import { sendNewUserNotification, sendWelcomeEmail } from '@/lib/email';

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: 'HOMEOWNER' },
  });

  const emailResults = await Promise.allSettled([
    sendWelcomeEmail({ to: user.email, name: user.name }),
    sendNewUserNotification({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    }),
  ]);

  for (const result of emailResults) {
    if (result.status === 'rejected') console.error('Failed to send registration email', result.reason);
  }

  return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
}
