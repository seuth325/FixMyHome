import { z } from 'zod';
import { JOB_CATEGORIES, MIN_BUDGET, MAX_BUDGET } from '@/lib/constants';

// Job creation validation schema
export const createJobSchema = z.object({
  title: z
    .string()
    .min(10, 'Title must be at least 10 characters')
    .max(100, 'Title must be less than 100 characters'),

  description: z
    .string()
    .min(50, 'Description must be at least 50 characters')
    .max(2000, 'Description must be less than 2000 characters'),

  category: z.enum(JOB_CATEGORIES as readonly [string, ...string[]], {
    error: 'Please select a category',
  }),

  location: z
    .string()
    .regex(/^\d{5}$/, 'Please enter a valid 5-digit ZIP code'),

  budget: z
    .number()
    .min(MIN_BUDGET, `Budget must be at least $${MIN_BUDGET}`)
    .max(MAX_BUDGET, `Budget cannot exceed $${MAX_BUDGET}`),

  preferredDate: z.date().optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

// Job update validation schema (allows partial updates)
export const updateJobSchema = createJobSchema.partial();

export type UpdateJobInput = z.infer<typeof updateJobSchema>;
