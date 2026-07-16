'use client';

import { useState } from 'react';
import { MailX, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function AccountSettingsCard() {
  const { user, updateProfile } = useCurrentUser();
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  if (!user) return null;

  async function handleEmailPreference(checked: boolean) {
    setIsSavingEmail(true);
    try {
      await updateProfile({ emailOptOut: checked });
      toast.success(checked ? 'Email unsubscribed' : 'Email subscribed', {
        description: checked
          ? 'You will no longer receive optional marketing emails. Important account and security emails may still be sent.'
          : 'You can receive optional FixMyHome updates again.',
      });
    } catch {
      toast.error('Could not update email preference.');
    } finally {
      setIsSavingEmail(false);
    }
  }

  async function handleDeleteAccount() {
    if (confirmText !== 'DELETE') {
      toast.error('Type DELETE to confirm account deletion.');
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch('/api/users/me', { method: 'DELETE' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Delete failed');
      toast.success('Account deleted');
      window.location.href = '/sign-out';
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete account.');
      setIsDeleting(false);
    }
  }

  return (
    <Card className="rounded-lg border-amber-200/70 dark:border-amber-900/60">
      <CardHeader>
        <CardTitle>Account Settings</CardTitle>
        <CardDescription>Manage email preferences or permanently delete your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-md border p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-medium"><MailX className="size-4" /> Email preference</div>
            <p className="text-sm text-muted-foreground">Unsubscribe from optional marketing and promotional emails. Account, password, security, and service-related emails may still be sent.</p>
          </div>
          <Switch checked={user.emailOptOut ?? false} onCheckedChange={handleEmailPreference} disabled={isSavingEmail} aria-label="Unsubscribe from optional emails" />
        </div>

        <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-950 dark:bg-red-950/20">
          <div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300"><Trash2 className="size-4" /> Delete account</div>
          <p className="mt-1 text-sm text-red-700/80 dark:text-red-200/80">This permanently removes your account and related marketplace data where allowed by the app. This cannot be undone.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="delete-confirm" className="text-xs text-red-700 dark:text-red-200">Type DELETE to confirm</Label>
              <Input id="delete-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" disabled={isDeleting} />
            </div>
            <Button type="button" variant="destructive" className="self-end" disabled={isDeleting || confirmText !== 'DELETE'} onClick={handleDeleteAccount}>
              {isDeleting ? 'Deleting...' : 'Delete Account'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
