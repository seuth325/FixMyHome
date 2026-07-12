'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Job, JobPhoto } from '@prisma/client';

export type JobSummary = Job & {
  photos: JobPhoto[];
  _count: { bids: number };
  hasReview: boolean;
  budget: number;
};

export type BrowseJob = Job & {
  photos: JobPhoto[];
  homeowner: { name: string };
  _count: { bids: number };
  budget: number;
  myBid: { id: string; status: string; amount: number } | null;
};

// ── My Jobs (homeowner) ──────────────────────────────────────────────────────

async function fetchMyJobs(): Promise<JobSummary[]> {
  const res = await fetch('/api/jobs');
  if (!res.ok) throw new Error('Failed to fetch jobs');
  return res.json();
}

export function useMyJobs() {
  return useQuery({
    queryKey: ['my-jobs'],
    queryFn: fetchMyJobs,
    staleTime: 30_000,
  });
}

// ── Browse Jobs (handyman) ───────────────────────────────────────────────────

async function fetchBrowseJobs(): Promise<BrowseJob[]> {
  const res = await fetch('/api/jobs/browse');
  if (!res.ok) throw new Error('Failed to fetch jobs');
  return res.json();
}

export function useBrowseJobs() {
  return useQuery({
    queryKey: ['browse-jobs'],
    queryFn: fetchBrowseJobs,
    staleTime: 30_000,
  });
}

// ── Create Job ───────────────────────────────────────────────────────────────

export function useCreateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      title: string;
      description: string;
      category: string;
      location: string;
      budget: number;
      preferredDate?: Date;
      photoUrls?: string[];
    }) => {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          preferredDate: data.preferredDate?.toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to create job');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-jobs'] });
    },
  });
}

// ── Update Job Status ────────────────────────────────────────────────────────

export function useUpdateJobStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ jobId, status }: { jobId: string; status: string }) => {
      const res = await fetch(`/api/jobs/${jobId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to update status');
      }
      return res.json();
    },
    onSuccess: (_data, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: ['my-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    },
  });
}
