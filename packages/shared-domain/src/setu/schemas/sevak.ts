import { z } from 'zod';

// The two roles an admin can grant/revoke through the Users & Roles screen.
// Teacher is read-only here (managed via /admin/levels), and family roles are
// derived from family membership — neither is grantable through this surface.
export const GRANTABLE_ROLES = ['admin', 'welcome-team'] as const;
export const GrantableRoleSchema = z.enum(GRANTABLE_ROLES);
export type GrantableRole = z.infer<typeof GrantableRoleSchema>;

// One deduped staff person in the merged listStaff() view.
export const StaffRowSchema = z.object({
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
});
export type StaffRow = z.infer<typeof StaffRowSchema>;

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

export const StaffListResponseSchema = z.object({ staff: z.array(StaffRowSchema) });
export type StaffListResponse = z.infer<typeof StaffListResponseSchema>;
