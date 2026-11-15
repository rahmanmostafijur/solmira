import { z } from 'zod';

/** In-app notifications belong to the organization: one read marks them read for every member. */

/**
 * One notification as `GET /notifications` lists it. Named a view so it never shadows the DOM's
 * Notification in browser code.
 */
export const notificationViewSchema = z.object({
  id: z.uuid(),
  /** `endpoint.auto_disabled` today; clients must tolerate types added later. */
  type: z.string(),
  title: z.string(),
  body: z.string(),
  /** What the notification is about, by type: `endpointId` and `applicationId` for an endpoint. */
  data: z.unknown(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type NotificationView = z.infer<typeof notificationViewSchema>;

export const readAllNotificationsResultSchema = z.object({
  /** How many unread notifications the call marked read; 0 when there were none. */
  updated: z.number().int().min(0),
});
export type ReadAllNotificationsResult = z.infer<typeof readAllNotificationsResultSchema>;
