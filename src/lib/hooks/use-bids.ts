'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export type MyBid = {
  id: string;
  jobId: string;
  amount: number;
  message: string;
  etaDays: number;
  status: string;
  createdAt: string;
  job: {
    id: string;
    title: string;
    category: string;
    location: string;
    budget: number;
    status: string;
    homeowner: { name: string };
  };
};

// ── My Bids (handyman) ───────────────────────────────────────────────────────

async function fetchMyBids(): Promise<MyBid[]> {
  const res = await fetch('/api/bids/my');
  if (!res.ok) throw new Error('Failed to fetch bids');
  return res.json();
}

export function useMyBids() {
  return useQuery({
    queryKey: ['my-bids'],
    queryFn: fetchMyBids,
    staleTime: 30_000,
  });
}

// ── Submit / Update Bid ──────────────────────────────────────────────────────

export function useSubmitBid(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { amount: number; message: string; etaDays: number }) => {
      const res = await fetch(`/api/jobs/${jobId}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to submit bid');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['my-bids'] });
      queryClient.invalidateQueries({ queryKey: ['browse-jobs'] });
    },
  });
}

// ── Accept Bid ───────────────────────────────────────────────────────────────

export function useAcceptBid(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (bidId: string) => {
      const res = await fetch(`/api/bids/${bidId}/accept`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to accept bid');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['my-jobs'] });
    },
  });
}

// ── Decline Bid ──────────────────────────────────────────────────────────────

export function useDeclineBid(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (bidId: string) => {
      const res = await fetch(`/api/bids/${bidId}/decline`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to decline bid');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    },
  });
}
