'use client';

import { FormEvent, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function GrowthPackageForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [feedback, setFeedback] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus('sending');
    setFeedback('');

    const business = String(data.get('business') || '').trim();
    const phone = String(data.get('phone') || '').trim();
    const website = String(data.get('website') || '').trim();
    const services = String(data.get('services') || '').trim();
    const message = [
      `Business: ${business || 'Not provided'}`,
      `Phone: ${phone || 'Not provided'}`,
      `Current website: ${website || 'None'}`,
      `Primary services: ${services || 'Not provided'}`,
      '',
      String(data.get('message') || '').trim(),
    ].join('\n');

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(data.get('name') || ''),
          email: String(data.get('email') || ''),
          role: 'Handyman',
          reason: 'Handyman Growth Package',
          message,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Unable to send your request.');

      form.reset();
      setStatus('sent');
      setFeedback('Your request is in. We will follow up by email to schedule a short discovery call.');
    } catch (error) {
      setStatus('error');
      setFeedback(error instanceof Error ? error.message : 'Unable to send your request. Please try again.');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" id="growth-package-inquiry">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="growth-name" className="text-white">Your name</Label><Input id="growth-name" name="name" required minLength={2} maxLength={100} autoComplete="name" className="border-white/15 bg-white/10 text-white placeholder:text-slate-400" /></div>
        <div className="space-y-2"><Label htmlFor="growth-email" className="text-white">Email</Label><Input id="growth-email" name="email" required type="email" maxLength={160} autoComplete="email" className="border-white/15 bg-white/10 text-white placeholder:text-slate-400" /></div>
        <div className="space-y-2"><Label htmlFor="growth-business" className="text-white">Business name</Label><Input id="growth-business" name="business" maxLength={120} className="border-white/15 bg-white/10 text-white placeholder:text-slate-400" /></div>
        <div className="space-y-2"><Label htmlFor="growth-phone" className="text-white">Phone</Label><Input id="growth-phone" name="phone" type="tel" maxLength={40} autoComplete="tel" className="border-white/15 bg-white/10 text-white placeholder:text-slate-400" /></div>
        <div className="space-y-2"><Label htmlFor="growth-website" className="text-white">Current website</Label><Input id="growth-website" name="website" maxLength={200} placeholder="None, or your website address" className="border-white/15 bg-white/10 text-white placeholder:text-slate-400" /></div>
        <div className="space-y-2"><Label htmlFor="growth-services" className="text-white">Primary services</Label><Input id="growth-services" name="services" maxLength={200} placeholder="Plumbing, painting, general repairs" className="border-white/15 bg-white/10 text-white placeholder:text-slate-400" /></div>
      </div>
      <div className="space-y-2"><Label htmlFor="growth-message" className="text-white">What would help your business most?</Label><Textarea id="growth-message" name="message" required minLength={20} maxLength={2400} rows={5} placeholder="Tell us about your goals, service area, and the customers you want to reach." className="border-white/15 bg-white/10 text-white placeholder:text-slate-400" /></div>
      {feedback && <p className={status === 'sent' ? 'text-sm text-emerald-300' : 'text-sm text-red-300'}>{feedback}</p>}
      <Button type="submit" disabled={status === 'sending'} className="w-full bg-white text-slate-950 hover:bg-slate-200 sm:w-auto"><Send className="mr-2 size-4" />{status === 'sending' ? 'Sending...' : 'Request a Discovery Call'}</Button>
    </form>
  );
}