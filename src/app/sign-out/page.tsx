'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { ArrowLeft, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/lib/hooks/use-current-user';

export default function SignOutPage() {
  const { user } = useCurrentUser();
  const dashboardPath = user?.role === 'HOMEOWNER' ? '/homeowner/dashboard' : '/handyman/dashboard';

  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Sign Out</CardTitle>
          <CardDescription>Are you sure you want to sign out?</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={() => signOut({ callbackUrl: '/', redirect: true })}>
            <LogOut className="mr-2 size-4" />
            Sign out
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href={dashboardPath}>
              <ArrowLeft className="mr-2 size-4" />
              No, go back to dashboard
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}