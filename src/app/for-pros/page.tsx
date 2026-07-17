import Link from 'next/link';
import { ArrowRight, Check, Globe, Megaphone, ShieldCheck, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GrowthPackageForm } from '@/components/marketing/growth-package-form';
import { PublicPageShell } from '@/components/marketing/public-page-shell';

export const metadata = {
  title: 'Business Services for Handymen | FixMyHome.pro',
  description: 'Professional websites, profiles, and local marketing support for Florida handymen.',
};

const included = [
  'Professionally completed FixMyHome.pro profile',
  'One-page mobile-friendly business website',
  'Contact and quote-request form',
  'Service and service-area content',
  'Google Business Profile setup guidance',
  '30 days of website updates',
];

export default function ForProsPage() {
  return (
    <PublicPageShell title="Build a professional local presence" eyebrow="Business services for handymen">
      <section className="grid gap-8 lg:grid-cols-[1.15fr_.85fr] lg:items-start">
        <div>
          <p className="max-w-2xl text-lg leading-8 text-slate-300">Win more confidence before the first phone call with a complete profile, a clean website, and a simple way for local homeowners to request a quote.</p>
          <div className="mt-6 flex flex-wrap items-end gap-3"><span className="text-4xl font-bold text-white">$499</span><span className="pb-1 text-sm text-slate-300">founding-client setup price</span></div>
          <p className="mt-2 text-sm text-slate-400">Optional hosting and maintenance starts at $59 per month after the included update period. No long-term contract is required.</p>
          <Button asChild size="lg" className="mt-7 bg-white text-slate-950 hover:bg-slate-200"><a href="#growth-package-inquiry">Request a Discovery Call <ArrowRight className="ml-2 size-4" /></a></Button>
        </div>
        <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/5 p-5 sm:p-6">
          <h2 className="text-xl font-semibold text-white">Handyman Growth Package</h2>
          <ul className="mt-5 space-y-3">{included.map((item) => <li key={item} className="flex gap-3 text-sm text-slate-200"><Check className="mt-0.5 size-4 shrink-0 text-emerald-300" />{item}</li>)}</ul>
        </div>
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          { icon: Globe, title: 'Look established', text: 'Give customers one polished place to understand your services and request a quote.' },
          { icon: Wrench, title: 'Built for your trade', text: 'Your service mix, coverage area, photos, and contact details shape the content.' },
          { icon: Megaphone, title: 'Ready to promote', text: 'Use your new website in profiles, business cards, social pages, and local outreach.' },
        ].map(({ icon: Icon, title, text }) => <div key={title} className="rounded-lg border border-white/10 bg-white/5 p-5"><Icon className="size-5 text-cyan-300" /><h2 className="mt-4 font-semibold text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-300">{text}</p></div>)}
      </section>

      <section className="mt-10 rounded-lg border border-cyan-300/20 bg-cyan-400/5 p-5 sm:p-7">
        <div className="mb-6 flex gap-3"><ShieldCheck className="mt-1 size-5 shrink-0 text-cyan-300" /><div><h2 className="text-xl font-semibold text-white">Tell us about your business</h2><p className="mt-1 text-sm text-slate-300">We will review your goals and confirm the project scope before any payment is due.</p></div></div>
        <GrowthPackageForm />
      </section>

      <p className="mt-8 text-center text-sm text-slate-400">Already have a FixMyHome.pro account? <Link href="/sign-in" className="text-cyan-200 hover:text-white">Sign in</Link> and keep your public profile current.</p>
    </PublicPageShell>
  );
}