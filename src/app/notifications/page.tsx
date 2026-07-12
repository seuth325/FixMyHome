'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { useMyJobs } from '@/lib/hooks/use-jobs';
import { useMyBids } from '@/lib/hooks/use-bids';
import { useBrowseJobs, type BrowseJob } from '@/lib/hooks/use-jobs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink, Search, Star, Wrench, Droplets, Wind, Paintbrush,
  Hammer, Fence, Leaf, Settings, Zap, Layers, Shield, Waves, Grid2X2,
  Sparkles, Home, AlertTriangle, ChevronRight, Bell, DollarSign,
  MessageSquare, CheckCircle, XCircle, Trophy, ClipboardCheck, Send, Loader2 } from 'lucide-react';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';

type NotificationType = 'NEW_BID' | 'BID_ACCEPTED' | 'BID_DECLINED' | 'JOB_COMPLETED' | 'NEW_MESSAGE' | 'JOB_STATUS';

type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  linkPath: string;
  read: boolean;
  createdAt: string;
};

// Local pricing estimates for Florida market (min-max range)
const CATEGORY_PRICING: Record<string, { min: number; max: number; icon: React.ReactNode; color: string }> = {
  'Plumbing':                    { min: 150,  max: 400,   icon: <Droplets className="w-5 h-5" />,  color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  'Electrical':                  { min: 200,  max: 500,   icon: <Zap className="w-5 h-5" />,       color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' },
  'HVAC & Air Conditioning':     { min: 300,  max: 800,   icon: <Wind className="w-5 h-5" />,      color: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300' },
  'Painting':                    { min: 500,  max: 2000,  icon: <Paintbrush className="w-5 h-5" />,color: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300' },
  'Carpentry':                   { min: 200,  max: 600,   icon: <Hammer className="w-5 h-5" />,    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' },
  'Fence Repair':                { min: 300,  max: 1200,  icon: <Fence className="w-5 h-5" />,     color: 'bg-lime-100 text-lime-700 dark:bg-lime-900 dark:text-lime-300' },
  'Landscaping & Irrigation':    { min: 200,  max: 800,   icon: <Leaf className="w-5 h-5" />,      color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  'General Handyman':            { min: 100,  max: 400,   icon: <Wrench className="w-5 h-5" />,    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  'Appliance Repair':            { min: 150,  max: 400,   icon: <Settings className="w-5 h-5" />,  color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
  'Flooring':                    { min: 500,  max: 3000,  icon: <Grid2X2 className="w-5 h-5" />,   color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' },
  'Roofing':                     { min: 500,  max: 3000,  icon: <Home className="w-5 h-5" />,      color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
  'Drywall':                     { min: 200,  max: 800,   icon: <Layers className="w-5 h-5" />,    color: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300' },
  'Stucco Cracks and Repairs':   { min: 300,  max: 1500,  icon: <Sparkles className="w-5 h-5" />, color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  'Pool Maintenance & Repair':   { min: 200,  max: 1000,  icon: <Waves className="w-5 h-5" />,     color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300' },
  'Screen Enclosures':           { min: 400,  max: 2000,  icon: <Grid2X2 className="w-5 h-5" />,   color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300' },
  'Pressure Washing':            { min: 150,  max: 500,   icon: <Droplets className="w-5 h-5" />,  color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300' },
  'Hurricane Shutters & Storm Prep': { min: 500, max: 3000, icon: <Shield className="w-5 h-5" />, color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  'Termite Infestations':        { min: 500,  max: 2000,  icon: <AlertTriangle className="w-5 h-5" />, color: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300' },
};

// Top 10 most common project categories for Florida homes
const TOP_TEN_CATEGORIES = [
  'General Handyman',
  'Plumbing',
  'HVAC & Air Conditioning',
  'Electrical',
  'Painting',
  'Landscaping & Irrigation',
  'Pressure Washing',
  'Flooring',
  'Screen Enclosures',
  'Pool Maintenance & Repair',
];

function notifIcon(type: NotificationType) {
  switch (type) {
    case 'NEW_BID':       return <DollarSign className="w-4 h-4" />;
    case 'BID_ACCEPTED':  return <Trophy className="w-4 h-4" />;
    case 'BID_DECLINED':  return <XCircle className="w-4 h-4" />;
    case 'JOB_COMPLETED': return <ClipboardCheck className="w-4 h-4" />;
    case 'NEW_MESSAGE':   return <MessageSquare className="w-4 h-4" />;
    case 'JOB_STATUS':    return <CheckCircle className="w-4 h-4" />;
  }
}

function notifIconBg(type: NotificationType): string {
  switch (type) {
    case 'NEW_BID':       return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    case 'BID_ACCEPTED':  return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    case 'BID_DECLINED':  return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    case 'JOB_COMPLETED': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    case 'NEW_MESSAGE':   return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
    case 'JOB_STATUS':    return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300';
  }
}

interface PreviewUrls {
  homeowner: string | false;
  handyman: string | false;
}

export default function NotificationsPage() {
  const { user, isLoaded } = useCurrentUser();
  const [sending, setSending] = useState(false);
  const [previews, setPreviews] = useState<PreviewUrls | null>(null);
  const [sendError, setSendError] = useState('');

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/notifications');
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{ notifications: AppNotification[]; unreadCount: number }>;
    },
    enabled: !!user,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch('/api/notifications/read-all', { method: 'POST' });
    },
  });

  // Mark all read when page opens
  useEffect(() => {
    if (user?.id) {
      markAllRead.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleSendTest = async () => {
    setSending(true);
    setSendError('');
    setPreviews(null);
    try {
      const res = await fetch('/api/email/test', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setPreviews({ homeowner: json.homeowner.previewUrl, handyman: json.handyman.previewUrl });
      } else {
        setSendError(json.error ?? 'Unknown error');
      }
    } catch (e) {
      setSendError(String(e));
    } finally {
      setSending(false);
    }
  };

  if (!isLoaded || !user) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  const notifications = notifData?.notifications ?? [];
  const location = user.location ?? '33139';
  const cityName = getCityFromZip(location);
  const dashboardPath = user.role === 'HOMEOWNER' ? '/homeowner/dashboard' : '/handyman/dashboard';

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* Email-style chrome header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href={dashboardPath}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Email Digest</span>
          </div>
          <Button size="sm" onClick={handleSendTest} disabled={sending}>
            {sending
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</>
              : <><Send className="w-4 h-4 mr-2" />Send Test Email</>}
          </Button>
        </div>

        {/* Preview URL results */}
        {previews && (
          <div className="container mx-auto px-4 pb-4 flex flex-col sm:flex-row gap-2">
            <a href={previews.homeowner || '#'} target="_blank" rel="noopener noreferrer"
               className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm hover:bg-blue-100 transition-colors">
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">Homeowner preview → open in browser</span>
            </a>
            <a href={previews.handyman || '#'} target="_blank" rel="noopener noreferrer"
               className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 text-sm hover:bg-green-100 transition-colors">
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">Handyman preview → open in browser</span>
            </a>
          </div>
        )}

        {/* Send error */}
        {sendError && (
          <div className="container mx-auto px-4 pb-4">
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
              Failed to send: {sendError}
            </p>
          </div>
        )}
      </header>

      {/* Outer email wrapper */}
      <div className="max-w-2xl mx-auto py-8 px-4">

        {/* Email card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">

          {/* Email header banner */}
          <div className="bg-gradient-to-r from-blue-600 to-green-500 px-8 py-8 text-white text-center">
            <h1 className="text-3xl font-bold tracking-tight mb-1">FixMyHome</h1>
            <p className="text-blue-100 text-sm">Your local home repair marketplace</p>
          </div>

          {/* Greeting */}
          <div className="px-8 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
            <p className="text-lg font-semibold">Hi {user.name.split(' ')[0]},</p>
            <p className="text-muted-foreground text-sm mt-1">
              {user.role === 'HOMEOWNER'
                ? "Here's your weekly digest — popular home projects and local pricing in your area."
                : "Here's a summary of available jobs and opportunities near you this week."}
            </p>
          </div>

          {/* Notification Inbox */}
          <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-base font-bold mb-3 flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              Alerts &amp; Notifications
            </h2>
            {notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No notifications yet.</p>
            ) : (
              <div className="space-y-2">
                {notifications.map(n => (
                  <Link key={n.id} href={n.linkPath}>
                    <div className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all cursor-pointer">
                      <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${notifIconBg(n.type)}`}>
                        {notifIcon(n.type)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-tight">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                        <p className="text-xs text-muted-foreground mt-1">{formatRelativeTime(n.createdAt)}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Role-specific activity section */}
          {user.role === 'HOMEOWNER'
            ? <HomeownerActivity />
            : <HandymanActivity />}

          {/* Search CTA */}
          <div className="px-8 py-6 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700">
            <p className="text-center text-sm font-semibold text-muted-foreground mb-3">
              What can we help you with?
            </p>
            <Link href={user.role === 'HOMEOWNER' ? '/jobs/new' : '/browse'}>
              <div className="flex items-center gap-3 border border-gray-300 dark:border-gray-600 rounded-full px-4 py-2.5 bg-white dark:bg-gray-800 hover:shadow-md transition-shadow cursor-pointer">
                <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-muted-foreground flex-1">
                  {user.role === 'HOMEOWNER' ? 'Post a new home repair job...' : 'Browse jobs in your area...'}
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </div>
            </Link>
          </div>

          {/* Top 10 Projects Section */}
          <div className="px-8 py-6 border-t border-gray-100 dark:border-gray-700">
            <h2 className="text-base font-bold mb-1">Top Ten Projects in {cityName}</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Most requested home services in your area
            </p>
            <div className="grid grid-cols-2 gap-3">
              {TOP_TEN_CATEGORIES.map((category) => {
                const info = CATEGORY_PRICING[category];
                return (
                  <Link
                    key={category}
                    href={user.role === 'HOMEOWNER' ? `/jobs/new?category=${encodeURIComponent(category)}` : `/browse?category=${encodeURIComponent(category)}`}
                  >
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary hover:shadow-sm transition-all cursor-pointer group">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${info?.color ?? 'bg-gray-100 text-gray-600'}`}>
                        {info?.icon ?? <Wrench className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold leading-tight group-hover:text-primary transition-colors truncate">
                          {category}
                        </p>
                        {info && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatCurrency(info.min)}–{formatCurrency(info.max)}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Project Costs Section */}
          <div className="px-8 py-6 bg-blue-50 dark:bg-blue-950/30 border-t border-gray-100 dark:border-gray-700">
            <h2 className="text-base font-bold mb-1">
              <DollarSign className="w-4 h-4 inline mr-1 text-blue-600" />
              Project Costs in {cityName}
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Average price ranges based on recent local jobs — actual costs vary by scope
            </p>
            <div className="space-y-2.5">
              {Object.entries(CATEGORY_PRICING).map(([category, info]) => (
                <div key={category} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${info.color} [&>svg]:w-3.5 [&>svg]:h-3.5`}>
                      {info.icon}
                    </span>
                    <span className="text-xs truncate">{category}</span>
                  </div>
                  <span className="text-xs font-semibold text-green-700 dark:text-green-400 whitespace-nowrap flex-shrink-0">
                    {formatCurrency(info.min)} – {formatCurrency(info.max)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Star rating callout */}
          <div className="px-8 py-5 border-t border-gray-100 dark:border-gray-700 bg-amber-50 dark:bg-amber-950/20">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <div className="flex">
                  {[1,2,3,4,5].map(i => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold">All handymen are community-rated</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {user.role === 'HOMEOWNER'
                    ? 'Read reviews from real neighbors before you hire. Leave a review after your job is complete.'
                    : 'Your rating is your reputation. Deliver great work and earn 5-star reviews from homeowners.'}
                </p>
              </div>
            </div>
          </div>

          {/* CTA buttons */}
          <div className="px-8 py-6 border-t border-gray-100 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row gap-3">
              {user.role === 'HOMEOWNER' ? (
                <>
                  <Link href="/jobs/new" className="flex-1">
                    <Button className="w-full" size="sm">
                      Post a Job
                    </Button>
                  </Link>
                  <Link href="/jobs" className="flex-1">
                    <Button variant="outline" className="w-full" size="sm">
                      View My Jobs
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/browse" className="flex-1">
                    <Button className="w-full" size="sm">
                      Browse Available Jobs
                    </Button>
                  </Link>
                  <Link href="/bids" className="flex-1">
                    <Button variant="outline" className="w-full" size="sm">
                      View My Bids
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Email footer */}
          <div className="px-8 py-5 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700 text-center">
            <p className="text-xs text-muted-foreground">
              © 2026 FixMyHome · Currently serving Florida
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              This digest is sent weekly to {user.email}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Homeowner activity panel ────────────────────────────────────────────────

function HomeownerActivity() {
  const { data: jobs = [] } = useMyJobs();

  const activeJobs = jobs.filter(j => j.status === 'OPEN' || j.status === 'IN_REVIEW').length;
  const inProgress = jobs.filter(j => j.status === 'AWARDED').length;
  const jobsWithBids = jobs.filter(j =>
    (j.status === 'OPEN' || j.status === 'IN_REVIEW') && j._count.bids > 0
  );
  const totalNewBids = jobsWithBids.reduce((sum, j) => sum + j._count.bids, 0);

  if (jobs.length === 0) return null;

  return (
    <div className="px-8 py-6 border-t border-gray-100 dark:border-gray-700">
      <h2 className="text-base font-bold mb-3 flex items-center gap-2">
        <Bell className="w-4 h-4 text-primary" />
        Your Activity This Week
      </h2>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/40 rounded-lg">
          <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{activeJobs}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Active Jobs</div>
        </div>
        <div className="text-center p-3 bg-green-50 dark:bg-green-950/40 rounded-lg">
          <div className="text-2xl font-bold text-green-700 dark:text-green-300">{totalNewBids}</div>
          <div className="text-xs text-muted-foreground mt-0.5">New Bids</div>
        </div>
        <div className="text-center p-3 bg-amber-50 dark:bg-amber-950/40 rounded-lg">
          <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">{inProgress}</div>
          <div className="text-xs text-muted-foreground mt-0.5">In Progress</div>
        </div>
      </div>
      {jobsWithBids.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Jobs with pending bids</p>
          {jobsWithBids.slice(0, 3).map(job => (
            <Link key={job.id} href={`/jobs/${job.id}`}>
              <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all cursor-pointer">
                <div className="min-w-0 mr-2">
                  <p className="text-sm font-medium truncate">{job.title}</p>
                  <p className="text-xs text-muted-foreground">{job.category} · {formatCurrency(job.budget)} budget</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Badge variant="default" className="text-xs">
                    {job._count.bids} {job._count.bids === 1 ? 'bid' : 'bids'}
                  </Badge>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Handyman activity panel ─────────────────────────────────────────────────

function HandymanActivity() {
  const { user } = useCurrentUser();
  const { data: myBids = [] } = useMyBids();
  const { data: browseJobs = [] } = useBrowseJobs();

  const mySkills = user?.handymanProfile?.skills ?? [];

  const activeBids = myBids.filter(b => b.status === 'PENDING').length;
  const acceptedBids = myBids.filter(b => b.status === 'ACCEPTED').length;
  const totalEarningsPotential = myBids
    .filter(b => b.status === 'PENDING')
    .reduce((sum, b) => sum + Number(b.amount), 0);

  const matchingJobs: BrowseJob[] = browseJobs
    .filter(j => !j.myBid && (mySkills.length === 0 || mySkills.includes(j.category)))
    .slice(0, 5);

  return (
    <div className="px-8 py-6 border-t border-gray-100 dark:border-gray-700">
      <h2 className="text-base font-bold mb-3 flex items-center gap-2">
        <Bell className="w-4 h-4 text-primary" />
        Your Activity This Week
      </h2>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/40 rounded-lg">
          <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{activeBids}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Active Bids</div>
        </div>
        <div className="text-center p-3 bg-green-50 dark:bg-green-950/40 rounded-lg">
          <div className="text-2xl font-bold text-green-700 dark:text-green-300">{acceptedBids}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Jobs Won</div>
        </div>
        <div className="text-center p-3 bg-amber-50 dark:bg-amber-950/40 rounded-lg">
          <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">{formatCurrency(totalEarningsPotential)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Bid Value</div>
        </div>
      </div>

      {matchingJobs.length > 0 && (
        <>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {mySkills.length > 0 ? 'Jobs matching your skills' : 'New jobs in your area'}
          </p>
          <div className="space-y-2">
            {matchingJobs.map(job => (
              <Link key={job.id} href={`/jobs/${job.id}/bid`}>
                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all cursor-pointer">
                  <div className="min-w-0 mr-2">
                    <p className="text-sm font-medium truncate">{job.title}</p>
                    <p className="text-xs text-muted-foreground">{job.category} · {job.location} · {formatCurrency(job.budget)} budget</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Badge variant="outline" className="text-xs text-green-700 border-green-300">
                      {formatCurrency(job.budget)}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <Link href="/browse">
            <Button variant="ghost" size="sm" className="mt-3 w-full text-xs">
              View all available jobs <ExternalLink className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </>
      )}
    </div>
  );
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function getCityFromZip(zip: string): string {
  // Florida ZIP → city lookup (sample set)
  const zipMap: Record<string, string> = {
    '33139': 'Miami Beach', '33101': 'Miami', '33130': 'Miami',
    '32801': 'Orlando',     '32803': 'Orlando',
    '33602': 'Tampa',       '33606': 'Tampa',
    '32202': 'Jacksonville','32204': 'Jacksonville',
    '33401': 'West Palm Beach',
    '34201': 'Bradenton',
    '34102': 'Naples',
    '32940': 'Melbourne',
    '32960': 'Vero Beach',
    '34741': 'Kissimmee',
    '32701': 'Altamonte Springs',
    '32707': 'Casselberry',
    '32708': 'Winter Springs',
    '32771': 'Sanford',
    '34785': 'Wildwood',
    '32720': 'DeLand',
  };
  return zipMap[zip] ?? `ZIP ${zip}`;
}
