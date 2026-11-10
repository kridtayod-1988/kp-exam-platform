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
- The staging database is newly created and currently empty. Apply reviewed schema migrations to staging before testing database-dependent API features.

## Verification

From the repository root:

```sh
npm install
npx wrangler deploy --dry-run
```

From `workers/api`:

```sh
npm install
npx wrangler deploy --config wrangler.jsonc --dry-run
npx wrangler preview --config wrangler.jsonc
```

A successful local dry run does not deploy to Cloudflare. Do not run `wrangler deploy` against production until the branch has been reviewed and deployment is explicitly approved.

## Current API scaffold

`GET /api/health` checks that the D1 binding exists and can execute `SELECT 1`. Other routes deliberately return HTTP 501 until their server-side implementation and tests are added. This scaffold does not claim that Google Login, sessions, exam attempts, scoring, or Admin APIs are implemented.
