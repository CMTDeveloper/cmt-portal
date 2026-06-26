# Cloud Sentry monitor — setup (one-time)

The workflow `.github/workflows/sentry-monitor.yml` is **ship-disabled** until you complete the
steps below. It stays skipped on every scheduled tick (zero cost) until you set the enable flag.

**What it does:** hourly, on a GitHub Actions runner, it detects new Sentry error issues and either
ships a guarded fix to `main` (red→green test → `code-reviewer` → the full pre-push gate → push →
resolve) or files a GitHub issue for the risky ones. Policy: `cloud-monitor-prompt.md`.

**Accepted costs you chose** (so they're not a surprise):
- The build (inside the pre-push gate) runs with **real prod secrets from AWS SSM** and — with no
  RTDB snapshot in the cloud — reads the **legacy PROD RTDB (`715b8`) live at build** (billed).
- Claude runs on your **subscription** token, drawing on your Pro/Max usage limits.

---

## 1. Claude subscription token (no API billing)

```sh
claude setup-token          # OAuth flow; prints a sk-ant-oat01-… token (valid ~1 year). It is NOT saved.
gh secret set CLAUDE_CODE_OAUTH_TOKEN --body "sk-ant-oat01-…"
```
Do **not** also set `ANTHROPIC_API_KEY` anywhere — it would outrank the subscription token and switch
you to per-call billing. (The workflow never passes `--bare`, which would do the same.)

## 2. Sentry org auth token (must allow RESOLVE — not read-only)

Sentry → **Settings → Auth Tokens** (Organization Auth Tokens) → create a token with scopes
**`event:write` + `project:write` + `org:read`** (a `--read-only` token cannot resolve issues).

```sh
gh secret set SENTRY_AUTH_TOKEN --body "sntrys_…"
```

## 3. AWS — OIDC role + the SSM parameter (region: `ca-central-1`)

**3a. GitHub OIDC provider** (skip if your account already has it):
```sh
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 1c58a3a8518e8759bf075b76b750d4f2df264fce
# (AWS validates GitHub's OIDC via its CA now; the thumbprint is a CLI formality.)
```

**3b. IAM role** trusting this repo. Save as `trust.json` (replace `<ACCOUNT_ID>`):
```json
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike":  { "token.actions.githubusercontent.com:sub": "repo:CMTDeveloper/cmt-portal:*" }
  }
}]}
```
```sh
aws iam create-role --role-name cmt-sentry-monitor --assume-role-policy-document file://trust.json
```

**3c. Permissions** — read the one SSM param + decrypt it. Save as `perms.json` (replace `<ACCOUNT_ID>`):
```json
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": "ssm:GetParameter",
    "Resource": "arn:aws:ssm:ca-central-1:<ACCOUNT_ID>:parameter/cmt-portal/sentry-monitor/*" },
  { "Effect": "Allow", "Action": "kms:Decrypt", "Resource": "*" }
]}
```
```sh
aws iam put-role-policy --role-name cmt-sentry-monitor \
  --policy-name ssm-read --policy-document file://perms.json
```

**3d. Store the build env in SSM.** The workflow defensively strips `RTDB_SNAPSHOT_DIR` and
`SENTRY_ORG/PROJECT/AUTH_TOKEN`, so you can upload your local file as-is:
```sh
aws ssm put-parameter --region ca-central-1 \
  --name /cmt-portal/sentry-monitor/portal-env-local \
  --type SecureString \
  --value file://apps/portal/.env.local
# update later with: … put-parameter … --overwrite --value file://apps/portal/.env.local
```

**3e. Tell GitHub the role + region:**
```sh
gh secret set AWS_OIDC_ROLE_ARN --body "arn:aws:iam::<ACCOUNT_ID>:role/cmt-sentry-monitor"
gh secret set AWS_REGION --body "ca-central-1"
```

## 4. Smoke-test BEFORE enabling the schedule

```sh
# Dry run — detects/triages only, no fixes/pushes/issues/resolves.
gh workflow run "Sentry monitor (autonomous fix)" -f dry_run=true
gh run watch   # then read the "Run Sentry monitor pass" step output
```
A dry run still needs steps 1–3 (it authenticates + lists issues), but writes nothing. Confirm:
the AWS/SSM step succeeds, both CLIs authenticate, and the pass prints a clean **DRY RUN** report.

**Scope check (the one UNCERTAIN bit):** the exact scope for `sentry issue resolve` isn't documented.
Once there's a real (or throwaway) issue, confirm a manual `sentry issue resolve <PROJECT-123>` works
with your token. If it 403s, the token is missing `event:write` — regenerate it.

## 5. Enable

```sh
gh variable set SENTRY_MONITOR_ENABLED --body true
```
From the next `:17` past the hour, it runs hourly. **Off switch:** `gh variable set SENTRY_MONITOR_ENABLED --body false`.

---

## Operating it

- **Watch runs:** `gh run list --workflow "Sentry monitor (autonomous fix)"` → `gh run view <id> --log`.
- **What it changed:** fix commits are tagged `(sentry: <shortId>)`; escalations are GitHub issues
  whose body ends with `<!-- cmt-sentry-cloud-monitor -->`.
- **Cost dials:** the `cron:` cadence (hourly today) and `timeout-minutes: 30`. Lengthen the cron to
  cut both Actions minutes and subscription-quota draw.
- **Guardrails (unchanged from local):** protected paths (`/api/setu`, auth, payments, `*Doc`
  schemas, indexes, migrations, env/config) are escalated, never auto-edited. No fix ships without a
  red→green repro test. The pre-push gate (`typecheck && lint && test && build`) always runs — never
  `--no-verify`. Resolve is single-pass; Sentry auto-reopens regressions, which the next run's
  git-log check escalates rather than re-fixing in a loop.
