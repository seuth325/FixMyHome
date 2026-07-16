'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { signInSchema, type SignInInput } from '@/lib/validations/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
  });

  const onSubmit = async (data: SignInInput) => {
    setIsLoading(true);
    try {
      const result = await signIn('credentials', { ...data, redirect: false });
      if (result?.error) {
        toast.error('Invalid email or password');
        return;
      }
      const callbackUrl = searchParams.get('callbackUrl');
      if (callbackUrl?.startsWith('/')) {
        router.push(callbackUrl);
        router.refresh();
        return;
      }

      const me = await fetch('/api/users/me').then((response) => response.ok ? response.json() : null).catch(() => null);
      const dashboardPath = me?.role === 'ADMIN'
        ? '/admin'
        : me?.role === 'HANDYMAN'
          ? '/handyman/dashboard'
          : '/homeowner/dashboard';
      router.push(dashboardPath);
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center space-y-3">
          <Link href="/" aria-label="FixMyHome.pro home">
            <img src="/fixmyhome-logo-dark.png" alt="FixMyHome.pro" className="h-24 w-24 object-contain sm:h-28 sm:w-28" />
          </Link>
          <CardTitle className="text-2xl">Sign In</CardTitle>
          <CardDescription>Welcome back to FixMyHome</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email')} disabled={isLoading} />
              {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="password">Password</Label>
                <Button asChild variant="link" size="sm" className="h-auto p-0 text-sm">
                  <Link href="/forgot-password">Forgot password?</Link>
                </Button>
              </div>
              <Input id="password" type="password" autoComplete="current-password" {...register('password')} disabled={isLoading} />
              {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link href="/sign-up" className="text-primary hover:underline">Sign up</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
