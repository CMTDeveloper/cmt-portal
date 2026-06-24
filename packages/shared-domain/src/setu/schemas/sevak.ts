import { z } from 'zod';

// The two roles an admin can grant/revoke through the Users & Roles screen.
// Teacher is read-only here (managed via /admin/levels), and family roles are
// derived from family membership — neither is grantable through this surface.
export const GRANTABLE_ROLES = ['admin', 'welcome-team'] as const;
export const GrantableRoleSchema = z.enum(GRANTABLE_ROLES);
export type GrantableRole = z.infer<typeof GrantableRoleSchema>;

// One deduped sevak in the merged listSevaks() view.
export const SevakRowSchema = z.object({
  key: z.string().min(1), // mid when known, else tid, else uid — dedupe key
  mid: z.string().nullable(),
  fid: z.string().nullable(),
  uid: z.string().nullable(),
  name: z.string().min(1),
  contact: z.string(), // email/phone for display + revoke routing
  roles: z.array(GrantableRoleSchema), // effective admin/welcome-team grants, deduped
  isTeacher: z.boolean(),
  teacherLevels: z.array(z.string()),
  source: z.enum(['family', 'staff']),
  lastSignIn: z.string().nullable(), // ISO of the person's most recent auth sign-in; null = never
});
export type SevakRow = z.infer<typeof SevakRowSchema>;

export const GrantRoleBodySchema = z.object({
  contact: z.string().min(1), // email or phone
  role: GrantableRoleSchema,
});
export type GrantRoleBody = z.infer<typeof GrantRoleBodySchema>;

export const RevokeRoleBodySchema = z.object({
  contact: z.string().min(1),
  role: GrantableRoleSchema,
});
export type RevokeRoleBody = z.infer<typeof RevokeRoleBodySchema>;

export const SevakListResponseSchema = z.object({ sevaks: z.array(SevakRowSchema) });
export type SevakListResponse = z.infer<typeof SevakListResponseSchema>;
