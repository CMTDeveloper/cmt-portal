---
name: auditing-firestore-indexes
description: Audits Firestore queries in a cmt-portal change for missing composite indexes and deploys them to UAT only. Use when adding or changing any `.where().orderBy()` / multi-`where` query, or when a Setu page returns 500 FAILED_PRECONDITION ("the query requires an index"). Fake-firestore unit tests do NOT enforce indexes, so green tests prove nothing here.
---

# Auditing Firestore indexes

A compound Firestore query needs a matching composite index declared in
`firestore.indexes.json` (repo root). The fake-firestore used by unit tests is
**index-blind**, so a missing index passes every test and only throws
`9 FAILED_PRECONDITION` in UAT/prod. This bit `/family/seva`: the `(sevaYear,
status, date)` index existed, but the unfiltered `where('sevaYear','==').orderBy
('date')` query needed a separate `(sevaYear, date)` index.

## The index-matching rule (read this first)
For `where(A == …).where(B == …).orderBy(C)` the index must be exactly
`(A, B, C)` — equality fields, then the orderBy field, in that order. Crucial
corollary:

> A 3-field index `(A, B, C)` does **NOT** serve `where(A).orderBy(C)`. The
> middle equality field `B` cannot be skipped. Two query shapes over the same
> collection usually need two indexes.

Single-field `where(A == …)` with no `orderBy` (or `orderBy` on the same field)
uses Firestore's automatic single-field index — no entry needed.

## Workflow
```
- [ ] 1. List every compound query the change adds/touches
- [ ] 2. For each, write (equality fields…, orderBy) and find its index
- [ ] 3. Add any missing index to firestore.indexes.json
- [ ] 4. Deploy to UAT ONLY (never --force, never prod 715b8)
- [ ] 5. Wait for the build; reproduce the real query against UAT
- [ ] 6. Update runbook §14 + a prod-TODO for the prod index deploy
```

**1–2. Find + classify.** Grep changed feature/route code:
```bash
rg -n '\.where\(|\.orderBy\(' apps/portal/src --glob '!**/__tests__/**' <changed-paths>
```
For each query note the equality fields and the orderBy field, then search
`firestore.indexes.json` for a `fields` array that matches `[…equality, orderBy]`
in order. Watch for two shapes (e.g. with-status vs without-status) sharing one
index — that's the classic gap.

**3. Add the index.** Append to the `indexes` array, mirroring the existing
shape (`collectionGroup`, `queryScope: "COLLECTION"` or `"COLLECTION_GROUP"`,
ordered `fields`).

**4. Deploy to UAT — the only safe command:**
```bash
firebase deploy --only firestore:indexes --project chinmaya-setu-uat
```
- NEVER pass `--force`. NEVER target `chinmaya-setu-715b8` (prod is shared with
  the standalone kiosk app; `--force` would delete its indexes). UAT is
  portal-only, so a normal deploy there is safe and only *adds* the new index.

**5. Verify.** Indexes build asynchronously (minutes). A query against a
still-building index throws `FAILED_PRECONDITION: index is currently building` —
that's progress, not failure. Poll by reproducing the actual query (see
`reproducing-setu-bugs-in-uat`) until it returns data.

**6. Runbook.** Add a dated `docs/runbooks/production-cutover-checklist.md` §14
entry with the prod-TODO: deploy the same index to `715b8` (no `--force`, per §5)
and let it finish building **before** the triggering state exists in prod.

## Watch for config-gated queries
Some queries only run once an admin sets a config (e.g. seva's `currentSevaYear`).
The index gap then stays latent until that state exists — so test/walk the feature
in its **active/configured** state, not the default empty one.
