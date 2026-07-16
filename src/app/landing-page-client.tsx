import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  CheckCircle,
  Home,
  Wrench,
  Star,
  MessageSquare,
  ShieldCheck,
  MapPin,
  Quote,
} from 'lucide-react';

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

const reviewStats = [
  { label: 'Average review goal', value: '4.9/5' },
  { label: 'Local Florida focus', value: '100%' },
  { label: 'Built for fast quotes', value: '24 hr' },
];

const homeownerReviews = [
  {
    name: 'Maria G.',
    role: 'Homeowner',
    location: 'Tampa, FL',
    comment: 'I posted a plumbing job with photos and had clear bids to compare. The messaging made it easy to ask questions before hiring.',
  },
  {
    name: 'Daniel R.',
    role: 'Homeowner',
    location: 'Orlando, FL',
    comment: 'The best part was seeing the price, timeline, and handyman profile together. It felt organized and much less stressful.',
  },
  {
    name: 'Alicia P.',
    role: 'Homeowner',
    location: 'Miami, FL',
    comment: 'FixMyHome helped me explain the project clearly and choose someone who understood the work. I would use it again for repairs.',
  },
];

const handymanReviews = [
  {
    name: 'Chris M.',
    role: 'Handyman',
    location: 'St. Petersburg, FL',
    comment: 'The job details are easy to scan, and submitting a bid is simple. It is built around real work, not chasing vague leads.',
  },
  {
    name: 'Andre B.',
    role: 'Handyman',
    location: 'Jacksonville, FL',
    comment: 'I like that homeowners can message before hiring. It helps me understand the job and send a realistic quote.',
  },
  {
    name: 'Luis T.',
    role: 'Handyman',
    location: 'Fort Lauderdale, FL',
    comment: 'The dashboard keeps bids, messages, and available jobs in one place. That saves time when I am checking work between appointments.',
  },
];

function Stars() {
  return (
    <div className="flex items-center gap-1 text-amber-300" aria-label="5 star review">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star key={star} className="size-4 fill-current" />
      ))}
    </div>
  );
}

function ReviewCard({ review }: { review: { name: string; role: string; location: string; comment: string } }) {
  return (
    <article className="rounded-lg border border-white/8 bg-slate-800/70 p-5 shadow-xl shadow-black/10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Stars />
        <Quote className="size-5 text-cyan-300/70" />
      </div>
      <p className="text-sm leading-6 text-slate-100">{review.comment}</p>
      <div className="mt-5 border-t border-white/8 pt-4">
        <p className="font-semibold text-white">{review.name}</p>
        <p className="mt-1 text-xs text-slate-400">{review.role} · {review.location}</p>
      </div>
    </article>
  );
}

export default function LandingPageClient() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#111b2b] text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3" aria-label="FixMyHome home">
            <img src="/fixmyhome-logo.png" alt="FixMyHome.pro" className="h-14 w-14 rounded-sm object-contain shadow-lg shadow-cyan-950/20 sm:h-16 sm:w-16" />
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
            <div className="flex justify-center">
              <img src="/fixmyhome-logo.png" alt="FixMyHome.pro" className="h-44 w-44 rounded-sm object-contain shadow-2xl shadow-black/20 sm:h-56 sm:w-56" />
            </div>
            <div className="mx-auto mt-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100">
              <ShieldCheck className="size-4" /> Florida home repair marketplace
            </div>
            <p className="mx-auto mt-7 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
              Post your home task, compare trusted bids, hire with confidence.
            </p>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              FixMyHome helps homeowners explain the job clearly and gives local handymen a professional way to bid, message, and win work.
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

          <div className="mx-auto mt-14 grid w-full max-w-4xl gap-3 sm:grid-cols-3">
            {reviewStats.map((stat) => (
              <div key={stat.label} className="rounded-lg border border-white/8 bg-white/5 px-5 py-4 text-center">
                <div className="text-2xl font-bold text-white">{stat.value}</div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{stat.label}</div>
              </div>
            ))}
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

          <section className="mx-auto mt-16 w-full max-w-6xl">
            <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-cyan-100">
                  <MessageSquare className="size-4" /> Top reviews
                </div>
                <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Homeowners and handymen both get a better repair workflow.</h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-slate-300">
                Clear project details, straightforward bids, and built-in messaging help both sides move from uncertainty to a confident hire.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              {homeownerReviews.map((review) => <ReviewCard key={review.name} review={review} />)}
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-3">
              {handymanReviews.map((review) => <ReviewCard key={review.name} review={review} />)}
            </div>
          </section>

          <section className="mx-auto mt-16 grid w-full max-w-5xl gap-5 rounded-lg border border-white/8 bg-slate-900/55 p-6 shadow-2xl shadow-black/20 md:grid-cols-3">
            <div className="flex items-start gap-3">
              <MapPin className="mt-1 size-5 text-cyan-300" />
              <div>
                <h3 className="font-semibold">Local by design</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300">Built around Florida homeowners, ZIP codes, and nearby pros.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MessageSquare className="mt-1 size-5 text-cyan-300" />
              <div>
                <h3 className="font-semibold">Message before hiring</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300">Ask questions, clarify scope, and avoid surprises before work starts.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-1 size-5 text-cyan-300" />
              <div>
                <h3 className="font-semibold">Compare with context</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300">Review price, timeline, profile, and ratings in one organized place.</p>
              </div>
            </div>
          </section>

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
          <footer className="mx-auto mt-12 flex w-full max-w-6xl flex-col gap-4 border-t border-white/10 pt-8 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 FixMyHome Pro LLC. Florida registered business name.</p>
            <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Public pages">
              <Link href="/about" className="hover:text-white">About</Link>
              <Link href="/terms" className="hover:text-white">Terms of Service</Link>
              <Link href="/contact" className="hover:text-white">Contact</Link>
              <Link href="/privacy" className="hover:text-white">Privacy Policy</Link>
            </nav>
          </footer>
        </div>
      </section>
    </main>
  );
}