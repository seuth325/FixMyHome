import type React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, DollarSign, Clock, AlertCircle, MapPin, Calendar, CheckCircle } from 'lucide-react';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ submitted?: string; error?: string }>;
};

export default async function SubmitBidPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const user = await requireUser();

  if (user.role !== 'HANDYMAN') {
    redirect('/role-selection');
  }

  const job = await db.job.findUnique({
    where: { id },
    include: {
      _count: { select: { bids: true } },
      bids: {
        where: { handymanId: user.id },
        select: { id: true, amount: true, message: true, etaDays: true },
        take: 1,
      },
    },
  });

  if (!job) {
    return (
      <Shell backHref="/browse" backLabel="Back to Browse">
        <div className="py-16 text-center">
          <h1 className="mb-2 text-2xl font-bold">Job Not Found</h1>
          <p className="text-muted-foreground">The job you are looking for does not exist.</p>
        </div>
      </Shell>
    );
  }

  const existingBid = job.bids[0] ?? null;
  const budget = Number(job.budget);
  const submitted = query.submitted === '1';
  const error = query.error;

  if (submitted) {
    return (
      <Shell backHref="/handyman/dashboard" backLabel="Back to Dashboard" narrow>
        <Card className="w-full text-center">
          <CardHeader>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
              <CheckCircle className="h-7 w-7" />
            </div>
            <CardTitle>{existingBid ? 'Bid Updated' : 'Bid Submitted'}</CardTitle>
            <CardDescription>Your bid has been saved and sent to the homeowner.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild className="w-full"><a href="/bids">View My Bids</a></Button>
            <Button asChild variant="outline" className="w-full"><a href="/handyman/dashboard">Back to Dashboard</a></Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (job.status !== 'OPEN' && job.status !== 'IN_REVIEW') {
    return (
      <Shell backHref="/browse" backLabel="Back to Browse">
        <div className="py-16 text-center">
          <AlertCircle className="mx-auto mb-4 h-16 w-16 text-orange-500" />
          <h1 className="mb-2 text-2xl font-bold">Bidding Closed</h1>
          <p className="mb-4 text-muted-foreground">
            This job is no longer accepting bids. It is currently "{job.status.replace('_', ' ')}".
          </p>
          <Link href="/browse"><Button>Browse Other Jobs</Button></Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell backHref={`/jobs/${id}`} backLabel="Back to Job Details">
      <div className="mb-6">
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/browse" className="hover:text-foreground">Browse</Link>
          <span>/</span>
          <Link href={`/jobs/${id}`} className="hover:text-foreground">{job.title}</Link>
          <span>/</span>
          <span>{existingBid ? 'Update Bid' : 'Submit Bid'}</span>
        </div>
        <h1 className="mb-1 text-3xl font-bold">{existingBid ? 'Update Your Bid' : 'Submit a Bid'}</h1>
        <p className="text-muted-foreground">
          {existingBid ? 'Make changes to your existing bid.' : "Convince the homeowner you're the right person for the job."}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Your Bid</CardTitle>
              <CardDescription>Be clear, competitive, and professional</CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                  {error}
                </div>
              )}
              <form action={`/api/jobs/${id}/bids`} method="post" className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="amount" className="text-sm font-medium">Your Bid Amount <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input id="amount" name="amount" type="number" min="1" max="50000" step="1" required defaultValue={existingBid ? Number(existingBid.amount) : ''} className="pl-7" />
                  </div>
                  <p className="text-xs text-muted-foreground">Homeowner budget: {formatCurrency(budget)}</p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="etaDays" className="text-sm font-medium">Estimated Completion <span className="text-red-500">*</span></label>
                  <div className="flex items-center gap-3">
                    <Input id="etaDays" name="etaDays" type="number" min="1" max="90" step="1" required defaultValue={existingBid?.etaDays ?? ''} className="w-32" />
                    <span className="text-sm text-muted-foreground">days after award</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="message" className="text-sm font-medium">Cover Message <span className="text-red-500">*</span></label>
                  <Textarea id="message" name="message" required minLength={30} maxLength={1000} rows={6} defaultValue={existingBid?.message ?? ''} placeholder="Introduce yourself, describe your approach, mention relevant experience, and explain why you're the best fit for this job..." />
                  <p className="text-xs text-muted-foreground">Minimum 30 characters.</p>
                </div>

                <div className="flex gap-3 border-t pt-4">
                  <Button asChild variant="outline" className="flex-1"><a href={`/jobs/${id}`}>Cancel</a></Button>
                  <Button type="submit" className="flex-1">{existingBid ? 'Update Bid' : 'Submit Bid'}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Job Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="font-semibold">{job.title}</p>
              <Badge variant="outline">{job.category}</Badge>
              <p className="line-clamp-4 text-muted-foreground">{job.description}</p>
              <Separator />
              <div className="space-y-2 text-muted-foreground">
                <InfoRow icon={<DollarSign className="h-4 w-4" />} label="Budget" value={formatCurrency(budget)} />
                <InfoRow icon={<MapPin className="h-4 w-4" />} label="ZIP" value={job.location} />
                <InfoRow icon={<Calendar className="h-4 w-4" />} label="Posted" value={formatRelativeTime(job.createdAt)} />
                {job._count.bids > 0 && <InfoRow icon={<Clock className="h-4 w-4" />} label="Bids" value={`${job._count.bids} submitted`} />}
              </div>
            </CardContent>
          </Card>

          <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
            <CardContent className="space-y-1 pt-4 text-xs text-blue-800 dark:text-blue-200">
              <p className="font-semibold">Tips for winning bids:</p>
              <p>- Bid competitively but do not undervalue your work</p>
              <p>- Mention specific experience with this type of job</p>
              <p>- Provide a realistic timeline</p>
              <p>- Be professional and responsive</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, backHref, backLabel, narrow = false }: { children: React.ReactNode; backHref: string; backLabel: string; narrow?: boolean }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="container mx-auto px-4 py-4">
          <Link href={backHref}>
            <Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />{backLabel}</Button>
          </Link>
        </div>
      </header>
      <main className={`container mx-auto px-4 py-8 ${narrow ? 'flex min-h-[calc(100vh-73px)] max-w-md items-center' : 'max-w-3xl'}`}>
        {children}
      </main>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span>{label}: <span className="font-medium text-foreground">{value}</span></span>
    </div>
  );
}
