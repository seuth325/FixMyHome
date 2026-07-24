import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { CheckCircle2, MapPin, RefreshCw, Sparkles, Target, UserCheck, XCircle } from 'lucide-react';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { runHandymanMatchingAgent } from '@/lib/handyman-matching-agent';
import { logOperationsActivity } from '@/lib/operations-intelligence';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

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
  await runHandymanMatchingAgent({ trigger: 'MANUAL' });
  revalidatePath('/admin/matching');
}

async function approveMatch(formData: FormData) {
  'use server';
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  const message = String(formData.get('message') || '').trim().slice(0, 500);
  const match = await db.handymanJobMatch.findUnique({ where: { id } });
  if (!match || match.status !== 'PENDING_REVIEW') return;
  const [job, handyman] = await Promise.all([
    db.job.findFirst({ where: { id: match.jobId, status: { in: ['OPEN', 'IN_REVIEW'] } }, select: { id: true, title: true } }),
    db.user.findFirst({ where: { id: match.handymanId, role: 'HANDYMAN', isAvailable: true }, select: { id: true, name: true } }),
  ]);
  if (!job || !handyman) return;
  const invitation = await db.$transaction(async (tx) => {
    const created = await tx.jobInvitation.create({ data: { jobId: job.id, handymanId: handyman.id, message: message || match.draftMessage } });
    await tx.notification.create({
      data: {
        userId: handyman.id,
        type: 'BID_INVITATION',
        title: 'You are invited to bid',
        body: `FixMyHome invited you to review "${job.title}" based on your marketplace profile.`,
        linkPath: `/jobs/${job.id}/bid`,
      },
    });
    await tx.handymanJobMatch.update({
      where: { id: match.id },
      data: { status: 'INVITED', approvedById: admin.id, approvedAt: new Date(), invitationId: created.id, draftMessage: message || match.draftMessage },
    });
    return created;
  });
  await logOperationsActivity({
    eventType: 'MATCH_INVITATION_APPROVED',
    actorType: 'ADMIN',
    actorId: admin.id,
    entityType: 'JOB_INVITATION',
    entityId: invitation.id,
    summary: `Approved invitation for ${handyman.name} to review "${job.title}".`,
    details: { matchId: match.id, jobId: job.id, handymanId: handyman.id, score: match.score },
  });
  revalidatePath('/admin/matching');
}

async function dismissMatch(formData: FormData) {
  'use server';
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  const match = await db.handymanJobMatch.update({ where: { id }, data: { status: 'DISMISSED', dismissedAt: new Date() } });
  await logOperationsActivity({
    eventType: 'MATCH_CANDIDATE_DISMISSED',
    actorType: 'ADMIN',
    actorId: admin.id,
    entityType: 'HANDYMAN_JOB_MATCH',
    entityId: match.id,
    summary: 'Administrator dismissed a handyman match candidate.',
    details: { jobId: match.jobId, handymanId: match.handymanId, score: match.score },
  });
  revalidatePath('/admin/matching');
}

function list(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export default async function HandymanMatchingPage() {
  await requireAdmin();
  const [matches, recent, runs] = await Promise.all([
    db.handymanJobMatch.findMany({ where: { status: 'PENDING_REVIEW' }, orderBy: [{ score: 'desc' }, { generatedAt: 'asc' }], take: 150 }),
    db.handymanJobMatch.findMany({ where: { status: { in: ['INVITED', 'DISMISSED'] } }, orderBy: { updatedAt: 'desc' }, take: 25 }),
    db.handymanMatchingRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
  ]);
  const all = [...matches, ...recent];
  const jobIds = [...new Set(all.map((match) => match.jobId))];
  const handymanIds = [...new Set(all.map((match) => match.handymanId))];
  const [jobs, handymen, bids] = await Promise.all([
    db.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, title: true, category: true, location: true, budget: true, createdAt: true, _count: { select: { bids: true } } } }),
    db.user.findMany({ where: { id: { in: handymanIds } }, select: { id: true, name: true, location: true, handymanProfile: { select: { businessName: true, ratingAvg: true, ratingCount: true, verificationStatus: true, skills: true } } } }),
    db.bid.findMany({ where: { jobId: { in: jobIds }, handymanId: { in: handymanIds } }, select: { id: true, jobId: true, handymanId: true } }),
  ]);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const handymenById = new Map(handymen.map((handyman) => [handyman.id, handyman]));
  const bidKeys = new Set(bids.map((bid) => `${bid.jobId}:${bid.handymanId}`));

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><Link href="/admin/operations" className="text-sm text-primary hover:underline">← Marketplace Operations</Link><div className="mt-3 flex items-center gap-3"><Target className="size-8 text-primary" /><h1 className="text-3xl font-bold">Handyman Matching Agent</h1></div><p className="mt-2 max-w-3xl text-muted-foreground">Scored project-to-handyman recommendations with editable invitation drafts. Nothing is invited until an administrator approves it.</p></div>
          <form action={runNow}><Button className="gap-2"><RefreshCw className="size-4" />Run matching</Button></form>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <Card className="border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/35"><CardHeader><CardDescription>Awaiting review</CardDescription><CardTitle>{matches.length}</CardTitle></CardHeader></Card>
          <Card className="border-teal-200 bg-teal-50/80 dark:border-teal-900 dark:bg-teal-950/35"><CardHeader><CardDescription>Invited recently</CardDescription><CardTitle>{recent.filter((item) => item.status === 'INVITED').length}</CardTitle></CardHeader></Card>
          <Card className="border-violet-200 bg-violet-50/80 dark:border-violet-900 dark:bg-violet-950/35"><CardHeader><CardDescription>Latest run</CardDescription><CardTitle className="text-lg">{runs[0]?.status ?? 'Not run'}</CardTitle></CardHeader></Card>
        </section>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-5" />Approval queue</CardTitle><CardDescription>Highest-scoring matches appear first. Review the evidence and edit the draft before approving.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            {matches.map((match) => {
              const job = jobsById.get(match.jobId);
              const handyman = handymenById.get(match.handymanId);
              if (!job || !handyman) return null;
              return <article key={match.id} className="rounded-lg border p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><div className="flex flex-wrap gap-2"><Badge className="bg-blue-700">Match {match.score}/100</Badge><Badge variant="outline">{job.category}</Badge><Badge variant="outline">{job._count.bids} bids</Badge></div><h2 className="mt-3 text-lg font-semibold"><Link href={`/jobs/${job.id}`} className="hover:underline">{job.title}</Link></h2><p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3" />{job.location} · ${Number(job.budget).toLocaleString()}</p></div>
                  <div className="text-right"><Link href={`/profile/${handyman.id}`} className="font-semibold text-primary hover:underline">{handyman.handymanProfile?.businessName || handyman.name}</Link><p className="mt-1 text-sm text-muted-foreground">{handyman.location ? `ZIP ${handyman.location}` : 'No ZIP'} · {Number(handyman.handymanProfile?.ratingAvg ?? 0).toFixed(1)} rating</p></div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
                  <div className="rounded-md bg-muted p-4"><div className="text-sm font-semibold">Why this match</div><ul className="mt-2 space-y-1 text-sm">{list(match.reasons).map((reason) => <li key={reason}>• {reason}</li>)}</ul><div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>Skills {match.skillScore}</span><span>Location {match.locationScore}</span><span>Quality {match.qualityScore}</span><span>Activity {match.activityScore}</span></div></div>
                  <form action={approveMatch} className="space-y-3"><input type="hidden" name="id" value={match.id} /><Textarea name="message" defaultValue={match.draftMessage} maxLength={500} rows={4} /><div className="flex gap-2"><Button className="gap-2"><UserCheck className="size-4" />Approve in-app invitation</Button><Button formAction={dismissMatch} variant="outline" className="gap-2"><XCircle className="size-4" />Dismiss</Button></div></form>
                </div>
              </article>;
            })}
            {!matches.length && <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><CheckCircle2 className="size-5 text-green-600" />No candidates are awaiting review.</div>}
          </CardContent>
        </Card>

        <section className="grid gap-8 xl:grid-cols-2">
          <Card><CardHeader><CardTitle>Recent outcomes</CardTitle></CardHeader><CardContent className="space-y-3">{recent.map((match) => { const job = jobsById.get(match.jobId); const handyman = handymenById.get(match.handymanId); const bid = bidKeys.has(`${match.jobId}:${match.handymanId}`); return <div key={match.id} className="rounded-md border p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{job?.title ?? 'Project'} · {handyman?.name ?? 'Handyman'}</span><Badge variant="outline">{bid ? 'BID RECEIVED' : match.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Match score {match.score}</p></div>; })}{!recent.length && <p className="text-sm text-muted-foreground">No reviewed matches yet.</p>}</CardContent></Card>
          <Card><CardHeader><CardTitle>Run history</CardTitle></CardHeader><CardContent className="space-y-3">{runs.map((run) => <div key={run.id} className="rounded-md border p-3 text-sm"><div className="flex justify-between gap-2"><span className="font-medium">{run.trigger} · {run.status}</span><span className="text-muted-foreground">{run.startedAt.toLocaleDateString()}</span></div><p className="mt-1 text-xs text-muted-foreground">{run.jobsAnalyzed} projects · {run.candidatesSeen} candidates · {run.matchesCreated} created · {run.matchesUpdated} refreshed</p></div>)}</CardContent></Card>
        </section>
      </div>
    </main>
  );
}
