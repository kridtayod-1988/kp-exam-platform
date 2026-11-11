# Cloudflare deployment topology

This repository intentionally contains two independently configured Workers.

| Worker | Wrangler config | Cloudflare Builds root directory | Purpose |
| --- | --- | --- | --- |
| `kp-exam-platform` | `/wrangler.jsonc` | `/` | Static frontend assets |
| `kp-exam-api` | `/workers/api/wrangler.jsonc` | `/workers/api` | API Worker and D1 access |

## Workers Builds settings

Configure the two GitHub-connected Workers separately. Do not point both build configurations at the root Wrangler file.

### Frontend Worker

- Root directory: repository root
- Build command: `npm install`
- Production deploy command: `npx wrangler deploy`
- Preview deploy command: `npx wrangler preview`

### API Worker

- Root directory: `workers/api`
- Build command: `npm install`
- Production deploy command: `npx wrangler deploy --config wrangler.jsonc`
- Preview deploy command: `npx wrangler preview --config wrangler.jsonc`

The API directory has its own package manifest so Wrangler is installed in that build root. Keep the Wrangler version at or above 4.135.0 for Worker Previews; this repository currently specifies ^4.160.0.

## D1 isolation

- Production API binding `DB` points to `kp_exam_platform_db`.
- Worker Preview binding `DB` points to the separate `kp_exam_platform_staging` database.
- Do not copy the production database ID into the Preview binding.
- Schema changes in this PR are additive migrations. Apply them only to the Staging D1 database after reviewing the SQL. Never run them against Production as part of this PR.

## Preview security configuration

- The Preview API allowlists only the current Frontend Preview origin: `https://feat-exam-engine-staging-kp-exam-platform.workers.dev`.
- Credentialed CORS is enabled only for that exact allowlisted origin. Wildcard origins are not used.
- Question content preview remains disabled by default (`QUESTION_PREVIEW_ENABLED=false`).
- For isolated review only, configure the Worker Preview secret `QUESTION_PREVIEW_TOKEN` and set `QUESTION_PREVIEW_ENABLED=true`. Send the token in an `Authorization: Bearer` header. Never put the token in frontend code, a checked-in file, or Production configuration.
- The browser adapter uses `credentials: include`; the API returns `Access-Control-Allow-Credentials: true` for the allowlisted origin. This is CORS compatibility, not an implementation of user authentication.

## Verification

From the repository root:

```sh
npm install
npx wrangler deploy --dry-run
```

From `workers/api`:

```sh
npm install
npm test
npx wrangler deploy --config wrangler.jsonc --dry-run
```

Preview smoke/integration checks can be run after both Preview Workers are available:

```sh
API_PREVIEW_URL=https://feat-exam-engine-staging-kp-exam-api.kridtayod.workers.dev \
FRONTEND_PREVIEW_ORIGIN=https://feat-exam-engine-staging-kp-exam-platform.kridtayod.workers.dev \
npm run test:integration
```

The integration test checks the actual Preview API health/D1 binding, year catalogue, and credentialed CORS preflight. It is skipped when the two Preview URLs are not supplied. A local dry run does not deploy to Cloudflare.

## Current API scaffold

- `GET /api/health`, `GET /api/exam-years`, and `GET /api/catalog` are read-only.
- Question content is available only in Preview with both the explicit feature flag and a server-side bearer token.
- All write methods remain disabled in Phase 1. Attempt creation and submission require the authenticated server-side session described in the API contract; user identity must never come from browser input.
- The legacy `schema.sql` uses an older `exams/exam_results` model and must not be applied to the current D1 database.
