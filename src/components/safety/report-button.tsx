'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type ReportButtonProps = {
  targetType: 'PROFILE' | 'JOB' | 'MESSAGE_THREAD';
  targetId: string;
  label?: string;
  variant?: 'outline' | 'ghost';
};

export function ReportButton({ targetType, targetId, label = 'Report', variant = 'outline' }: ReportButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitReport() {
    const reason = window.prompt('Why are you reporting this? Example: scam, unsafe, inappropriate, false information.');
    if (!reason?.trim()) return;
    const details = window.prompt('Add optional details for the admin team. Do not include passwords or payment details.') || '';

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, reason: reason.trim(), details: details.trim() || null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Report failed');
      toast.success('Report submitted', { description: 'The FixMyHome admin team will review it.' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not submit report.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Button type="button" variant={variant} size="sm" onClick={submitReport} disabled={isSubmitting} className="gap-2">
      <Flag className="size-4" />
      {isSubmitting ? 'Reporting...' : label}
    </Button>
  );
}
