# KP-EXAM Authentication and Authorization

## Current verified state

The frontend configuration currently has `authEnabled: false` and `demoMode: true`. The repository does not yet contain a verified Google OAuth callback, server-side session implementation, or role-enforcement middleware. The API Worker added in this branch is only a D1-backed health scaffold; unimplemented API paths return HTTP 501.

Do not enable production login or advertise Admin functionality as live until the implementation and tests below are complete.

## Target sign-in flow

1. The browser starts Google Identity Services sign-in using a public OAuth client ID configured for the exact frontend origin.
2. The browser sends the returned Google ID token to a dedicated API authentication endpoint over HTTPS.
3. The API verifies the token signature using Google's published keys and validates `iss`, `aud`, `exp`, and required claims. It must also validate the hosted-domain claim only if the product intentionally restricts domains.
4. The API maps the verified Google subject (`sub`) to a local user record. Email alone is not a stable identity key.
5. The API checks account status and reads the role from the database. The browser must never be allowed to set its own role.
6. The API creates a cryptographically random, opaque session identifier. Store only a hash of the session token in D1, with creation, expiry, revocation, and user references.
7. Return the session only in a `Secure; HttpOnly; SameSite=Lax` cookie, using a narrow cookie path and an appropriate domain. Do not put ID tokens or session tokens in localStorage or sessionStorage.
8. On each protected request, the API validates the session, expiry, revocation state, and current user status. Sensitive state-changing requests also require CSRF protection and Origin validation.

## Authorization flow

- Public routes are explicitly allowlisted.
- Authenticated user routes require a valid session and an active account.
- The API derives the user ID from the validated session, never from request JSON, query parameters, or browser state.
- Admin routes require a fresh server-side role lookup and an explicit `admin` role check on every request.
- Hiding the Admin navigation item is a user-interface convenience only; it is not an authorization control.
- User-owned records (attempts, answers, results, profile data) must be scoped to the session user in every SQL query.
- Admin actions should write an audit event with actor, action, target, timestamp, and safe metadata.
- Role changes and initial Admin bootstrap must be restricted to a controlled administrative process; never trust a client-supplied email or role.

## Required security controls

- Exact CORS allowlist for the production frontend and approved Preview origins; credentialed requests must not use wildcard origins.
- HTTPS only, secure cookie attributes, session rotation after login and privilege changes, logout/revocation, and bounded session lifetime.
- Rate limits for sign-in, token exchange, and sensitive actions.
- Parameterized SQL, input validation, consistent error responses, and no secrets in frontend assets.
- Do not return `correct_index`, answer keys, or explanations before submission. Calculate exam scores on the server.
- Keep Preview D1 isolated from Production D1 and never use production user data for Preview testing.

## Minimum acceptance tests

1. Missing, malformed, expired, wrong-audience, and invalid-signature Google tokens are rejected.
2. A valid Google identity can establish a session; replayed or revoked sessions are rejected.
3. Logout revokes the session.
4. Inactive users cannot access protected endpoints.
5. A normal User receives 403 from every Admin endpoint even if they manually construct the request.
6. An Admin can access only the explicitly authorized Admin operations.
7. A user cannot read or modify another user's attempts, answers, or results by changing an ID.
8. Cross-origin credentialed requests from unapproved origins are rejected.
9. Preview API requests use the staging D1 database, not Production.
10. Authentication failures and Admin actions are auditable without logging tokens or secrets.
