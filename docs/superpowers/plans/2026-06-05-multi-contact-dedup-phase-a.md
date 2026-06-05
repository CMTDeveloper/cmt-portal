# Multi-Contact Household Dedup — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each family member's email + phone on the registration screen so the household's contacts land on file at creation — fixing the #1 cause of duplicate family records (a spouse registering later with contacts no one captured).

**Architecture:** Client-only change. The registration backend (`registerFamily`) **already** writes a `contactKey` per member email/phone inside its atomic transaction, the register API schema **already** accepts `additionalMembers[].email/phone`, and the lookup **already** matches on either contact. The only gap is the `/register/family` form: it has no contact inputs on member rows and silently drops email/phone at submit (`page.tsx:218`). This plan adds the inputs and stops the drop.

**Tech Stack:** Next.js 16 (client component), React, Vitest + Testing Library + `userEvent`, TypeScript with `exactOptionalPropertyTypes`.

**Spec:** `docs/superpowers/specs/2026-06-04-multi-contact-household-dedup-design.md` (Phase A section).

---

## Scope notes (read before starting)

- **Phase A is the registration capture only.** Phase B (find-screen multi-search, OTP-verified "My contacts", post-sign-in nudge) is a **separate plan** — do not build it here.
- **Deliberate deviation from the spec's data-model note:** the spec suggested landing `altEmails`/`altPhones` (MemberDoc) and `source`/`verifiedAt` (contactKeys) in Phase A. **We are NOT adding those here** — Phase A captures a single email + single phone per member, which goes to the existing `MemberDoc.email`/`phone` fields and writes existing-shape contactKeys. Adding array fields nothing populates yet violates YAGNI; Phase B introduces them when it builds multi-contact + verified-add. No schema change is needed for Phase A.
- One member = one email + one phone at registration (no "+ add another contact per member" UI in Phase A — that's Phase B's "My contacts").

## File structure

| File | Change |
|------|--------|
| `apps/portal/src/app/register/family/page.tsx` | Add optional Email + Phone inputs to the add-member draft form; carry them on the member; light client email validation; include them in the submit body (fix line 218). |
| `apps/portal/src/app/register/family/__tests__/page.test.tsx` | Tests: member email/phone reach the POST body; an invalid member email is blocked client-side. |
| `apps/portal/src/features/setu/registration/__tests__/register-family.test.ts` | Guard test: a member's email + phone contactKeys point to **that member's** mid (locks the dedup invariant for Phase B). |

No backend/API/schema files change.

---

## Task 1: Capture member email + phone in the registration form

**Files:**
- Modify: `apps/portal/src/app/register/family/page.tsx`
- Test: `apps/portal/src/app/register/family/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('RegisterFamilyPage — additional members', ...)` block (after the `'included additional members in POST body'` test, before the block's closing `});`) in `apps/portal/src/app/register/family/__tests__/page.test.tsx`:

```tsx
  it("includes a member's email and phone in the POST body", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ redirectTo: '/family' }) });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    const textInputs = document.querySelectorAll('input[type="text"]');
    await user.type(textInputs[0] as HTMLElement, 'Gupta');
    await user.click(screen.getAllByRole('button', { name: 'Brampton' })[0]!);
    await user.type(textInputs[1] as HTMLElement, 'Sunita');
    await user.type(textInputs[2] as HTMLElement, 'Gupta');

    await user.click(screen.getAllByRole('button', { name: /add another member/i })[0]!);
    await user.type(screen.getAllByLabelText(/member first name/i)[0]!, 'Anil');
    await user.type(screen.getAllByLabelText(/member last name/i)[0]!, 'Gupta');
    await user.type(screen.getAllByLabelText(/member email/i)[0]!, 'anil@example.com');
    await user.type(screen.getAllByLabelText(/member phone/i)[0]!, '4165559999');
    await user.click(screen.getAllByRole('button', { name: /^add member$/i })[0]!);

    await user.click(screen.getAllByRole('button', { name: /create family/i })[0]!);

    await waitFor(() => {
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
        additionalMembers?: Array<{ firstName: string; email?: string; phone?: string }>;
      };
      const anil = body.additionalMembers?.find((m) => m.firstName === 'Anil');
      expect(anil?.email).toBe('anil@example.com');
      expect(anil?.phone).toBe('4165559999');
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/app/register/family/__tests__/page.test.tsx -t "includes a member's email and phone"`
Expected: FAIL — `getAllByLabelText(/member email/i)` finds no element (the inputs don't exist yet).

- [ ] **Step 3: Add email/phone to the form's member model + draft state**

In `apps/portal/src/app/register/family/page.tsx`, extend the `AdditionalMember` interface (currently lines 16-22):

```tsx
interface AdditionalMember {
  id: string;
  firstName: string;
  lastName: string;
  type: MemberType;
  gender: Gender;
  email?: string;
  phone?: string;
}
```

Add draft state alongside the other draft `useState` calls (after `const [draftGender, setDraftGender] = useState<Gender>('PreferNotToSay');`, currently line 166):

```tsx
  const [draftEmail, setDraftEmail] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftError, setDraftError] = useState('');
```

- [ ] **Step 4: Carry email/phone when a member is added (with light email validation)**

Replace the whole `handleAddMember` callback (currently lines 168-185) with:

```tsx
  const handleAddMember = useCallback(() => {
    if (!draftFirstName.trim() || !draftLastName.trim()) return;
    const email = draftEmail.trim();
    const phone = draftPhone.trim();
    // A member's email is optional, but if present it must look valid — otherwise
    // the server rejects the whole registration with a cryptic 400.
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setDraftError('Enter a valid email or leave it blank.');
      return;
    }
    setDraftError('');
    setAdditionalMembers((prev) => [
      ...prev,
      {
        id: `${Date.now()}`,
        firstName: draftFirstName.trim(),
        lastName: draftLastName.trim(),
        type: draftType,
        gender: draftGender,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      },
    ]);
    setDraftFirstName('');
    setDraftLastName('');
    setDraftEmail('');
    setDraftPhone('');
    setDraftType('Adult');
    setDraftGender('PreferNotToSay');
    setShowAddMember(false);
  }, [draftFirstName, draftLastName, draftEmail, draftPhone, draftType, draftGender]);
```

(The `...(email ? { email } : {})` conditional-spread keeps `exactOptionalPropertyTypes` happy — never assign `undefined`.)

- [ ] **Step 5: Render Email + Phone inputs in the draft member form**

In the draft member form, immediately AFTER the first/last-name `div.row` (the one containing "Member first name" / "Member last name" inputs — currently closes at line 398 with `</div>`) and BEFORE the type/gender pill row (currently the `div.row` starting line 399), insert:

```tsx
            <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <input
                className="input"
                type="email"
                placeholder="Email (optional)"
                value={draftEmail}
                onChange={e => setDraftEmail(e.target.value)}
                style={{ flex: '1 1 100px' }}
                aria-label="Member email"
              />
              <input
                className="input"
                type="tel"
                placeholder="Phone (optional)"
                value={draftPhone}
                onChange={e => setDraftPhone(e.target.value)}
                style={{ flex: '1 1 100px' }}
                aria-label="Member phone"
              />
            </div>
            <div className="hint" style={{ marginBottom: 10 }}>
              Adding a member&apos;s own email or phone helps us recognize them later and avoid a duplicate family record.
            </div>
            {draftError && <div className="field-error" role="alert" style={{ marginBottom: 10 }}>{draftError}</div>}
```

- [ ] **Step 6: Clear the new draft fields on Cancel**

Update the draft form's Cancel button `onClick` (currently line 442) from:

```tsx
                onClick={() => { setShowAddMember(false); setDraftFirstName(''); setDraftLastName(''); }}
```

to:

```tsx
                onClick={() => { setShowAddMember(false); setDraftFirstName(''); setDraftLastName(''); setDraftEmail(''); setDraftPhone(''); setDraftError(''); }}
```

- [ ] **Step 7: Show the captured contact on the added-member row**

In the added-members list, update the `AddedMemberRow` `type` prop (currently lines 361-364) to surface the captured contact so the manager can confirm it was recorded:

```tsx
            <AddedMemberRow
              name={`${m.firstName} ${m.lastName}`}
              type={`${m.type} · ${m.gender === 'PreferNotToSay' ? 'not specified' : m.gender}${m.email ? ` · ${m.email}` : ''}${m.phone ? ` · ${m.phone}` : ''}`}
            />
```

- [ ] **Step 8: Include email/phone in the submit body (the actual drop fix)**

Replace the `additionalMembers` map in the submit `fetch` body (currently lines 218-223) with:

```tsx
          additionalMembers: additionalMembers.map(({ firstName, lastName, type, gender, email, phone }) => ({
            firstName,
            lastName,
            type,
            gender,
            ...(email ? { email } : {}),
            ...(phone ? { phone } : {}),
          })),
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/app/register/family/__tests__/page.test.tsx`
Expected: PASS — all existing tests plus the new one are green.

- [ ] **Step 10: Commit**

```bash
git add apps/portal/src/app/register/family/page.tsx apps/portal/src/app/register/family/__tests__/page.test.tsx
git commit -m "feat(register): capture each member's email + phone (dedup — stop dropping them at submit)"
```

---

## Task 2: Block an invalid member email client-side

The validation logic landed in Task 1 Step 4; this task adds the test that locks it.

**Files:**
- Test: `apps/portal/src/app/register/family/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the same `describe('RegisterFamilyPage — additional members', ...)` block:

```tsx
  it('blocks adding a member with an invalid email and does not add the row', async () => {
    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    await user.click(screen.getAllByRole('button', { name: /add another member/i })[0]!);
    await user.type(screen.getAllByLabelText(/member first name/i)[0]!, 'Bad');
    await user.type(screen.getAllByLabelText(/member last name/i)[0]!, 'Email');
    await user.type(screen.getAllByLabelText(/member email/i)[0]!, 'not-an-email');
    await user.click(screen.getAllByRole('button', { name: /^add member$/i })[0]!);

    await waitFor(() => {
      expect(screen.getAllByText(/valid email/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('added-member-row')).toBeNull();
  });
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @cmt/portal vitest run src/app/register/family/__tests__/page.test.tsx -t "invalid email"`
Expected: PASS (the validation was implemented in Task 1 Step 4). If it FAILS, the validation in `handleAddMember` is wrong — fix `handleAddMember`, not the test.

> Note: this test characterizes the validation added in Task 1, so it goes green immediately — there is no separate red phase. It is here so the guard is explicit and Phase B can't silently drop it.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/app/register/family/__tests__/page.test.tsx
git commit -m "test(register): invalid member email is blocked client-side"
```

---

## Task 3: Guard the dedup invariant — a member's contact resolves to THAT member

The backend already writes member contactKeys (`register-family.ts:150-167`) and the existing test asserts the **count** (`register-family.test.ts:88-104`). This task adds a sharper assertion: the email **and** phone contactKeys for an additional member carry that member's `mid` — the invariant the whole dedup story rests on. No production code changes.

**Files:**
- Test: `apps/portal/src/features/setu/registration/__tests__/register-family.test.ts`

- [ ] **Step 1: Add the guard test**

Append this test inside the existing `describe('registerFamily — happy path', ...)` block (after the `'creates N+1 member docs when additionalMembers provided'` test, before the block's closing `});`):

```ts
  it("writes a member's email + phone contactKeys pointing to THAT member (dedup invariant)", async () => {
    const txnSet = vi.fn();
    mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = { get: vi.fn().mockResolvedValue({ exists: false }), set: txnSet };
      return fn(txn);
    });

    const { fid } = await registerFamily({
      ...baseInput,
      additionalMembers: [
        { firstName: 'Priya', lastName: 'Patel', type: 'Adult', gender: 'Female', email: 'priya@example.com', phone: '+14165550199' },
      ],
    });

    // Priya is the first (only) additional member → mid `${fid}-02`.
    const priyaMid = `${fid}-02`;
    const contactKeyWrites = txnSet.mock.calls
      .map((c) => c[1] as { contactKey?: string; type?: string; mid?: string } | undefined)
      .filter((d): d is { contactKey: string; type: string; mid: string } =>
        !!d && typeof d.contactKey === 'string',
      );

    expect(contactKeyWrites.find((d) => d.type === 'email' && d.mid === priyaMid)).toBeDefined();
    expect(contactKeyWrites.find((d) => d.type === 'phone' && d.mid === priyaMid)).toBeDefined();
  });
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @cmt/portal vitest run src/features/setu/registration/__tests__/register-family.test.ts`
Expected: PASS — it characterizes the existing backend. If it FAILS, the backend isn't mapping a member's contact to that member's mid — that's a real bug; stop and report rather than weakening the test.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/features/setu/registration/__tests__/register-family.test.ts
git commit -m "test(register): member contactKeys map to that member's mid (dedup invariant guard)"
```

---

## Task 4: Mock-free UAT walkthrough (pre-ship discipline)

Per `CLAUDE.md` ("walk the user's exact path in UAT before declaring done"), verify the dedup outcome end-to-end against UAT. This is a manual verification task — no code.

**Prereqs:** `apps/portal/.env.local` points at `chinmaya-setu-uat`; `NEXT_PUBLIC_FEATURE_SETU_AUTH=true`. Run the dev server: `pnpm --filter @cmt/portal dev:e2e` (serves on `:3001`).

- [ ] **Step 1: Register a family with a spouse contact**

Open `http://localhost:3001/register`. Enter a fresh test email + phone (one not already in UAT), continue to `/register/family`. Fill family name + location + your name, then **Add another member**: enter a spouse with a *distinct* email + phone (e.g. `spouse-<random>@example.com` / a distinct phone). Confirm the added-member row shows the spouse's email/phone. Submit → lands on `/family`.

- [ ] **Step 2: Confirm the spouse's contact now finds the family (the dedup win)**

Sign out (or open a private window). Go to `http://localhost:3001/register`. Enter the **spouse's** email + phone (the ones you just added — NOT the manager's). 
Expected: the **"We found a family with this contact"** card appears for the family you just created. Before this change, those contacts were never stored, so this lookup would have missed and offered to create a duplicate.

- [ ] **Step 3 (optional): Clean up the UAT test family**

If you used `_test`-tagged data or want to remove the throwaway family, use the existing `pnpm --filter @cmt/portal wipe:test-leaks` (only removes `_test:true` docs) — note a normal registration is NOT tagged `_test`, so manual cleanup via the admin/welcome tools may be needed, or just leave it (UAT).

- [ ] **Step 4: Record the result**

Note in the PR/commit summary: "UAT walkthrough done — spouse contact entered at registration is found by the lookup (no duplicate)." If anything deviated, say so plainly.

---

## Done when

- `pnpm --filter @cmt/portal vitest run src/app/register/family/__tests__/page.test.tsx` and `…/register-family.test.ts` are green.
- The full pre-push gate (`typecheck && lint && test && build`) passes (it runs on push; never `--no-verify`).
- The UAT walkthrough (Task 4) confirms a spouse's registration-entered contact resolves to the existing family.

## Out of scope (Phase B — separate plan)

Find-screen multi-contact search; OTP-verified "My contacts" add (`POST /api/setu/contacts/{send-code,verify-code}`, `canAccessRoute` allowlist); the one-time post-sign-in nudge; `MemberDoc.altEmails/altPhones` + contactKey `source`/`verifiedAt`; backfilling existing families.
