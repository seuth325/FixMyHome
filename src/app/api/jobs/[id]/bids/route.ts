import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { createBidSchema } from '@/lib/validations/bid';
import { sendMarketplaceEmail } from '@/lib/email';
import { checkRateLimit } from '@/lib/rate-limit';

type Params = { params: Promise<{ id: string }> };

function formRedirect(_request: Request, jobId: string, params: Record<string, string>) {
  const search = new URLSearchParams(params).toString();
  const location = `/jobs/${jobId}/bid${search ? `?${search}` : ''}`;
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

function errorMessage(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'fieldErrors' in error) return 'Please check the bid form and try again.';
  return 'Failed to submit bid. Please try again.';
}

// POST /api/jobs/[id]/bids - handyman submits or updates a bid
export async function POST(request: Request, { params }: Params) {
  const rateLimit = checkRateLimit(request, 'submit-bid', 20, 60 * 60 * 1000);
  if (!rateLimit.allowed) return NextResponse.json({ error: 'Too many bid attempts. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } });

  const contentType = request.headers.get('content-type') ?? '';
  const isFormPost = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');
  const { id: jobId } = await params;

  try {
    const user = await requireUser();

    if (user.role !== 'HANDYMAN') {
      if (isFormPost) return formRedirect(request, jobId, { error: 'Only handyman accounts can submit bids.' });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: unknown;
    if (isFormPost) {
      const form = await request.formData();
      body = {
        amount: Number(form.get('amount')),
        message: String(form.get('message') ?? ''),
        etaDays: Number(form.get('etaDays')),
      };
    } else {
      body = await request.json();
    }

    const parsed = createBidSchema.safeParse(body);
    if (!parsed.success) {
      if (isFormPost) return formRedirect(request, jobId, { error: errorMessage(parsed.error.flatten()) });
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const job = await db.job.findUnique({ where: { id: jobId }, include: { homeowner: { select: { name: true, email: true, emailOptOut: true } } } });
    if (!job) {
      if (isFormPost) return formRedirect(request, jobId, { error: 'Job not found.' });
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (job.status !== 'OPEN' && job.status !== 'IN_REVIEW') {
      if (isFormPost) return formRedirect(request, jobId, { error: 'Bidding is closed.' });
      return NextResponse.json({ error: 'Bidding is closed' }, { status: 400 });
    }

    const existing = await db.bid.findFirst({
      where: { jobId, handymanId: user.id },
    });

    const bid = await db.bid.upsert({
      where: { id: existing?.id ?? '__new__' },
      create: {
        jobId,
        handymanId: user.id,
        amount: parsed.data.amount,
        message: parsed.data.message,
        etaDays: parsed.data.etaDays,
        status: 'PENDING',
      },
      update: {
        amount: parsed.data.amount,
        message: parsed.data.message,
        etaDays: parsed.data.etaDays,
      },
    });

    if (!existing && job.status === 'OPEN') {
      await db.job.update({ where: { id: jobId }, data: { status: 'IN_REVIEW' } });
    }

    if (!existing) {
      await db.notification.create({
        data: {
          userId: job.homeownerId,
          type: 'NEW_BID',
          title: 'New Bid Received',
          body: `${user.name} submitted a bid of $${parsed.data.amount} on "${job.title}"`,
          linkPath: `/jobs/${jobId}`,
        },
      });
      if (!job.homeowner.emailOptOut) {
        await sendMarketplaceEmail({
          to: job.homeowner.email, name: job.homeowner.name, category: 'NEW_BID',
          subject: 'New bid received on ' + job.title, title: 'You received a new bid',
          body: user.name + ' submitted a $' + parsed.data.amount + ' bid on "' + job.title + '".',
          actionText: 'Review Bid', actionPath: '/jobs/' + jobId,
        }).catch((error) => console.error('New bid email failed', error));
      }
    }

    if (isFormPost) return formRedirect(request, jobId, { submitted: '1' });
    return NextResponse.json({ ...bid, amount: Number(bid.amount) }, { status: existing ? 200 : 201 });
  } catch {
    if (isFormPost) return formRedirect(request, jobId, { error: 'Please sign in and try again.' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
