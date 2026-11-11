const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

function error(code, message, status, headers) {
  return json({ error: code, message }, status, headers);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  const allowed = String(env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    "vary": "Origin"
  };
}

function parseChoices(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.map(choice => typeof choice === "string" ? choice : String(choice?.text ?? ""))
      : [];
  } catch {
    return [];
  }
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

async function getExamYears(env) {
  const result = await env.DB.prepare(
    `SELECT ey.id, ey.year_be, ey.label,
            COUNT(q.id) AS question_count
       FROM exam_years ey
       LEFT JOIN questions q
         ON q.exam_year_id = ey.id AND q.is_active = 1
      WHERE ey.is_active = 1
      GROUP BY ey.id, ey.year_be, ey.label
      ORDER BY ey.year_be DESC`
  ).all();

  return (result.results || []).map(row => ({
    id: row.id,
    year_be: row.year_be,
    label: row.label || `พ.ศ. ${row.year_be}`,
    question_count: Number(row.question_count || 0)
  }));
}

async function getCatalog(env) {
  const [groups, categories] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, slug
         FROM subject_groups
        WHERE is_active = 1
        ORDER BY sort_order, name`
    ).all(),
    env.DB.prepare(
      `SELECT id, subject_group_id, name, slug, is_gpa3
         FROM subcategories
        WHERE is_active = 1
        ORDER BY sort_order, name`
    ).all()
  ]);

  return {
    subject_groups: groups.results || [],
    subcategories: categories.results || []
  };
}

async function getYearQuestions(env, yearId, page, limit) {
  const year = await env.DB.prepare(
    `SELECT id, year_be, label
       FROM exam_years
      WHERE id = ? AND is_active = 1
      LIMIT 1`
  ).bind(yearId).first();

  if (!year) {
    return {
      status: 404,
      body: {
        error: "EXAM_YEAR_NOT_FOUND",
        message: "ไม่พบปีข้อสอบหรือปีข้อสอบยังไม่เปิดใช้งาน"
      }
    };
  }

  const offset = (page - 1) * limit;
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total
       FROM questions
      WHERE exam_year_id = ? AND is_active = 1`
  ).bind(yearId).first();

  const result = await env.DB.prepare(
    `SELECT q.id, q.question_text, q.passage, q.choices,
            q.difficulty, q.subcategory_id,
            sc.name AS subject_name
       FROM questions q
       LEFT JOIN subcategories sc ON sc.id = q.subcategory_id
      WHERE q.exam_year_id = ? AND q.is_active = 1
      ORDER BY q.id
      LIMIT ? OFFSET ?`
  ).bind(yearId, limit, offset).all();

  const questions = (result.results || []).map(row => ({
    id: row.id,
    question_text: row.question_text,
    passage: row.passage ?? null,
    choices: parseChoices(row.choices),
    difficulty: row.difficulty ?? null,
    subcategory_id: row.subcategory_id ?? null,
    subject_name: row.subject_name ?? null
  }));

  return {
    status: 200,
    body: {
      exam_year: {
        id: year.id,
        year_be: year.year_be,
        label: year.label || `พ.ศ. ${year.year_be}`
      },
      pagination: {
        page,
        limit,
        total: Number(countRow?.total || 0),
        total_pages: Math.ceil(Number(countRow?.total || 0) / limit)
      },
      questions
    }
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    const origin = request.headers.get("Origin");
    const allowed = !origin || headers["access-control-allow-origin"] === origin;

    if (request.method === "OPTIONS") {
      return allowed
        ? new Response(null, { status: 204, headers })
        : error("ORIGIN_NOT_ALLOWED", "Origin นี้ไม่ได้รับอนุญาต", 403);
    }

    if (!allowed) {
      return error("ORIGIN_NOT_ALLOWED", "Origin นี้ไม่ได้รับอนุญาต", 403);
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      try {
        if (!env.DB) return error("DATABASE_UNAVAILABLE", "D1 binding DB is unavailable", 503, headers);
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({
          ok: true,
          service: "kp-exam-api",
          database: "connected",
          environment: env.APP_ENV || "unknown"
        }, 200, headers);
      } catch {
        return error("DATABASE_UNAVAILABLE", "ไม่สามารถเชื่อมต่อฐานข้อมูลได้", 503, headers);
      }
    }

    if (request.method !== "GET") {
      return error("METHOD_NOT_ALLOWED", "รองรับเฉพาะ GET ใน Staging Phase 1", 405, {
        ...headers,
        allow: "GET, OPTIONS"
      });
    }

    if (!env.DB) return error("DATABASE_UNAVAILABLE", "D1 binding DB is unavailable", 503, headers);

    try {
      if (url.pathname === "/api/exam-years") {
        const examYears = await getExamYears(env);
        return json({ data: { exam_years: examYears } }, 200, headers);
      }

      if (url.pathname === "/api/catalog") {
        const catalog = await getCatalog(env);
        return json({ data: catalog }, 200, headers);
      }

      const match = url.pathname.match(/^\/api\/exam-years\/(\d+)\/questions$/);
      if (match) {
        const yearId = Number(match[1]);
        const page = Number(url.searchParams.get("page") || 1);
        const limit = Number(url.searchParams.get("limit") || 25);

        if (!isPositiveInteger(yearId)) {
          return error("INVALID_EXAM_YEAR", "รหัสปีข้อสอบไม่ถูกต้อง", 400, headers);
        }
        if (!isPositiveInteger(page) || !isPositiveInteger(limit) || limit > 50) {
          return error("INVALID_PAGINATION", "page ต้องเป็นจำนวนเต็มบวก และ limit ต้องอยู่ระหว่าง 1–50", 400, headers);
        }

        const result = await getYearQuestions(env, yearId, page, limit);
        if (result.status !== 200) {
          return error(result.body.error, result.body.message, result.status, headers);
        }
        return json({ data: result.body }, 200, headers);
      }

      return error("NOT_FOUND", "ไม่พบ API endpoint นี้", 404, headers);
    } catch {
      return error("INTERNAL_ERROR", "เกิดข้อผิดพลาดในการประมวลผล API", 500, headers);
    }
  }
};
