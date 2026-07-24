import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { CheckCircle2, RefreshCw, Rocket, UserCheck, XCircle } from 'lucide-react';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { runActivationAgent } from '@/lib/activation-agent';
import { logOperationsActivity } from '@/lib/operations-intelligence';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const user = await db.user.findFirst({ where: { OR: [{ id: session.user.id }, ...(session.user.email ? [{ email: session.user.email }] : [])] }, select: { id: true, role: true } });
  if (user?.role !== 'ADMIN') redirect('/role-selection');
  return user;
}
async function runNow() { 'use server'; await requireAdmin(); await runActivationAgent({ trigger: 'MANUAL' }); revalidatePath('/admin/activation'); }
async function review(formData: FormData) {
  'use server';
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  const decision = String(formData.get('decision') || '');
  if (!id || !['APPROVED', 'DISMISSED'].includes(decision)) return;
  const journey = await db.handymanActivationJourney.update({ where: { id }, data: decision === 'APPROVED' ? { status: 'APPROVED', approvedById: admin.id, approvedAt: new Date(), draftSubject: String(formData.get('subject') || '').slice(0, 200), draftBody: String(formData.get('body') || '').slice(0, 3000) } : { status: 'DISMISSED', dismissedAt: new Date() } });
  await logOperationsActivity({ eventType: `ACTIVATION_DRAFT_${decision}`, actorType: 'ADMIN', actorId: admin.id, entityType: 'ACTIVATION_JOURNEY', entityId: journey.id, summary: `Activation draft marked ${decision.toLowerCase()}; no message was sent.`, details: { userId: journey.userId, stage: journey.stage } });
  revalidatePath('/admin/activation');
}
function campaigns(value: unknown) { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : []; }

export default async function ActivationPage() {
  await requireAdmin();
  const [queue, journeys, snapshots, runs] = await Promise.all([
    db.handymanActivationJourney.findMany({ where: { status: 'NEEDS_REVIEW' }, orderBy: [{ stalledDays: 'desc' }, { profileCompleteness: 'asc' }], take: 150 }),
    db.handymanActivationJourney.findMany({ orderBy: { updatedAt: 'desc' }, take: 500 }),
    db.activationDailySnapshot.findMany({ orderBy: { snapshotDate: 'desc' }, take: 14 }),
    db.activationAgentRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: [...new Set(journeys.map((item) => item.userId))] } }, select: { id: true, name: true, email: true, location: true } });
  const usersById = new Map(users.map((user) => [user.id, user]));
  const latest = snapshots[0];
  const stages = ['SIGNED_UP', 'PROFILE_STARTED', 'PROFILE_COMPLETE', 'FIRST_BID', 'FIRST_WIN'];
  return <main className="min-h-screen bg-muted/30"><div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/admin/operations" className="text-sm text-primary hover:underline">← Marketplace Operations</Link><div className="mt-3 flex items-center gap-3"><Rocket className="size-8 text-primary" /><h1 className="text-3xl font-bold">Conversion & Activation Agent</h1></div><p className="mt-2 max-w-3xl text-muted-foreground">Handyman funnel progress, stalled-stage recommendations, profile completeness, campaign quality, and approval-only activation drafts.</p></div><form action={runNow}><Button className="gap-2"><RefreshCw className="size-4" />Run activation</Button></form></header>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{stages.map((stage) => <Card key={stage} className={stage === 'SIGNED_UP' ? 'border-blue-200 bg-blue-50/80 dark:border-blue-900 dark:bg-blue-950/35' : stage === 'PROFILE_STARTED' ? 'border-cyan-200 bg-cyan-50/80 dark:border-cyan-900 dark:bg-cyan-950/35' : stage === 'PROFILE_COMPLETE' ? 'border-violet-200 bg-violet-50/80 dark:border-violet-900 dark:bg-violet-950/35' : stage === 'FIRST_BID' ? 'border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/35' : 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/35'}><CardHeader><CardDescription>{stage.replaceAll('_', ' ')}</CardDescription><CardTitle>{journeys.filter((item) => item.stage === stage).length}</CardTitle></CardHeader></Card>)}</section>
    {latest && <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Card className="border-violet-200 bg-violet-50/80 dark:border-violet-900 dark:bg-violet-950/35"><CardHeader><CardDescription>Profile completion</CardDescription><CardTitle>{latest.profileCompletionRate}%</CardTitle></CardHeader></Card><Card className="border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/35"><CardHeader><CardDescription>Reached first bid</CardDescription><CardTitle>{latest.firstBidRate}%</CardTitle></CardHeader></Card><Card className="border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/35"><CardHeader><CardDescription>Reached first win</CardDescription><CardTitle>{latest.firstWinRate}%</CardTitle></CardHeader></Card><Card className="border-rose-200 bg-rose-50/80 dark:border-rose-900 dark:bg-rose-950/35"><CardHeader><CardDescription>Stalled journeys</CardDescription><CardTitle>{latest.stalled}</CardTitle></CardHeader></Card></section>}
    <Card><CardHeader><CardTitle>Activation review queue</CardTitle><CardDescription>Approving a draft stores it for manual use. It does not send email, SMS, or an in-app notification.</CardDescription></CardHeader><CardContent className="space-y-5">{queue.map((journey) => { const user = usersById.get(journey.userId); return <article key={journey.id} className="rounded-lg border p-5"><div className="flex flex-wrap justify-between gap-3"><div><div className="flex gap-2"><Badge className="bg-amber-600">{journey.stage.replaceAll('_', ' ')}</Badge><Badge variant="outline">{journey.profileCompleteness}% profile</Badge><Badge variant="outline">{journey.stalledDays} days stalled</Badge></div><h2 className="mt-3 text-lg font-semibold">{user?.name || 'Handyman'}</h2><p className="text-sm text-muted-foreground">{user?.email} · {user?.location || 'No ZIP'}</p></div><p className="max-w-md text-sm">{journey.nextAction}</p></div><form action={review} className="mt-4 space-y-3"><input type="hidden" name="id" value={journey.id} /><Input name="subject" defaultValue={journey.draftSubject} /><Textarea name="body" defaultValue={journey.draftBody} rows={4} /><div className="flex gap-2"><Button name="decision" value="APPROVED" className="gap-2"><UserCheck className="size-4" />Approve draft</Button><Button name="decision" value="DISMISSED" variant="outline" className="gap-2"><XCircle className="size-4" />Dismiss</Button></div></form></article>; })}{!queue.length && <div className="flex justify-center gap-2 py-10 text-sm text-muted-foreground"><CheckCircle2 className="size-5 text-green-600" />No stalled journeys require review.</div>}</CardContent></Card>
    <section className="grid gap-8 xl:grid-cols-2"><Card><CardHeader><CardTitle>Campaign activation quality</CardTitle></CardHeader><CardContent className="space-y-3">{campaigns(latest?.campaigns).map((item) => <div key={String(item.campaign)} className="rounded-md border p-3"><div className="flex justify-between"><span className="font-medium">{String(item.campaign)}</span><Badge variant="outline">{String(item.activationRate)}% activated</Badge></div><p className="mt-1 text-xs text-muted-foreground">{String(item.total)} signups · {String(item.complete)} complete · {String(item.bid)} bidders · {String(item.win)} winners</p></div>)}</CardContent></Card><Card><CardHeader><CardTitle>Run history</CardTitle></CardHeader><CardContent className="space-y-3">{runs.map((run) => <div key={run.id} className="rounded-md border p-3 text-sm"><div className="flex justify-between"><span className="font-medium">{run.trigger} · {run.status}</span><span>{run.startedAt.toLocaleDateString()}</span></div><p className="mt-1 text-xs text-muted-foreground">{run.usersAnalyzed} analyzed · {run.stalledCount} stalled</p></div>)}</CardContent></Card></section>
  </div></main>;
}
