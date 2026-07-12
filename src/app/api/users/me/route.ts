import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(null, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { handymanProfile: true },
  });

  return NextResponse.json(user);
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  location: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  isAvailable: z.boolean().optional(),
  handymanProfile: z.object({
    businessName: z.string().optional().nullable(),
    bio: z.string().optional().nullable(),
    skills: z.array(z.string()).optional(),
    serviceRadius: z.number().int().min(1).max(200).optional(),
    hourlyRate: z.number().min(0).optional().nullable(),
  }).optional(),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { handymanProfile: profileData, ...userData } = parsed.data;

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(userData.name      !== undefined && { name: userData.name }),
      ...(userData.location  !== undefined && { location: userData.location }),
      ...(userData.phone     !== undefined && { phone: userData.phone }),
      ...(userData.photoUrl  !== undefined && { photoUrl: userData.photoUrl }),
      ...(userData.isAvailable !== undefined && { isAvailable: userData.isAvailable }),
    },
    include: { handymanProfile: true },
  });

  if (profileData) {
    await prisma.handymanProfile.upsert({
      where: { userId: user.id },
      update: {
        ...(profileData.businessName !== undefined && { businessName: profileData.businessName }),
        ...(profileData.bio          !== undefined && { bio: profileData.bio }),
        ...(profileData.skills       !== undefined && { skills: profileData.skills }),
        ...(profileData.serviceRadius !== undefined && { serviceRadius: profileData.serviceRadius }),
        ...(profileData.hourlyRate   !== undefined && { hourlyRate: profileData.hourlyRate }),
      },
      create: {
        userId: user.id,
        skills: profileData.skills ?? [],
        serviceRadius: profileData.serviceRadius ?? 25,
        businessName: profileData.businessName ?? null,
        bio: profileData.bio ?? null,
        hourlyRate: profileData.hourlyRate ?? null,
      },
    });
  }

  const updatedUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { handymanProfile: true },
  });

  return NextResponse.json(updatedUser);
}
