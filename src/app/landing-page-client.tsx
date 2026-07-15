'use client';

import Link from 'next/link';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, CheckCircle, ClipboardList, Hammer, Home, MessageSquare, ShieldCheck, Star, Wrench } from 'lucide-react';

const homeownerSteps = [
  'Post a repair with photos, budget, and timing',
  'Compare local bids side by side',
  'Message, hire, and review in one place',
];

const proSteps = [
  'Browse jobs near your service area',
  'Bid on work that matches your skills',
  'Build trust with completed jobs and reviews',
];

const categories = ['Bathroom remodel', 'Roofing', 'Plumbing', 'Electrical', 'Painting', 'Handyman'];

const featureCards = [
  { title: 'Post with clarity', body: 'Add photos, budget, ZIP code, timing, and repair details.', Icon: ClipboardList },
  { title: 'Compare real bids', body: 'Review proposals from local pros before you commit.', Icon: Hammer },
  { title: 'Manage the work', body: 'Message, track status, and leave a review when complete.', Icon: CheckCircle },
];

export default function LandingPageClient() {
  const { user } = useCurrentUser();
  const dashboardPath = user?.role === 'HOMEOWNER' ? '/homeowner/dashboard' : '/handyman/dashboard';

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-gray-950 dark:text-gray-50">
      <section className="relative min-h-[88vh] overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1800&q=80"
          alt="Home repair professional measuring a cabinet installation"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-slate-950/70" />
        <div className="relative mx-auto flex min-h-[88vh] max-w-6xl flex-col px-4 py-6">
          <header className="flex items-center justify-between gap-4 text-white">
            <Link href="/" className="flex items-center gap-3 text-white">
              <img
                src="/fixmyhome-mark.png"
                alt=""
                aria-hidden="true"
                className="h-10 w-auto shrink-0 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)] sm:h-12"
              />
              <span className="text-2xl font-bold tracking-tight">FixMyHome</span>
            </Link>
            <div className="flex items-center gap-2">
              {user?.role ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={dashboardPath}>Go to Dashboard</Link>
                </Button>
              ) : (
                <>
                  <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white">
                    <Link href="/sign-in">Sign In</Link>
                  </Button>
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/sign-up">Get Started</Link>
                  </Button>
                </>
              )}
            </div>
          </header>

          <div className="grid flex-1 items-center gap-10 py-16 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="max-w-3xl text-white">
              <Badge className="mb-5 bg-emerald-500/95 text-white hover:bg-emerald-500">Florida home repair marketplace</Badge>
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Post the job. Compare bids. Hire with confidence.
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-200">
                FixMyHome connects homeowners with local handymen for repairs, remodels, and everyday fixes. Keep jobs, bids, messages, and reviews organized from the first quote to the final walkthrough.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {user?.role ? (
                  <Button asChild size="lg" className="bg-emerald-500 text-white hover:bg-emerald-600">
                    <Link href={dashboardPath}>Go to Dashboard <ArrowRight className="ml-2 size-4" /></Link>
                  </Button>
                ) : (
                  <>
                    <Button asChild size="lg" className="bg-emerald-500 text-white hover:bg-emerald-600">
                      <Link href="/sign-up">Create Free Account <ArrowRight className="ml-2 size-4" /></Link>
                    </Button>
                    <Button asChild size="lg" variant="secondary">
                      <Link href="/sign-in">Sign In</Link>
                    </Button>
                  </>
                )}
              </div>
              <div className="mt-8 grid gap-4 text-sm text-slate-200 sm:grid-cols-3">
                <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-300" /> Verified accounts</div>
                <div className="flex items-center gap-2"><MessageSquare className="size-4 text-emerald-300" /> Built-in messaging</div>
                <div className="flex items-center gap-2"><Star className="size-4 text-emerald-300" /> Reviews after work</div>
              </div>
            </div>

            <div className="rounded-lg border border-white/15 bg-white/95 p-5 shadow-2xl dark:bg-gray-900/95">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Sample job</p>
                  <h2 className="text-xl font-bold">Bathroom remodel estimate</h2>
                </div>
                <Badge variant="outline">3 bids</Badge>
              </div>
              <div className="space-y-3">
                {[
                  ['Licensed handyman', '$4,850', 'Can start this week'],
                  ['Local remodel crew', '$5,300', 'Includes materials review'],
                  ['Independent pro', '$4,600', 'Best value match'],
                ].map(([name, price, detail]) => (
                  <div key={name} className="flex items-center justify-between rounded-md border bg-background p-4">
                    <div>
                      <p className="font-semibold">{name}</p>
                      <p className="text-sm text-muted-foreground">{detail}</p>
                    </div>
                    <p className="font-bold text-emerald-600">{price}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-md bg-slate-100 p-4 text-sm text-slate-700 dark:bg-gray-800 dark:text-gray-200">
                Homeowners can compare price, timing, rating, and messages before choosing who to hire.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-5 md:grid-cols-3">
          {featureCards.map(({ title, body, Icon }) => (
            <Card key={title}>
              <CardHeader>
                <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <Icon className="size-5" />
                </div>
                <CardTitle>{title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">{body}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y bg-white dark:bg-gray-900">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-2">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"><Home className="size-6" /></div>
              <div>
                <h2 className="text-2xl font-bold">For homeowners</h2>
                <p className="text-muted-foreground">Get better bids without losing the details.</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {homeownerSteps.map((step) => <li key={step} className="flex gap-2"><CheckCircle className="mt-0.5 size-4 text-emerald-600" />{step}</li>)}
            </ul>
          </div>
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"><Wrench className="size-6" /></div>
              <div>
                <h2 className="text-2xl font-bold">For handymen</h2>
                <p className="text-muted-foreground">Find nearby work and build your reputation.</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {proSteps.map((step) => <li key={step} className="flex gap-2"><CheckCircle className="mt-0.5 size-4 text-emerald-600" />{step}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-2xl font-bold">Popular project types</h2>
            <p className="text-muted-foreground">Start with the work homeowners request most often.</p>
          </div>
          {!user?.role && <Button asChild><Link href="/sign-up">Start Free <ArrowRight className="ml-2 size-4" /></Link></Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <div key={category} className="rounded-md border bg-white p-4 font-medium shadow-sm dark:bg-gray-900">{category}</div>
          ))}
        </div>
      </section>
    </main>
  );
}