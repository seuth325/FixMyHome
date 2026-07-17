'use client';

import { FormEvent, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const roles = ['Homeowner', 'Handyman', 'Business', 'Other'];
const reasons = ['Account help', 'Job or bid support', 'Technical issue', 'Business inquiry', 'Handyman Growth Package', 'Other'];

export function ContactForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setStatus('sending');
    setMessage('');

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(formData.get('name') || ''),
          email: String(formData.get('email') || ''),
          role: String(formData.get('role') || ''),
          reason: String(formData.get('reason') || ''),
          message: String(formData.get('message') || ''),
        }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setStatus('error');
        setMessage(body?.error || 'Unable to send your message. Please try again.');
        return;
      }

      form.reset();
      setStatus('sent');
      setMessage(body?.message || 'Thanks. Your message has been sent.');
    } catch {
      setStatus('error');
      setMessage('Unable to send your message. Please try again.');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-cyan-300/20 bg-cyan-400/5 p-5 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Send us a message</h2>
        <p className="mt-1 text-sm text-slate-300">Tell us what you need help with and we will follow up by email.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contact-name" className="text-white">Name</Label>
          <Input id="contact-name" name="name" required minLength={2} maxLength={100} autoComplete="name" className="border-white/15 bg-white/10 text-white placeholder:text-slate-400" placeholder="Your name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contact-email" className="text-white">Email</Label>
          <Input id="contact-email" name="email" required type="email" maxLength={160} autoComplete="email" className="border-white/15 bg-white/10 text-white placeholder:text-slate-400" placeholder="you@example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contact-role" className="text-white">I am a</Label>
          <select id="contact-role" name="role" required className="h-10 w-full rounded-md border border-white/15 bg-slate-950/60 px-3 text-sm text-white outline-none focus:border-cyan-300">
            {roles.map((role) => <option key={role}>{role}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="contact-reason" className="text-white">Reason</Label>
          <select id="contact-reason" name="reason" required className="h-10 w-full rounded-md border border-white/15 bg-slate-950/60 px-3 text-sm text-white outline-none focus:border-cyan-300">
            {reasons.map((reason) => <option key={reason}>{reason}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-message" className="text-white">Message</Label>
        <Textarea id="contact-message" name="message" required minLength={20} maxLength={3000} rows={6} className="border-white/15 bg-white/10 text-white placeholder:text-slate-400" placeholder="Include account email, role, job title or link, and what happened." />
      </div>

      {message && (
        <p className={status === 'sent' ? 'text-sm text-emerald-300' : 'text-sm text-red-300'}>{message}</p>
      )}

      <Button type="submit" disabled={status === 'sending'} className="w-full bg-white text-slate-950 hover:bg-slate-200 sm:w-auto">
        {status === 'sending' ? 'Sending...' : <><Send className="mr-2 size-4" /> Send Message</>}
      </Button>
    </form>
  );
}