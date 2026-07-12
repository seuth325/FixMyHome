'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCreateJob } from '@/lib/hooks/use-jobs';
import { createJobSchema, type CreateJobInput } from '@/lib/validations/job';
import { JOB_CATEGORIES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, Briefcase, Sparkles, Loader2, X, Camera } from 'lucide-react';
import Link from 'next/link';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { generateJobDescription } from '@/lib/ai/description-generator';
import { useUploadJobPhotos } from '@/lib/hooks/use-upload';

export default function NewJobPage() {
  const router = useRouter();
  const createJob = useCreateJob();
  const isSubmitting = createJob.isPending;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateJobInput>({
    resolver: zodResolver(createJobSchema),
  });

  const selectedCategory = watch('category');
  const titleValue = watch('title');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiDraftVisible, setAiDraftVisible] = useState(false);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const { uploadPhotos, isUploading: isPhotoUploading } = useUploadJobPhotos();

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const remaining = 5 - photoPreviews.length;
    const toUpload = files.slice(0, remaining);
    e.target.value = '';
    if (toUpload.length === 0) return;
    // Show local previews immediately
    const localUrls = toUpload.map(f => URL.createObjectURL(f));
    setPhotoPreviews(prev => [...prev, ...localUrls]);
    // Upload and replace with CDN URLs
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

  const handleGenerate = async () => {
    if (!titleValue?.trim() || !selectedCategory) return;
    setIsGenerating(true);
    setAiDraftVisible(false);
    try {
      const { text } = await generateJobDescription(titleValue.trim(), selectedCategory);
      setValue('description', text, { shouldValidate: true });
      setAiDraftVisible(true);
      toast.success('Description generated!', {
        description: 'Review the draft and personalize the bracketed sections.',
      });
    } catch {
      toast.error('Generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const onSubmit = async (data: CreateJobInput) => {
    try {
      await createJob.mutateAsync({
        ...data,
        preferredDate: data.preferredDate ? new Date(data.preferredDate) : undefined,
        photoUrls: photoPreviews,
      });
      toast.success('Job posted successfully!', {
        description: 'Handymen in your area can now submit bids.',
      });
      router.push('/homeowner/dashboard');
    } catch {
      toast.error('Failed to post job. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <Link href="/homeowner/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Breadcrumb
          items={[
            { label: 'My Jobs', href: '/jobs' },
            { label: 'Post New Job' },
          ]}
        />
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
              <Briefcase className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Post a New Job</h1>
              <p className="text-muted-foreground">
                Describe your project and receive competitive bids from local handymen
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Job Details</CardTitle>
            <CardDescription>
              Provide as much detail as possible to get accurate bids
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title">
                  Job Title <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="title"
                  placeholder="e.g., Fix leaky kitchen faucet"
                  {...register('title')}
                  disabled={isSubmitting}
                />
                {errors.title && (
                  <p className="text-sm text-red-500">{errors.title.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Be specific and clear about what you need done
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="description">
                    Description <span className="text-red-500">*</span>
                  </Label>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!titleValue?.trim() || !selectedCategory || isGenerating || isSubmitting}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border transition-colors
                      bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100
                      dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800 dark:hover:bg-violet-900
                      disabled:opacity-40 disabled:cursor-not-allowed"
                    title={!titleValue?.trim() || !selectedCategory ? 'Enter a title and select a category first' : 'Generate a description draft with AI'}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Generate with AI
                      </>
                    )}
                  </button>
                </div>
                <Textarea
                  id="description"
                  placeholder="Describe the work needed in detail. Include any relevant information about the problem, location, access requirements, etc."
                  rows={aiDraftVisible ? 12 : 6}
                  {...register('description')}
                  disabled={isSubmitting || isGenerating}
                  className="font-mono text-sm leading-relaxed"
                />
                {errors.description && (
                  <p className="text-sm text-red-500">{errors.description.message}</p>
                )}
                {aiDraftVisible && (
                  <div className="flex items-start gap-2 text-xs text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950 border border-violet-200 dark:border-violet-800 rounded-md px-3 py-2">
                    <Sparkles className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span className="flex-1">
                      <strong>AI draft</strong> — fill in the bracketed sections with your specific details, then remove the brackets before posting.
                    </span>
                    <button
                      type="button"
                      onClick={() => setAiDraftVisible(false)}
                      className="text-violet-400 hover:text-violet-600 dark:hover:text-violet-200 flex-shrink-0"
                      aria-label="Dismiss notice"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {!aiDraftVisible && (
                  <p className="text-xs text-muted-foreground">
                    Minimum 50 characters. The more detail you provide, the better the bids you'll receive.
                  </p>
                )}
              </div>

              {/* Category */}
              <div className="space-y-2">
                <Label htmlFor="category">
                  Category <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={selectedCategory}
                  onValueChange={(value) => setValue('category', value as any)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category && (
                  <p className="text-sm text-red-500">{errors.category.message}</p>
                )}
              </div>

              {/* Location */}
              <div className="space-y-2">
                <Label htmlFor="location">
                  ZIP Code <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="location"
                  placeholder="33139"
                  maxLength={5}
                  {...register('location')}
                  disabled={isSubmitting}
                />
                {errors.location && (
                  <p className="text-sm text-red-500">{errors.location.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Your Florida ZIP code (handymen will see jobs in their service area)
                </p>
              </div>

              {/* Budget */}
              <div className="space-y-2">
                <Label htmlFor="budget">
                  Budget (USD) <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="budget"
                    type="number"
                    placeholder="300"
                    className="pl-7"
                    {...register('budget', { valueAsNumber: true })}
                    disabled={isSubmitting}
                  />
                </div>
                {errors.budget && (
                  <p className="text-sm text-red-500">{errors.budget.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Set your maximum budget. Handymen can bid at or below this amount.
                </p>
              </div>

              {/* Preferred Date */}
              <div className="space-y-2">
                <Label htmlFor="preferredDate">
                  Preferred Start Date (Optional)
                </Label>
                <Input
                  id="preferredDate"
                  type="date"
                  min={new Date().toISOString().split('T')[0]}
                  {...register('preferredDate', { valueAsDate: true })}
                  disabled={isSubmitting}
                />
                {errors.preferredDate && (
                  <p className="text-sm text-red-500">{errors.preferredDate.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  When would you like the work to begin?
                </p>
              </div>

              {/* Photo Upload */}
              <div className="space-y-2">
                <Label>Photos <span className="text-muted-foreground font-normal">(Optional, up to 5)</span></Label>
                <p className="text-xs text-muted-foreground">
                  Add photos to help handymen understand the scope of work and provide more accurate bids.
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
                      disabled={isSubmitting}
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

              {/* Submit Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || isPhotoUploading}
                  className="flex-1"
                >
                  {isSubmitting ? 'Posting...' : isPhotoUploading ? 'Uploading photos...' : 'Post Job'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Tips Card */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Tips for Getting Great Bids</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="flex gap-2">
              <span className="text-blue-600 dark:text-blue-400">✓</span>
              <p>Be specific about the problem and what needs to be fixed</p>
            </div>
            <div className="flex gap-2">
              <span className="text-blue-600 dark:text-blue-400">✓</span>
              <p>Mention any relevant details like room size, materials needed, or access issues</p>
            </div>
            <div className="flex gap-2">
              <span className="text-blue-600 dark:text-blue-400">✓</span>
              <p>Set a realistic budget based on the scope of work</p>
            </div>
            <div className="flex gap-2">
              <span className="text-blue-600 dark:text-blue-400">✓</span>
              <p>Add photos — jobs with photos receive 3× more bids and more accurate quotes</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
