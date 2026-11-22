import test from "node:test";
import assert from "node:assert/strict";
import { handleExamEngine } from "../src/exam-engine.js";

const ORIGIN = "https://frontend.example";
const SESSION_TOKEN = "opaque-session-token";
const CSRF_TOKEN = "session-csrf-token";
const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174000";

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function questions(count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    question_text: `Question ${index + 1}`,
    passage: null,
    choices: '["A","B","C","D"]',
    correct_index: 1,
    explanation: "private explanation",
    difficulty: "easy",
    subcategory_id: null,
    subject_name: "General"
  }));
}

function makeDb({ questionRows = questions(), attempt = null } = {}) {
  const state = {
    questionRows,
    attempt,
    answers: new Map(),
    insertedAttempt: null
  };
  const sessionRow = {
    profile_id: "profile-1",
    csrf_token_hash: null,
    expires_at: "2099-01-01 00:00:00",
    email: "user@example.test",
    display_name: "Test User",
    picture_url: null,
    role: "user",
    is_active: 1
  };
  const db = {
    state,
    async init() {
      sessionRow.csrf_token_hash = await sha256(CSRF_TOKEN);
    },
    prepare(sql) {
      let values = [];
      return {
        sql,
        bind(...args) { values = args; this.values = args; return this; },
        async first() {
          if (sql.includes("FROM auth_sessions s JOIN profiles")) return sessionRow;
          if (sql.includes("FROM exam_years")) return { id: 1, year_be: 2567, label: "พ.ศ. 2567" };
          if (sql.includes("FROM user_attempts") && sql.includes("WHERE id = ? AND user_id = ?")) {
            return state.attempt;
          }
          return null;
        },
        async all() {
          if (sql.includes("ORDER BY RANDOM()")) return { results: state.questionRows };
          if (sql.includes("SELECT id, choices, correct_index")) return {
            results: state.questionRows.map(({ id, choices, correct_index }) => ({ id, choices, correct_index }))
          };
          if (sql.includes("SELECT q.id, q.question_text")) {
            return {
              results: state.questionRows.map(row => ({
                ...row,
                selected_index: state.answers.has(row.id) ? state.answers.get(row.id) : null
              }))
            };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes("INSERT INTO user_attempts")) {
            state.insertedAttempt = {
              id: values[0],
              user_id: values[1],
              exam_year_id: values[2],
              question_count: values[3],
              mode: values[4],
              status: "in_progress",
              question_ids_json: values[5],
              started_at: "2026-11-22 12:00:00",
              submitted_at: null,
              score: null
            };
            state.attempt = state.insertedAttempt;
          }
          return { success: true, meta: { changes: 1 } };
        }
      };
    },
    async batch(statements) {
      if (!state.attempt || state.attempt.status !== "in_progress") {
        return [{ meta: { changes: 0 } }];
      }
      const [claim, ...writes] = statements;
      state.attempt.status = "submitted";
      state.attempt.score = claim.values[0];
      state.attempt.submitted_at = claim.values[1];
      for (const statement of writes) {
        const [, questionId, selectedIndex] = statement.values;
        state.answers.set(questionId, selectedIndex);
      }
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  };
  return db;
}

function makeRequest(path, { method = "GET", body } = {}) {
  return new Request("https://api.example.test" + path, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: `__Host-kp_session=${SESSION_TOKEN}; __Host-kp_csrf=${CSRF_TOKEN}`,
      "X-CSRF-Token": CSRF_TOKEN,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

async function makeEnv(DB) {
  await DB.init();
  return {
    DB,
    APP_ENV: "preview",
    AUTH_ENABLED: "true",
    CORS_ALLOWED_ORIGINS: ORIGIN
  };
}

test("attempt creation requires a verified session and CSRF token", async () => {
  const DB = makeDb();
  await DB.init();
  const env = await makeEnv(DB);
  const request = new Request("https://api.example.test/api/attempts", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ exam_year_id: 1, question_count: 10 })
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  assert.equal(response.status, 401);
});

test("attempt creation selects questions server-side and hides answer keys", async () => {
  const DB = makeDb();
  const env = await makeEnv(DB);
  const request = makeRequest("/api/attempts", {
    method: "POST",
    body: { exam_year_id: 1, question_count: 10, mode: "practice" }
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.data.questions.length, 10);
  assert.equal(payload.data.attempt.id, DB.state.insertedAttempt.id);
  assert.equal(DB.state.insertedAttempt.user_id, "profile-1");
  assert.equal(JSON.stringify(payload).includes("correct_index"), false);
  assert.equal(JSON.stringify(payload).includes("private explanation"), false);
});

test("attempt creation rejects unsupported question counts", async () => {
  const DB = makeDb();
  const env = await makeEnv(DB);
  const request = makeRequest("/api/attempts", {
    method: "POST",
    body: { exam_year_id: 1, question_count: 7 }
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_QUESTION_COUNT");
});

test("submission scores on the server and reveals explanations only after submit", async () => {
  const rows = questions(10);
  const DB = makeDb({
    questionRows: rows,
    attempt: {
      id: ATTEMPT_ID,
      user_id: "profile-1",
      exam_year_id: 1,
      question_count: 10,
      mode: "practice",
      status: "in_progress",
      question_ids_json: JSON.stringify(rows.map(row => row.id)),
      started_at: "2026-11-22 12:00:00",
      submitted_at: null,
      score: null
    }
  });
  const env = await makeEnv(DB);
  const request = makeRequest(`/api/attempts/${ATTEMPT_ID}/submit`, {
    method: "POST",
    body: {
      answers: [
        { question_id: 1, selected_index: 1 },
        { question_id: 2, selected_index: 0 }
      ]
    }
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.result.score, 1);
  assert.equal(payload.data.result.total, 10);
  assert.equal(payload.data.result.percentage, 10);
  assert.equal(payload.data.result.questions[0].correct_index, 1);
  assert.equal(payload.data.result.questions[0].explanation, "private explanation");
  assert.equal(DB.state.attempt.status, "submitted");
});
