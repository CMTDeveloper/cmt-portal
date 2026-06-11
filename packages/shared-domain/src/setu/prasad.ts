import { z } from 'zod';

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const BIRTH_MONTH = z.number().int().min(1).max(12);

export const PRASAD_REASONS = ['birthday-month', 'spill', 'no-birth-month'] as const;
export const PRASAD_SOURCES = ['auto', 'family-move', 'admin'] as const;
export const PRASAD_STATUSES = ['proposed', 'assigned', 'cancelled'] as const;

/** prasadAssignments/{paid} — one doc per family per period; paid = `${pid}-${fid}`. */
export const PrasadAssignmentDocSchema = z.object({
  paid: z.string().min(1),
  pid: z.string().min(1),
  fid: z.string().min(1),
  familyName: z.string(),
  location: z.string(),
  date: YMD,
  youngestMid: z.string().nullable(),
  youngestName: z.string().nullable(),
  birthMonth: BIRTH_MONTH.nullable(),
  reason: z.enum(PRASAD_REASONS),
  source: z.enum(PRASAD_SOURCES),
  status: z.enum(PRASAD_STATUSES),
  assignedAt: z.date(),
  movedFrom: YMD.nullable(),
  movedAt: z.date().nullable(),
  movedBy: z.string().nullable(),
  remindedAt: z.object({
    weekBefore: z.date().nullable(),
    twoDayBefore: z.date().nullable(),
  }),
  // Propose→confirm lifecycle (2026-06-10 revision): publish writes 'proposed';
  // a family confirm or an admin assign flips to 'assigned'. Docs written before
  // the revision have status 'assigned' and these fields absent → default null.
  confirmedAt: z.date().nullable().default(null),
  confirmedBy: z.enum(['family', 'admin']).nullable().default(null),
  proposalNotifiedAt: z.date().nullable().default(null),
});
export type PrasadAssignmentDoc = z.infer<typeof PrasadAssignmentDocSchema>;

/** prasadConfig/{pid} — the cap the admin published with (move dialog enforces it). */
export const PrasadConfigDocSchema = z.object({
  pid: z.string().min(1),
  capPerSunday: z.number().int().min(1),
  publishedAt: z.date(),
  publishedBy: z.string().min(1),
});
export type PrasadConfigDoc = z.infer<typeof PrasadConfigDocSchema>;

// ---- request bodies (shared web ↔ native) ----
export const PrasadPreviewBodySchema = z.object({
  pid: z.string().min(1),
  cap: z.number().int().min(1).optional(), // omitted → computed default
});
export const PrasadPublishBodySchema = z.object({
  pid: z.string().min(1),
  cap: z.number().int().min(1),
});
export const PrasadMoveBodySchema = z.object({ date: YMD });

/** Family confirm: no date → confirm the proposed Sunday in place; with date →
 *  confirm at that open Sunday instead (cap-checked). */
export const PrasadConfirmBodySchema = z.object({ date: YMD.optional() });
export type PrasadConfirmBody = z.infer<typeof PrasadConfirmBodySchema>;

/** Admin bulk: flip every remaining 'proposed' row for the pid to 'assigned'. */
export const PrasadAssignRemainingBodySchema = z.object({ pid: z.string().min(1) });
export type PrasadAssignRemainingBody = z.infer<typeof PrasadAssignRemainingBodySchema>;

export const PrasadAdminReassignBodySchema = z.object({
  paid: z.string().min(1),
  date: YMD.optional(),           // present → reassign to this date
  cancel: z.boolean().optional(), // true → status:'cancelled' (family left)
  assign: z.boolean().optional(), // true → proposed→assigned (confirmedBy:'admin')
});
export type PrasadPreviewBody = z.infer<typeof PrasadPreviewBodySchema>;
export type PrasadPublishBody = z.infer<typeof PrasadPublishBodySchema>;
export type PrasadMoveBody = z.infer<typeof PrasadMoveBodySchema>;
export type PrasadAdminReassignBody = z.infer<typeof PrasadAdminReassignBodySchema>;
