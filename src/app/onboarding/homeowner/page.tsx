'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function HomeownerOnboardingPage() {
  const router = useRouter();
  const { status } = useSession();
  const isLoaded = status !== 'loading';
  const isSignedIn = status === 'authenticated';
  const [location, setLocation] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Profile completed!');
      router.push('/homeowner/dashboard');
    } catch {
      toast.error('Failed to complete profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isLoaded || !isSignedIn) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Complete Your Homeowner Profile</CardTitle>
          <CardDescription>Just a few more details to get you started</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="location">ZIP Code</Label>
              <Input
                id="location"
                type="text"
                placeholder="33139"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
                pattern="[0-9]{5}"
                maxLength={5}
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                We'll use this to show you local handymen in your area
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                : 'Complete Profile'}
            </Button>
          </form>

          <div className="mt-6 p-3 bg-blue-50 dark:bg-blue-950 rounded-md">
            <p className="text-xs text-blue-900 dark:text-blue-100 font-medium">📍 Florida Only</p>
            <p className="text-xs text-blue-700 dark:text-blue-200 mt-1">
              Currently serving Florida homeowners. Enter any Florida ZIP code.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
