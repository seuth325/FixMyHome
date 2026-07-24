import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AlertTriangle, CheckCircle2, MapPin, RefreshCw, Search, Users, XCircle } from 'lucide-react';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { runSupplyRecruitmentAgent } from '@/lib/supply-recruitment-agent';
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

async function runNow() {
  'use server';
  await requireAdmin();
  await runSupplyRecruitmentAgent({ trigger: 'MANUAL' });
  revalidatePath('/admin/recruitment');
}

async function reviewCandidate(formData: FormData) {
  'use server';
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  const decision = String(formData.get('decision') || '');
  if (!id || !['APPROVED', 'DISMISSED'].includes(decision)) return;
  const draftSubject = String(formData.get('draftSubject') || '').trim().slice(0, 200);
  const draftBody = String(formData.get('draftBody') || '').trim().slice(0, 3000);
  const candidate = await db.recruitmentCandidate.update({
    where: { id },
    data: decision === 'APPROVED'
      ? { status: 'APPROVED', approvedById: admin.id, approvedAt: new Date(), draftSubject, draftBody }
      : { status: 'DISMISSED', dismissedAt: new Date() },
  });
  await logOperationsActivity({
    eventType: `RECRUITMENT_CANDIDATE_${decision}`,
    actorType: 'ADMIN',
    actorId: admin.id,
    entityType: 'RECRUITMENT_CANDIDATE',
    entityId: candidate.id,
    summary: `Recruitment candidate marked ${decision.toLowerCase()}; no outreach was sent.`,
    details: { gapId: candidate.gapId, leadId: candidate.leadId, score: candidate.score },
  });
  revalidatePath('/admin/recruitment');
}

function values(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export default async function RecruitmentPage() {
  await requireAdmin();
  const [gaps, candidates, reviewed, reports, runs] = await Promise.all([
    db.handymanSupplyGap.findMany({ where: { status: 'OPEN' }, orderBy: { gapScore: 'desc' }, take: 50 }),
    db.recruitmentCandidate.findMany({ where: { status: 'PENDING_REVIEW' }, orderBy: { score: 'desc' }, take: 150 }),
    db.recruitmentCandidate.findMany({ where: { status: { in: ['APPROVED', 'DISMISSED', 'CONVERTED'] } }, orderBy: { updatedAt: 'desc' }, take: 30 }),
    db.supplyWeeklyReport.findMany({ orderBy: { weekStart: 'desc' }, take: 8 }),
    db.supplyRecruitmentRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
  ]);
  const gapIds = [...new Set([...candidates, ...reviewed].map((item) => item.gapId))];
  const leadIds = [...new Set([...candidates, ...reviewed].map((item) => item.leadId))];
  const [candidateGaps, leads] = await Promise.all([
    db.handymanSupplyGap.findMany({ where: { id: { in: gapIds } } }),
    db.handymanLead.findMany({ where: { id: { in: leadIds } } }),
  ]);
  const gapById = new Map(candidateGaps.map((gap) => [gap.id, gap]));
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const latest = reports[0];

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><Link href="/admin/operations" className="text-sm text-primary hover:underline">← Marketplace Operations</Link><div className="mt-3 flex items-center gap-3"><Users className="size-8 text-primary" /><h1 className="text-3xl font-bold">Supply & Recruitment Agent</h1></div><p className="mt-2 max-w-3xl text-muted-foreground">Coverage gaps, ranked prospects, outreach drafts, and recruitment conversion tracking. Approval prepares outreach but never sends it.</p></div>
          <form action={runNow}><Button className="gap-2"><RefreshCw className="size-4" />Run analysis</Button></form>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader><CardDescription>Open supply gaps</CardDescription><CardTitle>{gaps.length}</CardTitle></CardHeader></Card>
          <Card><CardHeader><CardDescription>Critical gaps</CardDescription><CardTitle>{gaps.filter((gap) => gap.priority === 'P1').length}</CardTitle></CardHeader></Card>
          <Card><CardHeader><CardDescription>Prospects to review</CardDescription><CardTitle>{candidates.length}</CardTitle></CardHeader></Card>
          <Card><CardHeader><CardDescription>Conversions tracked</CardDescription><CardTitle>{reviewed.filter((item) => item.status === 'CONVERTED').length}</CardTitle></CardHeader></Card>
        </section>

        {latest && <Card className="border-primary/20"><CardHeader><CardDescription>Weekly Supply Report</CardDescription><CardTitle>{latest.headline}</CardTitle></CardHeader><CardContent><p>{latest.summary}</p><div className="mt-4 flex flex-wrap gap-2"><Badge variant="outline">{latest.openGapCount} gaps</Badge><Badge variant="outline">{latest.candidateCount} candidates</Badge><Badge variant="outline">{latest.approvedCount} approved</Badge><Badge variant="outline">{latest.convertedCount} converted</Badge></div></CardContent></Card>}

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-amber-600" />Priority coverage gaps</CardTitle><CardDescription>Demand areas where open projects exceed qualified available supply.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{gaps.map((gap) => <article key={gap.id} className="rounded-lg border p-4"><div className="flex justify-between gap-2"><Badge className={gap.priority === 'P1' ? 'bg-red-700' : gap.priority === 'P2' ? 'bg-amber-500 text-slate-950' : ''}>{gap.priority}</Badge><Badge variant="outline">Score {gap.gapScore}</Badge></div><h3 className="mt-3 font-semibold">{gap.category}</h3><p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3" />{gap.location}</p><p className="mt-3 text-sm">{gap.openJobs} open · {gap.noBidJobs} without bids · {gap.qualifiedPros} qualified pros</p></article>)}{!gaps.length && <p className="text-sm text-muted-foreground">No active supply gaps.</p>}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Search className="size-5" />Recruitment review queue</CardTitle><CardDescription>Edit drafts and approve them for manual outreach. This page never sends email, SMS, or messages.</CardDescription></CardHeader>
          <CardContent className="space-y-5">{candidates.map((candidate) => { const gap = gapById.get(candidate.gapId); const lead = leadById.get(candidate.leadId); if (!gap || !lead) return null; const signup = `https://fixmyhome.pro/sign-up?campaign=supply-recruitment&ref=${candidate.recruitmentCode}`; return <article key={candidate.id} className="rounded-lg border p-5"><div className="flex flex-wrap justify-between gap-4"><div><div className="flex gap-2"><Badge className="bg-blue-700">Score {candidate.score}</Badge><Badge variant="outline">{gap.category}</Badge></div><h2 className="mt-3 text-lg font-semibold">{lead.businessName}</h2><p className="mt-1 text-sm text-muted-foreground">{lead.location || 'No location'} · {lead.source}</p></div><div className="text-sm text-muted-foreground">{lead.email || lead.phone || lead.website || 'No direct contact data'}</div></div><div className="mt-4 grid gap-4 lg:grid-cols-[0.8fr_1.4fr]"><div className="rounded-md bg-muted p-4"><div className="font-semibold">Why this prospect</div><ul className="mt-2 space-y-1 text-sm">{values(candidate.reasons).map((reason) => <li key={reason}>• {reason}</li>)}</ul><p className="mt-3 break-all text-xs text-muted-foreground">Tracked signup: {signup}</p></div><form action={reviewCandidate} className="space-y-3"><input type="hidden" name="id" value={candidate.id} /><Input name="draftSubject" defaultValue={candidate.draftSubject} maxLength={200} /><Textarea name="draftBody" defaultValue={`${candidate.draftBody}\n\nCreate your free profile: ${signup}`} rows={6} maxLength={3000} /><div className="flex gap-2"><Button name="decision" value="APPROVED" className="gap-2"><CheckCircle2 className="size-4" />Approve draft</Button><Button name="decision" value="DISMISSED" variant="outline" className="gap-2"><XCircle className="size-4" />Dismiss</Button></div></form></div></article>; })}{!candidates.length && <div className="py-10 text-center text-sm text-muted-foreground">No prospects currently meet the recruitment threshold.</div>}</CardContent>
        </Card>

        <section className="grid gap-8 xl:grid-cols-2">
          <Card><CardHeader><CardTitle>Reviewed candidates</CardTitle></CardHeader><CardContent className="space-y-3">{reviewed.map((item) => <div key={item.id} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{leadById.get(item.leadId)?.businessName ?? 'Prospect'}</span><Badge variant="outline">{item.status}</Badge></div>)}{!reviewed.length && <p className="text-sm text-muted-foreground">No reviewed candidates.</p>}</CardContent></Card>
          <Card><CardHeader><CardTitle>Run history</CardTitle></CardHeader><CardContent className="space-y-3">{runs.map((run) => <div key={run.id} className="rounded-md border p-3 text-sm"><div className="flex justify-between"><span className="font-medium">{run.trigger} · {run.status}</span><span className="text-muted-foreground">{run.startedAt.toLocaleDateString()}</span></div><p className="mt-1 text-xs text-muted-foreground">{run.gapsDetected} gaps · {run.leadsEvaluated} evaluated · {run.candidatesCreated} created</p></div>)}</CardContent></Card>
        </section>
      </div>
    </main>
  );
}
