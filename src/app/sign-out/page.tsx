import Link from 'next/link';
import { ArrowLeft, LogOut } from 'lucide-react';
import { auth, signOut } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

async function confirmSignOut() {
  'use server';
  await signOut({ redirectTo: '/' });
}

export default async function SignOutPage() {
  const session = await auth();
  const role = session?.user?.role;
  const dashboardPath = role === 'HOMEOWNER' ? '/homeowner/dashboard' : role === 'ADMIN' ? '/admin' : '/handyman/dashboard';

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-50 to-white px-4 dark:from-gray-900 dark:to-gray-800">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Sign Out</CardTitle>
          <CardDescription>Are you sure you want to sign out?</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={confirmSignOut}>
            <Button type="submit" className="w-full">
              <LogOut className="mr-2 size-4" />
              Sign out
            </Button>
          </form>
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