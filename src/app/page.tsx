'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { Button } from '@/components/ui/button';
import { Home, Wrench, ArrowRight, CheckCircle } from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();
  const { user, isLoaded } = useCurrentUser();

  useEffect(() => {
    // Redirect authenticated users to their dashboard
    if (isLoaded && user && user.role) {
      const dashboardPath = user.role === 'HOMEOWNER' ? '/homeowner/dashboard' : '/handyman/dashboard';
      router.push(dashboardPath);
    }
  }, [isLoaded, user, router]);

  // Always show loading on initial render to prevent hydration mismatch
  if (!isLoaded || (user && user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-gray-900 dark:to-gray-800">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">
            FixMyHome
          </h1>
          <p className="text-2xl md:text-3xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Post your home task, set your budget,
            <br />
            compare bids, hire confidently.
          </p>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-8">
            Connect Florida homeowners with local handymen for home repairs and improvements.
            Get competitive bids, compare options, and hire the right person for the job.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link href="/sign-up">
              <Button size="lg" className="w-full sm:w-auto">
                Get Started Free
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
            <Link href="/sign-in">
              <Button variant="outline" size="lg" className="w-full sm:w-auto">
                Sign In
              </Button>
            </Link>
          </div>
        </div>

        {/* Two-Column Feature Grid */}
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto mt-16">
          {/* Homeowners */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-4">
              <Home className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-2xl font-bold mb-4">For Homeowners</h3>
            <ul className="space-y-3">
              {[
                'Post jobs with your budget and timeline',
                'Receive competitive bids from local pros',
                'View AI-recommended best value bids',
                'Message handymen before hiring',
                'Rate and review after completion',
              ].map((feature, idx) => (
                <li key={idx} className="flex items-start">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700 dark:text-gray-300">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Handymen */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
              <Wrench className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-2xl font-bold mb-4">For Handymen</h3>
            <ul className="space-y-3">
              {[
                'Browse local jobs in your area',
                'Submit competitive bids to win work',
                'No lead fees or subscription costs',
                'Message homeowners directly',
                'Build your reputation with ratings',
              ].map((feature, idx) => (
                <li key={idx} className="flex items-start">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700 dark:text-gray-300">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* CTA Section */}
        <div className="text-center mt-16">
          <div className="bg-blue-600 dark:bg-blue-700 rounded-lg p-8 max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-white mb-4">
              Ready to get started?
            </h2>
            <p className="text-blue-100 mb-6">
              Join FixMyHome today and connect with your local community.
              It's free to sign up!
            </p>
            <Link href="/sign-up">
              <Button size="lg" variant="secondary">
                Create Your Free Account
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-gray-200 dark:border-gray-700 text-center text-gray-600 dark:text-gray-400">
          <p className="text-sm">
            © 2026 FixMyHome. Currently serving Florida homeowners and handymen.
          </p>
        </div>
      </div>
    </div>
  );
}
