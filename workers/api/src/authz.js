import { getAuthenticatedSession } from "./auth.js";

const json = (body, status) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

/**
 * Server-side authorization guard for future Admin API handlers.
 * Role is read from the active, non-revoked database session; request
 * headers and client-supplied role values are never trusted.
 */
export async function requireAdmin(request, env) {
  const session = await getAuthenticatedSession(request, env);
  if (!session) {
    return {
      ok: false,
      session: null,
      response: json({ error: "UNAUTHENTICATED" }, 401)
    };
  }

  if (session.role !== "admin") {
    return {
      ok: false,
      session: null,
      response: json({ error: "FORBIDDEN" }, 403)
    };
  }

  return { ok: true, session, response: null };
}
