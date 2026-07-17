import Link from 'next/link';
import { CheckCircle2, Mail, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const verified = params.verified === '1';
  const expired = params.error === 'expired';
  const email = typeof params.email === 'string' ? params.email : '';
  return (
    <main className="flex min-h-screen items-center justify-center bg-transparent px-4 py-10">
      <Card className="w-full max-w-md border-white/10 bg-slate-950/75 text-center shadow-2xl backdrop-blur-md">
        <CardHeader className="items-center"><img src="/fixmyhome-logo-dark.png" alt="FixMyHome.pro" className="h-24 w-24 object-contain" />
          {verified ? <CheckCircle2 className="size-10 text-emerald-500" /> : expired ? <XCircle className="size-10 text-red-400" /> : <Mail className="size-10 text-cyan-300" />}
          <CardTitle>{verified ? 'Email verified' : expired ? 'Verification link expired' : 'Check your email'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-sm text-muted-foreground">
          <p>{verified ? 'Your account is active. You can now sign in and complete your profile.' : expired ? 'This verification link is no longer valid. Contact support@fixmyhome.pro for help.' : 'We sent a secure verification link' + (email ? ' to ' + email : '') + '. Open it to activate your account.'}</p>
          <Button asChild className="w-full"><Link href={verified ? '/sign-in?verified=1' : '/sign-in'}>{verified ? 'Continue to Sign In' : 'Back to Sign In'}</Link></Button>
        </CardContent>
      </Card>
    </main>
  );
}