import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, CheckCircle, Home, Wrench } from 'lucide-react';

const homeownerBenefits = [
  'Post jobs with your budget and timeline',
  'Receive competitive bids from local pros',
  'View AI-recommended best value bids',
  'Message handymen before hiring',
  'Rate and review after completion',
];

const handymanBenefits = [
  'Browse local jobs in your area',
  'Submit competitive bids to win work',
  'No lead fees or subscription costs',
  'Message homeowners directly',
  'Build your reputation with ratings',
];

export default function LandingPageClient() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#111b2b] text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3" aria-label="FixMyHome home">
            <span className="flex size-10 items-center justify-center rounded-md border border-cyan-300/35 bg-cyan-400/10 text-cyan-300 shadow-lg shadow-cyan-950/20 sm:size-11">
              <Home className="size-5 sm:size-6" />
            </span>
            <span className="bg-gradient-to-r from-cyan-400 to-teal-400 bg-clip-text text-xl font-bold tracking-tight text-transparent sm:text-2xl">FixMyHome</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="bg-white text-slate-950 hover:bg-slate-200">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-center py-14 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="bg-gradient-to-r from-cyan-400 to-teal-400 bg-clip-text text-5xl font-extrabold tracking-tight text-transparent sm:text-6xl">
              FixMyHome
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
              Post your home task, set your budget, compare bids, hire confidently.
            </p>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Connect Florida homeowners with local handymen for home repairs and improvements. Get competitive bids, compare options, and hire the right person for the job.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full bg-white text-slate-950 hover:bg-slate-200 sm:w-auto">
                <Link href="/sign-up">Get Started Free <ArrowRight className="ml-2 size-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white sm:w-auto">
                <Link href="/sign-in">Sign In</Link>
              </Button>
            </div>
          </div>

          <div className="mx-auto mt-16 grid w-full max-w-5xl gap-6 md:grid-cols-2">
            <article className="rounded-lg border border-white/5 bg-slate-800/65 p-7 shadow-xl shadow-black/10">
              <div className="mb-6 flex size-12 items-center justify-center rounded-full bg-blue-600 text-white">
                <Home className="size-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">For Homeowners</h2>
              <ul className="mt-6 space-y-4 text-base text-slate-100">
                {homeownerBenefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 size-5 shrink-0 text-emerald-400" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-lg border border-white/5 bg-slate-800/65 p-7 shadow-xl shadow-black/10">
              <div className="mb-6 flex size-12 items-center justify-center rounded-full bg-emerald-600 text-white">
                <Wrench className="size-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">For Handymen</h2>
              <ul className="mt-6 space-y-4 text-base text-slate-100">
                {handymanBenefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 size-5 shrink-0 text-emerald-400" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <section className="mx-auto mt-16 w-full max-w-4xl rounded-lg bg-blue-600 px-6 py-9 text-center shadow-2xl shadow-blue-950/30">
            <h2 className="text-3xl font-bold tracking-tight">Ready to get started?</h2>
            <p className="mx-auto mt-3 max-w-2xl text-blue-50">
              Create your free account and choose whether you are posting repairs or bidding on local work.
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="bg-white text-slate-950 hover:bg-slate-200">
                <Link href="/sign-up">Create Account</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
                <Link href="/sign-in">Sign In</Link>
              </Button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}