import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendContactEmail } from '@/lib/email';
import { db } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(100),
  email: z.string().trim().email('Please enter a valid email address').max(160),
  role: z.enum(['Homeowner', 'Handyman', 'Business', 'Other']),
  reason: z.enum(['Account help', 'Job or bid support', 'Technical issue', 'Business inquiry', 'Handyman Growth Package', 'Other']),
  message: z.string().trim().min(20, 'Please include at least 20 characters').max(3000),
});

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, 'contact', 5, 60 * 60 * 1000);
  if (!rateLimit.allowed) return NextResponse.json({ error: 'Too many messages. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } });

  try {
    const body = await request.json();
    const parsed = contactSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Please check the form and try again.' }, { status: 400 });
    }

    await db.contactSubmission.create({ data: parsed.data });
    await sendContactEmail(parsed.data);
    return NextResponse.json({ ok: true, message: 'Thanks. Your message has been sent.' });
  } catch (error) {
    console.error('Contact form failed:', error);
    return NextResponse.json({ error: 'Unable to send your message right now. Please email support@fixmyhome.pro.' }, { status: 500 });
  }
}
