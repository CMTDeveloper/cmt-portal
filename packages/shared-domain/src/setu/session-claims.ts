import { z } from 'zod';
import { ROLES } from '../auth/role';

// extraRoles can carry any role string — capability stacks (e.g. a
// family-manager with admin access). Optional + permissive enum.
const ExtraRolesField = z.array(z.enum(ROLES)).optional();

const FamilyManagerClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('family-manager'),
  fid: z.string(),
  mid: z.string(),
  extraRoles: ExtraRolesField,
  iat: z.number().optional(),
  exp: z.number().optional(),
});

const FamilyMemberClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('family-member'),
  fid: z.string(),
  mid: z.string(),
  extraRoles: ExtraRolesField,
  iat: z.number().optional(),
  exp: z.number().optional(),
});

/**
 * A sevak role that does not require a family.
 *
 * `fid`/`mid` are OPTIONAL, and that is the whole point: a standalone volunteer
 * account has no family record at all, while the same grant held by a parent
 * arrives with the family role as primary and the sevak role in `extraRoles`.
 * Requiring a family here would lock out exactly the standalone accounts.
 */
function staffClaims<T extends string>(role: T) {
  return z.object({
    uid: z.string(),
    role: z.literal(role),
    fid: z.string().optional(),
    mid: z.string().optional(),
    extraRoles: ExtraRolesField,
    iat: z.number().optional(),
    exp: z.number().optional(),
  });
}

const WelcomeTeamClaimsSchema = staffClaims('welcome-team');

/**
 * 🔴 ADDED 2026-08-06, after this union's gaps caused a production 404.
 *
 * `coordinator` and `kiosk` were both in ROLES and neither had a variant here.
 * A discriminated union REJECTS a discriminator it does not list, so a
 * standalone coordinator's session failed `safeParse` outright - and the two
 * consumers (`getFamilyForWelcome`, `getCurrentFamily`) both treat a parse
 * failure as "no session", so `/welcome/family/[fid]` answered notFound() for
 * every standalone coordinator. The defensive `isWelcomeTeam()` check sitting
 * right below the parse was never reached.
 *
 * Nothing caught it because the failure is invisible from both directions: the
 * coordinator E2E exercises API routes, which are gated by middleware and never
 * parse these claims, and a missing variant looks identical to a malformed
 * cookie. It took a screenshot of the rendered page to find.
 *
 * `session-claims.test.ts` now asserts a variant exists for EVERY member of
 * ROLES, so the next role added cannot repeat this.
 */
const CoordinatorClaimsSchema = staffClaims('coordinator');
const KioskClaimsSchema = staffClaims('kiosk');

// Legacy roles — preserved for /check-in/* compat
const LegacyFamilyClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('family'),
  familyId: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  extraRoles: ExtraRolesField,
  iat: z.number().optional(),
  exp: z.number().optional(),
});

const LegacyTeacherClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('teacher'),
  extraRoles: ExtraRolesField,
  iat: z.number().optional(),
  exp: z.number().optional(),
});

const LegacyAdminClaimsSchema = z.object({
  uid: z.string(),
  role: z.literal('admin'),
  extraRoles: ExtraRolesField,
  iat: z.number().optional(),
  exp: z.number().optional(),
});

/**
 * ⚠️ EVERY member of `ROLES` needs a variant in this list.
 *
 * A discriminated union does not ignore an unlisted discriminator, it REJECTS
 * the whole object - so a role missing from here is not a session with fewer
 * fields, it is a session that does not parse at all. Both consumers read that
 * as "not signed in". `session-claims.test.ts` asserts the coverage.
 */
export const SetuSessionClaimsSchema = z.discriminatedUnion('role', [
  FamilyManagerClaimsSchema,
  FamilyMemberClaimsSchema,
  WelcomeTeamClaimsSchema,
  CoordinatorClaimsSchema,
  KioskClaimsSchema,
  LegacyFamilyClaimsSchema,
  LegacyTeacherClaimsSchema,
  LegacyAdminClaimsSchema,
]);

export type SetuSessionClaims = z.infer<typeof SetuSessionClaimsSchema>;
