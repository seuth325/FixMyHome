import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export const publicLinks = [
  { href: '/about', label: 'About' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/contact', label: 'Contact' },
  { href: '/security', label: 'User Security' },
];

export function PublicPageShell({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#111b2b] text-white">
      <header className="border-b border-white/10 bg-[#111b2b]/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <Link href="/" aria-label="FixMyHome.pro home" className="flex items-center gap-3">
            <img src="/fixmyhome-logo.png" alt="FixMyHome.pro" className="h-14 w-14 rounded-sm object-contain" />
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="bg-white text-slate-950 hover:bg-slate-200">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        {eyebrow && <p className="text-sm font-semibold uppercase tracking-wide text-cyan-300">{eyebrow}</p>}
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
        <div className="mt-8 rounded-lg border border-white/10 bg-slate-900/55 p-6 text-slate-100 shadow-2xl shadow-black/20 sm:p-8">
          {children}
        </div>
      </section>

      <footer className="border-t border-white/10 px-4 py-8 text-sm text-slate-400 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 FixMyHome Pro LLC. Florida registered business name.</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Public pages">
            {publicLinks.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-white">{link.label}</Link>
            ))}
          </nav>
        </div>
      </footer>
    </main>
  );
}

export function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-white/10 py-6 first:border-t-0 first:pt-0 last:pb-0">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="mt-3 space-y-3 leading-7 text-slate-300">{children}</div>
    </section>
  );
}