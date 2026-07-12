'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMyBids } from '@/lib/hooks/use-bids';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Briefcase, DollarSign, Clock, Search, TrendingUp } from 'lucide-react';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { toast } from 'sonner';

export default function MyBidsPage() {
  const { data: allBids = [], isPending } = useMyBids();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const withdrawBid = useMutation({
    mutationFn: async (bidId: string) => {
      const res = await fetch(`/api/bids/${bidId}/withdraw`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to withdraw');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-bids'] });
      toast.info('Bid withdrawn');
    },
    onError: () => toast.error('Failed to withdraw bid.'),
  });

  const filteredBids = statusFilter === 'all'
    ? allBids
    : allBids.filter(b => b.status === statusFilter);

  const pendingCount = allBids.filter(b => b.status === 'PENDING').length;
  const acceptedCount = allBids.filter(b => b.status === 'ACCEPTED').length;
  const declinedCount = allBids.filter(b => b.status === 'DECLINED').length;
  const totalEarnings = allBids
    .filter(b => b.status === 'ACCEPTED')
    .reduce((sum, b) => sum + b.amount, 0);

  const getBidStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING':   return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'ACCEPTED':  return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'DECLINED':  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'WITHDRAWN': return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      default:          return 'bg-gray-100 text-gray-800';
    }
  };

  if (isPending) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-36" />
          </div>
        </header>
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <Skeleton className="h-9 w-28 mb-2" />
            <Skeleton className="h-5 w-52" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent className="pt-4 pb-4">
                  <Skeleton className="h-3 w-16 mb-2" />
                  <Skeleton className="h-8 w-12" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </div>
                      <Skeleton className="h-5 w-24 rounded-full" />
                    </div>
                    <div className="text-right space-y-1">
                      <Skeleton className="h-8 w-20 ml-auto" />
                      <Skeleton className="h-3 w-12 ml-auto" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-5/6 mb-4" />
                  <div className="flex flex-wrap gap-4 mb-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-36" />
                  </div>
                  <Separator className="mb-4" />
                  <div className="flex gap-2">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-8 w-24" />
                    <Skeleton className="h-8 w-20" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/handyman/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
          <Link href="/browse">
            <Button size="sm">
              <Search className="w-4 h-4 mr-2" />
              Browse More Jobs
            </Button>
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <Breadcrumb
          items={[
            { label: 'Dashboard', href: '/handyman/dashboard' },
            { label: 'My Bids' },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">My Bids</h1>
          <p className="text-muted-foreground">Track all bids you&apos;ve submitted</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Accepted</p>
              <p className="text-2xl font-bold text-green-600">{acceptedCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Declined</p>
              <p className="text-2xl font-bold text-red-600">{declinedCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Won Value</p>
              <p className="text-2xl font-bold text-primary">
                {totalEarnings > 0 ? formatCurrency(totalEarnings) : '--'}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mb-6 flex items-center gap-4">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-semibold">{filteredBids.length}</span> bid{filteredBids.length !== 1 ? 's' : ''}
          </p>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="ACCEPTED">Accepted</SelectItem>
              <SelectItem value="DECLINED">Declined</SelectItem>
              <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filteredBids.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Briefcase className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {statusFilter !== 'all' ? `No ${statusFilter.toLowerCase()} bids` : 'No bids yet'}
              </h3>
              <p className="text-muted-foreground mb-4">
                {statusFilter !== 'all'
                  ? 'Try changing the filter above'
                  : 'Browse available jobs and start bidding!'}
              </p>
              <Link href="/browse">
                <Button>
                  <Search className="w-4 h-4 mr-2" />
                  Browse Jobs
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredBids.map((bid) => (
              <Card key={bid.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-lg">{bid.job.title}</h3>
                        <Badge className={getBidStatusColor(bid.status)}>
                          {bid.status}
                        </Badge>
                      </div>
                      <Badge variant="outline" className="text-xs mb-2">{bid.job.category}</Badge>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">{formatCurrency(bid.amount)}</p>
                      <p className="text-xs text-muted-foreground">your bid</p>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{bid.message}</p>

                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-4">
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      <span>{bid.etaDays} day{bid.etaDays !== 1 ? 's' : ''} to complete</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <DollarSign className="w-4 h-4" />
                      <span>Budget: {formatCurrency(bid.job.budget)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" />
                      <span>Submitted {formatRelativeTime(bid.createdAt)}</span>
                    </div>
                  </div>

                  <Separator className="mb-4" />

                  <div className="flex gap-2">
                    <Link href={`/jobs/${bid.job.id}`}>
                      <Button variant="outline" size="sm">View Job</Button>
                    </Link>
                    {bid.status === 'PENDING' && (
                      <>
                        <Link href={`/jobs/${bid.job.id}/bid`}>
                          <Button variant="outline" size="sm">Update Bid</Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          disabled={withdrawBid.isPending}
                          onClick={() => withdrawBid.mutate(bid.id)}
                        >
                          Withdraw
                        </Button>
                      </>
                    )}
                    {(bid.status === 'ACCEPTED' || bid.status === 'PENDING') && (
                      <Link href={`/messages/${bid.id}`}>
                        <Button size="sm" variant={bid.status === 'ACCEPTED' ? 'default' : 'outline'}>
                          {bid.status === 'ACCEPTED' ? 'Message Homeowner' : 'Message'}
                        </Button>
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
