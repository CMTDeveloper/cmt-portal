# Sentry issue monitor (durable, launchd)

An unattended pass that watches this project's **Sentry error issues** and turns the
small/safe ones into shipped fixes — **end to end, detection → resolution** — while
escalating the risky ones to a GitHub issue instead of touching code. It is the Sentry
sibling of `scripts/github-monitor/` and reuses the same hardened wrapper mechanics.

Intended flow: a real error fires in production → within ~30 min the monitor triages it →
it either ships a fix to `main` (guarded by a red→green repro test + `code-reviewer` +
the pre-push gate) and resolves the Sentry issue once it's confirmed gone post-deploy, or
files a GitHub issue asking for a human decision.

## The loop

| Phase | What it does |
|---|---|
| **0. Verify** | For fixes pushed on a prior run (`pending-verify`): once ≥20 min have passed (Vercel deployed), check if new events still arrive. None → `sentry issue resolve --in <sha>` (Sentry auto-reopens on regression). Still arriving → file a GitHub issue (`fix-ineffective`). |
| **1. Detect** | `sentry issue list … --query "is:unresolved level:error" --sort=freq`, minus anything already terminal in the state file. |
| **2. Triage** | Drop noise (top frame not in our code, `ResizeObserver`/`ChunkLoadError`/network/bot, single fresh one-offs). |
| **3. Diagnose** | `issue view`/`issue events` (source-mapped stack → file:line), `issue plan` (Seer AI) as a hint, then read the real source. |
| **4. Classify** | Protected surface or non-reproducible or ambiguous → **escalate** (GitHub issue, no code change). Else → auto-fix. |
| **5. Fix** | Red repro test → minimal fix → green → `code-reviewer` (opus) → `git push` (full gate) → record `pending-verify`. **Cap: 2 fixes/run.** |

## Resolution model

**Full auto** for small/safe defects on **non-protected** surfaces — but with three rails that
never come off:

1. **The pre-push gate always runs** (`typecheck && lint && test && build`). Never `--no-verify`.
2. **A fix only ships if it carries a test that went red→green.** No reproducing test ⇒ it
   escalates to a GitHub issue instead of guessing at prod.
3. **Resolve happens a run *later* than the fix**, only after the issue stops producing events
   post-deploy — and via `resolve --in <release>`, so Sentry auto-reopens any regression.

## Protected paths — a hard wall (escalated, never auto-edited)

Even though resolution is "full auto", these surfaces are **never** changed unattended; a fix that
would touch them is filed as a GitHub issue for a human:

- `apps/portal/src/app/api/setu/**` (mobile-mirrored API contracts)
- any Zod `*Doc` schema, `firestore.indexes.json`
- `**/auth/**`, `packages/shared-domain/src/auth/`, custom-claims code
- `*stripe*` / `*donation*` / `*payment*` (money)
- migration / backfill / data-rewrite scripts
- env files, `vercel.ts` / `vercel.json`, cron declarations, build config, dependency manifests

To widen what the monitor may fix on its own, relax the PROTECTED PATHS list in `monitor-prompt.md`
(and the breach-detector grep in `run-monitor.sh`) — deliberately, one surface at a time.

## Pieces

| File | Where | Role |
|---|---|---|
| `monitor-prompt.md` | this dir (in repo) | the policy + procedure the headless Claude pass follows |
| `run-monitor.sh` | this dir (in repo) | wrapper: PATH/auth sanity, lock, kill-switch, watchdog, breach detector, launches `claude -p` |
| `org.chinmayatoronto.cmt-sentry-monitor.plist` | `~/Library/LaunchAgents/` (machine-local) | the launchd schedule (every 30 min) |
| `state.tsv`, `logs/`, `PAUSE`, `run.lock` | `~/.cmt-sentry-monitor/` (machine-local) | run state |

`state.tsv` is the cross-run memory: `ISO8601<TAB>shortId<TAB>status<TAB>detail`, where status is
`seen-noise` / `escalated` / `pending-verify` / `resolved` / `fix-ineffective`.

## Why launchd, not crontab

`claude` (and `gh`) store credentials in the **macOS login keychain**. A `crontab` job runs outside
the GUI session and can't unlock it. A **LaunchAgent** runs inside the logged-in user session, where
the keychain is available. (Requirement: the user must be logged into the Mac for a run to
authenticate.) The `sentry` CLI token lives in `~/.sentry/cli.db`, readable in any context.

## Operating it

```sh
# Install / activate (machine-local — copy the plist to LaunchAgents first if needed)
cp scripts/sentry-monitor/org.chinmayatoronto.cmt-sentry-monitor.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/org.chinmayatoronto.cmt-sentry-monitor.plist

# Pause / resume (takes effect on the next tick — no reload needed)
touch ~/.cmt-sentry-monitor/PAUSE
rm    ~/.cmt-sentry-monitor/PAUSE

# Watch what it did
ls -t ~/.cmt-sentry-monitor/logs/ | head
tail -f ~/.cmt-sentry-monitor/logs/run-*.log
cat ~/.cmt-sentry-monitor/state.tsv

# Trigger a run right now (respects PAUSE/lock)
launchctl kickstart -k gui/$(id -u)/org.chinmayatoronto.cmt-sentry-monitor

# Dry run (reports what it WOULD do — no fixes, pushes, GH issues, or resolves)
MONITOR_DRY_RUN=1 zsh scripts/sentry-monitor/run-monitor.sh   # then read the newest log

# Disable entirely / re-enable
launchctl bootout   gui/$(id -u)/org.chinmayatoronto.cmt-sentry-monitor
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/org.chinmayatoronto.cmt-sentry-monitor.plist
```

The wrapper self-protects: skips if the working tree has uncommitted tracked changes (won't clobber
in-progress work), uses an atomic lock (no overlapping runs), refuses to run if local `main` diverged
from origin, a 40-min watchdog kills a wedged pass, and a post-run breach detector raises a durable
`ALERT.log` if any commit touched a protected path.
