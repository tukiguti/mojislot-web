import { z } from 'zod';

export const ReelStripSchema = z.object({
  id: z.string(),
  cells: z.array(z.string()).length(10),
});

export const ReelConfigSchema = z.object({
  mode: z.string(),
  reels: z.array(ReelStripSchema).length(3),
});

export type ReelStrip = z.infer<typeof ReelStripSchema>;
export type ReelConfig = z.infer<typeof ReelConfigSchema>;
