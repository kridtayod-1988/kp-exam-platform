import { getAuthenticatedSession, verifySessionCsrf } from "./auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

const fail = (code, message, status) => json({ error: code, message }, status);

const ALLOWED_QUESTION_COUNTS = new Set([10, 25, 50]);
const ALLOWED_MODES = new Set(["practice"]);
const MAX_BODY_BYTES = 64 * 1024;

async function readJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return { error: "BODY_TOO_LARGE" };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return { error: "BODY_TOO_LARGE" };
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { value }
      : { error: "INVALID_JSON" };
  } catch {
    return { error: "INVALID_JSON" };
  }
}

function parseIdSnapshot(value) {
  try {
    const ids = JSON.parse(value);
    return Array.isArray(ids) && ids.every(id => Number.isSafeInteger(id) && id > 0)
      ? ids
      : null;
  } catch {
    return null;
  }
}

function parseChoices(value) {
  try {
    const choices = JSON.parse(value);
    return Array.isArray(choices) ? choices : [];
  } catch {
    return [];
  }
}

async function authenticatedMutation(request, env) {
  const session = await getAuthenticatedSession(request, env);
  if (!session) return { error: fail("UNAUTHENTICATED", "กรุณาเข้าสู่ระบบก่อนทำข้อสอบ", 401) };
  if (!await verifySessionCsrf(request, env, session)) {
    return { error: fail("CSRF_INVALID", "คำขอไม่ผ่านการตรวจสอบความปลอดภัย กรุณาโหลดหน้าเว็บใหม่", 403) };
  }
  return { session };
}

async function allowAttemptStart(env, profileId) {
  const accepted = await env.DB.prepare(
    `INSERT INTO auth_audit_log (profile_id, event_type, event_detail)
     SELECT ?, 'attempt_start', 'api'
      WHERE (
        SELECT COUNT(*) FROM auth_audit_log
         WHERE profile_id = ? AND event_type = 'attempt_start'
           AND created_at >= datetime('now', '-1 hour')
      ) < 10
     RETURNING id`
  ).bind(profileId, profileId).first();
  return !!accepted;
}

async function startAttempt(request, env) {
  const auth = await authenticatedMutation(request, env);
  if (auth.error) return auth.error;

  const parsed = await readJson(request);
  if (parsed.error) {
    return parsed.error === "BODY_TOO_LARGE"
      ? fail("BODY_TOO_LARGE", "ข้อมูลคำขอมีขนาดใหญ่เกินไป", 413)
      : fail("INVALID_JSON", "รูปแบบ JSON ไม่ถูกต้อง", 400);
  }

  const { exam_year_id: examYearId, question_count: questionCount, mode = "practice" } = parsed.value;
  if (!Number.isSafeInteger(examYearId) || examYearId <= 0) {
    return fail("INVALID_EXAM_YEAR", "รหัสปีข้อสอบไม่ถูกต้อง", 400);
  }
  if (!ALLOWED_QUESTION_COUNTS.has(questionCount)) {
    return fail("INVALID_QUESTION_COUNT", "จำนวนข้อสอบต้องเป็น 10, 25 หรือ 50 ข้อ", 400);
  }
  if (!ALLOWED_MODES.has(mode)) {
    return fail("INVALID_EXAM_MODE", "รูปแบบการสอบไม่ถูกต้อง", 400);
  }

  const year = await env.DB.prepare(
    "SELECT id, year_be, label FROM exam_years WHERE id = ? AND is_active = 1 LIMIT 1"
  ).bind(examYearId).first();
  if (!year) return fail("EXAM_YEAR_NOT_FOUND", "ไม่พบปีข้อสอบหรือปีข้อสอบยังไม่เปิดใช้งาน", 404);

  const unseen = await env.DB.prepare(
    `SELECT q.id, q.question_text, q.passage, q.choices, q.difficulty,
            q.subcategory_id, sc.name AS subject_name
       FROM questions q
       LEFT JOIN subcategories sc
         ON sc.id = q.subcategory_id AND sc.is_active = 1
       LEFT JOIN subject_groups sg
         ON sg.id = sc.subject_group_id AND sg.is_active = 1
      WHERE q.exam_year_id = ? AND q.is_active = 1
        AND (q.subcategory_id IS NULL OR sg.id IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM user_seen_questions seen
           WHERE seen.profile_id = ? AND seen.question_id = q.id
        )
      ORDER BY RANDOM()
      LIMIT ?`
  ).bind(examYearId, auth.session.profile_id, questionCount).all();

  const unseenRows = unseen.results || [];
  const remainingCount = questionCount - unseenRows.length;
  let rows = unseenRows;
  if (remainingCount > 0) {
    const selectedIds = unseenRows.map(row => row.id);
    const exclusion = selectedIds.length
      ? `AND q.id NOT IN (${selectedIds.map(() => "?").join(",")})`
      : "";
    const fallback = await env.DB.prepare(
      `SELECT q.id, q.question_text, q.passage, q.choices, q.difficulty,
              q.subcategory_id, sc.name AS subject_name
         FROM questions q
         LEFT JOIN subcategories sc
           ON sc.id = q.subcategory_id AND sc.is_active = 1
         LEFT JOIN subject_groups sg
           ON sg.id = sc.subject_group_id AND sg.is_active = 1
        WHERE q.exam_year_id = ? AND q.is_active = 1
          AND (q.subcategory_id IS NULL OR sg.id IS NOT NULL)
          ${exclusion}
        ORDER BY RANDOM()
        LIMIT ?`
    ).bind(examYearId, ...selectedIds, remainingCount).all();
    rows = [...unseenRows, ...(fallback.results || [])];
  }
  if (rows.length < questionCount) {
    return fail("INSUFFICIENT_QUESTIONS", `ปีข้อสอบนี้มีข้อสอบที่พร้อมใช้งานเพียง ${rows.length} ข้อ`, 422);
  }
  if (!await allowAttemptStart(env, auth.session.profile_id)) {
    return fail("ATTEMPT_RATE_LIMITED", "เริ่มชุดข้อสอบครบจำนวนที่กำหนดแล้ว กรุณาลองใหม่ภายหลัง", 429);
  }

  const attemptId = crypto.randomUUID();
  const questionIds = rows.map(row => row.id);
  await env.DB.prepare(
    `INSERT INTO user_attempts
       (id, user_id, exam_year_id, question_count, mode, status, question_ids_json)
     VALUES (?, ?, ?, ?, ?, 'in_progress', ?)`
  ).bind(
    attemptId,
    auth.session.profile_id,
    examYearId,
    questionCount,
    mode,
    JSON.stringify(questionIds)
  ).run();

  return json({
    data: {
      attempt: {
        id: attemptId,
        exam_year_id: examYearId,
        exam_year_label: year.label || `พ.ศ. ${year.year_be}`,
        question_count: questionCount,
        mode,
        started_at: new Date().toISOString()
      },
      questions: rows.map(row => ({
        id: row.id,
        question_text: row.question_text,
        passage: row.passage ?? null,
        choices: parseChoices(row.choices),
        difficulty: row.difficulty ?? null,
        subcategory_id: row.subcategory_id ?? null,
        subject_name: row.subject_name ?? null
      }))
    }
  }, 201);
}

async function loadOwnedAttempt(env, attemptId, profileId) {
  return env.DB.prepare(
    `SELECT id, user_id, exam_year_id, question_count, mode, status,
            question_ids_json, started_at, submitted_at, score
       FROM user_attempts
      WHERE id = ? AND user_id = ?
      LIMIT 1`
  ).bind(attemptId, profileId).first();
}

async function loadResult(env, attempt) {
  const ids = parseIdSnapshot(attempt.question_ids_json);
  if (!ids) throw new Error("ATTEMPT_QUESTION_SNAPSHOT_INVALID");
  const placeholders = ids.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `SELECT q.id, q.question_text, q.passage, q.choices, q.correct_index,
            q.explanation, q.difficulty, q.subcategory_id,
            sc.name AS subject_name, ua.selected_index
       FROM questions q
       LEFT JOIN subcategories sc ON sc.id = q.subcategory_id
       LEFT JOIN user_answers ua
         ON ua.attempt_id = ? AND ua.question_id = q.id
      WHERE q.id IN (${placeholders})`
  ).bind(attempt.id, ...ids).all();

  const byId = new Map((result.results || []).map(row => [row.id, row]));
  const questions = ids.map(id => {
    const row = byId.get(id);
    if (!row) return null;
    return {
      id: row.id,
      question_text: row.question_text,
      passage: row.passage ?? null,
      choices: parseChoices(row.choices),
      selected_index: row.selected_index ?? null,
      correct_index: row.correct_index,
      is_correct: row.selected_index !== null && row.selected_index === row.correct_index,
      explanation: row.explanation ?? null,
      difficulty: row.difficulty ?? null,
      subcategory_id: row.subcategory_id ?? null,
      subject_name: row.subject_name ?? null
    };
  }).filter(Boolean);

  const score = Number(attempt.score || 0);
  const total = Number(attempt.question_count);
  return {
    attempt_id: attempt.id,
    exam_year_id: attempt.exam_year_id,
    status: attempt.status,
    score,
    total,
    percentage: total ? Math.round((score / total) * 10000) / 100 : 0,
    xp_earned: score * 10,
    started_at: attempt.started_at,
    submitted_at: attempt.submitted_at,
    questions
  };
}

async function submitAttempt(request, env, attemptId) {
  const auth = await authenticatedMutation(request, env);
  if (auth.error) return auth.error;

  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) {
    return fail("INVALID_ATTEMPT_ID", "รหัสชุดข้อสอบไม่ถูกต้อง", 400);
  }
  const attempt = await loadOwnedAttempt(env, attemptId, auth.session.profile_id);
  if (!attempt) return fail("ATTEMPT_NOT_FOUND", "ไม่พบชุดข้อสอบนี้", 404);
  if (attempt.status === "submitted") {
    return json({ data: { result: await loadResult(env, attempt) } });
  }
  if (attempt.status !== "in_progress") {
    return fail("ATTEMPT_NOT_ACTIVE", "ชุดข้อสอบนี้ไม่อยู่ในสถานะที่ส่งคำตอบได้", 409);
  }

  const parsed = await readJson(request);
  if (parsed.error) {
    return parsed.error === "BODY_TOO_LARGE"
      ? fail("BODY_TOO_LARGE", "ข้อมูลคำตอบมีขนาดใหญ่เกินไป", 413)
      : fail("INVALID_JSON", "รูปแบบ JSON ไม่ถูกต้อง", 400);
  }
  const answers = parsed.value.answers;
  if (!Array.isArray(answers) || answers.length > attempt.question_count) {
    return fail("INVALID_ANSWERS", "รูปแบบคำตอบไม่ถูกต้อง", 400);
  }

  const snapshotIds = parseIdSnapshot(attempt.question_ids_json);
  if (!snapshotIds || snapshotIds.length !== attempt.question_count) {
    return fail("ATTEMPT_QUESTION_SNAPSHOT_INVALID", "ข้อมูลชุดข้อสอบไม่ถูกต้อง", 500);
  }
  const allowedIds = new Set(snapshotIds);
  const seen = new Set();
  for (const answer of answers) {
    if (!answer || !Number.isSafeInteger(answer.question_id) ||
        !Number.isSafeInteger(answer.selected_index) || answer.selected_index < 0 ||
        !allowedIds.has(answer.question_id) || seen.has(answer.question_id)) {
      return fail("INVALID_ANSWERS", "พบคำตอบซ้ำหรือคำตอบที่ไม่อยู่ในชุดข้อสอบ", 400);
    }
    seen.add(answer.question_id);
  }

  const placeholders = snapshotIds.map(() => "?").join(",");
  const questionResult = await env.DB.prepare(
    `SELECT id, choices, correct_index
       FROM questions
      WHERE id IN (${placeholders})`
  ).bind(...snapshotIds).all();
  const questionMap = new Map((questionResult.results || []).map(row => [row.id, row]));
  if (questionMap.size !== snapshotIds.length) {
    return fail("ATTEMPT_QUESTION_MISSING", "ข้อสอบบางข้อไม่พร้อมใช้งานแล้ว", 409);
  }

  let score = 0;
  for (const answer of answers) {
    const question = questionMap.get(answer.question_id);
    const choices = parseChoices(question.choices);
    if (answer.selected_index >= choices.length) {
      return fail("ANSWER_OUT_OF_RANGE", "ตัวเลือกคำตอบไม่ถูกต้อง", 400);
    }
    if (answer.selected_index === question.correct_index) score += 1;
  }

  // A unique marker lets the conditional answer writes belong only to the
  // request that successfully claims this in-progress attempt.
  const randomFraction = crypto.getRandomValues(new Uint32Array(1))[0].toString().padStart(10, "0");
  const submissionMarker = new Date().toISOString().replace(/(\\.\\d{3})Z$/, "$1" + randomFraction + "Z");
  const statements = [
    env.DB.prepare(
      `UPDATE user_attempts
          SET status = 'submitted', score = ?, submitted_at = ?
        WHERE id = ? AND user_id = ? AND status = 'in_progress'`
    ).bind(score, submissionMarker, attemptId, auth.session.profile_id)
  ];

  for (const answer of answers) {
    statements.push(env.DB.prepare(
      `INSERT INTO user_answers (attempt_id, question_id, selected_index)
       SELECT ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM user_attempts
           WHERE id = ? AND user_id = ? AND status = 'submitted' AND submitted_at = ?
        )
       ON CONFLICT(attempt_id, question_id) DO UPDATE SET
         selected_index = excluded.selected_index,
         answered_at = CURRENT_TIMESTAMP`
    ).bind(
      attemptId, answer.question_id, answer.selected_index,
      attemptId, auth.session.profile_id, submissionMarker
    ));
  }

  // XP and Anti-Repeat history are written in the same D1 batch as the
  // conditional submission claim. Losing concurrent submissions cannot
  // award XP or mark questions as seen under another request's marker.
  statements.push(env.DB.prepare(
    `UPDATE profiles
        SET xp = xp + ?
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM user_attempts
         WHERE id = ? AND user_id = ? AND status = 'submitted' AND submitted_at = ?
      )`
  ).bind(score * 10, auth.session.profile_id, attemptId, auth.session.profile_id, submissionMarker));

  statements.push(env.DB.prepare(
    `INSERT INTO user_seen_questions (profile_id, question_id, seen_at)
     SELECT ?, CAST(value AS INTEGER), ?
       FROM json_each(?)
      WHERE EXISTS (
        SELECT 1 FROM user_attempts
         WHERE id = ? AND user_id = ? AND status = 'submitted' AND submitted_at = ?
      )
     ON CONFLICT(profile_id, question_id) DO NOTHING`
  ).bind(
    auth.session.profile_id,
    submissionMarker,
    JSON.stringify(snapshotIds),
    attemptId,
    auth.session.profile_id,
    submissionMarker
  ));

  const batchResult = await env.DB.batch(statements);
  const claim = batchResult?.[0];
  if (!claim || Number(claim.meta?.changes ?? claim.changes ?? 0) !== 1) {
    const latest = await loadOwnedAttempt(env, attemptId, auth.session.profile_id);
    if (latest?.status === "submitted") {
      return json({ data: { result: await loadResult(env, latest) } });
    }
    return fail("ATTEMPT_SUBMISSION_CONFLICT", "ชุดข้อสอบถูกส่งหรือเปลี่ยนสถานะไปแล้ว", 409);
  }

  const submitted = await loadOwnedAttempt(env, attemptId, auth.session.profile_id);
  return json({ data: { result: await loadResult(env, submitted) } });
}

async function getAttemptResult(env, attemptId, profileId) {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) {
    return fail("INVALID_ATTEMPT_ID", "รหัสชุดข้อสอบไม่ถูกต้อง", 400);
  }
  const attempt = await loadOwnedAttempt(env, attemptId, profileId);
  if (!attempt) return fail("ATTEMPT_NOT_FOUND", "ไม่พบชุดข้อสอบนี้", 404);
  if (attempt.status !== "submitted") {
    return fail("ATTEMPT_NOT_SUBMITTED", "ยังไม่สามารถดูเฉลยได้ก่อนส่งข้อสอบ", 409);
  }
  return json({ data: { result: await loadResult(env, attempt) } });
}

export async function handleExamEngine(request, env, url) {
  if (env.APP_ENV !== "preview" || env.AUTH_ENABLED !== "true") {
    return fail("EXAM_ENGINE_NOT_ENABLED", "Exam Engine ยังไม่เปิดใช้งานใน Environment นี้", 404);
  }
  try {
    if (request.method === "POST" && url.pathname === "/api/attempts") {
      return await startAttempt(request, env);
    }
    const submitMatch = url.pathname.match(new RegExp("^/api/attempts/([^/]+)/submit$"));
    if (request.method === "POST" && submitMatch) {
      return await submitAttempt(request, env, decodeURIComponent(submitMatch[1]));
    }
    const resultMatch = url.pathname.match(new RegExp("^/api/attempts/([^/]+)/result$"));
    if (request.method === "GET" && resultMatch) {
      const session = await getAuthenticatedSession(request, env);
      if (!session) return fail("UNAUTHENTICATED", "กรุณาเข้าสู่ระบบก่อนดูผลสอบ", 401);
      return await getAttemptResult(env, decodeURIComponent(resultMatch[1]), session.profile_id);
    }
    return null;
  } catch {
    return fail("INTERNAL_ERROR", "เกิดข้อผิดพลาดในการประมวลผลข้อสอบ", 500);
  }
}
