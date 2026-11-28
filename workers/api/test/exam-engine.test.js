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

function makeDb({ questionRows = questions(), attempt = null, examSet = null, subcategory = null } = {}) {
  const state = {
    questionRows,
    attempt,
    examSet,
    subcategory,
    answers: new Map(),
    insertedAttempt: null,
    batchCalls: 0,
    xp: 0,
    seenQuestions: [],
    queryLog: []
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
          if (sql.includes("INSERT INTO auth_audit_log")) return { id: 1 };
          if (sql.includes("SELECT CASE WHEN datetime(?)")) return { expired: state.forceExpired ? 1 : 0 };
          if (sql.includes("SELECT COUNT(*) AS score FROM user_answers")) return { score: state.expiredScore || 0 };
          if (sql.includes("SELECT COUNT(*) AS total FROM user_attempts")) return { total: state.attempt ? 1 : 0 };
          if (sql.includes("COUNT(CASE WHEN status")) return { completed_count: state.attempt?.status === "submitted" || state.attempt?.status === "expired" ? 1 : 0, average_percentage: 70, best_percentage: 70 };
          if (sql.includes("SELECT started_at, deadline_at FROM user_attempts")) return state.attempt;
          if (sql.includes("FROM exam_sets")) return state.examSet;
          if (sql.includes("FROM subcategories")) return state.subcategory;
          if (sql.includes("FROM exam_years")) return { id: 1, year_be: 2567, label: "พ.ศ. 2567" };
          if (sql.includes("FROM user_attempts") && sql.includes("WHERE id = ? AND user_id = ?")) {
            return state.attempt && state.attempt.id === values[0] && state.attempt.user_id === values[1]
              ? state.attempt
              : null;
          }
          return null;
        },
        async all() {
          state.queryLog.push(sql);
          if (sql.includes("ORDER BY RANDOM()")) return { results: state.questionRows };
          if (sql.includes("SELECT id, choices FROM questions")) {
            return { results: state.questionRows.filter(row => values.includes(row.id)).map(({ id, choices }) => ({ id, choices })) };
          }
          if (sql.includes("SELECT a.id, a.exam_year_id")) {
            return { results: state.attempt ? [{ ...state.attempt, exam_year_label: "พ.ศ. 2567", percentage: 70 }] : [] };
          }
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
              exam_set_id: values[3] ?? null,
              question_count: values[4],
              mode: values[5],
              status: "in_progress",
              question_ids_json: values[6],
              time_limit_seconds: values[7] ?? null,
              deadline_at: values[7] ? "2026-11-22T13:00:00.000Z" : null,
              started_at: "2026-11-22T12:00:00.000Z",
              submitted_at: null,
              score: null
            };
            state.attempt = state.insertedAttempt;
          }
          if (sql.includes("INSERT INTO user_answers") && values.length === 4) {
            for (const answer of JSON.parse(values[1])) state.answers.set(answer.question_id, answer.selected_index);
          }
          return { success: true, meta: { changes: 1 } };
        }
      };
    },
    async batch(statements) {
      state.batchCalls += 1;
      if (!state.attempt || state.attempt.status !== "in_progress") {
        return [{ meta: { changes: 0 } }];
      }
      const [claim, ...writes] = statements;
      state.attempt.status = claim.sql.includes("status = 'expired'") ? "expired" : "submitted";
      state.attempt.score = claim.values[0];
      state.attempt.submitted_at = claim.values[1];
      for (const statement of writes) {
        if (statement.sql.includes("INSERT INTO user_answers")) {
          const [, questionId, selectedIndex] = statement.values;
          state.answers.set(questionId, selectedIndex);
        } else if (statement.sql.includes("UPDATE profiles")) {
          state.xp += statement.values[0];
        } else if (statement.sql.includes("INSERT INTO user_seen_questions")) {
          state.seenQuestions = JSON.parse(statement.values[2]);
        }
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
    EXAM_ENGINE_ENABLED: "true",
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
  assert.ok(DB.state.queryLog.some(sql => sql.includes("user_seen_questions")));
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
  assert.equal(DB.state.xp, 10);
  assert.equal(DB.state.seenQuestions.length, 10);
  assert.equal(payload.data.result.xp_earned, 10);
});


test("attempt results are isolated to the owning profile", async () => {
  const rows = questions(10);
  const DB = makeDb({
    questionRows: rows,
    attempt: {
      id: ATTEMPT_ID,
      user_id: "another-profile",
      exam_year_id: 1,
      question_count: 10,
      mode: "practice",
      status: "submitted",
      question_ids_json: JSON.stringify(rows.map(row => row.id)),
      started_at: "2026-11-22 12:00:00",
      submitted_at: "2026-11-22T12:05:00.1230000000Z",
      score: 8
    }
  });
  const env = await makeEnv(DB);
  const request = makeRequest(`/api/attempts/${ATTEMPT_ID}/result`);
  const response = await handleExamEngine(request, env, new URL(request.url));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "ATTEMPT_NOT_FOUND");
});

test("concurrent submissions award XP only once", async () => {
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
  const makeSubmitRequest = () => makeRequest(`/api/attempts/${ATTEMPT_ID}/submit`, {
    method: "POST",
    body: {
      answers: [
        { question_id: 1, selected_index: 1 },
        { question_id: 2, selected_index: 0 }
      ]
    }
  });
  const responses = await Promise.all([
    handleExamEngine(makeSubmitRequest(), env, new URL("https://api.example.test/api/attempts/" + ATTEMPT_ID + "/submit")),
    handleExamEngine(makeSubmitRequest(), env, new URL("https://api.example.test/api/attempts/" + ATTEMPT_ID + "/submit"))
  ]);
  const payloads = await Promise.all(responses.map(response => response.json()));

  assert.ok(responses.every(response => response.status === 200 || response.status === 409));
  assert.equal(DB.state.attempt.status, "submitted");
  assert.equal(DB.state.xp, 10);
  assert.ok(DB.state.batchCalls >= 1 && DB.state.batchCalls <= 2);
  assert.equal(payloads.filter(payload => payload.data?.result?.score === 1).length, 2);
  assert.match(DB.state.attempt.submitted_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{13}Z$/);
});

test("repeated submission returns the saved result without recalculating or writing again", async () => {
  const rows = questions(10);
  const DB = makeDb({
    questionRows: rows,
    attempt: {
      id: ATTEMPT_ID,
      user_id: "profile-1",
      exam_year_id: 1,
      question_count: 10,
      mode: "practice",
      status: "submitted",
      question_ids_json: JSON.stringify(rows.map(row => row.id)),
      started_at: "2026-11-22 12:00:00",
      submitted_at: "2026-11-22T12:05:00.1230000000Z",
      score: 7
    }
  });
  const env = await makeEnv(DB);
  const request = makeRequest(`/api/attempts/${ATTEMPT_ID}/submit`, {
    method: "POST",
    body: { answers: [] }
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.result.score, 7);
  assert.equal(DB.state.batchCalls, 0);
});


test("answer autosave persists validated answers for the owning in-progress attempt", async () => {
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
      started_at: "2026-11-22T12:00:00.000Z",
      submitted_at: null,
      score: null,
      deadline_at: null,
      time_limit_seconds: null
    }
  });
  const env = await makeEnv(DB);
  const request = makeRequest("/api/attempts/" + ATTEMPT_ID + "/answers", {
    method: "PATCH",
    body: { answers: [{ question_id: 1, selected_index: 2 }] }
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.saved_count, 1);
  assert.equal(DB.state.answers.get(1), 2);
});

test("answer autosave rejects an attempt owned by another profile", async () => {
  const rows = questions(10);
  const DB = makeDb({
    questionRows: rows,
    attempt: {
      id: ATTEMPT_ID,
      user_id: "another-profile",
      exam_year_id: 1,
      question_count: 10,
      mode: "practice",
      status: "in_progress",
      question_ids_json: JSON.stringify(rows.map(row => row.id)),
      started_at: "2026-11-22T12:00:00.000Z",
      deadline_at: null
    }
  });
  const env = await makeEnv(DB);
  const request = makeRequest("/api/attempts/" + ATTEMPT_ID + "/answers", {
    method: "PATCH",
    body: { answers: [{ question_id: 1, selected_index: 2 }] }
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "ATTEMPT_NOT_FOUND");
});

test("attempt history returns owner-scoped pagination and aggregate score report", async () => {
  const rows = questions(10);
  const DB = makeDb({
    questionRows: rows,
    attempt: {
      id: ATTEMPT_ID,
      user_id: "profile-1",
      exam_year_id: 1,
      question_count: 10,
      mode: "practice",
      status: "submitted",
      question_ids_json: JSON.stringify(rows.map(row => row.id)),
      started_at: "2026-11-22T12:00:00.000Z",
      submitted_at: "2026-11-22T12:05:00.000Z",
      score: 7
    }
  });
  const env = await makeEnv(DB);
  const request = makeRequest("/api/attempts?page=1&limit=10");
  const response = await handleExamEngine(request, env, new URL(request.url));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.pagination.total, 1);
  assert.equal(payload.data.summary.completed_count, 1);
  assert.equal(payload.data.attempts[0].id, ATTEMPT_ID);
});

test("simulation attempts receive a server-generated sixty-minute deadline", async () => {
  const DB = makeDb();
  const env = await makeEnv(DB);
  const request = makeRequest("/api/attempts", {
    method: "POST",
    body: { exam_year_id: 1, question_count: 10, mode: "simulation" }
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.data.attempt.mode, "simulation");
  assert.equal(payload.data.attempt.time_limit_seconds, 3600);
  assert.ok(payload.data.attempt.deadline_at);
  assert.match(DB.state.attempt.deadline_at, /^2026-11-22T13:00:00/);
});

test("expired simulation is finalized from autosaved answers and cannot accept more answers", async () => {
  const rows = questions(10);
  const DB = makeDb({
    questionRows: rows,
    attempt: {
      id: ATTEMPT_ID,
      user_id: "profile-1",
      exam_year_id: 1,
      question_count: 10,
      mode: "simulation",
      status: "in_progress",
      question_ids_json: JSON.stringify(rows.map(row => row.id)),
      started_at: "2026-11-22T12:00:00.000Z",
      deadline_at: "2020-01-01T00:00:00.000Z",
      time_limit_seconds: 3600,
      submitted_at: null,
      score: null
    }
  });
  DB.state.forceExpired = true;
  DB.state.expiredScore = 1;
  DB.state.answers.set(1, 1);
  const env = await makeEnv(DB);
  const request = makeRequest("/api/attempts/" + ATTEMPT_ID + "/submit", {
    method: "POST",
    body: { answers: [] }
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.result.status, "expired");
  assert.equal(payload.data.result.score, 1);
  assert.equal(DB.state.xp, 10);
  assert.equal(DB.state.attempt.status, "expired");

  const autosave = makeRequest("/api/attempts/" + ATTEMPT_ID + "/answers", {
    method: "PATCH",
    body: { answers: [{ question_id: 1, selected_index: 2 }] }
  });
  const autosaveResponse = await handleExamEngine(autosave, env, new URL(autosave.url));
  assert.equal(autosaveResponse.status, 409);
  assert.equal((await autosaveResponse.json()).error, "ATTEMPT_NOT_ACTIVE");
});


test("answer autosave requires a valid CSRF token", async () => {
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
      started_at: "2026-11-22T12:00:00.000Z",
      deadline_at: null
    }
  });
  const env = await makeEnv(DB);
  const request = new Request("https://api.example.test/api/attempts/" + ATTEMPT_ID + "/answers", {
    method: "PATCH",
    headers: {
      Origin: ORIGIN,
      Cookie: "__Host-kp_session=" + SESSION_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ answers: [{ question_id: 1, selected_index: 2 }] })
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "CSRF_INVALID");
});

test("attempt owner can resume and receive saved answers without answer keys", async () => {
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
      started_at: "2026-11-22T12:00:00.000Z",
      deadline_at: null,
      time_limit_seconds: null
    }
  });
  DB.state.answers.set(1, 3);
  const env = await makeEnv(DB);
  const request = makeRequest("/api/attempts/" + ATTEMPT_ID);
  const response = await handleExamEngine(request, env, new URL(request.url));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.questions[0].selected_index, 3);
  assert.equal(JSON.stringify(payload).includes("correct_index"), false);
  assert.equal(JSON.stringify(payload).includes("private explanation"), false);
});


test("Exam Engine stays disabled unless its explicit environment flag is enabled", async () => {
  const DB = makeDb();
  const env = await makeEnv(DB);
  env.EXAM_ENGINE_ENABLED = "false";
  const request = new Request("https://api.example.test/api/exam-years");
  const response = await handleExamEngine(request, env, new URL(request.url));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "EXAM_ENGINE_NOT_ENABLED");
});

test("Exam Engine can be enabled outside Preview only with both explicit flags", async () => {
  const DB = makeDb();
  const env = await makeEnv(DB);
  env.APP_ENV = "production";
  env.AUTH_ENABLED = "true";
  env.EXAM_ENGINE_ENABLED = "true";
  const request = new Request("https://api.example.test/api/attempts");
  const response = await handleExamEngine(request, env, new URL(request.url));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "UNAUTHENTICATED");
});

test("attempt creation can be scoped to a database exam set and subject", async () => {
  const rows = questions(10).map(row => ({ ...row, subcategory_id: "thai-analogy" }));
  const DB = makeDb({
    questionRows: rows,
    examSet: { id: 9, exam_year_id: 1, title: "ก.พ. 2569 • ชุดเริ่มต้น" },
    subcategory: { id: "thai-analogy" }
  });
  const env = await makeEnv(DB);
  const request = makeRequest("/api/attempts", {
    method: "POST",
    body: {
      exam_set_id: 9,
      subcategory_id: "thai-analogy",
      question_count: 10,
      mode: "simulation"
    }
  });
  const response = await handleExamEngine(request, env, new URL(request.url));
  assert.equal(response.status, 200);
  assert.equal(DB.state.insertedAttempt.exam_set_id, 9);
  assert.equal(DB.state.insertedAttempt.question_count, 10);
  assert.equal(DB.state.insertedAttempt.mode, "simulation");
  assert.ok(DB.state.queryLog.some(sql => sql.includes("q.exam_set_id = ?")));
  assert.ok(DB.state.queryLog.some(sql => sql.includes("q.subcategory_id = ?")));
});
