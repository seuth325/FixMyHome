import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock3, Eye, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { getTrustSafetySettings, runTrustSafetyAgent } from '@/lib/trust-safety-agent';
import { logOperationsActivity } from '@/lib/operations-intelligence';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export const maxDuration = 300;
async function requireAdmin() {
  const session = await auth(); if (!session?.user) redirect('/sign-in');
  const user = await db.user.findFirst({ where: { OR: [{ id: session.user.id }, ...(session.user.email ? [{ email: session.user.email }] : [])] }, select: { id: true, role: true } });
  if (user?.role !== 'ADMIN') redirect('/role-selection'); return user;
}
async function runNow() { 'use server'; await requireAdmin(); await runTrustSafetyAgent({ trigger: 'MANUAL' }); revalidatePath('/admin/trust-safety'); }
async function saveSettings(formData: FormData) {
  'use server'; await requireAdmin(); const number = (name: string, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Number(formData.get(name) || fallback)));
  const data = { enabled: formData.get('enabled') === 'true', scanDays: number('scanDays', 90, 7, 365), repeatReportThreshold: number('repeatReportThreshold', 2, 2, 10), cancellationThreshold: number('cancellationThreshold', 3, 2, 20), withdrawalThreshold: number('withdrawalThreshold', 3, 2, 20), highBidMultiplier: number('highBidMultiplier', 3, 1.5, 20), lowBidMultiplier: number('lowBidMultiplier', 0.2, 0.01, 0.8) };
  await db.trustSafetySettings.upsert({ where: { id: 'default' }, update: data, create: { id: 'default', ...data } }); revalidatePath('/admin/trust-safety');
}
async function reviewCase(formData: FormData) {
  'use server'; const admin = await requireAdmin(); const id = String(formData.get('id') || ''); const decision = String(formData.get('decision') || '');
  if (!id || !['REVIEWING', 'APPROVED_ACTION', 'RESOLVED', 'DISMISSED'].includes(decision)) return;
  const now = new Date(); const draftWarning = String(formData.get('draftWarning') || '').slice(0, 5000) || null;
  const safetyCase = await db.trustSafetyCase.update({ where: { id }, data: {
    status: decision, draftWarning,
    ...(decision === 'APPROVED_ACTION' ? { approvedById: admin.id, approvedAt: now } : {}),
    ...(decision === 'RESOLVED' ? { resolvedById: admin.id, resolvedAt: now } : {}),
    ...(decision === 'DISMISSED' ? { dismissedById: admin.id, dismissedAt: now } : {}),
  } });
  await db.trustSafetyCaseEvent.create({ data: { caseId: id, eventType: `CASE_${decision}`, actorType: 'ADMIN', actorId: admin.id, note: decision === 'APPROVED_ACTION' ? 'Draft/manual recommendation approved; no warning was sent and no account action was performed.' : null } });
  await logOperationsActivity({ eventType: `TRUST_SAFETY_CASE_${decision}`, actorType: 'ADMIN', actorId: admin.id, entityType: 'TRUST_SAFETY_CASE', entityId: id, summary: `${safetyCase.title} marked ${decision.toLowerCase().replaceAll('_', ' ')}.`, details: { type: safetyCase.type, severity: safetyCase.severity, automatedAction: false } });
  revalidatePath('/admin/trust-safety');
}
function date(value: Date | null) { return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }).format(value) : 'Never'; }
function severityClass(value: string) { return value === 'P0' ? 'bg-red-950 text-white' : value === 'P1' ? 'bg-red-700 text-white' : value === 'P2' ? 'bg-amber-500 text-slate-950' : 'bg-blue-600 text-white'; }
function subjectLink(type: string, id: string | null) { if (!id) return null; if (type === 'JOB') return `/jobs/${id}`; if (type === 'USER') return `/profile/${id}`; return null; }

export default async function TrustSafetyPage() {
  await requireAdmin();
  const [settings, cases, runs, grouped] = await Promise.all([
    getTrustSafetySettings(), db.trustSafetyCase.findMany({ orderBy: [{ status: 'asc' }, { severity: 'asc' }, { lastDetectedAt: 'desc' }], include: { events: { orderBy: { createdAt: 'desc' }, take: 8 } }, take: 250 }),
    db.trustSafetyRun.findMany({ orderBy: { startedAt: 'desc' }, take: 15 }), db.trustSafetyCase.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(grouped.map((item) => [item.status, item._count._all])); const active = cases.filter((item) => ['NEEDS_REVIEW', 'REVIEWING'].includes(item.status)); const closed = cases.filter((item) => !['NEEDS_REVIEW', 'REVIEWING'].includes(item.status)).slice(0, 30);
  return <main className="min-h-screen bg-muted/30"><div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/admin/operations" className="text-sm text-primary hover:underline">← Marketplace Operations</Link><div className="mt-3 flex items-center gap-3"><ShieldAlert className="size-8 text-red-600" /><h1 className="text-3xl font-bold">Marketplace Trust & Safety Agent</h1></div><p className="mt-2 max-w-4xl text-muted-foreground">Evidence-minimizing risk detection and an administrator case queue. The agent never sends warnings, removes content, suspends accounts, or changes marketplace records automatically.</p></div><form action={runNow}><Button className="gap-2"><RefreshCw className="size-4" />Run safety scan</Button></form></header>

    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
      <Card className="border-violet-200 bg-violet-50/80 dark:border-violet-900 dark:bg-violet-950/35"><CardHeader><CardDescription>Agent</CardDescription><CardTitle>{settings.enabled ? 'Enabled' : 'Paused'}</CardTitle></CardHeader></Card>
      <Card className="border-red-200 bg-red-50/80 dark:border-red-900 dark:bg-red-950/35"><CardHeader><CardDescription>Needs review</CardDescription><CardTitle>{counts.NEEDS_REVIEW || 0}</CardTitle></CardHeader></Card>
      <Card className="border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/35"><CardHeader><CardDescription>Reviewing</CardDescription><CardTitle>{counts.REVIEWING || 0}</CardTitle></CardHeader></Card>
      <Card className="border-blue-200 bg-blue-50/80 dark:border-blue-900 dark:bg-blue-950/35"><CardHeader><CardDescription>Approved drafts</CardDescription><CardTitle>{counts.APPROVED_ACTION || 0}</CardTitle></CardHeader></Card>
      <Card className="border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/35"><CardHeader><CardDescription>Resolved</CardDescription><CardTitle>{counts.RESOLVED || 0}</CardTitle></CardHeader></Card>
    </section>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-5" />Detection controls</CardTitle><CardDescription>Conservative thresholds reduce false positives. Every match still requires contextual review.</CardDescription></CardHeader><CardContent><form action={saveSettings} className="grid gap-4 md:grid-cols-4">
      <label className="space-y-2 text-sm font-medium">Status<select name="enabled" defaultValue={String(settings.enabled)} className="h-10 w-full rounded-md border bg-background px-3"><option value="true">Enabled</option><option value="false">Paused</option></select></label>
      <label className="space-y-2 text-sm font-medium">Review window (days)<Input name="scanDays" type="number" defaultValue={settings.scanDays} min="7" max="365" /></label>
      <label className="space-y-2 text-sm font-medium">Repeat reports<Input name="repeatReportThreshold" type="number" defaultValue={settings.repeatReportThreshold} min="2" max="10" /></label>
      <label className="space-y-2 text-sm font-medium">Cancelled projects<Input name="cancellationThreshold" type="number" defaultValue={settings.cancellationThreshold} min="2" max="20" /></label>
      <label className="space-y-2 text-sm font-medium">Withdrawn bids<Input name="withdrawalThreshold" type="number" defaultValue={settings.withdrawalThreshold} min="2" max="20" /></label>
      <label className="space-y-2 text-sm font-medium">High bid multiplier<Input name="highBidMultiplier" type="number" step="0.1" defaultValue={settings.highBidMultiplier} min="1.5" max="20" /></label>
      <label className="space-y-2 text-sm font-medium">Low bid multiplier<Input name="lowBidMultiplier" type="number" step="0.01" defaultValue={settings.lowBidMultiplier} min="0.01" max="0.8" /></label>
      <Button type="submit" variant="outline" className="self-end">Save controls</Button>
    </form></CardContent></Card>

    <Card><CardHeader><CardTitle>Safety review queue</CardTitle><CardDescription>{active.length} cases require human review. “Approve draft” stores the edited warning for manual use only.</CardDescription></CardHeader><CardContent className="space-y-5">{active.map((item) => { const link = subjectLink(item.subjectType, item.subjectId); return <article key={item.id} className="rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><Badge className={severityClass(item.severity)}>{item.severity}</Badge><Badge variant="outline">{item.type.replaceAll('_', ' ')}</Badge><Badge variant="outline">{item.confidence}% confidence</Badge><Badge variant="outline">{item.status.replaceAll('_', ' ')}</Badge></div><h2 className="mt-3 text-lg font-semibold">{item.title}</h2><p className="mt-1 text-sm text-muted-foreground">{item.summary}</p></div>{link && <Button asChild size="sm" variant="outline"><Link href={link}><Eye className="size-4" />Open source</Link></Button>}</div>
      <div className="mt-4 rounded-md bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><div className="text-sm font-semibold">Recommended manual action</div><p className="mt-1 text-sm">{item.recommendedAction}</p></div>
      <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">Minimal evidence and audit history</summary><pre className="mt-2 overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(item.evidence, null, 2)}</pre><div className="mt-2 space-y-1 text-xs text-muted-foreground">{item.events.map((event) => <p key={event.id}>{date(event.createdAt)} · {event.eventType.replaceAll('_', ' ')}</p>)}</div></details>
      <form action={reviewCase} className="mt-4 space-y-3"><input type="hidden" name="id" value={item.id} />{item.draftWarning && <Textarea name="draftWarning" defaultValue={item.draftWarning} rows={4} />}<div className="flex flex-wrap gap-2"><Button name="decision" value="REVIEWING" variant="outline"><Eye className="size-4" />Mark reviewing</Button>{item.draftWarning && <Button name="decision" value="APPROVED_ACTION"><ShieldCheck className="size-4" />Approve draft only</Button>}<Button name="decision" value="RESOLVED" variant="outline"><CheckCircle2 className="size-4" />Resolve</Button><Button name="decision" value="DISMISSED" variant="outline"><XCircle className="size-4" />Dismiss</Button></div></form>
    </article>; })}{!active.length && <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><CheckCircle2 className="size-5 text-emerald-600" />No safety cases currently need review.</div>}</CardContent></Card>

    <section className="grid gap-8 xl:grid-cols-2"><Card><CardHeader><CardTitle className="flex items-center gap-2"><RefreshCw className="size-5" />Run history</CardTitle><CardDescription>Last scan: {date(settings.lastRunAt)}</CardDescription></CardHeader><CardContent className="space-y-3">{runs.map((run) => <div key={run.id} className="rounded-md border p-3 text-sm"><div className="flex justify-between gap-2"><span className="font-medium">{run.trigger} · {run.status}</span><span className="text-muted-foreground">{date(run.startedAt)}</span></div><p className="mt-1 text-muted-foreground">{run.recordsScanned} records · {run.risksDetected} risks · {run.casesCreated} new · {run.casesUpdated} refreshed</p>{run.errorMessage && <p className="mt-1 text-red-600">{run.errorMessage}</p>}</div>)}{!runs.length && <p className="text-sm text-muted-foreground">No scans yet.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5" />Recently decided</CardTitle><CardDescription>Approved drafts, resolved cases, and dismissals remain in the audit trail.</CardDescription></CardHeader><CardContent className="space-y-3">{closed.map((item) => <div key={item.id} className="rounded-md border p-3 text-sm"><div className="flex justify-between gap-2"><span className="font-medium">{item.title}</span><Badge variant="outline">{item.status.replaceAll('_', ' ')}</Badge></div><p className="mt-1 text-muted-foreground">{item.type.replaceAll('_', ' ')} · {date(item.updatedAt)}</p></div>)}{!closed.length && <p className="text-sm text-muted-foreground">No decided cases yet.</p>}</CardContent></Card></section>
  </div></main>;
}