import { z } from 'zod';

/** In-app notifications belong to the organization: one read marks them read for every member. */

export const readAllNotificationsResultSchema = z.object({
  /** How many unread notifications the call marked read; 0 when there were none. */
  updated: z.number().int().min(0),
});
export type ReadAllNotificationsResult = z.infer<typeof readAllNotificationsResultSchema>;
