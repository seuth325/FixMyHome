import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ArrowLeft, BarChart3, BriefcaseBusiness, CheckCircle2, Clock3, Database, TrendingUp } from 'lucide-react';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { calculateMarketplaceKpis } from '@/lib/operations-intelligence';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const user = await db.user.findFirst({
    where: { OR: [{ id: session.user.id }, ...(session.user.email ? [{ email: session.user.email }] : [])] },
    select: { role: true },
  });
  if (user?.role !== 'ADMIN') redirect('/role-selection');
}

function dateTime(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  }).format(value);
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader>
      <CardContent className="text-xs text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

export default async function OperationsIntelligencePage() {
  await requireAdmin();
  const [kpis, briefing, history, activities, noBidAlerts] = await Promise.all([
    calculateMarketplaceKpis(),
    db.executiveBriefing.findFirst({ orderBy: { briefingDate: 'desc' } }),
    db.marketplaceKpiSnapshot.findMany({ orderBy: { snapshotDate: 'desc' }, take: 14 }),
    db.operationsActivity.findMany({ orderBy: { occurredAt: 'desc' }, take: 60 }),
    db.marketplaceOpsSignal.findMany({
      where: { type: 'OPEN_JOB_NO_BIDS', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      orderBy: [{ priority: 'asc' }, { lastSeenAt: 'desc' }],
      take: 50,
    }),
  ]);
  const trend = [...history].reverse();
  const maxOpen = Math.max(1, ...trend.map((item) => item.openJobs));
  const latestBriefing = briefing ?? {
    headline: 'Run Marketplace Operations to generate the first executive briefing',
    summary: 'Daily briefings are generated after each successful scheduled or manual operations scan.',
    wins: [],
    risks: [],
    recommendedActions: [],
    openAlertCount: 0,
    criticalCount: 0,
    briefingDate: new Date(),
  };

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/admin/operations" className="inline-flex items-center gap-2 text-sm text-primary hover:underline"><ArrowLeft className="size-4" />Marketplace Operations</Link>
            <div className="mt-3 flex items-center gap-3"><BarChart3 className="size-8 text-primary" /><h1 className="text-3xl font-bold">Operations Intelligence</h1></div>
            <p className="mt-2 max-w-3xl text-muted-foreground">Daily executive briefing, marketplace KPIs, no-bid alerts, and the centralized operational activity ledger.</p>
          </div>
          <Badge variant="outline" className="gap-2 px-3 py-2"><Database className="size-4" />Activity ledger active</Badge>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Open projects" value={kpis.openJobs} detail={`${kpis.jobsCreated30d} created in 30 days`} />
          <Metric label="Projects without bids" value={kpis.openJobsWithoutBids} detail={`${kpis.noBidRate}% of open projects`} />
          <Metric label="Average bid coverage" value={kpis.averageBidsPerOpenJob} detail={`${kpis.bids30d} bids submitted in 30 days`} />
          <Metric label="Active handymen" value={kpis.activeHandymen} detail={`${kpis.handymen30d} joined in 30 days`} />
          <Metric label="30-day award rate" value={`${kpis.awardRate30d}%`} detail={`${kpis.jobsAwarded30d} projects awarded`} />
          <Metric label="30-day completion rate" value={`${kpis.completionRate30d}%`} detail={`${kpis.jobsCompleted30d} projects completed`} />
          <Metric label="New homeowners" value={kpis.homeowners30d} detail="Joined in the last 30 days" />
          <Metric label="Cancelled projects" value={kpis.jobsCancelled30d} detail="Cancelled in the last 30 days" />
        </section>

        <Card className="border-primary/20">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardDescription>Daily Executive Briefing · {dateTime(latestBriefing.briefingDate)}</CardDescription><CardTitle className="mt-2 text-2xl">{latestBriefing.headline}</CardTitle></div>
              <div className="flex gap-2"><Badge variant="outline">{latestBriefing.openAlertCount} open alerts</Badge>{latestBriefing.criticalCount > 0 && <Badge className="bg-red-700">{latestBriefing.criticalCount} critical</Badge>}</div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="leading-7">{latestBriefing.summary}</p>
            <div className="grid gap-6 lg:grid-cols-3">
              <div><h3 className="flex items-center gap-2 font-semibold text-green-700"><CheckCircle2 className="size-4" />Wins</h3><ul className="mt-3 space-y-2 text-sm">{stringList(latestBriefing.wins).map((item) => <li key={item}>• {item}</li>)}</ul></div>
              <div><h3 className="flex items-center gap-2 font-semibold text-amber-700"><AlertTriangle className="size-4" />Risks</h3><ul className="mt-3 space-y-2 text-sm">{stringList(latestBriefing.risks).map((item) => <li key={item}>• {item}</li>)}</ul></div>
              <div><h3 className="flex items-center gap-2 font-semibold text-blue-700"><TrendingUp className="size-4" />Next actions</h3><ul className="mt-3 space-y-2 text-sm">{stringList(latestBriefing.recommendedActions).map((item) => <li key={item}>• {item}</li>)}</ul></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>14-day marketplace trend</CardTitle><CardDescription>Daily open-project volume and the share waiting without a bid.</CardDescription></CardHeader>
          <CardContent>
            {trend.length ? <div className="flex h-56 items-end gap-2 border-b border-l px-3 pt-4">
              {trend.map((item) => <div key={item.id} className="group flex h-full flex-1 items-end gap-0.5" title={`${item.snapshotDate.toISOString().slice(0, 10)}: ${item.openJobs} open, ${item.openJobsWithoutBids} no bids`}>
                <div className="w-1/2 rounded-t bg-primary/75" style={{ height: `${Math.max(4, (item.openJobs / maxOpen) * 100)}%` }} />
                <div className="w-1/2 rounded-t bg-amber-500/80" style={{ height: `${Math.max(2, (item.openJobsWithoutBids / maxOpen) * 100)}%` }} />
              </div>)}
            </div> : <p className="py-12 text-center text-sm text-muted-foreground">Trend data will accumulate after daily operations runs.</p>}
            <div className="mt-3 flex gap-5 text-xs text-muted-foreground"><span><i className="mr-2 inline-block size-2 rounded bg-primary/75" />Open projects</span><span><i className="mr-2 inline-block size-2 rounded bg-amber-500/80" />No bids</span></div>
          </CardContent>
        </Card>

        <section className="grid gap-8 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-amber-600" />No-bid project alerts</CardTitle><CardDescription>Projects past the configured no-bid threshold and awaiting intervention.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {noBidAlerts.map((alert) => <article key={alert.id} className="rounded-lg border p-4"><div className="flex items-center justify-between gap-2"><Badge className={alert.priority === 'P1' ? 'bg-red-700' : 'bg-amber-500 text-slate-950'}>{alert.priority}</Badge><span className="text-xs text-muted-foreground">{dateTime(alert.lastSeenAt)}</span></div><h3 className="mt-3 font-semibold">{alert.title}</h3><p className="mt-1 text-sm text-muted-foreground">{alert.summary}</p><Link href={`/jobs/${alert.subjectId}`} className="mt-3 inline-block text-sm font-medium text-primary hover:underline">Open project</Link></article>)}
              {!noBidAlerts.length && <p className="py-8 text-center text-sm text-muted-foreground">No active no-bid alerts.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-5" />Central activity log</CardTitle><CardDescription>Immutable system and administrator actions, newest first.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {activities.map((activity) => <article key={activity.id} className="border-l-2 border-primary/30 pl-4"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{activity.eventType.replaceAll('_', ' ')}</Badge><span className="text-xs text-muted-foreground">{dateTime(activity.occurredAt)}</span></div><p className="mt-2 text-sm font-medium">{activity.summary}</p><p className="mt-1 text-xs text-muted-foreground">{activity.actorType}{activity.entityType ? ` · ${activity.entityType}` : ''}</p></article>)}
              {!activities.length && <p className="py-8 text-center text-sm text-muted-foreground">The first operations run will initialize the activity ledger.</p>}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
