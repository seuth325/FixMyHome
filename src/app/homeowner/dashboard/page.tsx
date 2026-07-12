'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { useMyJobs } from '@/lib/hooks/use-jobs';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PlusCircle, Briefcase, MessageSquare, LogOut, DollarSign, Calendar, MapPin, User, Phone, Pencil, Camera, Bell } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';
import { toast } from 'sonner';
import { useUploadProfilePhoto } from '@/lib/hooks/use-upload';

export default function HomeownerDashboard() {
  const { user, isLoaded, updateProfile } = useCurrentUser();
  const { data: jobs = [], isPending: jobsPending } = useMyJobs();

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/notifications');
      if (!res.ok) return { notifications: [], unreadCount: 0 };
      return res.json() as Promise<{ notifications: unknown[]; unreadCount: number }>;
    },
    enabled: !!user,
    refetchInterval: 30_000,
  });
  const notifUnread = notifData?.unreadCount ?? 0;

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileLocation, setProfileLocation] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [photoPreview, setPhotoPreview] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadPhoto, isUploading: isPhotoUploading } = useUploadProfilePhoto();

  const openProfileDialog = () => {
    setProfileName(user?.name ?? '');
    setProfileLocation(user?.location ?? '');
    setProfilePhone(user?.phone ?? '');
    setPhotoPreview(user?.photoUrl ?? '');
    setProfileOpen(true);
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Photo must be under 5 MB.');
      return;
    }
    // Show local preview immediately
    setPhotoPreview(URL.createObjectURL(file));
    // Upload to UploadThing
    const url = await uploadPhoto(file);
    if (url) {
      setPhotoPreview(url);
    } else {
      toast.error('Photo upload failed. Please try again.');
      setPhotoPreview(user?.photoUrl ?? '');
    }
  };

  const handleSaveProfile = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!profileName.trim()) return;
    if (profileLocation && !/^\d{5}$/.test(profileLocation)) {
      toast.error('ZIP code must be exactly 5 digits.');
      return;
    }
    setIsSaving(true);
    try {
      await updateProfile({
        name: profileName.trim(),
        location: profileLocation.trim() || null,
        phone: profilePhone.trim() || null,
        photoUrl: photoPreview || null,
      });
      setProfileOpen(false);
      toast.success('Profile updated!');
    } catch {
      toast.error('Failed to save profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'IN_REVIEW': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'AWARDED': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'COMPLETED': return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (!isLoaded || !user) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-primary">FixMyHome</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Welcome, <strong>{user.name}</strong>
            </span>
            <ThemeToggle />
            <Link href="/notifications" title="Notifications">
              <Button variant="ghost" size="sm" className="relative">
                <Bell className="w-4 h-4" />
                {notifUnread > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center leading-none">
                    {notifUnread > 9 ? '9+' : notifUnread}
                  </span>
                )}
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: '/' })}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Homeowner Dashboard</h2>
          <p className="text-muted-foreground">
            Manage your home repair jobs and connect with local handymen
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <Link href="/jobs?status=active">
            <Card className="hover:shadow-md transition-shadow cursor-pointer hover:border-blue-300 dark:hover:border-blue-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Jobs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{jobs.filter(j => j.status === 'OPEN' || j.status === 'IN_REVIEW').length}</div>
                <p className="text-xs text-muted-foreground mt-1">Open &amp; in review</p>
              </CardContent>
            </Card>
          </Link>
          <Link href="/jobs">
            <Card className="hover:shadow-md transition-shadow cursor-pointer hover:border-blue-300 dark:hover:border-blue-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Bids</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{jobs.reduce((sum, j) => sum + j._count.bids, 0)}</div>
                <p className="text-xs text-muted-foreground mt-1">Across all jobs</p>
              </CardContent>
            </Card>
          </Link>
          <Link href="/jobs?status=AWARDED">
            <Card className="hover:shadow-md transition-shadow cursor-pointer hover:border-blue-300 dark:hover:border-blue-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">In Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{jobs.filter(j => j.status === 'AWARDED').length}</div>
                <p className="text-xs text-muted-foreground mt-1">Handyman awarded</p>
              </CardContent>
            </Card>
          </Link>
          <Link href="/jobs?status=COMPLETED">
            <Card className="hover:shadow-md transition-shadow cursor-pointer hover:border-blue-300 dark:hover:border-blue-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{jobs.filter(j => j.status === 'COMPLETED').length}</div>
                <p className="text-xs text-muted-foreground mt-1">Jobs finished</p>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Profile Card */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                  {user.photoUrl ? (
                    <img src={user.photoUrl} alt={user.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-primary font-bold text-2xl">{user.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <CardTitle>{user.name}</CardTitle>
                  <CardDescription>{user.email}</CardDescription>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={openProfileDialog}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit Profile
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 flex-shrink-0" />
                <span>{user.location ? `ZIP: ${user.location}` : 'No ZIP code set'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 flex-shrink-0" />
                <span>{user.phone || 'No phone number set'}</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 flex-shrink-0" />
                <span className="capitalize">{user.role?.toLowerCase() ?? 'Homeowner'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-2">
                <PlusCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle>Post a New Job</CardTitle>
              <CardDescription>Describe your project and get competitive bids</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/jobs/new">
                <Button className="w-full">Create Job Post</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="relative w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-2">
                <Briefcase className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle>My Jobs</CardTitle>
              <CardDescription>View and manage all your jobs</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/jobs">
                <Button variant="outline" className="w-full">View All Jobs</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="relative w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mb-2">
                <MessageSquare className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <CardTitle>Messages</CardTitle>
              <CardDescription>Chat with handymen</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/messages">
                <Button variant="outline" className="w-full">View Messages</Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Recent Jobs */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Your Jobs</CardTitle>
                <CardDescription>Recent job postings and their status</CardDescription>
              </div>
              <Link href="/jobs">
                <Button variant="outline" size="sm">View All</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {jobsPending ? (
              <div className="space-y-4">
                {[1, 2].map(i => (
                  <div key={i} className="border rounded-lg p-4 space-y-2">
                    <Skeleton className="h-6 w-52" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-8 w-24" />
                  </div>
                ))}
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-12">
                <Briefcase className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No jobs yet</h3>
                <p className="text-muted-foreground mb-4">Get started by posting your first job</p>
                <Link href="/jobs/new">
                  <Button>
                    <PlusCircle className="w-4 h-4 mr-2" />
                    Post Your First Job
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-lg">{job.title}</h3>
                          <Badge className={getStatusColor(job.status)}>
                            {job.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                          {job.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-3">
                      <div className="flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        <span className="font-medium">{formatCurrency(job.budget)} budget</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        <span>{job.location}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>{formatRelativeTime(job.createdAt.toString())}</span>
                      </div>
                      {job._count.bids > 0 && (
                        <div className="flex items-center gap-1">
                          <Briefcase className="w-4 h-4" />
                          <span className="font-medium text-primary">
                            {job._count.bids} {job._count.bids === 1 ? 'bid' : 'bids'} received
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Link href={`/jobs/${job.id}`}>
                        <Button variant="outline" size="sm">View Details</Button>
                      </Link>
                      {job._count.bids > 0 && (job.status === 'OPEN' || job.status === 'IN_REVIEW') && (
                        <Link href={`/jobs/${job.id}`}>
                          <Button size="sm">Review Bids ({job._count.bids})</Button>
                        </Link>
                      )}
                      {job.status === 'AWARDED' && (
                        <Link href={`/jobs/${job.id}`}>
                          <Button size="sm" variant="outline">Mark Complete</Button>
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Profile Dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>
              Update your name, ZIP code, and contact phone number.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveProfile} className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-3">
              <div
                className="relative w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden cursor-pointer group"
                onClick={() => fileInputRef.current?.click()}
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-primary font-bold text-3xl">
                    {profileName.charAt(0).toUpperCase() || user.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                  <Camera className="w-5 h-5 text-white" />
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                aria-label="Upload profile photo"
                onChange={handlePhotoChange}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  {photoPreview ? 'Change photo' : 'Upload photo'} (JPG, PNG, WebP · max 5 MB)
                </button>
                {photoPreview && (
                  <button
                    type="button"
                    onClick={() => { setPhotoPreview(''); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-name">Full Name <span className="text-red-500">*</span></Label>
              <Input
                id="profile-name"
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                placeholder="Jane Smith"
                disabled={isSaving}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-location">ZIP Code</Label>
              <Input
                id="profile-location"
                value={profileLocation}
                onChange={e => setProfileLocation(e.target.value)}
                placeholder="33139"
                maxLength={5}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">ZIP code — used to match local handymen</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-phone">Phone Number</Label>
              <Input
                id="profile-phone"
                type="tel"
                value={profilePhone}
                onChange={e => setProfilePhone(e.target.value)}
                placeholder="(305) 555-0100"
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">Optional — only shared with handymen you hire</p>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setProfileOpen(false)} disabled={isSaving || isPhotoUploading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving || isPhotoUploading}>
                {isSaving ? 'Saving...' : isPhotoUploading ? 'Uploading photo...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
