'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { StarRating } from '@/components/ui/star-rating';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  DollarSign,
  Star,
  Briefcase,
  CheckCircle,
  MessageSquare,
  Navigation,
  Pencil,
} from 'lucide-react';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';

type PublicProfile = {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
  handymanProfile: {
    id: string;
    businessName: string | null;
    bio: string | null;
    skills: string[];
    serviceRadius: number;
    hourlyRate: number | null;
    ratingAvg: number;
    ratingCount: number;
  } | null;
  reviews: Array<{
    id: string;
    stars: number;
    text: string | null;
    createdAt: string;
    reviewer: { name: string };
  }>;
  completedJobs: number;
};

export default function HandymanProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { user: currentUser } = useCurrentUser();

  const { data: profile, isPending } = useQuery({
    queryKey: ['user', userId],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}`);
      if (!res.ok) throw new Error('Not found');
      return res.json() as Promise<PublicProfile>;
    },
  });

  const isOwnProfile = currentUser?.id === userId;
  const backHref = currentUser?.role === 'HOMEOWNER' ? '/jobs' : '/handyman/dashboard';

  if (isPending) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="container mx-auto px-4 py-4">
            <Skeleton className="h-9 w-24" />
          </div>
        </header>
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="space-y-4">
              <Card><CardContent className="pt-6 space-y-4">
                <Skeleton className="w-24 h-24 rounded-full mx-auto" />
                <Skeleton className="h-6 w-32 mx-auto" />
                <Skeleton className="h-4 w-24 mx-auto" />
                <Skeleton className="h-16 w-full" />
              </CardContent></Card>
            </div>
            <div className="lg:col-span-2 space-y-6">
              <Card><CardContent className="pt-6 space-y-3">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent></Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile || !profile.handymanProfile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b">
          <div className="container mx-auto px-4 py-4">
            <Link href={backHref}>
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
            </Link>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">Profile Not Found</h1>
          <p className="text-muted-foreground">This handyman profile doesn&apos;t exist.</p>
        </div>
      </div>
    );
  }

  const hp = profile.handymanProfile;
  const ratingCount = hp.ratingCount;
  const ratingAvg = Number(hp.ratingAvg);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href={backHref}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          {isOwnProfile && (
            <Link href="/handyman/dashboard">
              <Button variant="outline" size="sm">
                <Pencil className="w-4 h-4 mr-2" />
                Edit Profile
              </Button>
            </Link>
          )}
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="grid lg:grid-cols-3 gap-6">

          {/* Left — Profile Card */}
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center mb-4">
                  {profile.photoUrl ? (
                    <img
                      src={profile.photoUrl}
                      alt={profile.name}
                      className="w-24 h-24 rounded-full object-cover mb-3 border-2 border-border"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                      <span className="text-primary font-bold text-4xl">
                        {profile.name.charAt(0)}
                      </span>
                    </div>
                  )}
                  <h1 className="text-xl font-bold">{profile.name}</h1>
                  {hp.businessName && (
                    <p className="text-muted-foreground text-sm">{hp.businessName}</p>
                  )}
                  {isOwnProfile && (
                    <Badge variant="outline" className="mt-2 text-xs">Your Profile</Badge>
                  )}
                </div>

                {ratingCount > 0 && (
                  <div className="flex flex-col items-center gap-1 mb-4">
                    <StarRating value={Math.round(ratingAvg)} readonly size="md" />
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">{ratingAvg.toFixed(1)}</span>
                      {' '}({ratingCount} review{ratingCount !== 1 ? 's' : ''})
                    </p>
                  </div>
                )}

                <Separator className="my-4" />

                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span><strong className="text-foreground">{profile.completedJobs}</strong> jobs completed</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Navigation className="w-4 h-4 text-blue-500" />
                    <span>Serves within <strong className="text-foreground">{hp.serviceRadius} miles</strong></span>
                  </div>
                  {hp.hourlyRate && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <DollarSign className="w-4 h-4 text-primary" />
                      <span><strong className="text-foreground">{formatCurrency(hp.hourlyRate)}/hr</strong> base rate</span>
                    </div>
                  )}
                </div>

                <Separator className="my-4" />

                {currentUser?.role === 'HOMEOWNER' && (
                  <div className="space-y-2">
                    <Link href="/jobs/new">
                      <Button className="w-full">Post a Job for This Handyman</Button>
                    </Link>
                    <Link href="/messages">
                      <Button variant="outline" className="w-full">
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Send Message
                      </Button>
                    </Link>
                  </div>
                )}
                {isOwnProfile && (
                  <Link href="/handyman/dashboard">
                    <Button variant="outline" className="w-full">
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit Profile
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>

            {hp.skills.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Skills &amp; Services</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {hp.skills.map(skill => (
                      <Badge key={skill} variant="secondary">{skill}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right — Bio + Reviews */}
          <div className="lg:col-span-2 space-y-6">
            {hp.bio ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">About</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">{hp.bio}</p>
                </CardContent>
              </Card>
            ) : isOwnProfile ? (
              <Card className="border-dashed">
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <Briefcase className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No bio yet.</p>
                  <Link href="/handyman/dashboard">
                    <Button variant="link" size="sm" className="mt-1">Add a bio</Button>
                  </Link>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    Reviews ({profile.reviews.length})
                  </CardTitle>
                  {ratingCount > 0 && (
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      <span className="font-semibold">{ratingAvg.toFixed(1)}</span>
                      <span className="text-sm text-muted-foreground">/ 5</span>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {profile.reviews.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Briefcase className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p>No reviews yet</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {profile.reviews.map((review, index) => (
                      <div key={review.id}>
                        {index > 0 && <Separator className="mb-5" />}
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                              {review.reviewer.name.charAt(0)}
                            </span>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-sm">{review.reviewer.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {formatRelativeTime(review.createdAt)}
                              </span>
                            </div>
                            <StarRating value={review.stars} readonly size="sm" />
                            {review.text && (
                              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                                {review.text}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
