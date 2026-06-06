import { z } from 'zod';

export const AchievementDocSchema = z.object({
  achId: z.string().min(1),
  mid: z.string().min(1),
  fid: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  programKey: z.string().nullable(),
  awardedByUid: z.string().min(1),
  awardedByName: z.string().nullable(),
  awardedAt: z.date(),
});
export type AchievementDoc = z.infer<typeof AchievementDocSchema>;

// API input for POST /api/setu/teacher/achievements. The server stamps
// achId/awardedBy*/awardedAt; the client supplies the rest.
export const AwardAchievementSchema = z.object({
  mid: z.string().min(1),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  programKey: z.string().trim().min(1).max(60).nullable().optional().default(null),
});
export type AwardAchievementInput = z.infer<typeof AwardAchievementSchema>;
