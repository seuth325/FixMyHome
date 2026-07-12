import { z } from 'zod';
import { MIN_RATING, MAX_RATING } from '@/lib/constants';

export const createReviewSchema = z.object({
  stars: z
    .number()
    .int()
    .min(MIN_RATING, 'Please select a rating')
    .max(MAX_RATING, 'Rating cannot exceed 5 stars'),

  text: z
    .string()
    .min(20, 'Please write at least 20 characters')
    .max(1000, 'Review must be less than 1000 characters'),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
