import { z } from 'zod';

export const sendMessageSchema = z.object({
  body: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(1000, 'Message must be less than 1000 characters'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
