'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { JOB_CATEGORIES } from '@/lib/constants';
import { toast } from 'sonner';
import { X, Loader2 } from 'lucide-react';

export default function HandymanOnboardingPage() {
  const router = useRouter();
  const { status } = useSession();
  const isLoaded = status !== 'loading';
  const isSignedIn = status === 'authenticated';
  const [businessName, setBusinessName] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [serviceRadius, setServiceRadius] = useState('25');
  const [hourlyRate, setHourlyRate] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const toggleSkill = (skill: string) => {
    setSkills(prev =>
      prev.includes(skill)
        ? prev.filter(s => s !== skill)
        : [...prev, skill]
    );
  };

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (skills.length === 0) {
      toast.error('Please select at least one skill');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handymanProfile: {
            businessName: businessName || null,
            bio: bio || null,
            skills,
            serviceRadius: parseInt(serviceRadius) || 25,
            hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null,
          },
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Profile completed!');
      router.push('/handyman/dashboard');
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4 py-12">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Complete Your Handyman Profile</CardTitle>
          <CardDescription>
            Tell homeowners about your services and expertise
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="businessName">Business Name (Optional)</Label>
              <Input
                id="businessName"
                type="text"
                placeholder="John's Home Services"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label>Skills & Services</Label>
              <p className="text-sm text-muted-foreground mb-3">
                Select all that apply (at least one required)
              </p>
              <div className="flex flex-wrap gap-2">
                {JOB_CATEGORIES.map((category) => (
                  <Badge
                    key={category}
                    variant={skills.includes(category) ? 'default' : 'outline'}
                    className="cursor-pointer hover:bg-primary/90"
                    onClick={() => toggleSkill(category)}
                  >
                    {category}
                    {skills.includes(category) && (
                      <X className="w-3 h-3 ml-1" />
                    )}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                placeholder="Tell homeowners about your experience, certifications, and what makes you great at what you do..."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                disabled={isLoading}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                {bio.length}/500 characters
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="serviceRadius">Service Radius (miles)</Label>
                <Input
                  id="serviceRadius"
                  type="number"
                  placeholder="25"
                  value={serviceRadius}
                  onChange={(e) => setServiceRadius(e.target.value)}
                  required
                  min="1"
                  max="100"
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  How far are you willing to travel?
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hourlyRate">Hourly Rate (Optional)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="hourlyRate"
                    type="number"
                    placeholder="50"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    min="0"
                    step="0.01"
                    disabled={isLoading}
                    className="pl-7"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  This is just a guideline for homeowners
                </p>
              </div>
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
              {isLoading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                : 'Complete Profile & Start Browsing Jobs'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
