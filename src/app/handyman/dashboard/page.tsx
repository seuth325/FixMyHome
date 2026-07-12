'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { useBrowseJobs } from '@/lib/hooks/use-jobs';
import { useMyBids } from '@/lib/hooks/use-bids';
import { useQuery } from '@tanstack/react-query';
import { JOB_CATEGORIES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Search, Briefcase, MessageSquare, User, LogOut, DollarSign, Calendar,
  MapPin, Star, TrendingUp, Pencil, Camera, Phone, Navigation, Zap, Bell,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';
import { StarRating } from '@/components/ui/star-rating';
import { toast } from 'sonner';
import { useUploadProfilePhoto } from '@/lib/hooks/use-upload';

export default function HandymanDashboard() {
  const { user, isLoaded, updateProfile } = useCurrentUser();
  const { data: browseJobs = [] } = useBrowseJobs();
  const { data: myBids = [] } = useMyBids();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const { uploadPhoto, isUploading: isPhotoUploading } = useUploadProfilePhoto();
  const [profileOpen, setProfileOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [formName, setFormName] = useState('');
  const [formBusiness, setFormBusiness] = useState('');
  const [formBio, setFormBio] = useState('');
  const [formSkills, setFormSkills] = useState<string[]>([]);
  const [formRadius, setFormRadius] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formZip, setFormZip] = useState('');
  const [formPhone, setFormPhone] = useState('');

  const hp = user?.handymanProfile;
  const displaySkills = hp?.skills ?? [];
  const displayBio = hp?.bio;
  const displayBusinessName = hp?.businessName;
  const displayRadius = hp?.serviceRadius;
  const displayRate = hp?.hourlyRate ? Number(hp.hourlyRate) : null;
  const displayRating = Number(hp?.ratingAvg ?? 0);
  const displayRatingCount = hp?.ratingCount ?? 0;

  const activeBids = myBids.filter(b => b.status === 'PENDING').length;
  const jobsWon = myBids.filter(b => b.status === 'ACCEPTED').length;

  const openProfileDialog = () => {
    setFormName(user?.name ?? '');
    setFormBusiness(hp?.businessName ?? '');
    setFormBio(hp?.bio ?? '');
    setFormSkills(hp?.skills ?? []);
    setFormRadius(String(hp?.serviceRadius ?? ''));
    setFormRate(String(hp?.hourlyRate ? Number(hp.hourlyRate) : ''));
    setFormZip(user?.location ?? '');
    setFormPhone(user?.phone ?? '');
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
    setPhotoPreview(URL.createObjectURL(file));
    const url = await uploadPhoto(file);
    if (url) {
      setPhotoPreview(url);
    } else {
      toast.error('Photo upload failed. Please try again.');
      setPhotoPreview(user?.photoUrl ?? '');
    }
  };

  const toggleSkill = (skill: string) => {
    setFormSkills(prev =>
      prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
    );
  };

  const handleSaveProfile = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formName.trim()) return;
    if (formZip && !/^\d{5}$/.test(formZip)) {
      toast.error('ZIP code must be exactly 5 digits.');
      return;
    }
    const radius = formRadius ? parseInt(formRadius) : undefined;
    const rate = formRate ? parseFloat(formRate) : undefined;
    if (radius !== undefined && (isNaN(radius) || radius < 1 || radius > 200)) {
      toast.error('Service radius must be between 1 and 200 miles.');
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({
        name: formName.trim(),
        location: formZip.trim() || null,
        phone: formPhone.trim() || null,
        photoUrl: photoPreview || null,
        handymanProfile: {
          businessName: formBusiness.trim() || null,
          bio: formBio.trim() || null,
          skills: formSkills,
          serviceRadius: radius ?? hp?.serviceRadius ?? 25,
          hourlyRate: rate && !isNaN(rate) ? rate : null,
        },
      });
      setProfileOpen(false);
      toast.success('Profile updated!', { description: 'Your public profile has been refreshed.' });
    } catch {
      toast.error('Failed to save profile.');
    } finally {
      setIsSaving(false);
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
          <h2 className="text-3xl font-bold mb-2">Handyman Dashboard</h2>
          <p className="text-muted-foreground">Browse jobs, submit bids, and grow your business</p>
        </div>

        {/* Profile Card */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative flex-shrink-0">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                    {user.photoUrl ? (
                      <img src={user.photoUrl} alt={user.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-primary font-bold text-3xl">{user.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                </div>
                <div>
                  <CardTitle className="text-xl">{user.name}</CardTitle>
                  {displayBusinessName && (
                    <p className="text-sm text-muted-foreground">{displayBusinessName}</p>
                  )}
                  {displayRatingCount > 0 && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <StarRating value={Math.round(displayRating)} readonly size="sm" />
                      <span className="text-xs text-muted-foreground">
                        {displayRating.toFixed(1)} ({displayRatingCount} reviews)
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={openProfileDialog}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit Profile
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground mb-3">
              {user.location && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" />
                  <span>ZIP {user.location}</span>
                </div>
              )}
              {displayRadius && (
                <div className="flex items-center gap-1.5">
                  <Navigation className="w-4 h-4" />
                  <span>Serves within {displayRadius} miles</span>
                </div>
              )}
              {displayRate && (
                <div className="flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4" />
                  <span>{formatCurrency(displayRate)}/hr</span>
                </div>
              )}
              {user.phone && (
                <div className="flex items-center gap-1.5">
                  <Phone className="w-4 h-4" />
                  <span>{user.phone}</span>
                </div>
              )}
            </div>
            {displayBio && (
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{displayBio}</p>
            )}
            {displaySkills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {displaySkills.map(skill => (
                  <Badge key={skill} variant="secondary" className="text-xs">{skill}</Badge>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  id="availability"
                  checked={user.isAvailable ?? true}
                  onCheckedChange={(checked) => updateProfile({ isAvailable: checked })}
                />
                <label htmlFor="availability" className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                  <Zap className={`w-3.5 h-3.5 ${(user.isAvailable ?? true) ? 'text-green-500' : 'text-muted-foreground'}`} />
                  <span className={(user.isAvailable ?? true) ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}>
                    {(user.isAvailable ?? true) ? 'Available for work' : 'Not available'}
                  </span>
                </label>
              </div>
              <Link href={`/profile/${user.id}`}>
                <Button variant="link" className="p-0 h-auto text-xs text-muted-foreground hover:text-primary">
                  View public profile →
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Bids</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{activeBids}</div>
              <p className="text-xs text-muted-foreground mt-1">Waiting for responses</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Jobs Won</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{jobsWon}</div>
              <p className="text-xs text-muted-foreground mt-1">Total jobs awarded</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Average Rating</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div className="text-2xl font-bold">
                  {displayRatingCount > 0 ? displayRating.toFixed(1) : '--'}
                </div>
                {displayRatingCount > 0 && <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {displayRatingCount > 0 ? `From ${displayRatingCount} reviews` : 'No reviews yet'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-2">
                <Search className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle>Browse Jobs</CardTitle>
              <CardDescription>Find jobs in your area</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/browse"><Button className="w-full">Find Work</Button></Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="relative w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-2">
                <Briefcase className="w-6 h-6 text-green-600 dark:text-green-400" />
                {jobsWon > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-green-500 text-white text-xs flex items-center justify-center font-bold leading-none">
                    {jobsWon > 9 ? '9+' : jobsWon}
                  </span>
                )}
              </div>
              <CardTitle>My Bids</CardTitle>
              <CardDescription>Track your submissions</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/bids"><Button variant="outline" className="w-full">View Bids</Button></Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="relative w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mb-2">
                <MessageSquare className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <CardTitle>Messages</CardTitle>
              <CardDescription>Chat with homeowners</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/messages"><Button variant="outline" className="w-full">Inbox</Button></Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center mb-2">
                <User className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <CardTitle>My Profile</CardTitle>
              <CardDescription>View public profile</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/profile/${user.id}`}>
                <Button variant="outline" className="w-full">View Profile</Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Available Jobs */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Available Jobs</CardTitle>
                <CardDescription>Recent job postings you can bid on</CardDescription>
              </div>
              <Link href="/browse">
                <Button variant="outline" size="sm">Browse All</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {browseJobs.length === 0 ? (
              <div className="text-center py-12">
                <Search className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No jobs available yet</h3>
                <Link href="/browse"><Button><Search className="w-4 h-4 mr-2" />Browse All Jobs</Button></Link>
              </div>
            ) : (
              <div className="space-y-4">
                {browseJobs.slice(0, 5).map((job) => (
                  <div key={job.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-lg">{job.title}</h3>
                          <Badge variant="outline" className="text-xs">{job.category}</Badge>
                          {job.myBid && (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                              Bid Submitted
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{job.description}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-3">
                      <div className="flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        <span className="font-medium text-primary">{formatCurrency(job.budget)} budget</span>
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
                          <TrendingUp className="w-4 h-4" />
                          <span>{job._count.bids} {job._count.bids === 1 ? 'bid' : 'bids'} submitted</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {job.myBid ? (
                        <>
                          <Link href="/bids">
                            <Button variant="outline" size="sm">View My Bid ({formatCurrency(job.myBid.amount)})</Button>
                          </Link>
                          <Link href={`/jobs/${job.id}`}>
                            <Button variant="outline" size="sm">View Details</Button>
                          </Link>
                        </>
                      ) : (
                        <>
                          <Link href={`/jobs/${job.id}/bid`}><Button size="sm">Submit Bid</Button></Link>
                          <Link href={`/jobs/${job.id}`}><Button variant="outline" size="sm">View Details</Button></Link>
                        </>
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
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>
              Update your public profile. Changes are visible to homeowners browsing your work.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveProfile} className="space-y-5 py-2">
            <div className="flex flex-col items-center gap-3">
              <div
                className="relative w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden cursor-pointer group"
                onClick={() => fileInputRef.current?.click()}
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-primary font-bold text-4xl">
                    {formName.charAt(0).toUpperCase() || user.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                  <Camera className="w-6 h-6 text-white" />
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
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove photo
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="h-name">Full Name <span className="text-red-500">*</span></Label>
              <Input id="h-name" value={formName} onChange={e => setFormName(e.target.value)} required disabled={isSaving} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="h-business">Business Name</Label>
              <Input id="h-business" value={formBusiness} onChange={e => setFormBusiness(e.target.value)} placeholder="Mike's Home Services" disabled={isSaving} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="h-bio">Bio</Label>
              <Textarea
                id="h-bio"
                value={formBio}
                onChange={e => setFormBio(e.target.value)}
                placeholder="Tell homeowners about your experience, specialties, and service area..."
                rows={4}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">{formBio.length} / 500 characters</p>
            </div>

            <div className="space-y-2">
              <Label>Skills &amp; Services</Label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-md bg-gray-50 dark:bg-gray-800/50">
                {JOB_CATEGORIES.map(skill => (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => toggleSkill(skill)}
                    disabled={isSaving}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      formSkills.includes(skill)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-white dark:bg-gray-800 text-muted-foreground border-gray-200 dark:border-gray-700 hover:border-primary hover:text-primary'
                    }`}
                  >
                    {skill}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{formSkills.length} selected</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="h-radius">Service Radius (miles)</Label>
                <Input
                  id="h-radius"
                  type="number"
                  min={1}
                  max={200}
                  value={formRadius}
                  onChange={e => setFormRadius(e.target.value)}
                  placeholder="25"
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="h-rate">Hourly Rate (USD)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="h-rate"
                    type="number"
                    min={1}
                    value={formRate}
                    onChange={e => setFormRate(e.target.value)}
                    placeholder="75"
                    className="pl-7"
                    disabled={isSaving}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="h-zip">ZIP Code</Label>
                <Input
                  id="h-zip"
                  value={formZip}
                  onChange={e => setFormZip(e.target.value)}
                  placeholder="33139"
                  maxLength={5}
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="h-phone">Phone Number</Label>
                <Input
                  id="h-phone"
                  type="tel"
                  value={formPhone}
                  onChange={e => setFormPhone(e.target.value)}
                  placeholder="(305) 555-0100"
                  disabled={isSaving}
                />
              </div>
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
