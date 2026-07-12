'use client';

import { use, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { sendMessageSchema, type SendMessageInput } from '@/lib/validations/message';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Send, DollarSign, Briefcase } from 'lucide-react';
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

type BidDetail = {
  id: string;
  jobId: string;
  handymanId: string;
  amount: number;
  etaDays: number;
  status: string;
  job: { id: string; title: string; homeownerId: string; homeowner: { id: string; name: string } };
  handyman: { id: string; name: string };
};

type Message = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  sender: { id: string; name: string };
};

export default function MessageThreadPage({ params }: { params: Promise<{ bidId: string }> }) {
  const { bidId } = use(params);
  const { user: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: bid, isPending: bidPending } = useQuery({
    queryKey: ['bid', bidId],
    queryFn: async () => {
      const res = await fetch(`/api/bids/${bidId}`);
      if (!res.ok) throw new Error('Not found');
      return res.json() as Promise<BidDetail>;
    },
    staleTime: 60_000,
  });

  const { data: messages = [], isPending: msgPending } = useQuery({
    queryKey: ['messages', bidId],
    queryFn: async () => {
      const res = await fetch(`/api/messages/${bidId}`);
      if (!res.ok) throw new Error('Failed to fetch messages');
      return res.json() as Promise<Message[]>;
    },
    refetchInterval: 8_000,
    enabled: !!bid,
  });

  const sendMessage = useMutation({
    mutationFn: async (data: SendMessageInput) => {
      const res = await fetch(`/api/messages/${bidId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to send');
      return res.json() as Promise<Message>;
    },
    onSuccess: (newMsg) => {
      queryClient.setQueryData<Message[]>(['messages', bidId], prev => [...(prev ?? []), newMsg]);
    },
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<SendMessageInput>({
    resolver: zodResolver(sendMessageSchema),
  });

  const bodyValue = watch('body') ?? '';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const onSend = async (data: SendMessageInput) => {
    try {
      await sendMessage.mutateAsync(data);
      reset();
    } catch {
      toast.error('Failed to send message. Please try again.');
    }
  };

  const otherName = currentUser?.role === 'HOMEOWNER'
    ? bid?.handyman.name
    : bid?.job.homeowner.name;

  if (bidPending || msgPending) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="container mx-auto px-4 py-3 max-w-3xl">
            <div className="flex items-center gap-4">
              <Skeleton className="h-9 w-9 rounded-md" />
              <div className="flex items-center gap-3 flex-1">
                <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Loading messages…</p>
        </div>
      </div>
    );
  }

  if (!bid) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b">
          <div className="container mx-auto px-4 py-4">
            <Link href="/messages">
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
            </Link>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">Conversation Not Found</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="container mx-auto px-4 py-3 max-w-3xl">
          <div className="flex items-center gap-4">
            <Link href="/messages">
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4" /></Button>
            </Link>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-primary font-semibold">{otherName?.charAt(0)}</span>
              </div>
              <div className="min-w-0">
                <p className="font-semibold leading-tight">{otherName}</p>
                <p className="text-xs text-muted-foreground truncate">{bid.job.title}</p>
              </div>
            </div>
            <Link href={`/jobs/${bid.job.id}`}>
              <Badge variant="outline" className="hidden sm:flex items-center gap-1 cursor-pointer hover:bg-accent">
                <Briefcase className="w-3 h-3" />
                View Job
              </Badge>
            </Link>
          </div>
        </div>
      </header>

      <div className="bg-blue-50 dark:bg-blue-950 border-b border-blue-100 dark:border-blue-900 flex-shrink-0">
        <div className="container mx-auto px-4 py-2 max-w-3xl">
          <div className="flex items-center gap-4 text-sm text-blue-800 dark:text-blue-200">
            <div className="flex items-center gap-1">
              <DollarSign className="w-4 h-4" />
              <span>Bid: <strong>{formatCurrency(bid.amount)}</strong></span>
            </div>
            <Separator orientation="vertical" className="h-4 bg-blue-200" />
            <span>{bid.etaDays} day{bid.etaDays !== 1 ? 's' : ''} to complete</span>
            <Separator orientation="vertical" className="h-4 bg-blue-200" />
            <Badge className={
              bid.status === 'ACCEPTED'
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                : bid.status === 'DECLINED'
                  ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
            }>
              {bid.status}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-4 py-6 max-w-3xl space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>No messages yet. Start the conversation!</p>
            </div>
          )}

          {messages.map((msg, index) => {
            const isMe = msg.senderId === currentUser?.id;
            const prevMsg = messages[index - 1];
            const showDateDivider = !prevMsg || formatDate(msg.createdAt) !== formatDate(prevMsg.createdAt);

            return (
              <div key={msg.id}>
                {showDateDivider && (
                  <div className="flex items-center gap-3 my-4">
                    <Separator className="flex-1" />
                    <span className="text-xs text-muted-foreground flex-shrink-0">{formatDate(msg.createdAt)}</span>
                    <Separator className="flex-1" />
                  </div>
                )}
                <div className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-primary font-semibold text-sm">{msg.sender.name.charAt(0)}</span>
                  </div>
                  <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div className={`rounded-2xl px-4 py-2.5 text-sm ${
                      isMe
                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                        : 'bg-white dark:bg-gray-800 text-foreground rounded-tl-sm shadow-sm'
                    }`}>
                      {msg.body}
                    </div>
                    <span className="text-xs text-muted-foreground mt-1 px-1">{formatRelativeTime(msg.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="flex-shrink-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-3 max-w-3xl">
          <form onSubmit={handleSubmit(onSend)} className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Textarea
                placeholder="Type a message..."
                rows={1}
                className="resize-none min-h-[42px] max-h-32"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(onSend)();
                  }
                }}
                {...register('body')}
                disabled={sendMessage.isPending}
              />
              {errors.body && <p className="text-xs text-red-500">{errors.body.message}</p>}
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={sendMessage.isPending || !bodyValue.trim()}
              className="flex-shrink-0 h-[42px] w-[42px]"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-1">Press Enter to send, Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
