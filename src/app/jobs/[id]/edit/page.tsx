'use client';

import { use, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createJobSchema, type CreateJobInput } from '@/lib/validations/job';
import { JOB_CATEGORIES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, Pencil, Camera, X } from 'lucide-react';
import Link from 'next/link';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { useUploadJobPhotos } from '@/lib/hooks/use-upload';

type JobForEdit = {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  budget: number;
  status: string;
  preferredDate: string | null;
  photos: { id: string; url: string }[];
};

async function fetchJob(id: string): Promise<JobForEdit> {
  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error('Not found');
  return res.json();
}

export default function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: job, isPending } = useQuery({
    queryKey: ['job', id],
    queryFn: () => fetchJob(id),
    staleTime: 60_000,
  });

  const [photoPreviews, setPhotoPreviews] = useState<string[]>(
    job?.photos.map(p => p.url) ?? []
  );
  const photoInputRef = useRef<HTMLInputElement>(null);
  const { uploadPhotos, isUploading: isPhotoUploading } = useUploadJobPhotos();

  const updateJob = useMutation({
    mutationFn: async (data: CreateJobInput) => {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          preferredDate: data.preferredDate ? new Date(data.preferredDate).toISOString() : null,
          photoUrls: photoPreviews,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to update');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', id] });
      queryClient.invalidateQueries({ queryKey: ['my-jobs'] });
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateJobInput>({
    resolver: zodResolver(createJobSchema),
    defaultValues: job
      ? {
          title: job.title,
          description: job.description,
          category: job.category as CreateJobInput['category'],
          location: job.location,
          budget: job.budget,
          preferredDate: job.preferredDate ? new Date(job.preferredDate) : undefined,
        }
      : undefined,
  });

  const selectedCategory = watch('category');

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const remaining = 5 - photoPreviews.length;
    const toUpload = files.slice(0, remaining);
    e.target.value = '';
    if (toUpload.length === 0) return;
    const localUrls = toUpload.map(f => URL.createObjectURL(f));
    setPhotoPreviews(prev => [...prev, ...localUrls]);
    const cdnUrls = await uploadPhotos(toUpload);
    if (cdnUrls.length > 0) {
      setPhotoPreviews(prev => {
        const without = prev.filter(u => !localUrls.includes(u));
        return [...without, ...cdnUrls];
      });
    } else {
      toast.error('Photo upload failed. Please try again.');
      setPhotoPreviews(prev => prev.filter(u => !localUrls.includes(u)));
    }
  };

  const removePhoto = (index: number) => {
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: CreateJobInput) => {
    try {
      await updateJob.mutateAsync(data);
      toast.success('Job updated successfully!');
      router.push(`/jobs/${id}`);
    } catch {
      toast.error('Failed to update job. Please try again.');
    }
  };

  if (isPending) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b">
          <div className="container mx-auto px-4 py-4">
            <Link href="/jobs">
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
            </Link>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">Job Not Found</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <Link href={`/jobs/${id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Job
            </Button>
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Breadcrumb
          items={[
            { label: 'My Jobs', href: '/jobs' },
            { label: job.title, href: `/jobs/${id}` },
            { label: 'Edit' },
          ]}
        />
        <div className="mb-6 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
            <Pencil className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Edit Job</h1>
            <p className="text-muted-foreground">Update the details for this job posting</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Job Details</CardTitle>
            <CardDescription>Make your changes below — only open jobs can be edited</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">Job Title <span className="text-red-500">*</span></Label>
                <Input id="title" {...register('title')} disabled={updateJob.isPending} />
                {errors.title && <p className="text-sm text-red-500">{errors.title.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description <span className="text-red-500">*</span></Label>
                <Textarea id="description" rows={6} {...register('description')} disabled={updateJob.isPending} />
                {errors.description && <p className="text-sm text-red-500">{errors.description.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category <span className="text-red-500">*</span></Label>
                <Select
                  value={selectedCategory}
                  onValueChange={(value) => setValue('category', value as CreateJobInput['category'])}
                  disabled={updateJob.isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category && <p className="text-sm text-red-500">{errors.category.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">ZIP Code <span className="text-red-500">*</span></Label>
                <Input id="location" maxLength={5} {...register('location')} disabled={updateJob.isPending} />
                {errors.location && <p className="text-sm text-red-500">{errors.location.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="budget">Budget (USD) <span className="text-red-500">*</span></Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input id="budget" type="number" className="pl-7" {...register('budget', { valueAsNumber: true })} disabled={updateJob.isPending} />
                </div>
                {errors.budget && <p className="text-sm text-red-500">{errors.budget.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="preferredDate">Preferred Start Date (Optional)</Label>
                <Input
                  id="preferredDate"
                  type="date"
                  min={new Date().toISOString().split('T')[0]}
                  {...register('preferredDate', { valueAsDate: true })}
                  disabled={updateJob.isPending}
                />
              </div>

              <div className="space-y-2">
                <Label>Photos <span className="text-muted-foreground font-normal">(Optional, up to 5)</span></Label>
                <p className="text-xs text-muted-foreground">
                  Add or remove photos to help handymen understand the scope of work.
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {photoPreviews.map((preview, i) => (
                    <div key={i} className="relative group aspect-square">
                      <img
                        src={preview}
                        alt={`Photo ${i + 1}`}
                        className="w-full h-full object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove photo"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                  {photoPreviews.length < 5 && (
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={updateJob.isPending}
                      className="aspect-square border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Camera className="w-5 h-5" />
                      <span className="text-xs">Add photo</span>
                    </button>
                  )}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  aria-label="Upload job photos"
                  onChange={handlePhotoChange}
                />
              </div>

              <div className="flex gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => router.back()} disabled={updateJob.isPending || isPhotoUploading} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={updateJob.isPending || isPhotoUploading} className="flex-1">
                  {updateJob.isPending ? 'Saving...' : isPhotoUploading ? 'Uploading photos...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
