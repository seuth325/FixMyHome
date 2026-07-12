'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useSubmitBid } from '@/lib/hooks/use-bids';
import { createBidSchema, type CreateBidInput } from '@/lib/validations/bid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { ArrowLeft, DollarSign, Clock, AlertCircle, MapPin, Calendar } from 'lucide-react';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumb } from '@/components/ui/breadcrumb';

type JobForBid = {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  budget: number;
  status: string;
  createdAt: string;
  _count: { bids: number };
  myBid: { id: string; amount: number; message: string; etaDays: number } | null;
};

async function fetchJob(id: string): Promise<JobForBid> {
  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error('Not found');
  return res.json();
}

export default function SubmitBidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: job, isPending } = useQuery({
    queryKey: ['job', id],
    queryFn: () => fetchJob(id),
    staleTime: 20_000,
  });

  const submitBid = useSubmitBid(id);
  const existingBid = job?.myBid;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CreateBidInput>({
    resolver: zodResolver(createBidSchema),
    defaultValues: existingBid
      ? { amount: existingBid.amount, message: existingBid.message, etaDays: existingBid.etaDays }
      : undefined,
  });

  const bidAmount = watch('amount');
  const messageLength = watch('message')?.length ?? 0;

  const onSubmit = async (data: CreateBidInput) => {
    try {
      await submitBid.mutateAsync(data);
      toast.success(existingBid ? 'Bid updated!' : 'Bid submitted!', {
        description: existingBid
          ? 'Your bid has been updated.'
          : 'The homeowner will be notified of your bid.',
      });
      router.push('/bids');
    } catch {
      toast.error('Failed to submit bid. Please try again.');
    }
  };

  if (isPending) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="container mx-auto px-4 py-4">
            <Skeleton className="h-9 w-36" />
          </div>
        </header>
        <div className="container mx-auto px-4 py-8 max-w-3xl">
          <Skeleton className="h-5 w-56 mb-6" />
          <Skeleton className="h-9 w-48 mb-2" />
          <Skeleton className="h-5 w-64 mb-6" />
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-20 mb-1" />
                  <Skeleton className="h-4 w-48" />
                </CardHeader>
                <CardContent className="space-y-6">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b">
          <div className="container mx-auto px-4 py-4">
            <Link href="/browse">
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Back to Browse</Button>
            </Link>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">Job Not Found</h1>
        </div>
      </div>
    );
  }

  if (job.status !== 'OPEN' && job.status !== 'IN_REVIEW') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b">
          <div className="container mx-auto px-4 py-4">
            <Link href="/browse">
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Back to Browse</Button>
            </Link>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 text-center">
          <AlertCircle className="w-16 h-16 mx-auto text-orange-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Bidding Closed</h1>
          <p className="text-muted-foreground mb-4">
            This job is no longer accepting bids. It is currently "{job.status.replace('_', ' ')}".
          </p>
          <Link href="/browse"><Button>Browse Other Jobs</Button></Link>
        </div>
      </div>
    );
  }

  const underBudget = bidAmount && bidAmount <= job.budget;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <Link href={`/jobs/${id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Job Details
            </Button>
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Breadcrumb
          items={[
            { label: 'Browse', href: '/browse' },
            { label: job.title, href: `/jobs/${id}` },
            { label: existingBid ? 'Update Bid' : 'Submit Bid' },
          ]}
        />
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">
            {existingBid ? 'Update Your Bid' : 'Submit a Bid'}
          </h1>
          <p className="text-muted-foreground">
            {existingBid ? 'Make changes to your existing bid.' : "Convince the homeowner you're the right person for the job."}
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Your Bid</CardTitle>
                <CardDescription>Be clear, competitive, and professional</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="amount">Your Bid Amount <span className="text-red-500">*</span></Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="amount"
                        type="number"
                        placeholder="0"
                        className="pl-7"
                        {...register('amount', { valueAsNumber: true })}
                        disabled={submitBid.isPending}
                      />
                    </div>
                    {errors.amount && <p className="text-sm text-red-500">{errors.amount.message}</p>}
                    {bidAmount > 0 && (
                      <p className={`text-xs font-medium ${underBudget ? 'text-green-600' : 'text-orange-600'}`}>
                        {underBudget
                          ? `✓ Within the homeowner's budget of ${formatCurrency(job.budget)}`
                          : `⚠ Exceeds homeowner's budget of ${formatCurrency(job.budget)}`}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="etaDays">Estimated Completion <span className="text-red-500">*</span></Label>
                    <div className="flex items-center gap-3">
                      <Input
                        id="etaDays"
                        type="number"
                        placeholder="3"
                        className="w-32"
                        min={1}
                        max={90}
                        {...register('etaDays', { valueAsNumber: true })}
                        disabled={submitBid.isPending}
                      />
                      <span className="text-muted-foreground text-sm">days after award</span>
                    </div>
                    {errors.etaDays && <p className="text-sm text-red-500">{errors.etaDays.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="message">Cover Message <span className="text-red-500">*</span></Label>
                    <Textarea
                      id="message"
                      placeholder="Introduce yourself, describe your approach, mention relevant experience, and explain why you're the best fit for this job..."
                      rows={6}
                      {...register('message')}
                      disabled={submitBid.isPending}
                    />
                    {errors.message && <p className="text-sm text-red-500">{errors.message.message}</p>}
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Minimum 30 characters</span>
                      <span className={messageLength > 900 ? 'text-orange-500' : ''}>
                        {messageLength} / 1000
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4 border-t">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.back()}
                      disabled={submitBid.isPending}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={submitBid.isPending} className="flex-1">
                      {submitBid.isPending
                        ? (existingBid ? 'Updating...' : 'Submitting...')
                        : (existingBid ? 'Update Bid' : 'Submit Bid')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Job Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="font-semibold">{job.title}</p>
                <Badge variant="outline">{job.category}</Badge>
                <p className="text-muted-foreground line-clamp-4">{job.description}</p>
                <Separator />
                <div className="space-y-2 text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    <span>Budget: <span className="font-medium text-foreground">{formatCurrency(job.budget)}</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    <span>ZIP: <span className="font-medium text-foreground">{job.location}</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span>Posted {formatRelativeTime(job.createdAt)}</span>
                  </div>
                  {job._count.bids > 0 && (
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{job._count.bids} competing bid{job._count.bids !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
              <CardContent className="pt-4 text-xs text-blue-800 dark:text-blue-200 space-y-1">
                <p className="font-semibold">Tips for winning bids:</p>
                <p>• Bid competitively but don't undervalue your work</p>
                <p>• Mention specific experience with this type of job</p>
                <p>• Provide a realistic timeline</p>
                <p>• Be professional and responsive</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
