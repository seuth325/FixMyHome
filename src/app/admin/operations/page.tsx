import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, MapPin, PauseCircle, PlayCircle, RefreshCw, Rocket, ShieldAlert, Target, UserPlus, Users } from 'lucide-react';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { getMarketplaceOpsSettings, getMarketplaceSnapshot, runMarketplaceOperations } from '@/lib/marketplace-operations';
import { logOperationsActivity } from '@/lib/operations-intelligence';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export const maxDuration = 300;

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const user = await db.user.findFirst({
    where: { OR: [{ id: session.user.id }, ...(session.user.email ? [{ email: session.user.email }] : [])] },
    select: { id: true, role: true },
  });
  if (user?.role !== 'ADMIN') redirect('/role-selection');
  return user;
}

async function runNow() {
  'use server';
  await requireAdmin();
  await runMarketplaceOperations({ trigger: 'MANUAL', force: true });
  revalidatePath('/admin/operations');
}

async function updateSettings(formData: FormData) {
  'use server';
  await requireAdmin();
  const timezone = String(formData.get('timezone') || 'America/New_York').trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { return; }
  const bounded = (name: string, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Number(formData.get(name) || fallback)));
  await db.marketplaceOpsSettings.upsert({
    where: { id: 'default' },
    update: {
      enabled: formData.get('enabled') === 'true', timezone,
      runHour: bounded('runHour', 7, 0, 23), noBidHours: bounded('noBidHours', 24, 1, 336),
      lowBidHours: bounded('lowBidHours', 48, 1, 336), staleJobHours: bounded('staleJobHours', 168, 24, 720),
      awardedStaleHours: bounded('awardedStaleHours', 168, 24, 720), reviewGapHours: bounded('reviewGapHours', 72, 1, 336),
      newHandymanGraceDays: bounded('newHandymanGraceDays', 14, 1, 90), handymanInactiveDays: bounded('handymanInactiveDays', 30, 7, 365),
    },
    create: {
      id: 'default', enabled: formData.get('enabled') === 'true', timezone,
      runHour: bounded('runHour', 7, 0, 23), noBidHours: bounded('noBidHours', 24, 1, 336),
      lowBidHours: bounded('lowBidHours', 48, 1, 336), staleJobHours: bounded('staleJobHours', 168, 24, 720),
      awardedStaleHours: bounded('awardedStaleHours', 168, 24, 720), reviewGapHours: bounded('reviewGapHours', 72, 1, 336),
      newHandymanGraceDays: bounded('newHandymanGraceDays', 14, 1, 90), handymanInactiveDays: bounded('handymanInactiveDays', 30, 7, 365),
    },
  });
  revalidatePath('/admin/operations');
}

async function updateSignalStatus(formData: FormData) {
  'use server';
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  const status = String(formData.get('status') || 'OPEN');
  if (!id || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'].includes(status)) return;
  const signal = await db.marketplaceOpsSignal.update({ where: { id }, data: { status, resolvedAt: ['RESOLVED', 'DISMISSED'].includes(status) ? new Date() : null } });
  await logOperationsActivity({ eventType: 'ALERT_STATUS_CHANGED', actorType: 'ADMIN', actorId: admin.id, entityType: 'MARKETPLACE_SIGNAL', entityId: signal.id, summary: signal.title + ' changed to ' + status + '.', details: { previousAction: 'ADMIN_REVIEW', status } });
  revalidatePath('/admin/operations');
}

function dateTime(value: Date | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }).format(value);
}

function priorityBadge(priority: string) {
  const className = priority === 'P1' ? 'bg-red-700 text-white' : priority === 'P2' ? 'bg-amber-500 text-slate-950' : 'bg-slate-200 text-slate-900';
  return <Badge className={className}>{priority}</Badge>;
}

function subjectLink(type: string, id: string | null) {
  if (!id) return null;
  if (type === 'JOB') return `/jobs/${id}`;
  if (type === 'HANDYMAN') return `/profile/${id}`;
  return null;
}

export default async function MarketplaceOperationsPage() {
  await requireAdmin();
  const [settings, snapshot, signals, runs, counts] = await Promise.all([
    getMarketplaceOpsSettings(), getMarketplaceSnapshot(),
    db.marketplaceOpsSignal.findMany({ orderBy: [{ status: 'asc' }, { priority: 'asc' }, { lastSeenAt: 'desc' }], take: 150 }),
    db.marketplaceOpsRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
    db.marketplaceOpsSignal.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const count = Object.fromEntries(counts.map((item) => [item.status, item._count._all]));
  const activeSignals = signals.filter((signal) => ['OPEN', 'ACKNOWLEDGED'].includes(signal.status));
  const recentClosed = signals.filter((signal) => ['RESOLVED', 'DISMISSED'].includes(signal.status)).slice(0, 20);

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/admin" className="text-sm text-primary hover:underline">← Admin dashboard</Link>
            <div className="mt-3 flex items-center gap-3"><Activity className="size-8 text-primary" /><h1 className="text-3xl font-bold">Marketplace Operations</h1></div>
            <p className="mt-2 max-w-3xl text-muted-foreground">Read-only marketplace monitoring with evidence-backed action queues. Phase 1 cannot message users, change jobs, award work, or modify accounts.</p>
          </div>
          <div className="flex flex-wrap gap-2"><Button asChild variant="outline" className="gap-2 border-red-200 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"><Link href="/admin/trust-safety"><ShieldAlert className="size-4" />Trust & Safety</Link></Button><Button asChild variant="outline" className="gap-2"><Link href="/admin/activation"><Rocket className="size-4" />Activation</Link></Button><Button asChild variant="outline" className="gap-2"><Link href="/admin/recruitment"><UserPlus className="size-4" />Recruitment</Link></Button><Button asChild variant="outline" className="gap-2"><Link href="/admin/matching"><Target className="size-4" />Matching</Link></Button><Button asChild variant="outline" className="gap-2"><Link href="/admin/operations/intelligence"><BarChart3 className="size-4" />Intelligence</Link></Button><form action={runNow}><Button className="gap-2"><RefreshCw className="size-4" />Run now</Button></form></div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
          <Card className="border-violet-200 bg-violet-50/80 dark:border-violet-900 dark:bg-violet-950/35"><CardHeader className="pb-2"><CardDescription>Agent</CardDescription><CardTitle className="flex items-center gap-2 text-xl">{settings.enabled ? <PlayCircle className="size-5 text-green-600" /> : <PauseCircle className="size-5 text-amber-600" />}{settings.enabled ? 'Enabled' : 'Paused'}</CardTitle></CardHeader></Card>
          <Card className="border-rose-200 bg-rose-50/80 dark:border-rose-900 dark:bg-rose-950/35"><CardHeader className="pb-2"><CardDescription>Open signals</CardDescription><CardTitle>{count.OPEN || 0}</CardTitle></CardHeader></Card>
          <Card className="border-blue-200 bg-blue-50/80 dark:border-blue-900 dark:bg-blue-950/35"><CardHeader className="pb-2"><CardDescription>Open jobs</CardDescription><CardTitle>{snapshot.openJobs}</CardTitle></CardHeader></Card>
          <Card className="border-teal-200 bg-teal-50/80 dark:border-teal-900 dark:bg-teal-950/35"><CardHeader className="pb-2"><CardDescription>Active handymen</CardDescription><CardTitle>{snapshot.activeHandymen}</CardTitle></CardHeader></Card>
          <Card className="border-cyan-200 bg-cyan-50/80 dark:border-cyan-900 dark:bg-cyan-950/35"><CardHeader className="pb-2"><CardDescription>Awarded (30d)</CardDescription><CardTitle>{snapshot.jobsAwarded30d}</CardTitle></CardHeader></Card>
          <Card className="border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/35"><CardHeader className="pb-2"><CardDescription>Completed (30d)</CardDescription><CardTitle>{snapshot.jobsCompleted30d}</CardTitle></CardHeader></Card>
        </div>

        <div className="grid gap-4 md:grid-cols-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
          <Card className="border-violet-200 bg-violet-50/80 dark:border-violet-900 dark:bg-violet-950/35"><CardHeader><CardDescription>Bids (30d)</CardDescription><CardTitle>{snapshot.bids30d}</CardTitle></CardHeader></Card>
          <Card className="border-blue-200 bg-blue-50/80 dark:border-blue-900 dark:bg-blue-950/35"><CardHeader><CardDescription>New homeowners (30d)</CardDescription><CardTitle>{snapshot.homeowners30d}</CardTitle></CardHeader></Card>
          <Card className="border-teal-200 bg-teal-50/80 dark:border-teal-900 dark:bg-teal-950/35"><CardHeader><CardDescription>New handymen (30d)</CardDescription><CardTitle>{snapshot.handymen30d}</CardTitle></CardHeader></Card>
          <Card className="border-rose-200 bg-rose-50/80 dark:border-rose-900 dark:bg-rose-950/35"><CardHeader><CardDescription>Cancelled jobs (30d)</CardDescription><CardTitle>{snapshot.jobsCancelled30d}</CardTitle></CardHeader></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-5" />Schedule and thresholds</CardTitle><CardDescription>The GitHub scheduler calls the protected runner hourly; analysis occurs once daily during the configured local hour.</CardDescription></CardHeader>
          <CardContent><form action={updateSettings} className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
            <label className="space-y-2 text-sm font-medium">Status<select name="enabled" defaultValue={String(settings.enabled)} className="h-10 w-full rounded-md border bg-background px-3"><option value="true">Enabled</option><option value="false">Paused</option></select></label>
            <label className="space-y-2 text-sm font-medium">Time zone<Input name="timezone" defaultValue={settings.timezone} /></label>
            <label className="space-y-2 text-sm font-medium">Daily run hour<Input name="runHour" type="number" min="0" max="23" defaultValue={settings.runHour} /></label>
            <label className="space-y-2 text-sm font-medium">No bids after hours<Input name="noBidHours" type="number" min="1" max="336" defaultValue={settings.noBidHours} /></label>
            <label className="space-y-2 text-sm font-medium">Low bids after hours<Input name="lowBidHours" type="number" min="1" max="336" defaultValue={settings.lowBidHours} /></label>
            <label className="space-y-2 text-sm font-medium">Stale open job hours<Input name="staleJobHours" type="number" min="24" max="720" defaultValue={settings.staleJobHours} /></label>
            <label className="space-y-2 text-sm font-medium">Stalled awarded hours<Input name="awardedStaleHours" type="number" min="24" max="720" defaultValue={settings.awardedStaleHours} /></label>
            <label className="space-y-2 text-sm font-medium">Review gap hours<Input name="reviewGapHours" type="number" min="1" max="336" defaultValue={settings.reviewGapHours} /></label>
            <label className="space-y-2 text-sm font-medium">New handyman grace days<Input name="newHandymanGraceDays" type="number" min="1" max="90" defaultValue={settings.newHandymanGraceDays} /></label>
            <label className="space-y-2 text-sm font-medium">Inactive handyman days<Input name="handymanInactiveDays" type="number" min="7" max="365" defaultValue={settings.handymanInactiveDays} /></label>
            <Button type="submit" variant="outline" className="w-fit md:col-span-3 xl:col-span-5">Save controls</Button>
          </form></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Prioritized action queue</CardTitle><CardDescription>{activeSignals.length} active signals. Actions remain recommendations until an administrator approves and performs them.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {activeSignals.map((signal) => {
              const link = subjectLink(signal.subjectType, signal.subjectId);
              return <article key={signal.id} className="rounded-lg border p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2">{priorityBadge(signal.priority)}<Badge variant="outline">{signal.type.replaceAll('_', ' ')}</Badge><Badge variant="outline">{signal.status}</Badge></div><h2 className="mt-3 text-lg font-semibold">{signal.title}</h2><p className="mt-1 text-sm text-muted-foreground">{signal.summary}</p></div>
                  <form action={updateSignalStatus} className="flex gap-2"><input type="hidden" name="id" value={signal.id} /><select name="status" defaultValue={signal.status} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="OPEN">Open</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option></select><Button size="sm" variant="outline">Save</Button></form>
                </div>
                <div className="mt-4 rounded-md bg-muted p-4"><div className="text-sm font-semibold">Recommended action</div><p className="mt-1 text-sm">{signal.recommendedAction}</p></div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span>Detected {dateTime(signal.detectedAt)}</span><span>Last seen {dateTime(signal.lastSeenAt)}</span>{signal.subjectType === 'LOCATION' && <span className="flex items-center gap-1"><MapPin className="size-3" />{signal.subjectId}</span>}{link && <Link href={link} className="font-medium text-primary hover:underline">Open {signal.subjectType.toLowerCase()}</Link>}</div>
                <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">Evidence</summary><pre className="mt-2 overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(signal.evidence, null, 2)}</pre></details>
              </article>;
            })}
            {activeSignals.length === 0 && <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><CheckCircle2 className="size-5 text-green-600" />No active operational signals.</div>}
          </CardContent>
        </Card>

        <div className="grid gap-8 xl:grid-cols-2">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><RefreshCw className="size-5" />Run history</CardTitle><CardDescription>Last run: {dateTime(settings.lastRunAt)}</CardDescription></CardHeader><CardContent className="space-y-3">{runs.map((run) => <div key={run.id} className="rounded-md border p-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{run.trigger} · {run.status}</span><span className="text-muted-foreground">{dateTime(run.startedAt)}</span></div><div className="mt-1 text-muted-foreground">{run.detected} detected · {run.created} new · {run.refreshed} refreshed · {run.autoResolved} auto-resolved</div>{run.errorMessage && <p className="mt-2 text-red-600">{run.errorMessage}</p>}</div>)}{runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}</CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5" />Recently closed</CardTitle><CardDescription>Automatically resolved or manually dismissed signals.</CardDescription></CardHeader><CardContent className="space-y-3">{recentClosed.map((signal) => <div key={signal.id} className="rounded-md border p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{signal.title}</span><Badge variant="outline">{signal.status}</Badge></div><p className="mt-1 text-muted-foreground">{signal.type.replaceAll('_', ' ')} · {dateTime(signal.resolvedAt)}</p></div>)}{recentClosed.length === 0 && <p className="text-sm text-muted-foreground">No closed signals yet.</p>}</CardContent></Card>
        </div>
      </div>
    </main>
  );
}