import { z } from 'zod';

const FamilyManagerClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('family-manager'),
  fid: z.string(),
  mid: z.string(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

const FamilyMemberClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('family-member'),
  fid: z.string(),
  mid: z.string(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

const WelcomeTeamClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('welcome-team'),
  fid: z.string().optional(),
  mid: z.string().optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

// Legacy roles — preserved for /check-in/* compat
const LegacyFamilyClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('family'),
  familyId: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

const LegacyTeacherClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('teacher'),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

const LegacyAdminClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('admin'),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export const SetuSessionClaimsSchema = z.discriminatedUnion('role', [
  FamilyManagerClaimsSchema,
  FamilyMemberClaimsSchema,
  WelcomeTeamClaimsSchema,
  LegacyFamilyClaimsSchema,
  LegacyTeacherClaimsSchema,
  LegacyAdminClaimsSchema,
]);

export type SetuSessionClaims = z.infer<typeof SetuSessionClaimsSchema>;
