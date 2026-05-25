# Mobile API integration

This document is the contract for building a native (iOS / Android / RN) mobile
client against the cmt-portal API. The portal exposes a stable Bearer-token
auth flow that mirrors the web cookie flow.

## TL;DR

- **Auth:** OTP via SES (email) or SNS (phone). Server returns a `customToken`
  in mobile mode; client exchanges via the Firebase Auth SDK for an ID token;
  send that ID token as `Authorization: Bearer <token>` on every API call.
- **Endpoints:** same paths as web — pass `mode=mobile` (in body or `?mode=mobile`)
  on session-minting routes to get a `customToken` back instead of an
  httpOnly cookie.
- **CORS:** mobile origins (Expo dev, Capacitor) must be added to
  `MOBILE_CORS_ORIGINS` (comma-separated env var on the Vercel project).
  Native iOS/Android with raw HTTP bypass CORS entirely.

---

## Authentication flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. POST /api/setu/auth/send-code                                         │
│    body: { type: 'email' | 'phone', value: '...' }                      │
│    → 200 { success: true }   (always 200 — anti-enum)                   │
│    User gets OTP at the contact.                                         │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. POST /api/setu/auth/verify-code?mode=mobile                          │
│    body: { type, value, code: '123456', mode: 'mobile' }                │
│    → 200 { customToken } if existing family/admin/welcome-team          │
│    → 200 { redirectTo: '/register?contact=verified' } if new user      │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. Client: firebase.auth().signInWithCustomToken(customToken)           │
│    Then: const idToken = await user.getIdToken()                        │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. Every subsequent API call:                                            │
│    headers: { Authorization: `Bearer ${idToken}` }                       │
│    Middleware verifies via verifyPortalIdToken() and attaches claims.    │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. Refresh: ID tokens expire every hour. Call user.getIdToken(true) to  │
│    force-refresh before requests near expiry, or catch 401 and retry.    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Registration flow (new user, no existing family)

After verify-code returns `redirectTo: '/register?contact=verified'`:

```
POST /api/setu/family-lookup
  body: { email, phone }
  → 200 { match: null }                       // → create new family
  → 200 { match: { fid, name, members } }     // → join existing

POST /api/setu/register?mode=mobile           // new family path
  body: { email, phone, familyName, location, manager: {firstName, lastName, gender},
          additionalMembers: [...], mode: 'mobile' }
  → 200 { fid, mid, customToken }              // sign-in with customToken

POST /api/setu/family/join?mode=mobile         // join-existing path
  body: { fid, contactProof: { type, value }, mode: 'mobile' }
  → 200 { fid, mid, customToken }
```

### Invite-accept flow

```
GET  /api/setu/invite/{token}                  // any signed-in user
  → 200 { familyName, inviterName, relation, expiresAt }
  → 404 / 410 / 409 on bad / expired / accepted invite

POST /api/setu/invite/accept?mode=mobile
  body: { token, mode: 'mobile' }
  → 200 { mid, fid, redirectTo: '/family', customToken }
  (Caller needs an OTP-verified session BEFORE this — Bearer header required.
  See email-match check inside the route.)
```

### Sign out

```
POST /api/setu/auth/signout?mode=mobile
  → 200 { ok: true }
  Client drops the local ID token. No server state to clear (cookie is web-only).
```

---

## API endpoint reference

All endpoints accept `Authorization: Bearer <ID_TOKEN>` from middleware.
Multi-role claims work: a family-manager with `extraRoles: ['admin']` can call
both `/api/setu/family/*` and `/api/admin/*` endpoints with the same token.

### Auth + onboarding (public)
| Method | Path | Body | Mobile mode |
|--------|------|------|-------------|
| POST | `/api/setu/auth/send-code` | `{ type, value }` | n/a — always 200 |
| POST | `/api/setu/auth/verify-code` | `{ type, value, code, mode? }` | ✅ returns `customToken` |
| POST | `/api/setu/auth/signout` | `{ mode? }` or query | ✅ returns `{ ok: true }` |
| POST | `/api/setu/family-lookup` | `{ email, phone }` | n/a — pure lookup |
| POST | `/api/setu/register` | `{ ..., mode? }` | ✅ returns `customToken` |
| POST | `/api/setu/family/join` | `{ ..., mode? }` | ✅ returns `customToken` |

### Family member (Bearer required)
| Method | Path | Capability |
|--------|------|------------|
| GET | `/api/setu/family` | family-manager OR family-member |
| GET | `/api/setu/members` | family-manager OR family-member |
| POST | `/api/setu/members` | family-manager only |
| PATCH | `/api/setu/members/{mid}` | manager OR self-edit (mid === claims.mid) |
| DELETE | `/api/setu/members/{mid}` | family-manager only |

### Invite (Bearer required)
| Method | Path | Capability |
|--------|------|------------|
| POST | `/api/setu/invite/send` | family-manager only |
| GET | `/api/setu/invite/{token}` | any signed-in user |
| POST | `/api/setu/invite/accept` | any signed-in user, mobile mode ✅ |

### Welcome team (Bearer required, role=welcome-team OR admin)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/setu/family/search?q=...` | search hits (top 20, deduped by fid) |

### Admin (Bearer required, role=admin OR extraRoles contains admin)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/admin/welcome-team` | list welcome-team users |
| POST | `/api/admin/welcome-team` | `{ email }` — grant welcome-team |
| DELETE | `/api/admin/welcome-team/{uid}` | revoke welcome-team |

Legacy `/api/check-in/admin/*` routes still work for admin role but are scheduled
for retirement in Slice 5.

---

## CORS

Native iOS/Android using raw HTTP (URLSession / OkHttp) bypass CORS — no
configuration needed.

React Native (fetch) and Capacitor (WebView with `file://` or `capacitor://`)
DO send `Origin` headers and the browser/WebView enforces CORS.

**Configuration:** set `MOBILE_CORS_ORIGINS` on the Vercel project as a
comma-separated list of allowed origins. Example:

```
MOBILE_CORS_ORIGINS=http://localhost:8081,exp://192.168.1.100:8081,capacitor://localhost
```

Middleware emits `Access-Control-Allow-Origin: <matched origin>` (echo, not
wildcard, since we set `Access-Control-Allow-Credentials: true`),
`Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS`, and
`Allow-Headers: authorization,content-type`. Preflight OPTIONS returns 204
with these headers and no body.

Empty/unset = no CORS headers emitted (current production behavior).

---

## Error contract

All errors are JSON: `{ error: '<code>' }` with a relevant HTTP status:

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `bad-request` | Schema validation failed. Some routes include `fields` object. |
| 401 | `no-session` | Middleware: missing/invalid Bearer or cookie. |
| 401 | `invalid-or-expired` | verify-code: OTP wrong or > 10min old. |
| 403 | `forbidden` | canAccessRoute denied. |
| 403 | `email-mismatch` | invite/accept: signed-in email ≠ invite email. |
| 404 | `not-found` | Resource doesn't exist OR `flags.setuAuth=false`. |
| 409 | `duplicate-contact` | register: email/phone already in another family. |
| 409 | `already-accepted` | invite/accept: invite already used. |
| 409 | `contact-already-registered` | accept: contactKey owned by another family. |
| 410 | `expired` | invite/accept: invite past `expiresAt`. |
| 429 | `rate-limited` | send-code: too many OTP requests for this contact. Response includes `resetAt`. |
| 500 | (Error string) | Unhandled — should be reported. |

---

## Token refresh strategy

Firebase ID tokens expire every hour. Two patterns:

**1. Proactive refresh (recommended)**
```ts
// Refresh 5 min before expiry
const result = await user.getIdTokenResult();
const expiresAt = new Date(result.expirationTime).getTime();
if (expiresAt - Date.now() < 5 * 60_000) {
  idToken = await user.getIdToken(true);
}
```

**2. Reactive (on 401)**
```ts
if (res.status === 401) {
  idToken = await user.getIdToken(true);
  // retry once
}
```

The portal does not implement refresh-token rotation server-side; Firebase
handles it via the SDK. Stale ID tokens always fail middleware.

---

## Multi-role behavior on mobile

A user with `claims.role = 'family-manager'` and `claims.extraRoles = ['admin']`:

- `/api/setu/family/*` works (family-manager)
- `/api/admin/*` works (admin via extras)
- `/api/setu/family/search` works (admin inherits welcome-team)

The mobile client doesn't need to know about extras — it just uses the same
Bearer token everywhere. The server resolves capability per-route.

To check what a user can do client-side, decode the ID token's claims:
```ts
const idResult = await user.getIdTokenResult();
const role = idResult.claims.role;
const extras = (idResult.claims.extraRoles as string[]) ?? [];
const isAdmin = role === 'admin' || extras.includes('admin');
```

---

## Testing the mobile flow against UAT

1. Get a UAT Firebase config (auth + project ID). Same project as web:
   `chinmaya-setu-uat`.
2. Add your dev origin to `MOBILE_CORS_ORIGINS` on the Vercel project.
3. Sign in via `verify-code?mode=mobile` with an email on the SES allowlist
   (`SETU_EMAIL_ALLOWLIST`) — currently `dineshdm7@gmail.com` and
   `dinesh.matta@outlook.com`.
4. Use Firebase Auth SDK to exchange the `customToken`.
5. Call any `/api/setu/*` endpoint with `Authorization: Bearer <idToken>`.

---

## Open items (not blocking initial mobile work)

- **API versioning** — paths are unversioned. If the response shape of any
  endpoint changes, shipped mobile builds will break. Consider prefixing
  `/api/v1/setu/*` before first mobile release.
- **OpenAPI / Swagger spec** — endpoint reference above is manual.
  Auto-generation from Zod schemas (e.g. `@asteasolutions/zod-to-openapi`)
  would keep it accurate.
- **Push notifications** — not currently wired. SES email and SNS SMS still
  handle all delivery.
