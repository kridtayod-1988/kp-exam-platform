# Exam Engine — Phase 2 implementation plan

## Delivery boundary

This phase is developed on `feat/exam-engine-staging` and targets Staging only.
No Production database, Worker configuration, deployment, or merge is included.
Migration `0004_auth_sessions.sql` is already recorded as applied in `kp_exam_platform_staging` (D1 read-back: `0004_auth_sessions`, 2026-11-11 15:57:13 UTC). Do not apply it again. No Production database was queried or changed.

## Authentication model

- Google OAuth 2.0 Authorization Code flow is handled by the API Worker.
- The callback validates the one-time state, nonce, Google token issuer, audience, expiry, subject, and verified email.
- Google client credentials and the session signing/pepper material are Worker secrets, never frontend variables or D1 values.
- A random opaque session token is stored only as a SHA-256 hash in D1 and sent in a Secure, HttpOnly, SameSite=Lax cookie.
- Session expiry and revocation are enforced server-side.
- State/nonce records are short-lived and single-use. Expired rows are cleaned on OAuth start. OAuth start is limited to five requests per edge IP per rolling minute using an atomic D1 insert/count and a keyed IP digest in the existing audit log.
- The browser receives a session-bound CSRF token derived with HMAC from the opaque session token and `SESSION_SECRET`. It is returned in a Secure, SameSite=Lax `__Host-kp_csrf` cookie and in the session response. The token is stable for the session, so opening another tab does not invalidate the first tab. Mutating requests require the header, matching CSRF cookie, stored hash, and an exact allowlisted Origin.
- Role is derived server-side from the configurable `ADMIN_EMAILS` allowlist. The initial Staging default may be `kridtayod@gmail.com`; it is not trusted from client input.

## Staging schema

Migration 0004 adds:
- `profiles`: stable internal profile ID, unique Google subject/email, and server-managed role.
- `auth_oauth_states`: one-time OAuth state and nonce.
- `auth_sessions`: hashed session token, CSRF hash, expiry, and revocation.
- `auth_audit_log`: login/logout/security events.
- Triggers requiring every new or reassigned attempt to reference an authenticated profile.

The Phase 1 `user_attempts.user_id` remains text-compatible and is constrained by triggers to reference `profiles.id`. This avoids a destructive table rebuild while preserving the current Staging data model.

## Exam Engine API contract

After the Auth gate is implemented:
- `GET /api/auth/session`: return the current profile and CSRF token, or unauthenticated.
- `GET /auth/google/start` and `GET /auth/google/callback`: OAuth flow.
- `POST /api/auth/logout`: revoke the current session.
- `POST /api/attempts`: accept only `exam_year_id`, `question_count` (10/25/50), and supported mode; choose active questions server-side.
- `PUT /api/attempts/:id/answers`: persist only answers belonging to the caller's in-progress attempt.
- `POST /api/attempts/:id/submit`: atomically score from server-side answer keys and make submission idempotent.
- `GET /api/attempts/:id/result`: return results only to the owning profile; reveal answer explanations only after submission.

No endpoint may accept a user ID, role, score, correct answer, or question snapshot from the browser as authoritative input.

## Required Worker configuration

Staging-only configuration will use:
- `GOOGLE_CLIENT_ID` (non-secret Worker variable)
- `GOOGLE_CLIENT_SECRET` (Worker secret)
- `GOOGLE_REDIRECT_URI` (exact Staging callback URL)
- `SESSION_SECRET` (Worker secret; high-entropy random value)
- `ADMIN_EMAILS` (comma-separated allowlist, initially including the configured admin email)
- `APP_ENV=preview`

Do not paste secrets into chat or commit them. Configure them directly in the Cloudflare Staging Worker environment.

## Verification gates

1. Unit tests for OAuth state/nonce, token claims, cookie flags, session expiry/revocation, CSRF, origin validation, and role derivation.
2. D1 integration tests for attempt ownership, question membership, answer bounds, transactional/idempotent submit, and result isolation.
3. Live Staging OAuth integration only after confirming Staging Worker secrets and callback configuration. Migration 0004 is already applied; never replay it.
4. Keep Preview/Production secrets and D1 bindings isolated. Never enable Preview question access in Production.


## Auth hardening implementation status

- CSRF no longer rotates on `GET /api/auth/session`. The token is deterministic for the current opaque session using HMAC-SHA-256 and the Worker secret `SESSION_SECRET`; every tab receives the same value. Logout checks the CSRF header, readable CSRF cookie, stored hash, and exact Origin.
- OAuth start is rate-limited to five starts per edge IP per rolling minute. The limiter stores only a keyed digest of `CF-Connecting-IP` in `auth_audit_log`; raw IPs, OAuth codes, tokens, and state values are not logged.
- Expired OAuth states are deleted before a new state is inserted. Callback state consumption remains a single-use `DELETE ... RETURNING`.
- OAuth integration tests mock the Google token and token-info endpoints. They cover successful Admin profile/session creation, exchange failure, nonce mismatch, rate limiting, expired-state cleanup, and multi-tab CSRF stability. These tests do not claim a live Google-provider sign-in.
- `SESSION_SECRET` must be configured as a high-entropy Staging Worker secret (at least 32 characters). It must not be committed or placed in `vars`.

## Staging Migration 0004 read-back

Read-only Cloudflare D1 inspection confirmed:
- `kp_schema_migrations` contains `0001_exam_engine`, `0002_exam_engine_integrity`, `0003_exam_engine_integer_question_ids`, and `0004_auth_sessions`.
- `profiles`, `auth_oauth_states`, `auth_sessions`, and `auth_audit_log` exist with the columns defined by Migration 0004.
- The two `trg_attempts_require_profile_*` triggers exist.
- The six checked auth/exam tables had zero rows at the time of inspection, including profiles and sessions.
- The D1 database-list metadata reported `num_tables: 0`, while a direct read-only `sqlite_master` query returned the tables and triggers above. Treat the metadata count as inconsistent/stale; the SQL read-back is the evidence used here.
- The earlier statement in this document that Migration 0004 was pending is superseded by this read-back. No migration was run during this inspection.
