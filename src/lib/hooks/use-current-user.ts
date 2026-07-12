'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type { User, HandymanProfile } from '@prisma/client';

export type CurrentUser = User & {
  handymanProfile: (Omit<HandymanProfile, 'skills'> & { skills: string[] }) | null;
};

async function fetchMe(): Promise<CurrentUser | null> {
  const res = await fetch('/api/users/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Failed to fetch user');
  return res.json();
}

export function useCurrentUser() {
  const { status } = useSession();
  const isLoaded = status !== 'loading';
  const isSignedIn = status === 'authenticated';
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['current-user'],
    queryFn: fetchMe,
    enabled: isLoaded && isSignedIn === true,
    staleTime: 60 * 1000,
  });

  const updateProfile = async (data: Partial<{
    name: string;
    location: string | null;
    phone: string | null;
    photoUrl: string | null;
    isAvailable: boolean;
    handymanProfile: Partial<{
      businessName: string | null;
      bio: string | null;
      skills: string[];
      serviceRadius: number;
      hourlyRate: number | null;
    }>;
  }>) => {
    const res = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update profile');
    const updated = await res.json();
    queryClient.setQueryData(['current-user'], updated);
    return updated as CurrentUser;
  };

  return {
    user: query.data ?? null,
    isLoaded: isLoaded && (!isSignedIn || !query.isPending),
    isSignedIn,
    updateProfile,
    refetch: query.refetch,
  };
}
