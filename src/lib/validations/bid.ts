import { z } from 'zod';
import { MIN_BUDGET, MAX_BUDGET } from '@/lib/constants';

export const createBidSchema = z.object({
  amount: z
    .number()
    .min(MIN_BUDGET, `Bid must be at least $${MIN_BUDGET}`)
    .max(MAX_BUDGET, `Bid cannot exceed $${MAX_BUDGET}`),

  message: z
    .string()
    .min(30, 'Please provide at least 30 characters describing your approach')
    .max(1000, 'Message must be less than 1000 characters'),

  etaDays: z
    .number()
    .int('Must be a whole number')
    .min(1, 'Minimum 1 day')
    .max(90, 'Maximum 90 days'),
});

export type CreateBidInput = z.infer<typeof createBidSchema>;
