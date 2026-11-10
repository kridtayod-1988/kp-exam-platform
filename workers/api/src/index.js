const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": env.FRONTEND_ORIGIN || "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
          "access-control-max-age": "600",
          "vary": "Origin"
        }
      });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      try {
        if (!env.DB) {
          return json({ ok: false, error: "D1 binding DB is unavailable" }, 503);
        }
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({
          ok: true,
          service: "kp-exam-api",
          database: "connected",
          environment: env.APP_ENV || "unknown"
        });
      } catch {
        return json({
          ok: false,
          service: "kp-exam-api",
          database: "unavailable"
        }, 503);
      }
    }

    return json({
      error: "NOT_IMPLEMENTED",
      message: "This API route is not implemented in the deployment scaffold."
    }, 501);
  }
};
