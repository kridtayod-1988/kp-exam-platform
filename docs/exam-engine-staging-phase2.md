# Exam Engine — Phase 2 implementation plan

## Delivery boundary

This phase is developed on `feat/exam-engine-staging` and targets Staging only.
No Production database, Worker configuration, deployment, or merge is included.
Migration `0004_auth_sessions.sql` is prepared but is **not applied** until separately approved.

## Authentication model

- Google OAuth 2.0 Authorization Code flow is handled by the API Worker.
- The callback validates the one-time state, nonce, Google token issuer, audience, expiry, subject, and verified email.
- Google client credentials and the session signing/pepper material are Worker secrets, never frontend variables or D1 values.
- A random opaque session token is stored only as a SHA-256 hash in D1 and sent in a Secure, HttpOnly, SameSite=Lax cookie.
- Session expiry and revocation are enforced server-side.
- State/nonce records are short-lived and single-use.
- The browser receives a separate CSRF token; mutating requests require both the token header and an allowed Origin.
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
3. Live Staging integration only after migration 0004 is separately approved and applied.
4. Keep Preview/Production secrets and D1 bindings isolated. Never enable Preview question access in Production.
