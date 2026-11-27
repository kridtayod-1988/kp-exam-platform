# D1 Exam Engine Attempt API — Phase 2 implementation

## Scope

This implementation adds the first authenticated attempt lifecycle on the Cloudflare Workers + D1 stack. It reuses the Google OAuth session tables and the `user_attempts` / `user_answers` schema. Migration `0006_user_seen_questions.sql` adds per-profile Anti-Repeat history.

The attempt API remains Preview-only: it returns `EXAM_ENGINE_NOT_ENABLED` unless `APP_ENV=preview` and `AUTH_ENABLED=true`. This is an intentional deployment boundary; this PR does not enable attempt writes on Production.

## Endpoints

### Create an attempt

`POST /api/attempts`

Request fields:
- `exam_year_id`: active `exam_years.id`
- `question_count`: 10, 25, or 50
- `mode`: `practice` only (defaults to `practice`; simulation remains disabled until time-limit enforcement is implemented)

The Worker verifies the session and CSRF token, checks that the exam year is active, selects question IDs on the server, applies a limit of 10 attempt starts per profile per hour, stores an immutable question-ID snapshot in `user_attempts`, and returns only public question fields. Answer keys and explanations are not included.

### Submit an attempt

`POST /api/attempts/:attemptId/submit`

Request:
```json
{
  "answers": [
    { "question_id": 101, "selected_index": 2 }
  ]
}
```

The Worker verifies ownership and attempt state, validates each question and selected option against the stored snapshot and D1 question rows, calculates the score from `questions.correct_index`, then atomically claims the in-progress attempt and writes submitted answers using D1 `batch()`.

Unanswered questions count as incorrect. Repeated submissions return the saved result instead of awarding XP again.

### Read a submitted result

`GET /api/attempts/:attemptId/result`

Only the owning authenticated profile can read the result. Answer keys, correctness flags, and explanations are returned only after the attempt is submitted.

## Security controls

- Profile identity comes from the verified HttpOnly session cookie; no browser-supplied user ID is trusted.
- Mutating requests require an exact allowlisted Origin and the session-bound CSRF header/cookie/hash.
- Attempt ownership is checked on every read and write.
- The browser cannot select the authoritative question set or submit a score/correct answer.
- Question selection prefers unseen questions for the authenticated profile, then fills from previously seen questions when needed.
- Successful submission atomically awards 10 XP per correct answer and records the question snapshot as seen in the same D1 batch as the submission claim; replayed submissions cannot award XP again.
- XP uses the canonical `profiles.xp` column.
- Attempt APIs remain Preview-only.
- Request body size is capped at 64 KiB.
- Public create-attempt responses omit `correct_index` and `explanation`.

## Tests and current verification

`workers/api/test/exam-engine.test.js` covers authentication, server-side question selection, answer-key redaction, question-count validation, server-side scoring, result ownership, and repeat-submission behavior.

- The latest recorded CI run for the current feature commit passed `npm test` and Wrangler Staging configuration dry-run.
- The live Preview integration job was skipped in that run; CI success is not a live D1 end-to-end result.
- Staging API deployment and health/database connectivity were previously verified. Staging year 2567 contains 50 original practice questions (not official exam questions).
- Full live create-attempt → submit → result end-to-end testing through the frontend remains outstanding.

## Migration status

Migration `0006_user_seen_questions.sql` has been applied to both `kp_exam_platform_staging` and `kp_exam_platform_db` (Production). The Production D1 migration work was performed separately with a pre-change export and Time Travel bookmark; it is not an action performed by this PR.

Production D1 now has the Auth and Exam Engine schema, but the Production question bank is empty. No Production API or Frontend Worker deployment has been performed, and the attempt API remains disabled outside Preview.

## Known follow-up work

1. Persist in-progress answer changes before final submission (autosave endpoint and frontend integration).
2. Add attempt history and pagination.
3. Add server-enforced time limits and expiry policy for simulation mode.
4. Add membership/plan entitlements when the membership schema is ready.
5. Complete live Staging OAuth + D1 create/submit/result end-to-end tests.
6. Seed and review Production exam years, categories, and question content before Production exam use.

## Deployment boundary

This PR adds API code, tests, and the shared migration file. It does not deploy Production Workers or enable attempt writes on Production. Production D1 schema migration and Staging content seeding/deployment are separate operations documented independently.
