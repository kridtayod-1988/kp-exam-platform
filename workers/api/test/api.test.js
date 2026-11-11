import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const FRONTEND_PREVIEW = "https://feat-frontend-only-production-kp-exam-platform.workers.dev";

function makeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          if (sql.includes("SELECT 1 AS ok")) return { ok: 1 };
          if (sql.includes("FROM exam_years") && sql.includes("WHERE id = ?")) {
            return values[0] === 2567
              ? { id: 2567, year_be: 2567, label: "พ.ศ. 2567" }
              : null;
          }
          if (sql.includes("COUNT(*) AS total")) return { total: 1 };
          return null;
        },
        async all() {
          if (sql.includes("COUNT(q.id)")) {
            return { results: [{ id: 2567, year_be: 2567, label: "พ.ศ. 2567", question_count: 1 }] };
          }
          if (sql.includes("FROM subject_groups")) return { results: [{ id: "analysis", name: "คิดวิเคราะห์", slug: "analysis" }] };
          if (sql.includes("FROM subcategories")) return { results: [{ id: "logic", subject_group_id: "analysis", name: "เหตุผล", slug: "logic", is_gpa3: 0 }] };
          if (sql.includes("FROM questions q")) {
            return { results: [{
              id: 10,
              question_text: "คำถามทดสอบ",
              passage: null,
              choices: '["ก","ข","ค","ง"]',
              difficulty: "easy",
              subcategory_id: "logic",
              subject_name: "เหตุผล",
              correct_index: 1,
              explanation: "เฉลยลับ"
            }] };
          }
          return { results: [] };
        }
      };
    }
  };
}

function request(path, { method = "GET", origin, headers = {} } = {}) {
  return new Request("https://api-preview.example.test" + path, {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), ...headers }
  });
}

const previewEnv = {
  DB: makeDb(),
  APP_ENV: "preview",
  CORS_ALLOWED_ORIGINS: FRONTEND_PREVIEW,
  QUESTION_PREVIEW_ENABLED: "true",
  QUESTION_PREVIEW_TOKEN: "test-preview-token"
};

test("health checks the bound database", async () => {
  const response = await worker.fetch(request("/api/health"), { DB: makeDb(), APP_ENV: "preview" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).database, "connected");
});

test("lists active exam years with question counts", async () => {
  const response = await worker.fetch(request("/api/exam-years"), { DB: makeDb() });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.exam_years[0].year_be, 2567);
  assert.equal(payload.data.exam_years[0].question_count, 1);
});

test("catalog endpoint returns active subject groups and categories", async () => {
  const response = await worker.fetch(request("/api/catalog"), { DB: makeDb() });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.subject_groups.length, 1);
  assert.equal(payload.data.subcategories.length, 1);
});

test("question preview requires a server-side preview token", async () => {
  const response = await worker.fetch(request("/api/exam-years/2567/questions?limit=10"), {
    ...previewEnv,
    QUESTION_PREVIEW_TOKEN: undefined
  });
  assert.equal(response.status, 403);
});

test("authorized question preview returns public fields only", async () => {
  const response = await worker.fetch(request("/api/exam-years/2567/questions?limit=10", {
    headers: { Authorization: "Bearer test-preview-token" }
  }), previewEnv);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.data.questions[0].choices, ["ก", "ข", "ค", "ง"]);
  assert.equal("correct_index" in payload.data.questions[0], false);
  assert.equal("explanation" in payload.data.questions[0], false);
});

test("rejects invalid pagination", async () => {
  const response = await worker.fetch(request("/api/exam-years/2567/questions?limit=500", {
    headers: { Authorization: "Bearer test-preview-token" }
  }), previewEnv);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_PAGINATION");
});

test("returns 404 for inactive or unknown exam year", async () => {
  const response = await worker.fetch(request("/api/exam-years/2568/questions", {
    headers: { Authorization: "Bearer test-preview-token" }
  }), previewEnv);
  assert.equal(response.status, 404);
});

test("does not expose write endpoints in Phase 1", async () => {
  const response = await worker.fetch(request("/api/attempts", { method: "POST" }), { DB: makeDb() });
  assert.equal(response.status, 405);
});

test("rejects origins not in the explicit allowlist", async () => {
  const response = await worker.fetch(request("/api/exam-years", { origin: "https://evil.example" }), {
    DB: makeDb(),
    CORS_ALLOWED_ORIGINS: FRONTEND_PREVIEW
  });
  assert.equal(response.status, 403);
});

test("allows credentialed preflight only for the configured frontend preview", async () => {
  const response = await worker.fetch(request("/api/exam-years", {
    method: "OPTIONS",
    origin: FRONTEND_PREVIEW,
    headers: {
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "content-type,authorization"
    }
  }), previewEnv);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), FRONTEND_PREVIEW);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("access-control-allow-headers"), /authorization/i);
});

test("rejects preflight from an untrusted frontend origin", async () => {
  const response = await worker.fetch(request("/api/exam-years", {
    method: "OPTIONS",
    origin: "https://evil.example"
  }), previewEnv);
  assert.equal(response.status, 403);
});

test("does not expose question content unless preview is explicitly enabled", async () => {
  const response = await worker.fetch(request("/api/exam-years/2567/questions"), {
    DB: makeDb(),
    APP_ENV: "production"
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "QUESTION_PREVIEW_DISABLED");
});
