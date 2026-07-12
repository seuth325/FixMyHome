'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import { createReviewSchema, type CreateReviewInput } from '@/lib/validations/review';
import { StarRating } from '@/components/ui/star-rating';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

type JobDetail = {
  id: string;
  title: string;
  category: string;
  status: string;
  hasReview: boolean;
  bids: Array<{
    id: string;
    status: string;
    amount: number;
    handyman: { id: string; name: string };
  }>;
};

export default function LeaveReviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);
  const [stars, setStars] = useState(0);
  const [starsError, setStarsError] = useState('');

  const { data: job, isPending } = useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) throw new Error('Not found');
      return res.json() as Promise<JobDetail>;
    },
  });

  const submitReview = useMutation({
    mutationFn: async (data: CreateReviewInput & { stars: number }) => {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, jobId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to submit');
      }
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      toast.success('Review submitted!', { description: 'Thank you for your feedback.' });
    },
  });

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<CreateReviewInput>({
    resolver: zodResolver(createReviewSchema),
    defaultValues: { stars: 0 },
  });

  const textLength = watch('text')?.length ?? 0;
  const acceptedBid = job?.bids.find(b => b.status === 'ACCEPTED');
  const alreadyReviewed = job?.hasReview ?? false;

  const onSubmit = async (data: CreateReviewInput) => {
    if (stars === 0) {
      setStarsError('Please select a star rating');
      return;
    }
    setStarsError('');
    try {
      await submitReview.mutateAsync({ ...data, stars });
    } catch {
      toast.error('Failed to submit review. Please try again.');
    }
  };

  if (isPending) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b">
          <div className="container mx-auto px-4 py-4">
            <Skeleton className="h-9 w-32" />
          </div>
        </header>
        <div className="container mx-auto px-4 py-8 max-w-2xl space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b">
          <div className="container mx-auto px-4 py-4">
            <Link href="/jobs"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Back</Button></Link>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">Job Not Found</h1>
        </div>
      </div>
    );
  }

  if (job.status !== 'COMPLETED') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b">
          <div className="container mx-auto px-4 py-4">
            <Link href={`/jobs/${jobId}`}><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Back</Button></Link>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 text-center max-w-md">
          <AlertCircle className="w-16 h-16 mx-auto text-orange-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Job Not Completed</h1>
          <p className="text-muted-foreground mb-4">
            You can only leave a review after a job has been marked as completed.
          </p>
          <Link href={`/jobs/${jobId}`}><Button>View Job</Button></Link>
        </div>
      </div>
    );
  }

  if (submitted || alreadyReviewed) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-3xl font-bold mb-2">
            {alreadyReviewed && !submitted ? 'Already Reviewed' : 'Review Submitted!'}
          </h1>
          <p className="text-muted-foreground mb-2">
            {alreadyReviewed && !submitted
              ? <>You&apos;ve already left a review for <strong>{job.title}</strong>.</>
              : <>Thank you for your feedback on <strong>{job.title}</strong>.</>}
          </p>
          <div className="flex justify-center my-4">
            <StarRating value={stars} readonly size="lg" />
          </div>
          <p className="text-sm text-muted-foreground mb-8">
            Your review helps the FixMyHome community find great handymen.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/jobs"><Button variant="outline">My Jobs</Button></Link>
            {acceptedBid && (
              <Link href={`/profile/${acceptedBid.handyman.id}`}>
                <Button>View Handyman Profile</Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <Link href={`/jobs/${jobId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Job
            </Button>
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Breadcrumb
          items={[
            { label: 'My Jobs', href: '/jobs' },
            { label: job.title, href: `/jobs/${jobId}` },
            { label: 'Leave a Review' },
          ]}
        />
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">Leave a Review</h1>
          <p className="text-muted-foreground">How did {acceptedBid?.handyman.name ?? 'the handyman'} do?</p>
        </div>

        <Card className="mb-6 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{job.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs">{job.category}</Badge>
                  {acceptedBid && (
                    <span className="text-sm text-muted-foreground">
                      Paid {formatCurrency(acceptedBid.amount)}
                    </span>
                  )}
                </div>
              </div>
              {acceptedBid && (
                <Link href={`/profile/${acceptedBid.handyman.id}`}>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center cursor-pointer hover:bg-primary/20 transition-colors">
                    <span className="text-primary font-semibold text-lg">
                      {acceptedBid.handyman.name.charAt(0)}
                    </span>
                  </div>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your Review</CardTitle>
            <CardDescription>
              Be honest and specific — your review helps other homeowners make informed decisions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <Label>Overall Rating <span className="text-red-500">*</span></Label>
                <div className="py-2">
                  <StarRating
                    value={stars}
                    onChange={(val) => {
                      setStars(val);
                      setValue('stars', val, { shouldValidate: true });
                      setStarsError('');
                    }}
                    size="lg"
                    showLabel
                  />
                </div>
                {starsError && <p className="text-sm text-red-500">{starsError}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="text">
                  Written Review <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="text"
                  placeholder="Describe your experience. Was the work done well? Were they on time and professional? Would you hire them again?"
                  rows={5}
                  {...register('text')}
                  disabled={submitReview.isPending}
                />
                {errors.text && <p className="text-sm text-red-500">{errors.text.message}</p>}
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Minimum 20 characters</span>
                  <span className={textLength > 900 ? 'text-orange-500' : ''}>{textLength} / 1000</span>
                </div>
              </div>

              <div className="flex gap-3 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                  disabled={submitReview.isPending}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitReview.isPending} className="flex-1">
                  {submitReview.isPending ? 'Submitting...' : 'Submit Review'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
