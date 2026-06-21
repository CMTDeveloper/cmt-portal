# GitHub issue monitor (durable, launchd)

An unattended maintenance pass that watches this repo's GitHub issues/comments and
**fixes the small, safe ones** automatically — risky items get a comment asking for a
human decision instead. Intended workflow: a tester (e.g. Vaibhav) files a GitHub
issue → within ~15 min the monitor triages it → it either ships a small fix to UAT and
comments the commit SHA, or asks a clarifying question.

## Pieces

| File | Where | Role |
|---|---|---|
| `monitor-prompt.md` | this dir (in repo) | the guardrail policy + procedure the headless Claude pass follows |
| `run-monitor.sh` | this dir (in repo) | wrapper: PATH/auth sanity, lock, kill-switch, watchdog, launches `claude -p` |
| `org.chinmayatoronto.cmt-github-monitor.plist` | `~/Library/LaunchAgents/` (machine-local) | the launchd schedule (every 15 min) |
| `watermark.txt`, `logs/`, `PAUSE`, `run.lock` | `~/.cmt-github-monitor/` (machine-local) | run state |

## Why launchd, not crontab

Both `gh` and `claude` store credentials in the **macOS login keychain**. A plain
`crontab` job runs outside the GUI session and can't unlock it, so it would silently
fail to authenticate. A **LaunchAgent** runs inside the logged-in user session, where
the keychain is available. (Requirement: the user must be logged into the Mac for a
run to authenticate.)

## Guardrails (what it will and won't do on its own)

**Will fix + push + comment:** UI copy, styling, single-file bug fixes with an obvious
expected outcome, tests, docs (≤ ~6 files).

**Will only comment + ask (never autonomous code):** data-model / Firestore schema /
Zod `*Doc` schema / index / migration changes; `/api/setu/**` contract changes; auth /
roles / claims; payments / Stripe; env / Vercel / cron / build config; anything touching
prod; large/architectural changes; anything ambiguous. Caps at **2 issues per run**.

Every autonomous change goes through a `code-reviewer` subagent and the pre-push gate
(`typecheck && lint && test && build`) before it can land. Every comment ends with
`<!-- cmt-auto-monitor -->` so the monitor never replies to itself.

## Operating it

```sh
# Pause / resume (takes effect on the next tick — no reload needed)
touch ~/.cmt-github-monitor/PAUSE
rm    ~/.cmt-github-monitor/PAUSE

# Watch what it did
ls -t ~/.cmt-github-monitor/logs/ | head
tail -f ~/.cmt-github-monitor/logs/run-*.log

# Trigger a run right now (respects PAUSE/lock)
launchctl kickstart -k gui/$(id -u)/org.chinmayatoronto.cmt-github-monitor

# Dry run (reports what it WOULD do, no pushes/comments) — set the env in the plist
#   then: launchctl bootout … && launchctl bootstrap … && kickstart -k …

# Disable entirely / re-enable
launchctl bootout   gui/$(id -u)/org.chinmayatoronto.cmt-github-monitor
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/org.chinmayatoronto.cmt-github-monitor.plist
```

The wrapper also self-protects: it skips if the working tree has uncommitted tracked
changes (won't clobber in-progress work), uses an atomic lock (no overlapping runs), and
a 40-min watchdog kills a wedged pass so it can't block the schedule.
