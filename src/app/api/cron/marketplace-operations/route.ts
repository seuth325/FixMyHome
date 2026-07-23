import { NextResponse } from 'next/server';
import { runMarketplaceOperations } from '@/lib/marketplace-operations';

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  const cronSecret = request.headers.get('x-cron-secret');
  if (!secret || (authorization !== `Bearer ${secret}` && cronSecret !== secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await runMarketplaceOperations({ trigger: 'SCHEDULED' }));
  } catch (error) {
    console.error('Scheduled marketplace operations run failed:', error);
    return NextResponse.json({ error: 'Marketplace operations run failed' }, { status: 500 });
  }
}