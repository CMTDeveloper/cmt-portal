#!/usr/bin/env bash
# PostToolUse hook — after any Firebase/Firestore DB change, remind to update the
# production cutover runbook (docs/runbooks/production-cutover-checklist.md) in the
# SAME change. Reads the tool-call JSON on stdin; emits a reminder (systemMessage +
# additionalContext) only when a DB-write is detected. Non-blocking, never fails.
#
# Fires on:
#   - Bash:  `firebase deploy … firestore:indexes`  (index deploy)
#            a write ops-script: pnpm `migrate:` / `seed:` / `backfill:` / `wipe:` /
#            `school-year:` alias, or a `tsx scripts/<write-named>.ts` run
#   - Edit/Write/MultiEdit: a change to `firestore.indexes.json`
# Skips `--dry-run` Bash runs (no actual write) and read-only inspect/check/list/
# debug/snapshot scripts.
set -uo pipefail

input="$(cat)"
have_jq() { command -v jq >/dev/null 2>&1; }
field() { # $1 = jq path; safe fallback if jq missing
  if have_jq; then printf '%s' "$input" | jq -r "$1 // \"\"" 2>/dev/null; fi
}

tool="$(field '.tool_name')"
cmd="$(field '.tool_input.command')"
fp="$(field '.tool_input.file_path')"

db_change=0
case "$tool" in
  Bash)
    if printf '%s' "$cmd" | grep -q -- '--dry-run'; then
      db_change=0  # dry run writes nothing
    elif printf '%s' "$cmd" | grep -Eq \
      'firebase[^|&;]*deploy[^|&;]*firestore:indexes|(migrate|seed|backfill|wipe|school-year):[a-z]|scripts/(migrate|seed|backfill|assign|grant|promote|start-new-year|wipe)[a-z0-9-]*\.ts'; then
      db_change=1
    fi
    ;;
  Edit|Write|MultiEdit)
    printf '%s' "$fp" | grep -q 'firestore\.indexes\.json' && db_change=1
    ;;
esac

[ "$db_change" -eq 1 ] || exit 0

MSG="⚠️  Firebase/Firestore DB change detected — update docs/runbooks/production-cutover-checklist.md in the SAME change (§3 collections · §5 indexes · §6 migration sequence · §10 script reference · §14 dated change-log)."
CTX="A Firebase/Firestore DB change was just made (a Firestore index deploy, a write ops-script run — migrate:/seed:/backfill:/wipe:/school-year:/tsx scripts — or an edit to firestore.indexes.json). Per the repo maintenance rule, the production cutover runbook docs/runbooks/production-cutover-checklist.md MUST be updated in the same change: §3 (collection ownership map) for any new collection/field, §5 (prod index deploy list) for any new index, §6 (prod data-migration sequence) for any new migration step, §10 (CLI script reference) for any new script, and a dated §14 change-log entry describing the change + its prod-cutover TODO. Treat updating the runbook as required before this task is considered done."

if have_jq; then
  jq -cn --arg m "$MSG" --arg c "$CTX" \
    '{systemMessage:$m, hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:$c}}'
else
  # jq unavailable: still surface the reminder on stderr (shown in transcript).
  printf '%s\n' "$MSG" >&2
fi
exit 0
