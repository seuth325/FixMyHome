'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { useAcceptBid, useDeclineBid } from '@/lib/hooks/use-bids';
import { useUpdateJobStatus } from '@/lib/hooks/use-jobs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  DollarSign,
  MapPin,
  Calendar,
  Briefcase,
  Clock,
  User as UserIcon,
  TrendingUp,
  Star,
  CheckCircle,
  XCircle,
  Sparkles,
  Info,
} from 'lucide-react';
import { formatCurrency, formatRelativeTime, formatDate } from '@/lib/utils';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

type JobDetail = {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  budget: number;
  status: string;
  createdAt: string;
  preferredDate: string | null;
  homeowner: { id: string; name: string };
  photos: { id: string; url: string }[];
  bids: Array<{
    id: string;
    handymanId: string;
    amount: number;
    message: string;
    etaDays: number;
    status: string;
    createdAt: string;
    score: number;
    isRecommended: boolean;
    handyman: {
      id: string;
      name: string;
      handymanProfile: { businessName: string | null; ratingAvg: number; ratingCount: number } | null;
    };
  }>;
  myBid: { id: string; amount: number; status: string } | null;
  hasReview: boolean;
};

async function fetchJob(id: string): Promise<JobDetail> {
  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error('Failed to fetch job');
  return res.json();
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user: currentUser, isLoaded: userLoaded } = useCurrentUser();
  const { data: job, isPending: jobPending, error } = useQuery({
    queryKey: ['job', id],
    queryFn: () => fetchJob(id),
    staleTime: 20_000,
  });

  const acceptBid = useAcceptBid(id);
  const declineBid = useDeclineBid(id);
  const updateStatus = useUpdateJobStatus();

  const isHandyman = currentUser?.role === 'HANDYMAN';
  const isLoading = !userLoaded || jobPending;

  const handleAcceptBid = async (bidId: string, handymanName: string) => {
    try {
      await acceptBid.mutateAsync(bidId);
      toast.success('Bid accepted!', {
        description: `You've awarded this job to ${handymanName}. They'll be notified right away.`,
      });
    } catch {
      toast.error('Failed to accept bid. Please try again.');
    }
  };

  const handleDeclineBid = async (bidId: string) => {
    try {
      await declineBid.mutateAsync(bidId);
      toast.info('Bid declined', { description: 'The handyman has been notified.' });
    } catch {
      toast.error('Failed to decline bid. Please try again.');
    }
  };

  const handleStatusChange = async (status: string) => {
    try {
      await updateStatus.mutateAsync({ jobId: id, status });
      if (status === 'CANCELLED') toast.info('Job closed');
      if (status === 'COMPLETED') toast.success('Job marked as complete!');
    } catch {
      toast.error('Failed to update job status.');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'IN_REVIEW': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'AWARDED': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'COMPLETED': return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      case 'CANCELLED': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="container mx-auto px-4 py-4">
            <Skeleton className="h-9 w-36" />
          </div>
        </header>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <Skeleton className="h-5 w-48 mb-6" />
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <Skeleton className="h-7 w-64" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-40" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Separator />
                  <div className="grid sm:grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
                        <div className="space-y-1">
                          <Skeleton className="h-3 w-16" />
                          <Skeleton className="h-5 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader><Skeleton className="h-6 w-20" /></CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="container mx-auto px-4 py-4">
            <Link href={isHandyman ? '/browse' : '/jobs'}>
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
            </Link>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">Job Not Found</h1>
          <p className="text-muted-foreground">The job you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  const { bids } = job;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <Link href={isHandyman ? '/browse' : '/jobs'}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {isHandyman ? 'Back to Browse' : 'Back to My Jobs'}
            </Button>
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Breadcrumb
          items={[
            { label: isHandyman ? 'Browse' : 'My Jobs', href: isHandyman ? '/browse' : '/jobs' },
            { label: job.title },
          ]}
        />
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h1 className="text-2xl font-bold">{job.title}</h1>
                      <Badge className={getStatusColor(job.status)}>
                        {job.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <Badge variant="outline">{job.category}</Badge>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>Posted {formatRelativeTime(job.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold mb-2">Description</h3>
                    <p className="text-muted-foreground whitespace-pre-wrap">{job.description}</p>
                  </div>

                  {job.photos.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h3 className="font-semibold mb-3">Photos ({job.photos.length})</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {job.photos.map((photo) => (
                            <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer" className="block">
                              <img
                                src={photo.url}
                                alt="Job photo"
                                className="w-full aspect-square object-cover rounded-lg border border-gray-200 dark:border-gray-700 hover:opacity-90 transition-opacity cursor-zoom-in"
                              />
                            </a>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                        <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Budget</p>
                        <p className="font-semibold text-lg">{formatCurrency(job.budget)}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-5 h-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Location</p>
                        <p className="font-semibold">{job.location}</p>
                      </div>
                    </div>

                    {job.preferredDate && (
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center flex-shrink-0">
                          <Clock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Preferred Start</p>
                          <p className="font-semibold">{formatDate(job.preferredDate)}</p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center flex-shrink-0">
                        <UserIcon className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Posted by</p>
                        <p className="font-semibold">{job.homeowner.name}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bids Section (Homeowner) */}
            {!isHandyman && (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>Bids Received ({bids.length})</CardTitle>
                      <CardDescription>Review and compare bids from local handymen</CardDescription>
                    </div>
                    {bids.some(b => b.isRecommended) && (
                      <div className="flex items-center gap-1.5 text-xs text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950 border border-violet-200 dark:border-violet-800 rounded-md px-2.5 py-1.5 flex-shrink-0">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>AI-ranked by price, rating &amp; capacity</span>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {bids.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="font-medium">No bids yet</p>
                      <p className="text-sm mt-1">Handymen in your area will be notified. Check back soon.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {bids.map((bid) => {
                        const rating = bid.handyman.handymanProfile?.ratingAvg ?? 0;
                        const isAccepted = bid.status === 'ACCEPTED';
                        const isDeclined = bid.status === 'DECLINED';
                        const isPending = bid.status === 'PENDING';
                        return (
                          <div
                            key={bid.id}
                            className={`border rounded-lg p-4 ${
                              bid.isRecommended
                                ? 'border-violet-300 dark:border-violet-700 bg-violet-50/40 dark:bg-violet-950/30'
                                : 'border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <h4 className="font-semibold">{bid.handyman.name}</h4>
                                  <div className="flex items-center gap-1 text-sm">
                                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                                    <span className="font-medium">{rating.toFixed(1)}</span>
                                  </div>
                                  {bid.isRecommended && (
                                    <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 border-violet-300 dark:border-violet-700 gap-1">
                                      <Sparkles className="w-3 h-3" />
                                      AI Pick
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                  <span className="font-semibold text-primary text-lg">{formatCurrency(bid.amount)}</span>
                                  <span>•</span>
                                  <span>{bid.etaDays} day{bid.etaDays !== 1 ? 's' : ''}</span>
                                  <span>•</span>
                                  <span>{formatRelativeTime(bid.createdAt)}</span>
                                </div>
                              </div>
                              <div className="flex-shrink-0 ml-3 text-center">
                                <div className={`text-sm font-bold rounded-full w-10 h-10 flex items-center justify-center ${
                                  bid.score >= 75
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                    : bid.score >= 55
                                      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                }`}>
                                  {Math.round(bid.score)}
                                </div>
                              </div>
                            </div>

                            <p className="text-sm text-muted-foreground mb-3">{bid.message}</p>

                            <div className="flex gap-2 flex-wrap items-center">
                              <Link href={`/profile/${bid.handymanId}`}>
                                <Button size="sm" variant="outline">View Profile</Button>
                              </Link>
                              <Link href={`/messages/${bid.id}`}>
                                <Button size="sm" variant="outline">Message</Button>
                              </Link>
                              {isPending && job.status !== 'AWARDED' && (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => handleAcceptBid(bid.id, bid.handyman.name)}
                                    disabled={acceptBid.isPending}
                                  >
                                    <CheckCircle className="w-4 h-4 mr-1" />
                                    {acceptBid.isPending ? 'Accepting...' : 'Accept Bid'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => handleDeclineBid(bid.id)}
                                    disabled={declineBid.isPending}
                                  >
                                    <XCircle className="w-4 h-4 mr-1" />
                                    {declineBid.isPending ? 'Declining...' : 'Decline'}
                                  </Button>
                                </>
                              )}
                              {isAccepted && (
                                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  Awarded
                                </Badge>
                              )}
                              {isDeclined && (
                                <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Declined</Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!isHandyman && (
                  <>
                    {(job.status === 'OPEN' || job.status === 'IN_REVIEW') && (
                      <>
                        {job.status === 'OPEN' && (
                          <Link href={`/jobs/${id}/edit`}>
                            <Button className="w-full" variant="outline">Edit Job</Button>
                          </Link>
                        )}
                        <Button
                          className="w-full"
                          variant="outline"
                          disabled={updateStatus.isPending}
                          onClick={() => handleStatusChange('CANCELLED')}
                        >
                          Close Job
                        </Button>
                      </>
                    )}
                    {job.status === 'AWARDED' && (
                      <Button
                        className="w-full"
                        disabled={updateStatus.isPending}
                        onClick={() => handleStatusChange('COMPLETED')}
                      >
                        Mark as Complete
                      </Button>
                    )}
                    {job.status === 'COMPLETED' && (
                      <Link href={`/review/${id}`}>
                        <Button className="w-full">{job.hasReview ? 'Review Submitted ✓' : 'Leave Review'}</Button>
                      </Link>
                    )}
                  </>
                )}
                {isHandyman && job.status === 'OPEN' && (
                  <>
                    {job.myBid ? (
                      <div className="space-y-2">
                        <div className="text-sm text-center p-2 rounded-md bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200">
                          You bid <strong>{formatCurrency(job.myBid.amount)}</strong>
                        </div>
                        <Link href={`/jobs/${id}/bid`}>
                          <Button className="w-full" variant="outline">Update Bid</Button>
                        </Link>
                      </div>
                    ) : (
                      <Link href={`/jobs/${id}/bid`}>
                        <Button className="w-full">Submit Bid</Button>
                      </Link>
                    )}
                  </>
                )}
                {!(!isHandyman && ['OPEN', 'IN_REVIEW', 'AWARDED', 'COMPLETED'].includes(job.status)) &&
                 !(isHandyman && job.status === 'OPEN') && (
                  <div className="text-center py-5 text-muted-foreground">
                    <Info className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm font-medium">No actions available</p>
                    <p className="text-xs mt-1">
                      {job.status === 'CANCELLED' ? 'This job has been closed.' :
                       job.status === 'AWARDED' ? 'This job is in progress.' :
                       job.status === 'COMPLETED' ? 'This job is complete.' : 'Check back later.'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Job Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Briefcase className="w-4 h-4" />
                    <span className="text-sm">Bids Received</span>
                  </div>
                  <span className="font-semibold">{bids.length}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-sm">Average Bid</span>
                  </div>
                  <span className="font-semibold">
                    {bids.length > 0
                      ? formatCurrency(bids.reduce((s, b) => s + b.amount, 0) / bids.length)
                      : 'N/A'}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <DollarSign className="w-4 h-4" />
                    <span className="text-sm">Lowest Bid</span>
                  </div>
                  <span className="font-semibold">
                    {bids.length > 0
                      ? formatCurrency(Math.min(...bids.map(b => b.amount)))
                      : 'N/A'}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
