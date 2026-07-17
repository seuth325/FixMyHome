'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { resetPasswordSchema, type ResetPasswordInput } from '@/lib/validations/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

type ResetPasswordResponse = {
  ok: boolean;
  email?: string;
  dashboardPath?: string;
  error?: string;
};

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams]);
  const [isLoading, setIsLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token },
  });

  const onSubmit = async (data: ResetPasswordInput) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, token }),
      });
      const body = await res.json().catch(() => null) as ResetPasswordResponse | null;

      if (!res.ok) {
        toast.error(body?.error || 'This reset link is invalid or expired.');
        return;
      }

      const dashboardPath = body?.dashboardPath || '/homeowner/dashboard';
      if (body?.email) {
        const signInResult = await signIn('credentials', {
          email: body.email,
          password: data.password,
          redirect: false,
        });

        if (!signInResult?.error) {
          toast.success('Password updated. Taking you to your dashboard.');
          router.push(dashboardPath);
          router.refresh();
          return;
        }
      }

      toast.success('Password updated. Please sign in with your new password.');
      router.push(`/sign-in?callbackUrl=${encodeURIComponent(dashboardPath)}`);
    } catch {
      toast.error('Unable to reset password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-white/10 bg-slate-950/70 shadow-2xl shadow-black/30 backdrop-blur-md">
      <CardHeader>
        <CardTitle>Choose New Password</CardTitle>
        <CardDescription>Enter a new password for your FixMyHome account.</CardDescription>
      </CardHeader>
      <CardContent>
        {!token ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">This reset link is missing a token. Request a new password reset link.</p>
            <Button asChild className="w-full">
              <Link href="/forgot-password">Request New Link</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <input type="hidden" value={token} {...register('token')} />
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <Input id="password" type="password" autoComplete="new-password" {...register('password')} disabled={isLoading} />
              {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input id="confirmPassword" type="password" autoComplete="new-password" {...register('confirmPassword')} disabled={isLoading} />
              {errors.confirmPassword && <p className="text-sm text-red-500">{errors.confirmPassword.message}</p>}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Updating password...' : 'Update Password'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent px-4 py-10">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
