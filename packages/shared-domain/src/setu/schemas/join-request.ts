import { z } from 'zod';

// A member→manager request to join a family, written by the open lookup
// "request to join" flow at families/{fid}/joinRequests/{token}. A manager
// approves (promotes the matched member to co-manager) or declines.
export const JoinRequestDocSchema = z.object({
  token: z.string(),
  fid: z.string(),
  matchedMid: z.string(),
  requesterEmail: z.string(),
  requesterPhone: z.string().optional(),
  requesterName: z.string().optional(),
  status: z.enum(['pending', 'approved', 'declined']),
  createdAt: z.date(),
  expiresAt: z.date(),
});

export type JoinRequestDoc = z.infer<typeof JoinRequestDocSchema>;
