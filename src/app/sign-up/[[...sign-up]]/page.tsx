'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, CheckCircle } from 'lucide-react';
import { registerFormSchema, type RegisterFormInput } from '@/lib/validations/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

const benefits = [
  'Free account setup',
  'Choose homeowner or handyman after signup',
  'Manage jobs, bids, and messages in one place',
];

export default function SignUpPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<RegisterFormInput>({
    resolver: zodResolver(registerFormSchema),
  });

  const onSubmit = async (data: RegisterFormInput) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, email: data.email, password: data.password }),
      });

      if (res.status === 409) {
        toast.error('Email already in use');
        return;
      }
      if (!res.ok) {
        toast.error('Failed to create account. Please try again.');
        return;
      }

      router.push('/verify-email?email=' + encodeURIComponent(data.email));
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-transparent px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-2xl flex-col items-center justify-center gap-6">
        <section className="w-full rounded-lg border border-white/10 bg-slate-950/60 p-6 text-center shadow-2xl shadow-black/25 backdrop-blur-md sm:p-8">
          <Link href="/" aria-label="FixMyHome.pro home" className="inline-flex justify-center">
            <img src="/fixmyhome-logo-dark.png" alt="FixMyHome.pro" className="h-24 w-24 object-contain sm:h-28 sm:w-28" />
          </Link>
          <h1 className="mx-auto mt-5 max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">Start with the right local repair workflow.</h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            Create one account, choose your role, and finish a short setup so the app can show the right jobs, bids, and dashboard.
          </p>
          <ul className="mx-auto mt-6 grid max-w-xl gap-3 text-left text-sm text-muted-foreground sm:grid-cols-3">
            {benefits.map((benefit) => (
              <li key={benefit} className="flex gap-2"><CheckCircle className="mt-0.5 size-4 shrink-0 text-emerald-600" />{benefit}</li>
            ))}
          </ul>
        </section>

        <Card className="w-full border-white/10 bg-slate-950/70 shadow-2xl shadow-black/30 backdrop-blur-md">
          <CardHeader className="text-center">
            <CardTitle>Create your account</CardTitle>
            <CardDescription>Sign up once, then choose homeowner or handyman.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" type="text" autoComplete="name" {...register('name')} disabled={isLoading} />
                  {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" {...register('email')} disabled={isLoading} />
                  {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="new-password" {...register('password')} disabled={isLoading} />
                  {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input id="confirmPassword" type="password" autoComplete="new-password" {...register('confirmPassword')} disabled={isLoading} />
                  {errors.confirmPassword && <p className="text-sm text-red-500">{errors.confirmPassword.message}</p>}
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Creating account...' : <>Create Account <ArrowRight className="ml-2 size-4" /></>}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/sign-in" className="text-primary hover:underline">Sign in</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
