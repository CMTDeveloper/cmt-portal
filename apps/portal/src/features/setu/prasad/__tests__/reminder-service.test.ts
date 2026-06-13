import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { sendDuePrasadReminders } from '../reminder-service';

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
  date: string;
  familyName: string;
  status: string;
  remindedAt?: { weekBefore?: unknown; twoDayBefore?: unknown };
}

interface Seeds {
  assignments: AssignmentSeed[];
  // members keyed by fid
  membersByFid: Record<string, MemberSeed[]>;
}

// Capture the where() calls made against prasadAssignments so tests can assert
// the query is backed by the (status,date) index.
interface CapturedQuery {
  where: Array<{ field: string; op: string; value: unknown }>;
}

// Capture every doc.ref.set() so tests can assert the remindedAt stamp.
interface CapturedSet {
  paid: string;
  data: Json;
  opts: unknown;
}

function makeDb(seeds: Seeds, captured: { query: CapturedQuery; sets: CapturedSet[] }) {
  function assignmentsQuery() {
    // Per-query-instance filters: the service now issues one query per status
    // (assigned + proposed), so each instance must resolve its OWN where()
    // chain. `captured.query.where` still accumulates across instances for
    // query-shape assertions.
    const local: CapturedQuery['where'] = [];
    const q = {
      where: vi.fn((field: string, op: string, value: unknown) => {
        local.push({ field, op, value });
        captured.query.where.push({ field, op, value });
        return q;
      }),
      get: vi.fn(async () => {
        // Apply this instance's filters to the seeded assignments so the mock
        // mirrors the real (status,date) query.
        const statusF = local.find((w) => w.field === 'status');
        const dateF = local.find((w) => w.field === 'date');
        const inDates = Array.isArray(dateF?.value) ? (dateF!.value as string[]) : null;
        const rows = seeds.assignments
          .filter((a) => (statusF ? a.status === statusF.value : true))
          .filter((a) => (inDates ? inDates.includes(a.date) : true))
          .map((a) => ({
            ref: {
              set: vi.fn(async (data: Json, opts: unknown) => {
                captured.sets.push({ paid: a.paid, data, opts });
              }),
            },
            data: (): Json => ({
              fid: a.fid,
              date: a.date,
              familyName: a.familyName,
              ...(a.remindedAt ? { remindedAt: a.remindedAt } : {}),
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

// All fixture dates are built RELATIVE to this fixed `now` so the suite never
// depends on the wall clock. 2026-06-10 is a Wednesday — addDays math is pure
// UTC calendar arithmetic, matching the service.
const NOW = new Date('2026-06-10T13:00:00.000Z');
const TODAY = '2026-06-10';

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

const DAY7 = addDays(TODAY, 7); // weekBefore target
const DAY2 = addDays(TODAY, 2); // twoDayBefore target

let emailSpy: ReturnType<typeof vi.fn<(args: SendEmailArgs) => Promise<void>>>;
let smsSpy: ReturnType<typeof vi.fn<(args: SendSMSArgs) => Promise<void>>>;

beforeEach(() => {
  vi.clearAllMocks();
  emailSpy = vi.fn<(args: SendEmailArgs) => Promise<void>>().mockResolvedValue(undefined);
  smsSpy = vi.fn<(args: SendSMSArgs) => Promise<void>>().mockResolvedValue(undefined);
  mockResolveSender.mockReturnValue({ sendEmail: emailSpy, sendSMS: smsSpy });
});

describe('sendDuePrasadReminders', () => {
  it('queries (status,date) once per status — assigned AND proposed — with date in [today+7, today+2]', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb({ assignments: [], membersByFid: {} }, captured) as never,
    );

    await sendDuePrasadReminders(NOW);

    const statusFs = captured.query.where.filter((w) => w.field === 'status');
    expect(statusFs.map((w) => ({ op: w.op, value: w.value }))).toEqual(
      expect.arrayContaining([
        { op: '==', value: 'assigned' },
        { op: '==', value: 'proposed' },
      ]),
    );
    expect(statusFs).toHaveLength(2);
    const dateFs = captured.query.where.filter((w) => w.field === 'date');
    expect(dateFs).toHaveLength(2);
    for (const dateF of dateFs) {
      expect(dateF.op).toBe('in');
      expect((dateF.value as string[]).slice().sort()).toEqual([DAY7, DAY2].sort());
    }
  });

  it('sends email AND SMS for a weekBefore assignment and stamps remindedAt.weekBefore', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-week', fid: 'F1', date: DAY7, familyName: 'Sharma', status: 'assigned' },
          ],
          membersByFid: {
            F1: [
              { mid: 'm1', manager: true, email: 'mgr@example.com', phone: '+14375551212', firstName: 'Asha' },
            ],
          },
        },
        captured,
      ) as never,
    );

    const result = await sendDuePrasadReminders(NOW);

    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(smsSpy).toHaveBeenCalledTimes(1);
    expect(emailSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'mgr@example.com' }),
    );
    expect(smsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+14375551212' }),
    );
    // one-week-away copy for weekBefore
    expect((emailSpy.mock.calls[0]![0] as { text: string }).text).toContain('one week away');

    expect(captured.sets).toHaveLength(1);
    expect(captured.sets[0]!.data).toEqual({ remindedAt: { weekBefore: '__ts__' } });
    expect(captured.sets[0]!.opts).toEqual({ merge: true });

    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
  });

  it('stamps remindedAt.twoDayBefore for a today+2 assignment with this-Sunday copy', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-two', fid: 'F2', date: DAY2, familyName: 'Patel', status: 'assigned' },
          ],
          membersByFid: {
            F2: [{ mid: 'm2', manager: true, email: 'two@example.com', phone: null, firstName: 'Ravi' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await sendDuePrasadReminders(NOW);

    expect(captured.sets).toHaveLength(1);
    expect(captured.sets[0]!.data).toEqual({ remindedAt: { twoDayBefore: '__ts__' } });
    expect((emailSpy.mock.calls[0]![0] as { text: string }).text).toContain('this Sunday');
    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
  });

  it('skips an assignment already stamped for the due kind — no sends', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            {
              paid: 'p-week',
              fid: 'F1',
              date: DAY7,
              familyName: 'Sharma',
              status: 'assigned',
              remindedAt: { weekBefore: '__already__', twoDayBefore: null },
            },
          ],
          membersByFid: {
            F1: [{ mid: 'm1', manager: true, email: 'mgr@example.com', phone: '+14375551212' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await sendDuePrasadReminders(NOW);

    expect(emailSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();
    expect(captured.sets).toHaveLength(0);
    expect(result).toEqual({ checked: 1, sent: 0, skipped: 1, failed: 0 });
  });

  it('does not SMS a manager who has only an email', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-week', fid: 'F1', date: DAY7, familyName: 'Sharma', status: 'assigned' },
          ],
          membersByFid: {
            F1: [{ mid: 'm1', manager: true, email: 'only@example.com', phone: null }],
          },
        },
        captured,
      ) as never,
    );

    const result = await sendDuePrasadReminders(NOW);

    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(smsSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
  });

  it('does NOT stamp and counts failed when the manager has no email or phone (nothing dispatched)', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-week', fid: 'F1', date: DAY7, familyName: 'Sharma', status: 'assigned' },
          ],
          membersByFid: {
            F1: [{ mid: 'm1', manager: true, email: null, phone: null, firstName: 'Asha' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await sendDuePrasadReminders(NOW);

    expect(emailSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();
    // No stamp — so a later run retries once a contact is added.
    expect(captured.sets).toHaveLength(0);
    expect(result).toEqual({ checked: 1, sent: 0, skipped: 0, failed: 1 });
  });

  it('does NOT stamp and counts failed when the family has no manager at all', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-week', fid: 'F1', date: DAY7, familyName: 'Sharma', status: 'assigned' },
          ],
          membersByFid: { F1: [{ mid: 'm1', manager: false, email: 'child@example.com' }] },
        },
        captured,
      ) as never,
    );

    const result = await sendDuePrasadReminders(NOW);

    expect(emailSpy).not.toHaveBeenCalled();
    expect(captured.sets).toHaveLength(0);
    expect(result).toEqual({ checked: 1, sent: 0, skipped: 0, failed: 1 });
  });

  it('reports {checked, sent, skipped, failed} across a mixed batch', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-week', fid: 'F1', date: DAY7, familyName: 'Sharma', status: 'assigned' },
            { paid: 'p-two', fid: 'F2', date: DAY2, familyName: 'Patel', status: 'assigned' },
            {
              paid: 'p-done',
              fid: 'F3',
              date: DAY7,
              familyName: 'Iyer',
              status: 'assigned',
              remindedAt: { weekBefore: '__already__' },
            },
          ],
          membersByFid: {
            F1: [{ mid: 'm1', manager: true, email: 'a@example.com' }],
            F2: [{ mid: 'm2', manager: true, email: 'b@example.com' }],
            F3: [{ mid: 'm3', manager: true, email: 'c@example.com' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await sendDuePrasadReminders(NOW);

    expect(result).toEqual({ checked: 3, sent: 2, skipped: 1, failed: 0 });
    expect(captured.sets).toHaveLength(2);
  });

  it('nudges a PROPOSED weekBefore doc with confirm copy instead of a plain reminder', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-prop', fid: 'F1', date: DAY7, familyName: 'Sharma', status: 'proposed' },
          ],
          membersByFid: {
            F1: [{ mid: 'm1', manager: true, email: 'mgr@example.com', firstName: 'Asha' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await sendDuePrasadReminders(NOW);

    expect(emailSpy).toHaveBeenCalledTimes(1);
    const call = emailSpy.mock.calls[0]![0] as { subject: string; text: string };
    expect(call.text).toContain('not confirmed');
    expect(call.text).toContain('/family/prasad');
    expect(call.subject).toContain('please confirm');
    // The proposed doc still gets the idempotency stamp.
    expect(captured.sets).toHaveLength(1);
    expect(captured.sets[0]!.data).toEqual({ remindedAt: { weekBefore: '__ts__' } });
    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
  });

  it('sends a plain reminder AND a confirm nudge when assigned + proposed are both due today+2', async () => {
    const captured = { query: { where: [] as CapturedQuery['where'] }, sets: [] as CapturedSet[] };
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { paid: 'p-assigned', fid: 'F1', date: DAY2, familyName: 'Sharma', status: 'assigned' },
            { paid: 'p-proposed', fid: 'F2', date: DAY2, familyName: 'Patel', status: 'proposed' },
          ],
          membersByFid: {
            F1: [{ mid: 'm1', manager: true, email: 'a@example.com' }],
            F2: [{ mid: 'm2', manager: true, email: 'b@example.com' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await sendDuePrasadReminders(NOW);

    expect(result).toEqual({ checked: 2, sent: 2, skipped: 0, failed: 0 });
    expect(emailSpy).toHaveBeenCalledTimes(2);
    const texts = emailSpy.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts.some((t) => t.includes('Please bring prasad'))).toBe(true);
    expect(texts.some((t) => t.includes('not confirmed'))).toBe(true);
    expect(captured.sets).toHaveLength(2);
    expect(captured.sets.map((s) => s.data)).toEqual([
      { remindedAt: { twoDayBefore: '__ts__' } },
      { remindedAt: { twoDayBefore: '__ts__' } },
    ]);
  });

  it('isolates per-family failures: second family still sends+stamps when first throws', async () => {
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
            { paid: 'p-f1', fid: 'F1', date: DAY7, familyName: 'Sharma', status: 'assigned' },
            { paid: 'p-f2', fid: 'F2', date: DAY7, familyName: 'Patel', status: 'assigned' },
          ],
          membersByFid: {
            F1: [{ mid: 'm1', manager: true, email: 'fail@example.com' }],
            F2: [{ mid: 'm2', manager: true, email: 'ok@example.com' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await sendDuePrasadReminders(NOW);

    // F2 still got its email despite F1 throwing.
    expect(errorSpy).toHaveBeenCalledTimes(2); // called for both families
    // F1 not stamped (send failed before stamp); F2 stamped.
    expect(captured.sets).toHaveLength(1);
    expect(captured.sets[0]!.paid).toBe('p-f2');
    expect(result).toMatchObject({ sent: 1, failed: 1 });
  });
});
