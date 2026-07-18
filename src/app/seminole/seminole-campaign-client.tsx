'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowRight, CheckCircle2, Clock3, MapPin, ShieldCheck } from 'lucide-react';
import { JOB_CATEGORIES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const CAMPAIGN = 'seminole-homeowners';
const DRAFT_KEY = 'fmh-seminole-job-draft';
const SESSION_KEY = 'fmh-campaign-session';

type Draft = {
  title: string;
  category: string;
  location: string;
  budget: string;
  description: string;
  referralCode: string;
};

const initialDraft: Draft = {
  title: '',
  category: 'General Handyman',
  location: '33777',
  budget: '',
  description: '',
  referralCode: '',
};

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

async function track(eventName: string, draft: Draft, metadata?: Record<string, string | number | boolean>, jobId?: string) {
  try {
    await fetch('/api/campaign/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        sessionId: getSessionId(),
        eventName,
        campaign: CAMPAIGN,
        referralCode: draft.referralCode || undefined,
        path: '/seminole',
        zipCode: /^\d{5}$/.test(draft.location) ? draft.location : undefined,
        jobId,
        metadata,
      }),
    });
  } catch {
    // Analytics must never prevent a homeowner from posting.
  }
}

export default function SeminoleCampaignClient() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const referralCode = (params.get('ref') || params.get('referral') || '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64);
    const saved = localStorage.getItem(DRAFT_KEY);
    let next = { ...initialDraft, referralCode };
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<Draft>;
        next = { ...next, ...parsed, referralCode: referralCode || parsed.referralCode || '' };
      } catch {}
    }
    setDraft(next);
    void track('landing_view', next, { returning: Boolean(saved) });
  }, []);

  const update = (field: keyof Draft, value: string) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    if (!started.current) {
      started.current = true;
      void track('form_started', next);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.title.trim().length < 10 || draft.description.trim().length < 50) {
      toast.error('Please add a little more detail so local pros can quote accurately.');
      return;
    }
    if (!/^\d{5}$/.test(draft.location) || !draft.budget || Number(draft.budget) < 1) {
      toast.error('Please enter a valid ZIP code and estimated budget.');
      return;
    }

    setSubmitting(true);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    await track('short_form_completed', draft, { authenticated: Boolean(session?.user) });

    if (!session?.user) {
      await track('signup_started', draft);
      const query = new URLSearchParams({ campaign: CAMPAIGN, returnTo: '/seminole?resume=1' });
      if (draft.referralCode) query.set('ref', draft.referralCode);
      router.push(`/sign-up?${query.toString()}`);
      return;
    }

    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          budget: Number(draft.budget),
          campaignSource: CAMPAIGN,
          referralCode: draft.referralCode || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Unable to post project');

      await track('job_submitted', draft, { category: draft.category }, result.id);
      localStorage.removeItem(DRAFT_KEY);
      toast.success('Your project is live. Local pros can now review it.');
      router.push(`/jobs/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to post project');
      setSubmitting(false);
    }
  };

  const proof = [
    { icon: Clock3, title: 'About 2 minutes', copy: 'Short project form' },
    { icon: ShieldCheck, title: 'You stay in control', copy: 'Review before hiring' },
    { icon: CheckCircle2, title: 'Free to post', copy: 'No homeowner fee' },
  ];

  return (
    <main className="min-h-screen bg-transparent text-white">
      <header className="border-b border-white/10 bg-slate-950/55 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" aria-label="FixMyHome.pro home">
            <img src="/fixmyhome-logo-dark.png" alt="FixMyHome.pro" className="h-14 w-14 object-contain" />
          </Link>
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <MapPin className="size-4 text-emerald-400" />Serving Seminole, Florida
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-start gap-10 px-5 py-10 lg:grid-cols-[1.05fr_.95fr] lg:py-16">
        <div className="pt-2 lg:pt-8">
          <p className="text-sm font-semibold uppercase text-emerald-300">Seminole home repair marketplace</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">Tell us what needs fixing. Compare local bids.</h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-200">Post once, explain the project clearly, and let nearby service professionals compete for your work.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {proof.map(({ icon: Icon, title, copy }) => (
              <div key={title} className="border-t border-white/20 pt-4">
                <Icon className="size-5 text-emerald-400" />
                <p className="mt-3 font-semibold">{title}</p>
                <p className="mt-1 text-sm text-slate-300">{copy}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 max-w-xl text-sm leading-6 text-slate-300">FixMyHome.pro is created and operated by FixMyHome Pro LLC. We help homeowners organize project details, compare bids, message service providers, and make their own hiring decision.</p>
        </div>

        <form onSubmit={submit} className="rounded-lg border border-white/10 bg-slate-950/75 p-5 shadow-2xl shadow-black/30 backdrop-blur-md sm:p-7">
          <div className="mb-6">
            <p className="text-sm font-medium text-emerald-300">Get local bids</p>
            <h2 className="mt-1 text-2xl font-bold">What can we help with?</h2>
            <p className="mt-2 text-sm text-slate-300">No payment information required.</p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Project</Label>
              <Input id="title" value={draft.title} onChange={e => update('title', e.target.value)} placeholder="Example: Repair a leaking kitchen faucet" maxLength={100} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category">Service</Label>
                <select id="category" value={draft.category} onChange={e => update('category', e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  {JOB_CATEGORIES.map(category => <option key={category}>{category}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">ZIP code</Label>
                <Input id="location" inputMode="numeric" value={draft.location} onChange={e => update('location', e.target.value.replace(/\D/g, '').slice(0, 5))} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget">Estimated budget</Label>
              <Input id="budget" type="number" min="1" max="50000" value={draft.budget} onChange={e => update('budget', e.target.value)} placeholder="$300" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">A few helpful details</Label>
              <textarea id="description" value={draft.description} onChange={e => update('description', e.target.value)} placeholder="What is happening, where is it located, and when would you like the work done?" minLength={50} maxLength={2000} required className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
            </div>
          </div>
          <Button type="submit" size="lg" className="mt-6 w-full" disabled={submitting || status === 'loading'}>
            {submitting ? 'Saving your project...' : session?.user ? 'Post Project' : 'Continue Free'}<ArrowRight className="ml-2 size-4" />
          </Button>
          <p className="mt-4 text-center text-xs leading-5 text-slate-400">By continuing, you agree to the <Link href="/terms" className="underline">Terms of Service</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</p>
        </form>
      </section>
    </main>
  );
}
