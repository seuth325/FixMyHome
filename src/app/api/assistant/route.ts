import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

const schema = z.object({
  message: z.string().trim().min(1).max(1200),
  pagePath: z.string().trim().max(240).default('/'),
  conversation: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1200) })).max(10).default([]),
});

function context(path: string) {
  if (path.startsWith('/homeowner') || path.startsWith('/jobs/new')) return 'Homeowner workspace: posting jobs, comparing bids, inviting handymen, messaging, hiring, and settings.';
  if (path.startsWith('/handyman') || path.includes('/bid') || path === '/browse') return 'Handyman workspace: finding jobs, invitations, bids, messages, profiles, and business growth services.';
  if (path.startsWith('/for-pros')) return 'Handyman growth services page. Do not invent pricing or guarantees.';
  return 'Public marketplace page: explain FixMyHome services for homeowners and local handymen.';
}

function outputText(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const data = value as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  return data.output_text || data.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('').trim() || '';
}

export async function POST(request: Request) {
  const limit = checkRateLimit(request, 'assistant', 20, 10 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json({ error: 'Please wait a few minutes before asking another question.' }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Please enter a shorter question.' }, { status: 400 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'The assistant is temporarily unavailable. Please contact support@fixmyhome.pro.' }, { status: 503 });

  const user = await getCurrentUser().catch(() => null);
  const role = user?.role === 'HANDYMAN' ? 'handyman' : user?.role === 'HOMEOWNER' ? 'homeowner' : 'visitor';
  const instructions = `You are the concise, friendly FixMyHome.pro assistant. FixMyHome.pro is a Florida home-repair marketplace created and operated by FixMyHome Pro LLC. Homeowners post projects, compare bids, invite handymen, message, and hire. Handymen create profiles, browse work, receive invitations, submit bids, and may use optional growth services. Viewer: ${role}. Page: ${context(parsed.data.pagePath)} Never claim a provider is licensed, insured, screened, verified, or guaranteed unless confirmed in that profile. Never claim to see private account data. Never ask for passwords, cards, IDs, or sensitive documents. Do not invent prices, policies, availability, or outcomes. Direct policy questions to /terms and /privacy-policy. For account issues, offer Contact support or support@fixmyhome.pro. For dangerous emergencies, advise emergency services or an appropriately licensed local professional. Keep answers under 120 words.`;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL || 'gpt-5-mini', instructions, input: [...parsed.data.conversation, { role: 'user', content: parsed.data.message }], max_output_tokens: 350, store: false }),
    });
    const payload = await response.json().catch(() => null);
    const answer = outputText(payload);
    if (!response.ok || !answer) {
      const apiError = payload && typeof payload === 'object' && 'error' in payload ? (payload as { error?: { code?: string } }).error?.code : undefined;
      console.error('Assistant API response failed:', response.status, apiError || 'empty_output');
      return NextResponse.json({ error: 'I could not answer right now. Please try again or contact support.' }, { status: 502 });
    }
    return NextResponse.json({ answer });
  } catch (error) {
    console.error('Assistant request failed:', error);
    return NextResponse.json({ error: 'I could not answer right now. Please try again or contact support.' }, { status: 502 });
  }
}
