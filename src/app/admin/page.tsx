import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Activity, Ban, Briefcase, CheckCircle2, DollarSign, KeyRound, Mail, MessageSquare, Search, Star, Trash2, Users } from 'lucide-react';

type AdminSearchParams = Promise<Record<string, string | string[] | undefined>>;

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const currentUser = await db.user.findFirst({
    where: {
      OR: [
        { id: session.user.id },
        ...(session.user.email ? [{ email: session.user.email }] : []),
      ],
    },
    select: { id: true, email: true, role: true },
  });

  if (currentUser?.role !== 'ADMIN') redirect('/role-selection');

  return {
    ...session,
    user: {
      ...session.user,
      id: currentUser.id,
      email: currentUser.email,
      role: currentUser.role,
    },
  };
}

async function updateUserRole(formData: FormData) {
  'use server';

  await requireAdmin();
  const userId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '') as Role;

  if (!userId || !['HOMEOWNER', 'HANDYMAN', 'ADMIN'].includes(role)) return;
  await db.user.update({ where: { id: userId }, data: { role } });
  revalidatePath('/admin');
}

async function updateUserAvailability(formData: FormData) {
  'use server';

  await requireAdmin();
  const userId = String(formData.get('userId') ?? '');
  const isAvailable = String(formData.get('isAvailable')) === 'true';

  if (!userId) return;
  await db.user.update({ where: { id: userId }, data: { isAvailable } });
  revalidatePath('/admin');
}

function optionalText(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? '').trim();
  return value.length > 0 ? value : null;
}

function parseSkills(value: string | null) {
  if (!value) return [];
  return value.split(/[,\n]/).map((skill) => skill.trim()).filter(Boolean);
}

async function updateAdminUserProfile(formData: FormData) {
  'use server';

  await requireAdmin();
  const userId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '') as Role;
  if (!userId || !['HOMEOWNER', 'HANDYMAN', 'ADMIN'].includes(role)) return;

  const serviceRadius = Number(formData.get('serviceRadius') || 25);
  const hourlyRateRaw = String(formData.get('hourlyRate') ?? '').trim();
  const hourlyRate = hourlyRateRaw ? Number(hourlyRateRaw) : null;

  await db.user.update({
    where: { id: userId },
    data: {
      name: optionalText(formData, 'name') || 'User',
      role,
      location: optionalText(formData, 'location'),
      phone: optionalText(formData, 'phone'),
      isAvailable: String(formData.get('isAvailable')) === 'true',
    },
  });

  if (role === 'HANDYMAN') {
    await db.handymanProfile.upsert({
      where: { userId },
      update: {
        businessName: optionalText(formData, 'businessName'),
        website: optionalText(formData, 'website'),
        licenseNumber: optionalText(formData, 'licenseNumber'),
        isInsured: String(formData.get('isInsured')) === 'true',
        verificationStatus: String(formData.get('verificationStatus') || 'UNVERIFIED'),
        bio: optionalText(formData, 'bio'),
        skills: parseSkills(optionalText(formData, 'skills')),
        serviceRadius: Number.isFinite(serviceRadius) && serviceRadius > 0 ? Math.min(serviceRadius, 200) : 25,
        hourlyRate: hourlyRate !== null && Number.isFinite(hourlyRate) ? hourlyRate : null,
      },
      create: {
        userId,
        businessName: optionalText(formData, 'businessName'),
        website: optionalText(formData, 'website'),
        licenseNumber: optionalText(formData, 'licenseNumber'),
        isInsured: String(formData.get('isInsured')) === 'true',
        bio: optionalText(formData, 'bio'),
        skills: parseSkills(optionalText(formData, 'skills')),
        serviceRadius: Number.isFinite(serviceRadius) && serviceRadius > 0 ? Math.min(serviceRadius, 200) : 25,
        hourlyRate: hourlyRate !== null && Number.isFinite(hourlyRate) ? hourlyRate : null,
      },
    });
  }

  revalidatePath('/admin');
}

async function deleteJob(formData: FormData) {
  'use server';

  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await db.job.delete({ where: { id } });
  revalidatePath('/admin');
}

async function deleteMessage(formData: FormData) {
  'use server';

  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await db.message.delete({ where: { id } });
  revalidatePath('/admin');
}

async function deleteReview(formData: FormData) {
  'use server';

  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await db.review.delete({ where: { id } });
  revalidatePath('/admin');
}

async function deleteNotification(formData: FormData) {
  'use server';

  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await db.notification.delete({ where: { id } });
  revalidatePath('/admin');
}

async function updateReportStatus(formData: FormData) {
  'use server';

  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? 'OPEN');
  if (!id || !['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'].includes(status)) return;
  await db.report.update({ where: { id }, data: { status } });
  revalidatePath('/admin');
}


async function updateContactSubmissionStatus(formData: FormData) {
  'use server';

  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? 'NEW');
  if (!id || !['NEW', 'IN_PROGRESS', 'CLOSED', 'SPAM'].includes(status)) return;
  await db.contactSubmission.update({ where: { id }, data: { status } });
  revalidatePath('/admin');
}

async function deleteContactSubmission(formData: FormData) {
  'use server';

  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await db.contactSubmission.delete({ where: { id } });
  revalidatePath('/admin');
}
async function expireResetToken(formData: FormData) {
  'use server';

  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await db.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
  revalidatePath('/admin');
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(value);
}

function money(value: unknown) {
  const amount = typeof value === 'object' && value && 'toString' in value ? Number(value.toString()) : Number(value ?? 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    OPEN: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
    IN_REVIEW: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
    AWARDED: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
    COMPLETED: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
    PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
    ACCEPTED: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
    DECLINED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
    WITHDRAWN: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    NEW: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
    IN_PROGRESS: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
    CLOSED: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
    SPAM: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
    REVIEWING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
    RESOLVED: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
    DISMISSED: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  };
  return <Badge className={colors[status] ?? ''}>{status.replace('_', ' ')}</Badge>;
}

function roleBadge(role: string) {
  const colors: Record<string, string> = {
    ADMIN: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200',
    HANDYMAN: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
    HOMEOWNER: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  };
  return <Badge className={colors[role] ?? ''}>{role}</Badge>;
}

function DeleteButton({ label = 'Delete' }: { label?: string }) {
  return (
    <Button type="submit" size="sm" variant="destructive" className="gap-1">
      <Trash2 className="size-3" />
      {label}
    </Button>
  );
}

export default async function AdminPage({ searchParams }: { searchParams?: AdminSearchParams }) {
  const session = await requireAdmin();
  const params = searchParams ? await searchParams : {};
  const q = firstParam(params.q).trim();
  const role = firstParam(params.role);
  const status = firstParam(params.status);

  const userWhere: Record<string, unknown> = {};
  if (q) {
    userWhere.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
      { location: { contains: q } },
      { phone: { contains: q } },
    ];
  }
  if (['HOMEOWNER', 'HANDYMAN', 'ADMIN'].includes(role)) userWhere.role = role;
  if (status === 'active') userWhere.isAvailable = true;
  if (status === 'suspended') userWhere.isAvailable = false;

  const contentWhere = q
    ? {
        OR: [
          { title: { contains: q } },
          { description: { contains: q } },
          { category: { contains: q } },
          { location: { contains: q } },
        ],
      }
    : undefined;

  const [
    users,
    jobs,
    bids,
    messages,
    reviews,
    notifications,
    resetTokens,
    reports,
    counts,
  ] = await Promise.all([
    db.user.findMany({
      where: userWhere,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { handymanProfile: true, _count: { select: { jobsPosted: true, bidsSubmitted: true, messagesSent: true } } },
    }),
    db.job.findMany({
      where: contentWhere,
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { homeowner: { select: { name: true, email: true } }, _count: { select: { bids: true, messages: true, photos: true } } },
    }),
    db.bid.findMany({
      where: q ? { OR: [{ message: { contains: q } }, { job: { title: { contains: q } } }, { handyman: { email: { contains: q } } }, { handyman: { name: { contains: q } } }] } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { handyman: { select: { name: true, email: true } }, job: { select: { title: true } } },
    }),
    db.message.findMany({
      where: q ? { OR: [{ body: { contains: q } }, { job: { title: { contains: q } } }, { sender: { email: { contains: q } } }, { sender: { name: { contains: q } } }] } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { sender: { select: { name: true, email: true } }, job: { select: { title: true } } },
    }),
    db.review.findMany({
      where: q ? { OR: [{ text: { contains: q } }, { job: { title: { contains: q } } }, { reviewer: { email: { contains: q } } }, { handyman: { email: { contains: q } } }] } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { reviewer: { select: { name: true, email: true } }, handyman: { select: { name: true, email: true } }, job: { select: { title: true } } },
    }),
    db.notification.findMany({
      where: q ? { OR: [{ title: { contains: q } }, { body: { contains: q } }, { user: { email: { contains: q } } }] } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { user: { select: { name: true, email: true } } },
    }),
    db.passwordResetToken.findMany({
      where: q ? { user: { email: { contains: q } } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { user: { select: { name: true, email: true } } },
    }),
    db.report.findMany({
      where: q ? { OR: [{ reason: { contains: q } }, { details: { contains: q } }, { reporter: { email: { contains: q } } }] } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { reporter: { select: { name: true, email: true } } },
    }),
    db.contactSubmission.findMany({
      where: q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { role: { contains: q } }, { reason: { contains: q } }, { message: { contains: q } }] } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    Promise.all([
      db.user.count(),
      db.job.count(),
      db.bid.count(),
      db.message.count(),
      db.review.count(),
      db.notification.count({ where: { read: false } }),
      db.passwordResetToken.count({ where: { usedAt: null, expiresAt: { gt: new Date() } } }),
      db.contactSubmission.count({ where: { status: 'NEW' } }),
      db.job.aggregate({ _sum: { budget: true } }),
    ]),
  ]);

  const [userCount, jobCount, bidCount, messageCount, reviewCount, unreadNotifications, activeResets, newContactRequests, budgetTotal] = counts;
  const stats = [
    { label: 'Users', value: userCount, detail: 'Registered accounts', icon: Users },
    { label: 'Jobs', value: jobCount, detail: `${money(budgetTotal._sum.budget)} posted budget`, icon: Briefcase },
    { label: 'Bids', value: bidCount, detail: 'Submitted proposals', icon: DollarSign },
    { label: 'Messages', value: messageCount, detail: 'User conversations', icon: MessageSquare },
    { label: 'Reviews', value: reviewCount, detail: 'Completed feedback', icon: Star },
    { label: 'Unread Alerts', value: unreadNotifications, detail: 'Open notifications', icon: Activity },
    { label: 'Reset Links', value: activeResets, detail: 'Active password resets', icon: KeyRound },
    { label: 'Contact', value: newContactRequests, detail: 'New contact requests', icon: Mail },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b bg-white dark:bg-gray-800 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <Link href="/" aria-label="FixMyHome.pro home"><img src="/fixmyhome-logo-dark.png" alt="FixMyHome.pro" className="h-14 w-14 object-contain" /></Link>
            <p className="text-sm text-muted-foreground">Admin Console</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-sm text-muted-foreground">{session.user.email}</span>
            <ThemeToggle />
            <Button asChild variant="outline" size="sm"><Link href="/sign-out">Sign Out</Link></Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        <section>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-2">Search, moderate, and maintain marketplace activity from one place.</p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {stats.map(({ label, value, detail, icon: Icon }) => (
            <Card key={label}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                  <Icon className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                <p className="text-xs text-muted-foreground mt-1">{detail}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Search & Filters</CardTitle>
            <CardDescription>Filter users and recent marketplace content by keyword, role, or account status.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/admin" className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input name="q" defaultValue={q} placeholder="Search name, email, job, message..." className="pl-9" />
              </div>
              <select name="role" defaultValue={role} className="h-9 rounded-md border bg-background px-3 text-sm">
                <option value="">All roles</option>
                <option value="HOMEOWNER">Homeowners</option>
                <option value="HANDYMAN">Handymen</option>
                <option value="ADMIN">Admins</option>
              </select>
              <select name="status" defaultValue={status} className="h-9 rounded-md border bg-background px-3 text-sm">
                <option value="">All statuses</option>
                <option value="active">Active users</option>
                <option value="suspended">Suspended users</option>
              </select>
              <Button type="submit">Apply</Button>
              <Button asChild type="button" variant="outline"><Link href="/admin">Clear</Link></Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>User Management</CardTitle>
            <CardDescription>Change roles, suspend availability, and inspect account activity.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-3 pr-4 font-medium">User</th>
                  <th className="py-3 pr-4 font-medium">Role</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 font-medium">Activity</th>
                  <th className="py-3 pr-4 font-medium">Joined</th>
                  <th className="py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((user) => (
                  <tr key={user.id} className="align-top">
                    <td className="py-4 pr-4">
                      <div className="font-medium">{user.name}</div>
                      <div className="text-muted-foreground">{user.email}</div>
                    </td>
                    <td className="py-4 pr-4">{roleBadge(user.role)}</td>
                    <td className="py-4 pr-4">
                      {user.isAvailable ? <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"><CheckCircle2 className="size-3" /> Active</Badge> : <Badge className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"><Ban className="size-3" /> Suspended</Badge>}
                    </td>
                    <td className="py-4 pr-4 text-muted-foreground">
                      {user._count.jobsPosted} jobs / {user._count.bidsSubmitted} bids / {user._count.messagesSent} messages
                    </td>
                    <td className="py-4 pr-4 text-muted-foreground">{formatDate(user.createdAt)}</td>
                    <td className="py-4">
                      <div className="flex flex-wrap gap-2">
                        <form action={updateUserRole} className="flex gap-2">
                          <input type="hidden" name="userId" value={user.id} />
                          <select name="role" defaultValue={user.role} className="h-9 rounded-md border bg-background px-2 text-sm">
                            <option value="HOMEOWNER">Homeowner</option>
                            <option value="HANDYMAN">Handyman</option>
                            <option value="ADMIN">Admin</option>
                          </select>
                          <Button type="submit" size="sm" variant="outline">Save</Button>
                        </form>
                        <form action={updateUserAvailability}>
                          <input type="hidden" name="userId" value={user.id} />
                          <input type="hidden" name="isAvailable" value={String(!user.isAvailable)} />
                          <Button type="submit" size="sm" variant={user.isAvailable ? 'destructive' : 'outline'}>
                            {user.isAvailable ? 'Suspend' : 'Reactivate'}
                          </Button>
                        </form>
                      </div>
                      <details className="mt-3 rounded-md border p-3">
                        <summary className="cursor-pointer text-sm font-medium">Edit profile</summary>
                        <form action={updateAdminUserProfile} className="mt-3 grid gap-3">
                          <input type="hidden" name="userId" value={user.id} />
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="space-y-1 text-xs font-medium">Name<Input name="name" defaultValue={user.name} /></label>
                            <label className="space-y-1 text-xs font-medium">Role<select name="role" defaultValue={user.role} className="h-9 w-full rounded-md border bg-background px-2 text-sm"><option value="HOMEOWNER">Homeowner</option><option value="HANDYMAN">Handyman</option><option value="ADMIN">Admin</option></select></label>
                            <label className="space-y-1 text-xs font-medium">ZIP / Location<Input name="location" defaultValue={user.location ?? ''} /></label>
                            <label className="space-y-1 text-xs font-medium">Phone<Input name="phone" defaultValue={user.phone ?? ''} /></label>
                          </div>
                          <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" name="isAvailable" value="true" defaultChecked={user.isAvailable} /> Active / available</label>
                          {user.role === 'HANDYMAN' && (
                            <div className="grid gap-3 rounded-md bg-muted/40 p-3 md:grid-cols-2">
                              <label className="space-y-1 text-xs font-medium">Business Name<Input name="businessName" defaultValue={user.handymanProfile?.businessName ?? ''} /></label>
                              <label className="space-y-1 text-xs font-medium">Website<Input name="website" defaultValue={user.handymanProfile?.website ?? ''} placeholder="yourbusiness.com" /></label>
                              <label className="space-y-1 text-xs font-medium">License Number<Input name="licenseNumber" defaultValue={user.handymanProfile?.licenseNumber ?? ''} /></label>
                              <label className="space-y-1 text-xs font-medium">Service Radius<Input name="serviceRadius" type="number" min="1" max="200" defaultValue={user.handymanProfile?.serviceRadius ?? 25} /></label>
                              <label className="space-y-1 text-xs font-medium">Hourly Rate<Input name="hourlyRate" type="number" min="0" step="0.01" defaultValue={user.handymanProfile?.hourlyRate ? Number(user.handymanProfile.hourlyRate) : ''} /></label>
                              <label className="flex items-center gap-2 text-xs font-medium md:pt-6"><input type="checkbox" name="isInsured" value="true" defaultChecked={user.handymanProfile?.isInsured ?? false} /> License / insured</label>
                              <label className="space-y-1 text-xs font-medium md:col-span-2">Verification Status<select name="verificationStatus" defaultValue={user.handymanProfile?.verificationStatus ?? 'UNVERIFIED'} className="h-9 w-full rounded-md border bg-background px-2 text-sm"><option value="UNVERIFIED">Unverified</option><option value="PENDING_REVIEW">Pending Review</option><option value="VERIFIED">Verified</option><option value="SUSPENDED">Suspended</option></select></label>
                              <label className="space-y-1 text-xs font-medium md:col-span-2">Skills<Textarea name="skills" defaultValue={Array.isArray(user.handymanProfile?.skills) ? user.handymanProfile.skills.join(', ') : ''} rows={2} /></label>
                              <label className="space-y-1 text-xs font-medium md:col-span-2">Bio<Textarea name="bio" defaultValue={user.handymanProfile?.bio ?? ''} rows={3} /></label>
                            </div>
                          )}
                          <Button type="submit" size="sm" className="w-fit">Save Profile</Button>
                        </form>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid gap-8 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Recent Jobs</CardTitle><CardDescription>Delete inappropriate or duplicate job posts.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {jobs.map((job) => (
                <div key={job.id} className="rounded-md border p-4">
                  <div className="flex items-start justify-between gap-3"><div><div className="font-medium">{job.title}</div><div className="text-sm text-muted-foreground">{job.homeowner.name} / {job.location} / {money(job.budget)}</div></div>{statusBadge(job.status)}</div>
                  <div className="mt-2 text-xs text-muted-foreground">{job._count.bids} bids / {job._count.messages} messages / {job._count.photos} photos / {formatDate(job.createdAt)}</div>
                  <form action={deleteJob} className="mt-3"><input type="hidden" name="id" value={job.id} /><DeleteButton /></form>
                </div>
              ))}
              {jobs.length === 0 && <p className="text-sm text-muted-foreground">No jobs found.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Bids</CardTitle><CardDescription>Latest proposals from handymen.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {bids.map((bid) => (
                <div key={bid.id} className="rounded-md border p-4">
                  <div className="flex items-start justify-between gap-3"><div><div className="font-medium">{bid.job.title}</div><div className="text-sm text-muted-foreground">{bid.handyman.name} / {money(bid.amount)} / ETA {bid.etaDays} days</div></div>{statusBadge(bid.status)}</div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{bid.message}</p>
                </div>
              ))}
              {bids.length === 0 && <p className="text-sm text-muted-foreground">No bids found.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Messages</CardTitle><CardDescription>Remove inappropriate user communication.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {messages.map((message) => (
                <div key={message.id} className="rounded-md border p-4">
                  <div className="font-medium">{message.sender.name}</div>
                  <div className="text-xs text-muted-foreground">{message.job.title} / {formatDate(message.createdAt)}</div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{message.body}</p>
                  <form action={deleteMessage} className="mt-3"><input type="hidden" name="id" value={message.id} /><DeleteButton /></form>
                </div>
              ))}
              {messages.length === 0 && <p className="text-sm text-muted-foreground">No messages found.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Reviews</CardTitle><CardDescription>Remove abusive or mistaken reviews.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {reviews.map((review) => (
                <div key={review.id} className="rounded-md border p-4">
                  <div className="font-medium">{review.stars} stars for {review.handyman.name}</div>
                  <div className="text-xs text-muted-foreground">From {review.reviewer.name} / {review.job.title}</div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{review.text || 'No written review.'}</p>
                  <form action={deleteReview} className="mt-3"><input type="hidden" name="id" value={review.id} /><DeleteButton /></form>
                </div>
              ))}
              {reviews.length === 0 && <p className="text-sm text-muted-foreground">No reviews found.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Notifications</CardTitle><CardDescription>Clean up stale platform notifications.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {notifications.map((notification) => (
                <div key={notification.id} className="rounded-md border p-4">
                  <div className="flex items-center justify-between gap-3"><div className="font-medium">{notification.title}</div>{notification.read ? <Badge variant="outline">Read</Badge> : <Badge>Unread</Badge>}</div>
                  <div className="text-xs text-muted-foreground">{notification.user.email} / {notification.type} / {formatDate(notification.createdAt)}</div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{notification.body}</p>
                  <form action={deleteNotification} className="mt-3"><input type="hidden" name="id" value={notification.id} /><DeleteButton /></form>
                </div>
              ))}
              {notifications.length === 0 && <p className="text-sm text-muted-foreground">No notifications found.</p>}
            </CardContent>
          </Card>


          <Card>
            <CardHeader><CardTitle>Trust & Safety Reports</CardTitle><CardDescription>User reports for profiles, jobs, and message threads.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {reports.map((report) => (
                <div key={report.id} className="rounded-md border p-4">
                  <div className="flex items-start justify-between gap-3"><div><div className="font-medium">{report.targetType} / {report.targetId}</div><div className="text-xs text-muted-foreground">Reported by {report.reporter.name} / {report.reporter.email} / {formatDate(report.createdAt)}</div></div>{statusBadge(report.status)}</div>
                  <p className="mt-2 text-sm"><strong>Reason:</strong> {report.reason}</p>
                  {report.details && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{report.details}</p>}
                  <form action={updateReportStatus} className="mt-3 flex flex-wrap gap-2">
                    <input type="hidden" name="id" value={report.id} />
                    <select name="status" defaultValue={report.status} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="OPEN">Open</option><option value="REVIEWING">Reviewing</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option></select>
                    <Button type="submit" size="sm" variant="outline">Update</Button>
                  </form>
                </div>
              ))}
              {reports.length === 0 && <p className="text-sm text-muted-foreground">No reports found.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Contact Requests</CardTitle><CardDescription>Messages submitted from the public contact form.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {contactSubmissions.map((submission) => (
                <div key={submission.id} className="rounded-md border p-4">
                  <div className="flex items-start justify-between gap-3"><div><div className="font-medium">{submission.reason}</div><div className="text-xs text-muted-foreground">{submission.name} / {submission.email} / {submission.role} / {formatDate(submission.createdAt)}</div></div>{statusBadge(submission.status)}</div>
                  <p className="mt-2 line-clamp-4 text-sm text-muted-foreground">{submission.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline"><a href={`mailto:${submission.email}`}>Reply</a></Button>
                    <form action={updateContactSubmissionStatus} className="flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={submission.id} />
                      <select name="status" defaultValue={submission.status} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="NEW">New</option><option value="IN_PROGRESS">In Progress</option><option value="CLOSED">Closed</option><option value="SPAM">Spam</option></select>
                      <Button type="submit" size="sm" variant="outline">Update</Button>
                    </form>
                    <form action={deleteContactSubmission}><input type="hidden" name="id" value={submission.id} /><DeleteButton /></form>
                  </div>
                </div>
              ))}
              {contactSubmissions.length === 0 && <p className="text-sm text-muted-foreground">No contact requests found.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Password Reset Links</CardTitle><CardDescription>Expire active account recovery links.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {resetTokens.map((token) => (
                <div key={token.id} className="rounded-md border p-4">
                  <div className="flex items-center justify-between gap-3"><div className="font-medium">{token.user.email}</div>{token.usedAt ? <Badge variant="outline">Used</Badge> : token.expiresAt < new Date() ? <Badge className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">Expired</Badge> : <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">Active</Badge>}</div>
                  <div className="text-xs text-muted-foreground">Created {formatDate(token.createdAt)} / Expires {formatDate(token.expiresAt)}</div>
                  {!token.usedAt && token.expiresAt >= new Date() && <form action={expireResetToken} className="mt-3"><input type="hidden" name="id" value={token.id} /><Button type="submit" size="sm" variant="outline">Expire Link</Button></form>}
                </div>
              ))}
              {resetTokens.length === 0 && <p className="text-sm text-muted-foreground">No reset links found.</p>}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
