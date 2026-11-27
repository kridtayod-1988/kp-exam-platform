import { verifySessionCsrf } from "./auth.js";
import { requireAdmin } from "./authz.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

const fail = (code, message, status) => json({ error: code, message }, status);
const MAX_BODY_BYTES = 64 * 1024;

async function readJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return { error: "BODY_TOO_LARGE" };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return { error: "BODY_TOO_LARGE" };
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { value }
      : { error: "INVALID_JSON" };
  } catch {
    return { error: "INVALID_JSON" };
  }
}

function pagination(url) {
  const page = Number(url.searchParams.get("page") || 1);
  const limit = Number(url.searchParams.get("limit") || 25);
  if (!Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null;
  return { page, limit, offset: (page - 1) * limit };
}

async function requireWriteAccess(request, env) {
  const access = await requireAdmin(request, env);
  if (!access.ok) return access;
  if (!await verifySessionCsrf(request, env, access.session)) {
    return { ok: false, response: fail("CSRF_INVALID", "คำขอไม่ผ่านการตรวจสอบความปลอดภัย", 403) };
  }
  return access;
}

async function listUsers(env, url) {
  const paging = pagination(url);
  if (!paging) return fail("INVALID_PAGINATION", "page/limit ไม่ถูกต้อง (limit สูงสุด 100)", 400);
  const [count, rows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM profiles").first(),
    env.DB.prepare(
      `SELECT id, email, display_name, role, is_active, verification_status,
              xp, level, last_login_at, created_at
         FROM profiles
        ORDER BY created_at DESC, id
        LIMIT ? OFFSET ?`
    ).bind(paging.limit, paging.offset).all()
  ]);
  return json({
    data: { users: rows.results || [] },
    pagination: {
      page: paging.page,
      limit: paging.limit,
      total: Number(count?.total || 0),
      total_pages: Math.ceil(Number(count?.total || 0) / paging.limit)
    }
  });
}

async function updateUserStatus(request, env, profileId, adminProfileId) {
  if (!profileId || profileId.length > 128) return fail("INVALID_USER_ID", "รหัสผู้ใช้ไม่ถูกต้อง", 400);
  if (profileId === adminProfileId) return fail("SELF_STATUS_CHANGE_BLOCKED", "ไม่อนุญาตให้เปลี่ยนสถานะบัญชีของตนเองผ่าน API นี้", 409);
  const parsed = await readJson(request);
  if (parsed.error) return fail(parsed.error, "ข้อมูลคำขอไม่ถูกต้อง", parsed.error === "BODY_TOO_LARGE" ? 413 : 400);
  if (typeof parsed.value.is_active !== "boolean") {
    return fail("INVALID_ACCOUNT_STATUS", "is_active ต้องเป็น true หรือ false", 400);
  }
  const result = await env.DB.prepare(
    `UPDATE profiles
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      RETURNING id, email, display_name, role, is_active, verification_status`
  ).bind(parsed.value.is_active ? 1 : 0, profileId).first();
  if (!result) return fail("USER_NOT_FOUND", "ไม่พบผู้ใช้", 404);
  await env.DB.prepare(
    "INSERT INTO auth_audit_log (profile_id, event_type, event_detail) VALUES (?, 'admin_user_status', ?)"
  ).bind(adminProfileId, JSON.stringify({ target_profile_id: profileId, is_active: parsed.value.is_active })).run();
  return json({ data: { user: result } });
}

function validateQuestion(value) {
  if (!Number.isSafeInteger(value.exam_year_id) || value.exam_year_id <= 0) return "INVALID_EXAM_YEAR";
  if (typeof value.question_text !== "string" || !value.question_text.trim() || value.question_text.length > 10000) return "INVALID_QUESTION_TEXT";
  if (!Array.isArray(value.choices) || value.choices.length < 2 || value.choices.length > 6 ||
      value.choices.some(choice => typeof choice !== "string" || !choice.trim() || choice.length > 500)) return "INVALID_CHOICES";
  if (!Number.isSafeInteger(value.correct_index) || value.correct_index < 0 || value.correct_index >= value.choices.length) return "INVALID_CORRECT_INDEX";
  if (value.passage != null && (typeof value.passage !== "string" || value.passage.length > 20000)) return "INVALID_PASSAGE";
  if (value.explanation != null && (typeof value.explanation !== "string" || value.explanation.length > 10000)) return "INVALID_EXPLANATION";
  if (value.difficulty != null && !["easy", "medium", "hard"].includes(value.difficulty)) return "INVALID_DIFFICULTY";
  if (value.subcategory_id != null && (typeof value.subcategory_id !== "string" || !value.subcategory_id.trim() || value.subcategory_id.length > 128)) return "INVALID_SUBCATEGORY";
  return null;
}

async function validateQuestionRelations(env, value) {
  const year = await env.DB.prepare(
    "SELECT id FROM exam_years WHERE id = ? AND is_active = 1 LIMIT 1"
  ).bind(value.exam_year_id).first();
  if (!year) return "EXAM_YEAR_NOT_FOUND";
  if (value.subcategory_id != null) {
    const category = await env.DB.prepare(
      `SELECT sc.id FROM subcategories sc
        JOIN subject_groups sg ON sg.id = sc.subject_group_id
       WHERE sc.id = ? AND sc.is_active = 1 AND sg.is_active = 1 LIMIT 1`
    ).bind(value.subcategory_id).first();
    if (!category) return "SUBCATEGORY_NOT_FOUND";
  }
  return null;
}

async function listQuestions(env, url) {
  const paging = pagination(url);
  if (!paging) return fail("INVALID_PAGINATION", "page/limit ไม่ถูกต้อง (limit สูงสุด 100)", 400);
  const yearId = url.searchParams.get("exam_year_id");
  if (yearId != null && (!/^\d+$/.test(yearId) || Number(yearId) <= 0)) {
    return fail("INVALID_EXAM_YEAR", "รหัสปีข้อสอบไม่ถูกต้อง", 400);
  }
  const where = yearId == null ? "" : "WHERE q.exam_year_id = ?";
  const countQuery = env.DB.prepare(`SELECT COUNT(*) AS total FROM questions q ${where}`);
  const rowsQuery = env.DB.prepare(
    `SELECT q.id, q.exam_year_id, ey.year_be, q.subcategory_id,
            q.question_text, q.passage, q.choices, q.correct_index,
            q.explanation, q.difficulty, q.source_round, q.is_active,
            q.created_at, q.updated_at
       FROM questions q JOIN exam_years ey ON ey.id = q.exam_year_id
       ${where}
      ORDER BY q.created_at DESC, q.id DESC
      LIMIT ? OFFSET ?`
  );
  const count = yearId == null
    ? await countQuery.first()
    : await countQuery.bind(Number(yearId)).first();
  const rows = yearId == null
    ? await rowsQuery.bind(paging.limit, paging.offset).all()
    : await rowsQuery.bind(Number(yearId), paging.limit, paging.offset).all();
  return json({
    data: { questions: (rows.results || []).map(row => ({
      ...row,
      choices: (() => { try { return JSON.parse(row.choices); } catch { return []; } })()
    })) },
    pagination: {
      page: paging.page, limit: paging.limit,
      total: Number(count?.total || 0),
      total_pages: Math.ceil(Number(count?.total || 0) / paging.limit)
    }
  });
}

async function createQuestion(request, env) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(parsed.error, "ข้อมูลคำขอไม่ถูกต้อง", parsed.error === "BODY_TOO_LARGE" ? 413 : 400);
  const value = parsed.value;
  const invalid = validateQuestion(value);
  if (invalid) return fail(invalid, "ข้อมูลข้อสอบไม่ถูกต้อง", 400);
  const relationError = await validateQuestionRelations(env, value);
  if (relationError) return fail(relationError, "ไม่พบปีข้อสอบหรือหมวดวิชาที่เปิดใช้งาน", 422);
  const row = await env.DB.prepare(
    `INSERT INTO questions
       (exam_year_id, subcategory_id, question_text, passage, choices,
        correct_index, explanation, difficulty, source_round)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')
     RETURNING id, exam_year_id, subcategory_id, question_text, passage,
               choices, correct_index, explanation, difficulty, source_round, is_active`
  ).bind(
    value.exam_year_id, value.subcategory_id ?? null, value.question_text.trim(),
    value.passage ?? null, JSON.stringify(value.choices), value.correct_index,
    value.explanation ?? null, value.difficulty ?? null
  ).first();
  return json({ data: { question: { ...row, choices: value.choices } } }, 201);
}

async function updateQuestion(request, env, questionId) {
  if (!/^\d+$/.test(questionId) || Number(questionId) <= 0) return fail("INVALID_QUESTION_ID", "รหัสข้อสอบไม่ถูกต้อง", 400);
  const parsed = await readJson(request);
  if (parsed.error) return fail(parsed.error, "ข้อมูลคำขอไม่ถูกต้อง", parsed.error === "BODY_TOO_LARGE" ? 413 : 400);
  const value = parsed.value;
  const invalid = validateQuestion(value);
  if (invalid) return fail(invalid, "ข้อมูลข้อสอบไม่ถูกต้อง", 400);
  const relationError = await validateQuestionRelations(env, value);
  if (relationError) return fail(relationError, "ไม่พบปีข้อสอบหรือหมวดวิชาที่เปิดใช้งาน", 422);
  const row = await env.DB.prepare(
    `UPDATE questions
        SET exam_year_id = ?, subcategory_id = ?, question_text = ?, passage = ?,
            choices = ?, correct_index = ?, explanation = ?, difficulty = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      RETURNING id, exam_year_id, subcategory_id, question_text, passage,
                choices, correct_index, explanation, difficulty, source_round, is_active`
  ).bind(
    value.exam_year_id, value.subcategory_id ?? null, value.question_text.trim(),
    value.passage ?? null, JSON.stringify(value.choices), value.correct_index,
    value.explanation ?? null, value.difficulty ?? null, Number(questionId)
  ).first();
  if (!row) return fail("QUESTION_NOT_FOUND", "ไม่พบข้อสอบ", 404);
  return json({ data: { question: { ...row, choices: value.choices } } });
}

async function updateQuestionStatus(request, env, questionId) {
  if (!/^\d+$/.test(questionId) || Number(questionId) <= 0) return fail("INVALID_QUESTION_ID", "รหัสข้อสอบไม่ถูกต้อง", 400);
  const parsed = await readJson(request);
  if (parsed.error) return fail(parsed.error, "ข้อมูลคำขอไม่ถูกต้อง", parsed.error === "BODY_TOO_LARGE" ? 413 : 400);
  if (typeof parsed.value.is_active !== "boolean") return fail("INVALID_QUESTION_STATUS", "is_active ต้องเป็น true หรือ false", 400);
  const row = await env.DB.prepare(
    `UPDATE questions SET is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      RETURNING id, is_active`
  ).bind(parsed.value.is_active ? 1 : 0, Number(questionId)).first();
  return row ? json({ data: { question: row } }) : fail("QUESTION_NOT_FOUND", "ไม่พบข้อสอบ", 404);
}

export async function handleAdmin(request, env, url) {
  if (env.ADMIN_API_ENABLED !== "true" || env.AUTH_ENABLED !== "true") {
    return fail("ADMIN_API_NOT_ENABLED", "Admin API ยังไม่เปิดใช้งานใน Environment นี้", 404);
  }
  const access = request.method === "GET"
    ? await requireAdmin(request, env)
    : await requireWriteAccess(request, env);
  if (!access.ok) return access.response;

  if (request.method === "GET" && url.pathname === "/api/admin/users") {
    return listUsers(env, url);
  }
  const userStatus = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if (request.method === "PATCH" && userStatus) {
    return updateUserStatus(request, env, decodeURIComponent(userStatus[1]), access.session.profile_id);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/questions") {
    return listQuestions(env, url);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/questions") {
    return createQuestion(request, env);
  }
  const questionStatus = url.pathname.match(/^\/api\/admin\/questions\/(\d+)\/status$/);
  if (request.method === "PATCH" && questionStatus) {
    return updateQuestionStatus(request, env, questionStatus[1]);
  }
  const question = url.pathname.match(/^\/api\/admin\/questions\/(\d+)$/);
  if (request.method === "PATCH" && question) {
    return updateQuestion(request, env, question[1]);
  }
  return fail("NOT_FOUND", "ไม่พบ Admin API endpoint นี้", 404);
}
