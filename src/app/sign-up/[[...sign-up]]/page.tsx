'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
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

      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });
      if (result?.error) {
        toast.error('Account created, but sign-in failed. Please sign in manually.');
        router.push('/sign-in');
        return;
      }

      router.push('/role-selection');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-gray-950">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-5xl items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="hidden lg:block">
          <Link href="/" aria-label="FixMyHome.pro home"><img src="/fixmyhome-logo.png" alt="FixMyHome.pro" className="h-20 w-20 rounded-sm object-contain" /></Link>
          <h1 className="mt-8 text-4xl font-bold tracking-tight">Start with the right local repair workflow.</h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">
            Create one account, choose your role, and finish a short setup so the app can show the right jobs, bids, and dashboard.
          </p>
          <ul className="mt-8 space-y-4 text-sm text-muted-foreground">
            {benefits.map((benefit) => (
              <li key={benefit} className="flex gap-3"><CheckCircle className="mt-0.5 size-4 text-emerald-600" />{benefit}</li>
            ))}
          </ul>
        </section>

        <Card className="w-full">
          <CardHeader>
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