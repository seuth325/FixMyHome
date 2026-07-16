import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendContactEmail } from '@/lib/email';

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(100),
  email: z.string().trim().email('Please enter a valid email address').max(160),
  role: z.enum(['Homeowner', 'Handyman', 'Business', 'Other']),
  reason: z.enum(['Account help', 'Job or bid support', 'Technical issue', 'Business inquiry', 'Other']),
  message: z.string().trim().min(20, 'Please include at least 20 characters').max(3000),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = contactSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Please check the form and try again.' }, { status: 400 });
    }

    await sendContactEmail(parsed.data);
    return NextResponse.json({ ok: true, message: 'Thanks. Your message has been sent.' });
  } catch (error) {
    console.error('Contact form failed:', error);
    return NextResponse.json({ error: 'Unable to send your message right now. Please email support@fixmyhome.pro.' }, { status: 500 });
  }
}