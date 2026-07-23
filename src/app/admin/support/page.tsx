import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AlertTriangle, Bot, Clock3, Mail, PauseCircle, PlayCircle, RefreshCw } from 'lucide-react';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { getSupportAgentSettings, runSupportAgent } from '@/lib/support-agent';
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
  await runSupportAgent({ trigger: 'MANUAL', force: true });
  revalidatePath('/admin/support');
}

async function updateSettings(formData: FormData) {
  'use server';
  await requireAdmin();
  const timezone = String(formData.get('timezone') || 'America/New_York').trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { return; }
  const firstRunHour = Math.max(0, Math.min(23, Number(formData.get('firstRunHour') || 8)));
  const secondRunHour = Math.max(0, Math.min(23, Number(formData.get('secondRunHour') || 16)));
  const batchSize = Math.max(1, Math.min(50, Number(formData.get('batchSize') || 20)));
  await db.supportAgentSettings.upsert({
    where: { id: 'default' },
    update: { enabled: formData.get('enabled') === 'true', timezone, firstRunHour, secondRunHour, batchSize },
    create: { id: 'default', enabled: formData.get('enabled') === 'true', timezone, firstRunHour, secondRunHour, batchSize },
  });
  revalidatePath('/admin/support');
}

async function updateCaseStatus(formData: FormData) {
  'use server';
  await requireAdmin();
  const id = String(formData.get('id') || '');
  const status = String(formData.get('status') || 'NEEDS_REVIEW');
  if (!id || !['NEEDS_REVIEW', 'REVIEWED', 'WAITING', 'ESCALATED', 'CLOSED'].includes(status)) return;
  await db.supportCase.update({ where: { id }, data: { status, escalated: status === 'ESCALATED' } });
  revalidatePath('/admin/support');
}

function dateTime(value: Date | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }).format(value);
}

function priorityBadge(priority: string) {
  const className = priority === 'P0' ? 'bg-red-700 text-white' : priority === 'P1' ? 'bg-orange-600 text-white' : priority === 'P2' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-900';
  return <Badge className={className}>{priority}</Badge>;
}

export default async function AdminSupportPage() {
  await requireAdmin();
  const settings = await getSupportAgentSettings();
  const [cases, runs, statusCounts, unprocessedSubmissions] = await Promise.all([
    db.supportCase.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }], take: 100 }),
    db.supportAgentRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
    db.supportCase.groupBy({ by: ['status'], _count: { _all: true } }),
    db.contactSubmission.count({ where: { status: 'NEW' } }),
  ]);
  const count = Object.fromEntries(statusCounts.map((item) => [item.status, item._count._all]));

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/admin" className="text-sm text-primary hover:underline">← Admin dashboard</Link>
            <div className="mt-3 flex items-center gap-3"><Bot className="size-8 text-primary" /><h1 className="text-3xl font-bold">Support Agent</h1></div>
            <p className="mt-2 max-w-3xl text-muted-foreground">Phase 1 classifies stored support requests and prepares drafts for human review. It cannot send email or change customer accounts.</p>
          </div>
          <form action={runNow}><Button className="gap-2"><RefreshCw className="size-4" />Run now</Button></form>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card><CardHeader className="pb-2"><CardDescription>Agent</CardDescription><CardTitle className="flex items-center gap-2 text-xl">{settings.enabled ? <PlayCircle className="size-5 text-green-600" /> : <PauseCircle className="size-5 text-amber-600" />}{settings.enabled ? 'Enabled' : 'Paused'}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>New submissions</CardDescription><CardTitle>{unprocessedSubmissions}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Needs review</CardDescription><CardTitle>{count.NEEDS_REVIEW || 0}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Escalated</CardDescription><CardTitle>{count.ESCALATED || 0}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Last run</CardDescription><CardTitle className="text-base">{dateTime(settings.lastRunAt)}</CardTitle></CardHeader></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-5" />Schedule and controls</CardTitle><CardDescription>The protected cron endpoint should be called hourly; it runs only during the two configured local hours.</CardDescription></CardHeader>
          <CardContent>
            <form action={updateSettings} className="grid gap-4 md:grid-cols-5">
              <label className="space-y-2 text-sm font-medium">Status<select name="enabled" defaultValue={String(settings.enabled)} className="h-10 w-full rounded-md border bg-background px-3"><option value="true">Enabled</option><option value="false">Paused</option></select></label>
              <label className="space-y-2 text-sm font-medium">Time zone<Input name="timezone" defaultValue={settings.timezone} /></label>
              <label className="space-y-2 text-sm font-medium">First hour (0–23)<Input name="firstRunHour" type="number" min="0" max="23" defaultValue={settings.firstRunHour} /></label>
              <label className="space-y-2 text-sm font-medium">Second hour (0–23)<Input name="secondRunHour" type="number" min="0" max="23" defaultValue={settings.secondRunHour} /></label>
              <label className="space-y-2 text-sm font-medium">Batch size<Input name="batchSize" type="number" min="1" max="50" defaultValue={settings.batchSize} /></label>
              <Button type="submit" variant="outline" className="w-fit md:col-span-5">Save controls</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Review queue</CardTitle><CardDescription>AI-generated content is internal until an administrator reviews it. No send action exists in Phase 1.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            {cases.map((supportCase) => (
              <article key={supportCase.id} className="rounded-lg border p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="flex flex-wrap items-center gap-2">{priorityBadge(supportCase.priority)}<Badge variant="outline">{supportCase.audience}</Badge><Badge variant="outline">{supportCase.category.replaceAll('_', ' ')}</Badge>{supportCase.escalated && <Badge className="bg-red-100 text-red-800"><AlertTriangle className="size-3" />Human escalation</Badge>}</div><h2 className="mt-3 text-lg font-semibold">{supportCase.subject || 'Support request'}</h2><p className="text-sm text-muted-foreground">{supportCase.senderName} · {supportCase.senderEmail} · {dateTime(supportCase.createdAt)}</p></div>
                  <form action={updateCaseStatus} className="flex gap-2"><input type="hidden" name="id" value={supportCase.id} /><select name="status" defaultValue={supportCase.status} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="NEEDS_REVIEW">Needs review</option><option value="REVIEWED">Reviewed</option><option value="WAITING">Waiting</option><option value="ESCALATED">Escalated</option><option value="CLOSED">Closed</option></select><Button size="sm" variant="outline">Update</Button></form>
                </div>
                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <div className="space-y-4"><section><h3 className="text-sm font-semibold">Customer message</h3><p className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{supportCase.message}</p></section><section><h3 className="text-sm font-semibold">Case summary</h3><p className="mt-1 text-sm text-muted-foreground">{supportCase.summary}</p></section><section><h3 className="text-sm font-semibold">Recommended action</h3><p className="mt-1 text-sm text-muted-foreground">{supportCase.recommendedAction}</p></section>{supportCase.missingInformation && <section><h3 className="text-sm font-semibold">Missing information</h3><p className="mt-1 text-sm text-muted-foreground">{supportCase.missingInformation}</p></section>}</div>
                  <div className="space-y-4"><section className="rounded-md border border-dashed p-4"><div className="flex items-center gap-2"><Mail className="size-4" /><h3 className="text-sm font-semibold">Draft only</h3></div><p className="mt-3 text-sm font-medium">{supportCase.draftSubject}</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{supportCase.draftBody}</p></section><section><h3 className="text-sm font-semibold">Internal note</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{supportCase.internalNote}</p></section><p className="text-xs text-muted-foreground">Confidence: {supportCase.confidence === null ? 'Not reported' : `${Math.round(supportCase.confidence * 100)}%`} · Source: {supportCase.sourceType}</p></div>
                </div>
              </article>
            ))}
            {cases.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No support cases have been processed. Choose Run now to process stored contact submissions.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Run history</CardTitle><CardDescription>Operational results, failures, and token counts for the most recent runs.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {runs.map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"><div><div className="font-medium">{run.trigger} · {run.status}</div><div className="text-xs text-muted-foreground">Started {dateTime(run.startedAt)} · Finished {dateTime(run.finishedAt)}</div>{run.errorMessage && <p className="mt-2 max-w-3xl text-sm text-red-600">{run.errorMessage}</p>}</div><div className="text-right text-sm"><div>{run.processed}/{run.discovered} processed · {run.failed} failed</div><div className="text-xs text-muted-foreground">{run.inputTokens} input · {run.outputTokens} output tokens</div></div></div>)}
            {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs recorded.</p>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
