'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, Home, Loader2, Wrench } from 'lucide-react';
import { toast } from 'sonner';

const homeownerFeatures = [
  'Post jobs with budget, photos, and timing',
  'Receive bids from local handymen',
  'Message before hiring',
  'Review the work after completion',
];

const handymanFeatures = [
  'Browse local jobs matching your skills',
  'Submit bids and win work',
  'Message homeowners directly',
  'Build your reputation with reviews',
];

export default function RoleSelectionPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const isLoaded = status !== 'loading';
  const isSignedIn = status === 'authenticated';
  const [selecting, setSelecting] = useState<'HOMEOWNER' | 'HANDYMAN' | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) router.push('/sign-in');
    if (session?.user.role === 'ADMIN') router.push('/admin');
  }, [isLoaded, isSignedIn, session?.user.role, router]);

  const handleRoleSelection = async (role: 'HOMEOWNER' | 'HANDYMAN') => {
    setSelecting(role);
    try {
      const res = await fetch('/api/users/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error('Failed to set role');
      toast.success(`Welcome! You are signed up as a ${role === 'HOMEOWNER' ? 'homeowner' : 'handyman'}.`);
      router.push(`/onboarding/${role.toLowerCase()}`);
    } catch {
      toast.error('Something went wrong. Please try again.');
      setSelecting(null);
    }
  };

  if (!isLoaded || !isSignedIn || session?.user.role === 'ADMIN') {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <main className="min-h-screen bg-transparent px-4 py-12">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-8 text-center">
          <p className="text-sm font-medium text-emerald-600">One quick choice</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">How will you use FixMyHome?</h1>
          <p className="mt-3 text-muted-foreground">Choose the role that fits you today. Admins can adjust accounts later if needed.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-2 transition-shadow hover:border-blue-400 hover:shadow-lg">
            <CardHeader>
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                <Home className="size-6" />
              </div>
              <CardTitle>I'm a Homeowner</CardTitle>
              <CardDescription>I need help with repairs, improvements, or remodels.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="mb-6 space-y-3 text-sm text-muted-foreground">
                {homeownerFeatures.map((feature) => (
                  <li key={feature} className="flex gap-2"><CheckCircle className="mt-0.5 size-4 text-emerald-600" />{feature}</li>
                ))}
              </ul>
              <Button onClick={() => handleRoleSelection('HOMEOWNER')} className="w-full" size="lg" disabled={!!selecting}>
                {selecting === 'HOMEOWNER' ? <><Loader2 className="mr-2 size-4 animate-spin" />Setting up...</> : 'Continue as Homeowner'}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-2 transition-shadow hover:border-emerald-400 hover:shadow-lg">
            <CardHeader>
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <Wrench className="size-6" />
              </div>
              <CardTitle>I'm a Handyman</CardTitle>
              <CardDescription>I provide home repair and improvement services.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="mb-6 space-y-3 text-sm text-muted-foreground">
                {handymanFeatures.map((feature) => (
                  <li key={feature} className="flex gap-2"><CheckCircle className="mt-0.5 size-4 text-emerald-600" />{feature}</li>
                ))}
              </ul>
              <Button onClick={() => handleRoleSelection('HANDYMAN')} className="w-full" size="lg" disabled={!!selecting}>
                {selecting === 'HANDYMAN' ? <><Loader2 className="mr-2 size-4 animate-spin" />Setting up...</> : 'Continue as Handyman'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
