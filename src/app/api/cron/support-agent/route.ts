import { NextResponse } from 'next/server';
import { runSupportAgent } from '@/lib/support-agent';

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  if (!secret || authorization !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await runSupportAgent({ trigger: 'SCHEDULED' });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Scheduled support agent failed:', error);
    return NextResponse.json({ error: 'Support agent run failed' }, { status: 500 });
  }
}
