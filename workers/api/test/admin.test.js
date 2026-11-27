import test from "node:test";
import assert from "node:assert/strict";
import { handleAdmin } from "../src/admin.js";

const ORIGIN = "https://frontend.example";
const SESSION_TOKEN = "admin-api-session";
const CSRF_TOKEN = "admin-api-csrf";

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function makeDb(role = "admin") {
  const state = { statements: [], insertedQuestion: null };
  const sessionRow = {
    profile_id: role === "admin" ? "admin-profile" : "user-profile",
    csrf_token_hash: null,
    expires_at: "2099-01-01 00:00:00",
    email: role + "@example.test",
    display_name: role,
    picture_url: null,
    role,
    is_active: 1
  };
  const DB = {
    state,
    async init() { sessionRow.csrf_token_hash = await sha256(CSRF_TOKEN); },
    prepare(sql) {
      let values = [];
      const statement = {
        sql,
        bind(...args) { values = args; return this; },
        async first() {
          state.statements.push({ sql, values });
          if (sql.includes("FROM auth_sessions s JOIN profiles")) return sessionRow;
          if (sql.includes("SELECT id FROM exam_years")) return { id: 1 };
          if (sql.includes("SELECT sc.id FROM subcategories")) return { id: "general" };
          if (sql.includes("INSERT INTO questions")) {
            state.insertedQuestion = {
              id: 501, exam_year_id: values[0], subcategory_id: values[1],
              question_text: values[2], passage: values[3], choices: values[4],
              correct_index: values[5], explanation: values[6],
              difficulty: values[7], source_round: "manual", is_active: 1
            };
            return state.insertedQuestion;
          }
          return null;
        },
        async all() {
          state.statements.push({ sql, values });
          if (sql.includes("FROM profiles")) return { results: [{
            id: "user-profile", email: "user@example.test", role: "user", is_active: 1
          }] };
          return { results: [] };
        },
        async run() {
          state.statements.push({ sql, values });
          return { success: true, meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
  return DB;
}

function makeRequest(path, { method = "GET", body, withSession = true, withCsrf = true } = {}) {
  const headers = { Origin: ORIGIN };
  if (withSession) headers.Cookie = `__Host-kp_session=${SESSION_TOKEN}${withCsrf ? `; __Host-kp_csrf=${CSRF_TOKEN}` : ""}`;
  if (withCsrf) headers["X-CSRF-Token"] = CSRF_TOKEN;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request("https://api.example.test" + path, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

async function setup(role = "admin") {
  const DB = makeDb(role);
  await DB.init();
  return {
    DB,
    env: { DB, APP_ENV: "preview", AUTH_ENABLED: "true", CORS_ALLOWED_ORIGINS: ORIGIN }
  };
}

test("Admin API denies unauthenticated requests with 401", async () => {
  const { env } = await setup();
  const request = makeRequest("/api/admin/users", { withSession: false, withCsrf: false });
  const response = await handleAdmin(request, env, new URL(request.url));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "UNAUTHENTICATED");
});

test("Admin API denies normal User with 403 even if request claims admin", async () => {
  const { env } = await setup("user");
  const request = makeRequest("/api/admin/users");
  request.headers.set("X-Role", "admin");
  const response = await handleAdmin(request, env, new URL(request.url));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "FORBIDDEN");
});

test("Admin can list users without exposing auth/session fields", async () => {
  const { DB, env } = await setup();
  const request = makeRequest("/api/admin/users");
  const response = await handleAdmin(request, env, new URL(request.url));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.users[0].email, "user@example.test");
  assert.equal(JSON.stringify(payload).includes("session_token_hash"), false);
  assert.equal(JSON.stringify(payload).includes("google_sub"), false);
  assert.ok(DB.state.statements.some(item => item.sql.includes("FROM profiles")));
});

test("Admin write requires valid CSRF token", async () => {
  const { env } = await setup();
  const request = makeRequest("/api/admin/questions", {
    method: "POST",
    body: {
      exam_year_id: 1, question_text: "Question?", choices: ["A", "B"],
      correct_index: 0, subcategory_id: null
    },
    withCsrf: false
  });
  const response = await handleAdmin(request, env, new URL(request.url));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "CSRF_INVALID");
});

test("Admin can create a validated question with server-selected manual source", async () => {
  const { DB, env } = await setup();
  const request = makeRequest("/api/admin/questions", {
    method: "POST",
    body: {
      exam_year_id: 1, question_text: "Question?", choices: ["A", "B"],
      correct_index: 1, explanation: "Because B", difficulty: "easy",
      subcategory_id: null
    }
  });
  const response = await handleAdmin(request, env, new URL(request.url));
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.data.question.id, 501);
  assert.equal(payload.data.question.source_round, "manual");
  assert.deepEqual(payload.data.question.choices, ["A", "B"]);
  assert.equal(DB.state.insertedQuestion.correct_index, 1);
});

test("Admin API rejects invalid correct answer index", async () => {
  const { env } = await setup();
  const request = makeRequest("/api/admin/questions", {
    method: "POST",
    body: { exam_year_id: 1, question_text: "Question?", choices: ["A", "B"], correct_index: 2 }
  });
  const response = await handleAdmin(request, env, new URL(request.url));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_CORRECT_INDEX");
});
