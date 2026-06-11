import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SendEmailArgs } from '@/lib/aws/ses';
import type { SendSMSArgs } from '@/lib/aws/sns';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: vi.fn(),
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { notifyUnnotifiedProposals } from '../proposal-notify';

const mockFirestore = vi.mocked(portalFirestore);
const mockResolveSender = vi.mocked(resolveSender);

type Json = Record<string, unknown>;

interface MemberSeed {
  mid: string;
  manager?: boolean;
  email?: string | null;
  phone?: string | null;
  firstName?: string;
}

interface AssignmentSeed {
  paid: string;
  fid: string;
  pid: string;
  date: string;
  status: string;
  proposalNotifiedAt?: unknown;
}

interface Seeds {
  assignments: AssignmentSeed[];
  // members keyed by fid
  membersByFid: Record<string, MemberSeed[]>;
}

// Capture the where() calls made against prasadAssignments so tests can assert
// the (pid, status) equality query shape.
interface CapturedQuery {
  where: Array<{ field: string; op: string; value: unknown }>;
}

// Capture every doc.ref.set() so tests can assert the proposalNotifiedAt stamp.
interface CapturedSet {
  paid: string;
  data: Json;
  opts: unknown;
}

function makeDb(seeds: Seeds, captured: { query: CapturedQuery; sets: CapturedSet[] }) {
  function assignmentsQuery() {
    const q = {
      where: vi.fn((field: string, op: string, value: unknown) => {
        captured.query.where.push({ field, op, value });
        return q;
      }),
      get: vi.fn(async () => {
        // Apply the captured filters so the mock mirrors the real
        // pid== + status=='proposed' query — assigned docs never come back.
        const pidF = captured.query.where.find((w) => w.field === 'pid');
        const statusF = captured.query.where.find((w) => w.field === 'status');
        const rows = seeds.assignments
          .filter((a) => (pidF ? a.pid === pidF.value : true))
          .filter((a) => (statusF ? a.status === statusF.value : true))
          .map((a) => ({
            ref: {
              set: vi.fn(async (data: Json, opts: unknown) => {
                captured.sets.push({ paid: a.paid, data, opts });
              }),
            },
            data: (): Json => ({
              fid: a.fid,
              date: a.date,
              ...(a.proposalNotifiedAt != null ? { proposalNotifiedAt: a.proposalNotifiedAt } : {}),
            }),
          }));
        return { docs: rows, size: rows.length };
      }),
    };
    return q;
  }

  function familyDoc(fid: string) {
    return {
      collection: vi.fn((sub: string) => {
        if (sub !== 'members') throw new Error(`unexpected subcollection ${sub}`);
        const managersQ = {
          where: vi.fn((field: string, _op: string, value: unknown) => {
            if (field !== 'manager' || value !== true) {
              throw new Error(`unexpected members filter ${field}=${String(value)}`);
            }
            return managersQ;
          }),
          get: vi.fn(async () => {
            const managers = (seeds.membersByFid[fid] ?? []).filter((m) => m.manager === true);
            return {
              docs: managers.map((m) => ({ id: m.mid, data: (): Json => ({ ...m }) })),
            };
          }),
        };
        return managersQ;
      }),
    };
  }

  return {
    collection: vi.fn((col: string) => {
      if (col === 'prasadAssignments') return assignmentsQuery();
      if (col === 'families') return { doc: vi.fn((fid: string) => familyDoc(fid)) };
      throw new Error(`unexpected collection ${col}`);
    }),
  };
}

const PID = 'bv-brampton-2026-27';

let emailSpy: ReturnType<typeof vi.fn<(args: SendEmailArgs) => Promise<void>>>;
let smsSpy: ReturnType<typeof vi.fn<(args: SendSMSArgs) => Promise<void>>>;

const ORIGINAL_CRON_ENABLED = process.env.PRASAD_REMINDER_CRON_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PRASAD_REMINDER_CRON_ENABLED = 'true';
  emailSpy = vi.fn<(args: SendEmailArgs) => Promise<void>>().mockResolvedValue(undefined);
  smsSpy = vi.fn<(args: SendSMSArgs) => Promise<void>>().mockResolvedValue(undefined);
  mockResolveSender.mockReturnValue({ sendEmail: emailSpy, sendSMS: smsSpy });
});

afterEach(() => {
  if (ORIGINAL_CRON_ENABLED === undefined) {
    delete process.env.PRASAD_REMINDER_CRON_ENABLED;
  } else {
    process.env.PRASAD_REMINDER_CRON_ENABLED = ORIGINAL_CRON_ENABLED;
  }
});

describe('notifyUnnotifiedProposals', () => {
  it('sends once per un-notified proposed family, stamps it, skips already-notified, ignores assigned', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-new', fid: 'F1', pid: PID, date: '2026-11-08', status: 'proposed' },
            {
              paid: 'p-done',
              fid: 'F2',
              pid: PID,
              date: '2026-11-15',
              status: 'proposed',
              proposalNotifiedAt: '__already__',
            },
            // Excluded by the status=='proposed' query — must produce no send.
            { paid: 'p-assigned', fid: 'F3', pid: PID, date: '2026-11-22', status: 'assigned' },
          ],
          membersByFid: {
            F1: [
              { mid: 'm1', manager: true, email: 'mgr@example.com', phone: '+14375551212', firstName: 'Asha' },
            ],
            F2: [{ mid: 'm2', manager: true, email: 'done@example.com' }],
            F3: [{ mid: 'm3', manager: true, email: 'assigned@example.com' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await notifyUnnotifiedProposals(PID);

    // Query shape: two equality filters, no composite needed.
    expect(captured.query.where).toEqual(
      expect.arrayContaining([
        { field: 'pid', op: '==', value: PID },
        { field: 'status', op: '==', value: 'proposed' },
      ]),
    );

    // Only F1's manager is contacted — email AND SMS, confirm-style copy.
    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(smsSpy).toHaveBeenCalledTimes(1);
    expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({ to: 'mgr@example.com' }));
    expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({ phone: '+14375551212' }));
    expect((emailSpy.mock.calls[0]![0] as { text: string }).text).toContain('/family/prasad');

    // Only the un-notified doc is stamped.
    expect(captured.sets).toHaveLength(1);
    expect(captured.sets[0]!.paid).toBe('p-new');
    expect(captured.sets[0]!.data).toEqual({ proposalNotifiedAt: '__ts__' });
    expect(captured.sets[0]!.opts).toEqual({ merge: true });

    expect(result).toEqual({ checked: 2, sent: 1, skipped: 1, failed: 0 });
  });

  it('isolates per-family failures: a sendEmail rejection does not stamp or abort later families', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    // F1's sendEmail rejects; F2 should proceed normally.
    const errorSpy = vi.fn<(args: SendEmailArgs) => Promise<void>>()
      .mockRejectedValueOnce(new Error('SES timeout'))
      .mockResolvedValue(undefined);
    const silentSms = vi.fn<(args: SendSMSArgs) => Promise<void>>().mockResolvedValue(undefined);
    mockResolveSender.mockReturnValue({ sendEmail: errorSpy, sendSMS: silentSms });

    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-f1', fid: 'F1', pid: PID, date: '2026-11-08', status: 'proposed' },
            { paid: 'p-f2', fid: 'F2', pid: PID, date: '2026-11-15', status: 'proposed' },
          ],
          membersByFid: {
            F1: [{ mid: 'm1', manager: true, email: 'fail@example.com' }],
            F2: [{ mid: 'm2', manager: true, email: 'ok@example.com' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await notifyUnnotifiedProposals(PID);

    // F2 still got its email despite F1 throwing.
    expect(errorSpy).toHaveBeenCalledTimes(2);
    // F1 not stamped (send failed before stamp); F2 stamped.
    expect(captured.sets).toHaveLength(1);
    expect(captured.sets[0]!.paid).toBe('p-f2');
    expect(result).toEqual({ checked: 2, sent: 1, skipped: 0, failed: 1 });
  });

  it('returns disabled with zero sends when PRASAD_REMINDER_CRON_ENABLED is not "true"', async () => {
    process.env.PRASAD_REMINDER_CRON_ENABLED = 'false';
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-new', fid: 'F1', pid: PID, date: '2026-11-08', status: 'proposed' },
          ],
          membersByFid: {
            F1: [{ mid: 'm1', manager: true, email: 'mgr@example.com' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await notifyUnnotifiedProposals(PID);

    expect(result).toEqual({ disabled: true, checked: 0, sent: 0, skipped: 0, failed: 0 });
    expect(emailSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();
    expect(captured.sets).toHaveLength(0);
  });
});
