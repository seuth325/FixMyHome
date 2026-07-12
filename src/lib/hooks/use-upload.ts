'use client';

import { useState, useCallback } from 'react';
import { genUploader } from 'uploadthing/client';
import type { OurFileRouter } from '@/lib/uploadthing';

const { uploadFiles } = genUploader<OurFileRouter>();

/** Upload a single profile photo; returns the CDN URL or null on failure. */
export function useUploadProfilePhoto() {
  const [isUploading, setIsUploading] = useState(false);

  const uploadPhoto = useCallback(async (file: File): Promise<string | null> => {
    setIsUploading(true);
    try {
      const [result] = await uploadFiles('profilePhoto', { files: [file] });
      return result?.ufsUrl ?? null;
    } catch {
      return null;
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { uploadPhoto, isUploading };
}

/** Upload up to 5 job photos; returns an array of CDN URLs. */
export function useUploadJobPhotos() {
  const [isUploading, setIsUploading] = useState(false);

  const uploadPhotos = useCallback(async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];
    setIsUploading(true);
    try {
      const results = await uploadFiles('jobPhotos', { files });
      return results.map(r => r.ufsUrl);
    } catch {
      return [];
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { uploadPhotos, isUploading };
}
