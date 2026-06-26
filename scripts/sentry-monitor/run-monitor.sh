#!/bin/zsh
# ─────────────────────────────────────────────────────────────────────────────
# CMT Sentry issue monitor — scheduler wrapper (run by a launchd LaunchAgent).
#
# Every 30 min launchd runs this. It launches ONE headless Claude pass that
# turns Sentry *error* issues into shipped fixes end-to-end for the small/safe
# ones, and ESCALATES the risky ones to a GitHub issue instead of touching code.
# The full policy (detect → triage → diagnose → fix-with-repro-test → gate →
# push → verify-post-deploy → resolve) lives in ./monitor-prompt.md. Protected
# surfaces (/api/setu contracts, auth, payments, schemas, indexes, migrations,
# env/config) are a HARD WALL — those are escalated, never auto-edited.
#
# Why launchd and NOT cron: `claude` (and `gh`) store credentials in the macOS
# login keychain, which a plain crontab job (outside the GUI session) cannot
# unlock. A LaunchAgent runs inside the logged-in user session, so the keychain
# is available. The `sentry` CLI token lives in ~/.sentry/cli.db (user-readable
# in any context). This wrapper aborts loudly if auth is unreachable.
#
# Controls:
#   Pause:   touch  ~/.cmt-sentry-monitor/PAUSE
#   Resume:  rm     ~/.cmt-sentry-monitor/PAUSE
#   Logs:    ~/.cmt-sentry-monitor/logs/run-*.log
#   State:   ~/.cmt-sentry-monitor/state.tsv   (what's been seen/escalated/resolved)
#   Disable: launchctl bootout gui/$(id -u)/org.chinmayatoronto.cmt-sentry-monitor
#
# Attention sentinels (a human should look when these appear):
#   ~/.cmt-sentry-monitor/WEDGED     a run bailed (dirty human tree / diverged main / breach)
#   ~/.cmt-sentry-monitor/ALERT.log  a pass committed under a PROTECTED path (guardrail breach)
# ─────────────────────────────────────────────────────────────────────────────
set -u

SCRIPT_DIR="${0:A:h}"          # …/scripts/sentry-monitor
REPO="${SCRIPT_DIR:h:h}"       # repo root (two levels up)

# launchd hands us a minimal PATH; rebuild one that can find claude/node/pnpm/gh/git/sentry.
NODE_BIN=""
[[ -d "$HOME/.nvm/versions/node" ]] && \
  NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.local/bin${NODE_BIN:+:$NODE_BIN}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

STATE_DIR="$HOME/.cmt-sentry-monitor"
LOG_DIR="$STATE_DIR/logs"
LOCK_DIR="$STATE_DIR/run.lock"
PAUSE_FILE="$STATE_DIR/PAUSE"
STATE_FILE="$STATE_DIR/state.tsv"
KILL_MARKER="$STATE_DIR/last-kill"
WEDGED="$STATE_DIR/WEDGED"
PROMPT_FILE="$SCRIPT_DIR/monitor-prompt.md"
export MONITOR_DRY_RUN="${MONITOR_DRY_RUN:-0}"   # set once; used throughout

mkdir -p "$LOG_DIR"
[[ -f "$STATE_FILE" ]] || : > "$STATE_FILE"   # ensure the state log exists for the pass to read
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/run-$TS.log"
exec >>"$LOG" 2>&1

echo "=== cmt-sentry-monitor run $TS ==="
echo "repo=$REPO dry_run=$MONITOR_DRY_RUN"

# Kill switch ------------------------------------------------------------------
if [[ -f "$PAUSE_FILE" ]]; then
  echo "PAUSE file present — skipping."
  exit 0
fi

# No-overlap lock (macOS has no flock; mkdir is atomic) ------------------------
# 60-min stale reclaim > 40-min watchdog kill, so a wedged run self-terminates
# before its lock becomes reclaimable — no double-execution window.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [[ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +60 2>/dev/null)" ]]; then
    echo "Stale lock (>60m) — reclaiming."
    rm -rf "$LOCK_DIR" && mkdir "$LOCK_DIR" || { echo "FATAL: cannot reclaim lock"; exit 1; }
  else
    echo "Another run holds the lock — exiting."
    exit 0
  fi
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

# Tool + auth sanity (fail loud, not silent) ----------------------------------
for t in claude gh git node pnpm sentry; do
  command -v "$t" >/dev/null || { echo "FATAL: $t not on PATH"; exit 1; }
done
if ! gh auth token >/dev/null 2>&1; then
  echo "FATAL: gh not authenticated in this context (login keychain unreachable?)."
  echo "       Ensure the user is logged into the GUI session, or store a PAT in GH_TOKEN."
  exit 1
fi
if ! sentry auth status >/dev/null 2>&1; then
  echo "FATAL: sentry CLI not authenticated (run: sentry auth login)."
  exit 1
fi

cd "$REPO" || { echo "FATAL: cannot cd $REPO"; exit 1; }

# Dirty-tree handling ----------------------------------------------------------
# Only TRACKED modifications matter (untracked files like .env.local are fine).
# Distinguish watchdog kill-debris (safe to discard) from in-progress human work
# (must NOT clobber) using the kill-marker the watchdog writes before a hard kill.
if ! git diff --quiet HEAD 2>/dev/null; then
  if [[ -f "$KILL_MARKER" ]]; then
    echo "Dirty tree + kill-marker → discarding watchdog debris (git reset --hard; git clean -fd)."
    git reset --hard HEAD; git clean -fd
  else
    echo "WEDGE: dirty tracked tree and NO kill-marker — looks like in-progress human work."
    echo "       Refusing to run so I don't clobber it. Commit/stash/clean, then it resumes."
    git status --short || true
    : > "$WEDGED"
    exit 2
  fi
fi
rm -f "$KILL_MARKER"   # clear after evaluation (a killed-but-clean run must not leave it stale)

# Divergence guard -------------------------------------------------------------
# Never operate on a local main that's ahead of origin: that means a prior run's
# push was rejected, and policy forbids --force, so it can never self-recover.
git fetch --quiet origin main 2>/dev/null || echo "warn: git fetch failed (continuing)."
AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
if [[ "${AHEAD:-0}" -gt 0 ]]; then
  echo "WEDGE: local main is $AHEAD commit(s) ahead of origin/main — a previous push likely failed."
  echo "       Refusing to run (policy forbids --force; a human must reconcile)."
  git log --oneline origin/main..HEAD 2>/dev/null | head || true
  : > "$WEDGED"
  exit 2
fi
git merge --ff-only --quiet origin/main 2>/dev/null || echo "warn: could not fast-forward to origin/main (continuing)."

rm -f "$WEDGED"   # reached a clean, non-diverged tree → clear any prior wedge alert

export MONITOR_REPO="$REPO"
export MONITOR_STATE_FILE="$STATE_FILE"
START_SHA="$(git rev-parse HEAD 2>/dev/null)"

# Process-tree kill helper (macOS has no setsid; signal descendants recursively
# so a hard kill doesn't orphan git/pnpm/subagent children).
kill_tree() {
  local _pid="$1" _sig="$2" _c
  for _c in ${(f)"$(pgrep -P "$_pid" 2>/dev/null)"}; do kill_tree "$_c" "$_sig"; done
  kill "-$_sig" "$_pid" 2>/dev/null
}

echo "Launching headless Claude (opus)… start_sha=$START_SHA"
claude -p "$(cat "$PROMPT_FILE")" --model opus --dangerously-skip-permissions &
CLAUDE_PID=$!

# Watchdog: hard-stop a wedged pass after 40 min so it can't block the schedule.
( sleep 2400
  : > "$KILL_MARKER"            # tell the next run this was a hard kill (debris is safe to discard)
  kill_tree "$CLAUDE_PID" TERM
  sleep 20
  kill_tree "$CLAUDE_PID" KILL
) &
WATCHDOG_PID=$!

wait "$CLAUDE_PID"; RC=$?
kill "$WATCHDOG_PID" 2>/dev/null   # normal exit → cancel the watchdog before it writes the kill-marker

echo "=== claude exited rc=$RC ==="

# Defense-in-depth: the prompt forbids touching protected surfaces, but the only
# hard barrier under --dangerously-skip-permissions is text. Detect any protected
# path that slipped into a commit this pass made, and raise a loud, durable alert.
if [[ "$MONITOR_DRY_RUN" != "1" && -n "$START_SHA" ]]; then
  NEWHEAD="$(git rev-parse HEAD 2>/dev/null)"
  if [[ "$NEWHEAD" != "$START_SHA" ]]; then
    VIOL="$(git diff --name-only "$START_SHA" "$NEWHEAD" 2>/dev/null \
      | grep -Ei '/api/setu/|firestore\.indexes\.json|/auth/|claims|stripe|donation|payment|migrat' || true)"
    if [[ -n "$VIOL" ]]; then
      echo "ALERT: pass committed changes under PROTECTED paths (possible guardrail breach):"
      echo "$VIOL"
      { echo "ALERT $(date -u +%FT%TZ) range=$START_SHA..$NEWHEAD"; echo "$VIOL"; echo; } >> "$STATE_DIR/ALERT.log"
      : > "$WEDGED"
    fi
  fi
fi

exit $RC
