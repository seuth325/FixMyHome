'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useBrowseJobs } from '@/lib/hooks/use-jobs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft,
  Search,
  DollarSign,
  MapPin,
  Calendar,
  TrendingUp,
  Filter,
  X,
} from 'lucide-react';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';
import { JOB_CATEGORIES } from '@/lib/constants';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumb } from '@/components/ui/breadcrumb';

export default function BrowseJobsPage() {
  const { data: allJobs = [], isPending } = useBrowseJobs();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [minBudget, setMinBudget] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'budget_high' | 'budget_low' | 'fewest_bids'>('newest');

  const filteredJobs = allJobs
    .filter((job) => {
      const matchesSearch =
        job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || job.category === categoryFilter;
      const matchesLocation = !locationFilter || job.location.includes(locationFilter);
      const matchesMinBudget = !minBudget || job.budget >= parseFloat(minBudget);
      const matchesMaxBudget = !maxBudget || job.budget <= parseFloat(maxBudget);
      return matchesSearch && matchesCategory && matchesLocation && matchesMinBudget && matchesMaxBudget;
    })
    .sort((a, b) => {
      if (sortBy === 'budget_high') return b.budget - a.budget;
      if (sortBy === 'budget_low') return a.budget - b.budget;
      if (sortBy === 'fewest_bids') return a._count.bids - b._count.bids;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const hasActiveFilters = categoryFilter !== 'all' || minBudget || maxBudget || locationFilter;

  const clearFilters = () => {
    setCategoryFilter('all');
    setMinBudget('');
    setMaxBudget('');
    setLocationFilter('');
  };

  if (isPending) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="container mx-auto px-4 py-4">
            <Skeleton className="h-9 w-40" />
          </div>
        </header>
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <Skeleton className="h-9 w-36 mb-2" />
            <Skeleton className="h-5 w-64" />
          </div>
          <div className="grid lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1">
              <Card>
                <CardHeader><Skeleton className="h-6 w-16" /></CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <div className="grid grid-cols-2 gap-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-3 space-y-4">
              <Card><CardContent className="pt-6"><Skeleton className="h-10 w-full" /></CardContent></Card>
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <div className="mb-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-6 w-52" />
                        <Skeleton className="h-5 w-24 rounded-full" />
                      </div>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                    <div className="flex flex-wrap gap-3 mb-4">
                      <Skeleton className="h-5 w-28" />
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-5 w-32" />
                    </div>
                    <div className="flex gap-2">
                      <Skeleton className="h-8 w-24" />
                      <Skeleton className="h-8 w-24" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <Link href="/handyman/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <Breadcrumb
          items={[
            { label: 'Dashboard', href: '/handyman/dashboard' },
            { label: 'Browse Jobs' },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Browse Jobs</h1>
          <p className="text-muted-foreground">
            Find jobs in your area and submit competitive bids
          </p>
        </div>

        <div className="grid lg:grid-cols-4 gap-6">
          {/* Filters Sidebar */}
          <div className="lg:col-span-1">
            <Card className="sticky top-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Filters</CardTitle>
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="h-auto p-0 text-xs">
                      Clear all
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category</label>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {JOB_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">ZIP Code</label>
                  <Input
                    placeholder="33139"
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    maxLength={5}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Budget Range</label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" placeholder="Min" value={minBudget} onChange={(e) => setMinBudget(e.target.value)} />
                    <Input type="number" placeholder="Max" value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} />
                  </div>
                </div>

                {hasActiveFilters && (
                  <div className="pt-4 border-t">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Active Filters:</p>
                    <div className="space-y-1">
                      {categoryFilter !== 'all' && (
                        <Badge variant="secondary" className="text-xs">
                          {categoryFilter}
                          <button onClick={() => setCategoryFilter('all')} className="ml-1 hover:text-destructive">
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      )}
                      {locationFilter && (
                        <Badge variant="secondary" className="text-xs">
                          ZIP: {locationFilter}
                          <button onClick={() => setLocationFilter('')} className="ml-1 hover:text-destructive">
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      )}
                      {minBudget && (
                        <Badge variant="secondary" className="text-xs">
                          Min: ${minBudget}
                          <button onClick={() => setMinBudget('')} className="ml-1 hover:text-destructive">
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      )}
                      {maxBudget && (
                        <Badge variant="secondary" className="text-xs">
                          Max: ${maxBudget}
                          <button onClick={() => setMaxBudget('')} className="ml-1 hover:text-destructive">
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Jobs List */}
          <div className="lg:col-span-3">
            <Card className="mb-6">
              <CardContent className="pt-6">
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search jobs by title or description..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest first</SelectItem>
                      <SelectItem value="budget_high">Budget: High → Low</SelectItem>
                      <SelectItem value="budget_low">Budget: Low → High</SelectItem>
                      <SelectItem value="fewest_bids">Fewest bids</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <div className="mb-4">
              <p className="text-sm text-muted-foreground">
                Showing <span className="font-semibold">{filteredJobs.length}</span> job{filteredJobs.length !== 1 ? 's' : ''}
              </p>
            </div>

            {filteredJobs.length === 0 ? (
              <Card>
                <CardContent className="text-center py-12">
                  <Search className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No jobs found</h3>
                  <p className="text-muted-foreground mb-4">Try adjusting your search criteria or filters</p>
                  {hasActiveFilters && (
                    <Button onClick={clearFilters} variant="outline">
                      <Filter className="w-4 h-4 mr-2" />
                      Clear Filters
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredJobs.map((job) => {
                  const hasBid = !!job.myBid;
                  return (
                    <Card key={job.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-lg">{job.title}</h3>
                              <Badge variant="outline" className="text-xs">{job.category}</Badge>
                              {job.status === 'IN_REVIEW' && (
                                <Badge variant="secondary" className="text-xs">Reviewing Bids</Badge>
                              )}
                              {hasBid && (
                                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                  Bid Submitted
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                              {job.description}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-4">
                          <div className="flex items-center gap-1">
                            <DollarSign className="w-4 h-4" />
                            <span className="font-medium text-primary">{formatCurrency(job.budget)} budget</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <MapPin className="w-4 h-4" />
                            <span>{job.location}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            <span>{formatRelativeTime(job.createdAt.toString())}</span>
                          </div>
                          {job._count.bids > 0 && (
                            <div className="flex items-center gap-1">
                              <TrendingUp className="w-4 h-4" />
                              <span>{job._count.bids} {job._count.bids === 1 ? 'bid' : 'bids'}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <Link href={`/jobs/${job.id}`}>
                            <Button variant="outline" size="sm">View Details</Button>
                          </Link>
                          {hasBid ? (
                            <Link href={`/jobs/${job.id}/bid`}>
                              <Button variant="outline" size="sm">
                                View My Bid ({formatCurrency(job.myBid!.amount)})
                              </Button>
                            </Link>
                          ) : (
                            <Link href={`/jobs/${job.id}/bid`}>
                              <Button size="sm">Submit Bid</Button>
                            </Link>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
