'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, MessageSquare, ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumb } from '@/components/ui/breadcrumb';

type Conversation = {
  bidId: string;
  jobId: string;
  jobTitle: string;
  bidStatus: string;
  otherUser: { id: string; name: string };
  lastMessage: { id: string; body: string; senderId: string; createdAt: string };
};

export default function MessagesPage() {
  const { user, isLoaded } = useCurrentUser();

  const { data: conversations = [], isPending } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await fetch('/api/messages');
      if (!res.ok) throw new Error('Failed to load');
      return res.json() as Promise<Conversation[]>;
    },
    enabled: !!user,
  });

  const backHref = user?.role === 'HOMEOWNER' ? '/homeowner/dashboard' : '/handyman/dashboard';

  if (!isLoaded || isPending) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="container mx-auto px-4 py-4">
            <Skeleton className="h-9 w-40" />
          </div>
        </header>
        <div className="container mx-auto px-4 py-8 max-w-3xl">
          <div className="mb-8">
            <Skeleton className="h-9 w-36 mb-2" />
            <Skeleton className="h-5 w-56" />
          </div>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Skeleton className="w-12 h-12 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                      <Skeleton className="h-5 w-36 rounded-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                    <Skeleton className="w-4 h-4 flex-shrink-0" />
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
        <div className="container mx-auto px-4 py-4">
          <Link href={backHref}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Breadcrumb
          items={[
            { label: 'Dashboard', href: backHref },
            { label: 'Messages' },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Messages</h1>
          <p className="text-muted-foreground">
            {user?.role === 'HOMEOWNER'
              ? 'Your conversations with handymen'
              : 'Your conversations with homeowners'}
          </p>
        </div>

        {conversations.length === 0 ? (
          <Card>
            <CardContent className="text-center py-16">
              <MessageSquare className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No messages yet</h3>
              <p className="text-muted-foreground">
                {user?.role === 'HOMEOWNER'
                  ? 'Messages will appear here once handymen start bidding on your jobs.'
                  : 'Messages will appear here once you submit bids and homeowners respond.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {conversations.map(({ bidId, jobTitle, otherUser, lastMessage }) => (
              <Link key={bidId} href={`/messages/${bidId}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-primary font-semibold text-lg">
                          {otherUser.name.charAt(0)}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-semibold">{otherUser.name}</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {formatRelativeTime(lastMessage.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs py-0">
                            {jobTitle}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {lastMessage.senderId === user?.id && (
                            <span className="text-muted-foreground/60">You: </span>
                          )}
                          {lastMessage.body}
                        </p>
                      </div>

                      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
