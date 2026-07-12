'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Home, Wrench, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function RoleSelectionPage() {
  const router = useRouter();
  const { status } = useSession();
  const isLoaded = status !== 'loading';
  const isSignedIn = status === 'authenticated';
  const [selecting, setSelecting] = useState<'HOMEOWNER' | 'HANDYMAN' | null>(null);

  const handleRoleSelection = async (role: 'HOMEOWNER' | 'HANDYMAN') => {
    setSelecting(role);
    try {
      const res = await fetch('/api/users/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error('Failed to set role');
      toast.success(`Welcome! You're signed up as a ${role === 'HOMEOWNER' ? 'homeowner' : 'handyman'}.`);
      router.push(`/onboarding/${role.toLowerCase()}`);
    } catch {
      toast.error('Something went wrong. Please try again.');
      setSelecting(null);
    }
  };

  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isSignedIn) {
    router.push('/sign-in');
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Welcome to FixMyHome!</h1>
          <p className="text-muted-foreground">Choose your role to get started</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Homeowner Card */}
          <Card className="hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-primary">
            <CardHeader>
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-4">
                <Home className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle>I'm a Homeowner</CardTitle>
              <CardDescription>I need help with home repairs and improvements</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                {['Post jobs with your budget', 'Receive competitive bids from local handymen', 'Message and hire with confidence', 'Rate and review after completion'].map(f => (
                  <li key={f} className="flex items-start"><span className="mr-2">✓</span><span>{f}</span></li>
                ))}
              </ul>
              <Button onClick={() => handleRoleSelection('HOMEOWNER')} className="w-full" size="lg" disabled={!!selecting}>
                {selecting === 'HOMEOWNER' ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Setting up…</> : 'Continue as Homeowner'}
              </Button>
            </CardContent>
          </Card>

          {/* Handyman Card */}
          <Card className="hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-primary">
            <CardHeader>
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
                <Wrench className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle>I'm a Handyman</CardTitle>
              <CardDescription>I provide home repair and improvement services</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                {['Browse local jobs matching your skills', 'Submit competitive bids to win work', 'Message homeowners directly', 'Build your reputation through ratings'].map(f => (
                  <li key={f} className="flex items-start"><span className="mr-2">✓</span><span>{f}</span></li>
                ))}
              </ul>
              <Button onClick={() => handleRoleSelection('HANDYMAN')} className="w-full" size="lg" disabled={!!selecting}>
                {selecting === 'HANDYMAN' ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Setting up…</> : 'Continue as Handyman'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
