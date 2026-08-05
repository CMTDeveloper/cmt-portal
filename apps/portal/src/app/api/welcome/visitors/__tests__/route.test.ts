import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordGuestCheckIn } = vi.hoisted(() => ({ recordGuestCheckIn: vi.fn() }));
vi.mock('@/features/check-in/shared', () => ({ recordGuestCheckIn }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

import { POST } from '../route';

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://x/api/welcome/visitors', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const WELCOME = { 'x-portal-role': 'welcome-team', 'x-portal-extra-roles': '' };
const COORDINATOR = { 'x-portal-role': 'coordinator', 'x-portal-extra-roles': '' };
const ADMIN = { 'x-portal-role': 'admin', 'x-portal-extra-roles': '' };
const FAMILY = { 'x-portal-role': 'family-manager', 'x-portal-extra-roles': '' };

const GUEST = {
  firstName: 'Asha',
  lastName: 'Sharma',
  email: 'asha@example.com',
  phone: '416-555-0100',
  numberOfAdults: 2,
  children: [
    { name: 'Riya', grade: 'Grade 2' },
    { name: 'Aarav', grade: 'Grade 5' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  recordGuestCheckIn.mockResolvedValue('guest-1');
});

describe('POST /api/welcome/visitors - authorization (gate 3)', () => {
  it('401 with no session header', async () => {
    const res = await POST(req(GUEST));
    expect(res.status).toBe(401);
    expect(recordGuestCheckIn).not.toHaveBeenCalled();
  });

  it('403 for a family role', async () => {
    const res = await POST(req(GUEST, FAMILY));
    expect(res.status).toBe(403);
    expect(recordGuestCheckIn).not.toHaveBeenCalled();
  });

  it('201 for welcome-team', async () => {
    const res = await POST(req(GUEST, WELCOME));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: 'guest-1' });
  });

  it('201 for admin', async () => {
    expect((await POST(req(GUEST, ADMIN))).status).toBe(201);
  });

  // The visitors board was welcome-team-only until 2026-08-05; coordinator
  // inherits it now, and the handler must agree with the middleware or the
  // screen renders a control whose request comes back 403.
  it('201 for coordinator - it inherits welcome-team', async () => {
    expect((await POST(req(GUEST, COORDINATOR))).status).toBe(201);
  });
});

describe('POST /api/welcome/visitors - validation', () => {
  it('400 when email is missing - a guest family must stay reachable', async () => {
    const noEmail: Record<string, unknown> = { ...GUEST };
    delete noEmail['email'];
    const res = await POST(req(noEmail, WELCOME));
    expect(res.status).toBe(400);
    expect(recordGuestCheckIn).not.toHaveBeenCalled();
  });

  it('400 when a child row has a name but no grade', async () => {
    const res = await POST(req({ ...GUEST, children: [{ name: 'Riya', grade: '' }] }, WELCOME));
    expect(res.status).toBe(400);
  });

  it('accepts an adults-only visit (no children)', async () => {
    const res = await POST(req({ ...GUEST, children: [] }, WELCOME));
    expect(res.status).toBe(201);
    expect(recordGuestCheckIn.mock.calls[0]![0]).toMatchObject({ children: [] });
  });

  it('400 on a malformed date rather than passing it to the date normalizer', async () => {
    const res = await POST(req({ ...GUEST, date: '08/05/2026' }, WELCOME));
    expect(res.status).toBe(400);
    expect(recordGuestCheckIn).not.toHaveBeenCalled();
  });
});

describe('POST /api/welcome/visitors - what it writes', () => {
  // N=2 children, because every read of this record fans out per child and a
  // one-child fixture cannot see an index or a slice bug.
  it('passes both children through to the store', async () => {
    await POST(req(GUEST, WELCOME));
    const [guest] = recordGuestCheckIn.mock.calls[0]!;
    expect(guest.children).toEqual([
      { name: 'Riya', grade: 'Grade 2' },
      { name: 'Aarav', grade: 'Grade 5' },
    ]);
  });

  // The trap this closes: /welcome/visitors has a date picker, and the store
  // otherwise stamps TODAY. A desk adding a visitor while viewing last Sunday
  // would file them on a day the person who just typed them in cannot see.
  it('forwards the viewed date as the walk-in day', async () => {
    await POST(req({ ...GUEST, date: '2026-03-08' }, WELCOME));
    expect(recordGuestCheckIn.mock.calls[0]![1]).toBe('2026-03-08');
  });

  it('omits the date entirely when none is given, so the store uses today', async () => {
    await POST(req(GUEST, WELCOME));
    expect(recordGuestCheckIn.mock.calls[0]![1]).toBeUndefined();
  });

  it('never forwards `date` as part of the guest document', async () => {
    // `date` is a transport concern of this route; the store owns stamping it
    // alongside the derived sessionDate. Leaking it into the doc payload would
    // put an un-normalized value beside a normalized one.
    await POST(req({ ...GUEST, date: '2026-03-08' }, WELCOME));
    expect(recordGuestCheckIn.mock.calls[0]![0]).not.toHaveProperty('date');
  });
});
