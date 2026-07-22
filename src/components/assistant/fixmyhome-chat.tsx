'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { ChevronDown, Headphones, LoaderCircle, MessageCircle, Send, X } from 'lucide-react';
import { useCurrentUser } from '@/lib/hooks/use-current-user';

type Message = { role: 'user' | 'assistant'; content: string };

const CHAT_STORAGE_KEY = 'fixmyhome-assistant-state';

function pageCopy(path: string, role?: string) {
  if (role === 'HOMEOWNER' || path.startsWith('/homeowner') || path.startsWith('/jobs/new')) return { greeting: 'Hi! I can help you post a project, compare bids, invite a handyman, or use your homeowner dashboard.', prompts: ['How do I post a job?', 'How do I compare bids?', 'How do I invite a handyman?'] };
  if (role === 'HANDYMAN' || path.startsWith('/handyman') || path.includes('/bid') || path === '/browse') return { greeting: 'Hi! I can help you find jobs, submit bids, improve your profile, or learn about growth services.', prompts: ['How do I submit a bid?', 'How can I improve my profile?', 'What growth services are available?'] };
  return { greeting: 'Thanks for visiting FixMyHome.pro. Ask me how the marketplace works for homeowners and local handymen.', prompts: ['How does FixMyHome work?', 'I need to post a repair', 'How do handymen join?'] };
}

export function FixMyHomeChat() {
  const path = usePathname();
  const { user } = useCurrentUser();
  const copy = pageCopy(path, user?.role);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [support, setSupport] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [restored, setRestored] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const state = JSON.parse(saved) as { open?: boolean; messages?: Message[] };
        setOpen(Boolean(state.open));
        if (Array.isArray(state.messages)) setMessages(state.messages.slice(-20));
      }
    } catch {
      sessionStorage.removeItem(CHAT_STORAGE_KEY);
    } finally {
      setRestored(true);
      setMounted(true);
    }
  }, []);

  useEffect(() => {
    if (!restored) return;
    sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ open, messages: messages.slice(-20) }));
  }, [messages, open, restored]);

  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy]);
  if (!mounted || path.startsWith('/admin')) return null;

  async function ask(value: string) {
    const question = value.trim();
    if (!question || busy) return;
    const history = messages.slice(-8);
    setMessages((old) => [...old, { role: 'user', content: question }]); setInput(''); setBusy(true);
    try {
      const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question, pagePath: path, conversation: history }) });
      const body = await response.json().catch(() => null);
      setMessages((old) => [...old, { role: 'assistant', content: response.ok ? body.answer : body?.error || 'I could not answer right now.' }]);
    } catch { setMessages((old) => [...old, { role: 'assistant', content: 'I could not connect. Please try again or contact support.' }]); }
    finally { setBusy(false); }
  }

  async function contact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setNotice('');
    const role = user?.role === 'HANDYMAN' ? 'Handyman' : user?.role === 'HOMEOWNER' ? 'Homeowner' : 'Other';
    try {
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: data.get('name'), email: data.get('email'), role, reason: 'Account help', message: data.get('message') }) });
      const body = await response.json().catch(() => null); setNotice(response.ok ? body?.message || 'Message sent.' : body?.error || 'Unable to send.'); if (response.ok) form.reset();
    } catch { setNotice('Unable to send. Please email support@fixmyhome.pro.'); } finally { setBusy(false); }
  }

  return createPortal(<div className="fixed bottom-4 right-4 z-[70] sm:bottom-6 sm:right-6" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    {open && <section aria-label="FixMyHome assistant" className="mb-3 flex h-[min(640px,calc(100vh-6.5rem))] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-cyan-300/25 bg-slate-950 text-white shadow-2xl shadow-black/40">
      <header className="flex h-16 shrink-0 items-center gap-3 bg-cyan-950 px-4"><img src="/fixmyhome-logo-dark.png" alt="" className="h-11 w-11 object-contain" /><div className="min-w-0 flex-1"><h2 className="font-semibold">FixMyHome Assistant</h2><p className="truncate text-xs text-cyan-100/75">Questions about this page?</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Minimize assistant" className="grid size-9 place-items-center rounded-md hover:bg-white/10"><ChevronDown className="size-5" /></button></header>
      {support ? <form onSubmit={contact} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Contact support</h3><p className="text-xs text-slate-400">We will follow up by email.</p></div><button type="button" onClick={() => { setSupport(false); setNotice(''); }} aria-label="Close support form" className="grid size-8 place-items-center rounded-md hover:bg-white/10"><X className="size-4" /></button></div><input name="name" required minLength={2} defaultValue={user?.name || ''} placeholder="Name" className="h-11 rounded-md border border-white/15 bg-white/5 px-3 text-sm outline-none focus:border-cyan-300" /><input name="email" required type="email" defaultValue={user?.email || ''} placeholder="Email" className="h-11 rounded-md border border-white/15 bg-white/5 px-3 text-sm outline-none focus:border-cyan-300" /><textarea name="message" required minLength={20} maxLength={3000} rows={6} placeholder="How can we help? Do not include passwords or payment information." className="resize-none rounded-md border border-white/15 bg-white/5 p-3 text-sm outline-none focus:border-cyan-300" /><p className="rounded-md bg-white/5 p-3 text-xs leading-5 text-slate-400">By submitting, you agree that FixMyHome.pro may contact you by email about this request.</p>{notice && <p className="text-sm text-cyan-200">{notice}</p>}<button disabled={busy} className="flex h-11 items-center justify-center gap-2 rounded-md bg-cyan-300 font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-60">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />} Send</button></form> : <><div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite"><div className="max-w-[88%] rounded-lg rounded-tl-sm bg-slate-800 p-3 text-sm leading-5">{copy.greeting}</div>{messages.map((message, index) => <div key={index} className={`max-w-[88%] whitespace-pre-wrap rounded-lg p-3 text-sm leading-5 ${message.role === 'user' ? 'ml-auto rounded-tr-sm bg-cyan-300 text-slate-950' : 'rounded-tl-sm bg-slate-800'}`}>{message.content}</div>)}{busy && <div className="flex w-fit items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300"><LoaderCircle className="size-4 animate-spin" /> Thinking</div>}{!messages.length && <div className="flex flex-wrap gap-2 pt-1">{copy.prompts.map((prompt) => <button type="button" key={prompt} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void ask(prompt); }} className="rounded-full border border-cyan-300/30 px-3 py-2 text-left text-xs text-cyan-100 hover:bg-cyan-300/10">{prompt}</button>)}</div>}<div ref={end} /></div><div className="border-t border-white/10 p-3"><div className="mb-2 flex justify-end"><button type="button" onClick={() => setSupport(true)} className="flex items-center gap-1.5 text-xs text-cyan-200"><Headphones className="size-3.5" /> Contact support</button></div><div className="flex gap-2"><input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); void ask(input); } }} maxLength={1200} placeholder="Ask a question..." aria-label="Message" className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-3 text-sm outline-none focus:border-cyan-300" /><button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void ask(input); }} disabled={busy || !input.trim()} aria-label="Send message" className="grid size-11 shrink-0 place-items-center rounded-md bg-cyan-300 text-slate-950 disabled:opacity-50"><Send className="size-4" /></button></div></div></>}
    </section>}
    <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }} aria-label={open ? 'Close FixMyHome assistant' : 'Open FixMyHome assistant'} className="ml-auto flex h-14 items-center gap-2 rounded-full border border-cyan-200/30 bg-cyan-300 px-4 font-semibold text-slate-950 shadow-xl hover:bg-cyan-200 focus:ring-2 focus:ring-cyan-100">{open ? <X className="size-5" /> : <MessageCircle className="size-5" />}<span className="hidden sm:inline">Ask FixMyHome</span></button>
  </div>, document.body);
}
