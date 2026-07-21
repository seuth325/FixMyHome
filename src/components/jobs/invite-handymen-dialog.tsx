'use client';

import { useMemo, useState } from 'react';
import { Check, Loader2, Search, Send, ShieldCheck, Star, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

type Handyman = {
  id: string;
  name: string;
  location: string | null;
  businessName: string | null;
  skills: unknown;
  ratingAvg: number;
  ratingCount: number;
  verified: boolean;
  bidSubmitted: boolean;
  invitation: { id: string } | null;
};

export function InviteHandymenDialog({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [handymen, setHandymen] = useState<Handyman[]>([]);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);

  const loadHandymen = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}/invitations`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load handymen.');
      setHandymen(data.handymen);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load handymen.');
    } finally {
      setLoading(false);
    }
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return handymen;
    return handymen.filter((handyman) => {
      const skills = Array.isArray(handyman.skills) ? handyman.skills.join(' ') : '';
      return [handyman.name, handyman.businessName, handyman.location, skills]
        .filter(Boolean).join(' ').toLowerCase().includes(term);
    });
  }, [handymen, search]);

  const invite = async (handyman: Handyman) => {
    setSendingId(handyman.id);
    try {
      const response = await fetch(`/api/jobs/${jobId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handymanId: handyman.id, message }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to send invitation.');
      setHandymen((current) => current.map((item) => item.id === handyman.id ? { ...item, invitation: data.invitation } : item));
      toast.success(`Invitation sent to ${handyman.businessName || handyman.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to send invitation.');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next && handymen.length === 0) void loadHandymen(); }}>
      <DialogTrigger asChild>
        <Button className="w-full" variant="outline"><UserPlus className="mr-2 h-4 w-4" />Invite Handymen</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Invite handymen to bid</DialogTitle>
          <DialogDescription>Select trusted local professionals for &quot;{jobTitle}&quot;. They will receive an email and an in-app notification.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 overflow-hidden">
          <Textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} placeholder="Optional personal note to include with each invitation" className="min-h-20" />
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, business, ZIP or skill" className="pl-9" />
          </div>
          <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
            {loading && <div className="flex items-center justify-center py-12 text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Finding available handymen...</div>}
            {!loading && visible.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No available handymen match this search.</p>}
            {!loading && visible.map((handyman) => {
              const skills = Array.isArray(handyman.skills) ? handyman.skills.filter((skill): skill is string => typeof skill === 'string').slice(0, 3) : [];
              const done = handyman.bidSubmitted || !!handyman.invitation;
              return (
                <div key={handyman.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{handyman.name.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-semibold">{handyman.businessName || handyman.name}</p>
                        {handyman.verified && <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Verified" />}
                      </div>
                      {handyman.businessName && <p className="text-xs text-muted-foreground">{handyman.name}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center"><Star className="mr-1 h-3.5 w-3.5 fill-amber-400 text-amber-400" />{handyman.ratingAvg.toFixed(1)} ({handyman.ratingCount})</span>
                        {handyman.location && <span>{handyman.location}</span>}
                      </div>
                      {skills.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{skills.map((skill) => <Badge key={skill} variant="secondary" className="text-[10px]">{skill}</Badge>)}</div>}
                    </div>
                  </div>
                  <Button size="sm" className="shrink-0" variant={done ? 'secondary' : 'default'} disabled={done || sendingId === handyman.id} onClick={() => invite(handyman)}>
                    {sendingId === handyman.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : done ? <Check className="mr-1 h-4 w-4" /> : <Send className="mr-1 h-4 w-4" />}
                    {handyman.bidSubmitted ? 'Bid submitted' : handyman.invitation ? 'Invited' : 'Send Invite'}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
