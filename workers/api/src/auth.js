const SESSION_COOKIE = "__Host-kp_session";
const CSRF_COOKIE = "__Host-kp_csrf";
const OAUTH_STATE_COOKIE = "__Host-kp_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const OAUTH_TTL_SECONDS = 10 * 60;
const OAUTH_START_LIMIT = 5;

const json = (body, status = 200, headers = {}) => {
  const responseHeaders = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  if (headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      if (key.toLowerCase() !== "set-cookie") responseHeaders.set(key, value);
    }
    const cookies = headers.getSetCookie?.() || (headers.has("set-cookie") ? [headers.get("set-cookie")] : []);
    for (const value of cookies) responseHeaders.append("set-cookie", value);
  } else {
    for (const [key, value] of Object.entries(headers || {})) responseHeaders.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
};

const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

async function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64url(value);
}

async function sha256(value) {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function hmac(value, secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("SESSION_SECRET_NOT_CONFIGURED");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function csrfForSession(sessionToken, env) {
  return hmac(`kp-exam-csrf:v1:${sessionToken}`, env.SESSION_SECRET);
}

function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function sessionCookieHeaders(session, csrf, maxAge = SESSION_TTL_SECONDS) {
  return [
    `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
    `${CSRF_COOKIE}=${csrf}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}`
  ];
}

function clearCookieHeaders() {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; Secure; SameSite=Lax; Max-Age=0`,
    `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  ];
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return !!origin && String(env.CORS_ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).includes(origin);
}

function adminEmails(env) {
  return String(env.ADMIN_EMAILS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

async function getSession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.profile_id, s.csrf_token_hash, s.expires_at, p.email, p.display_name, p.picture_url, p.role, p.is_active
       FROM auth_sessions s JOIN profiles p ON p.id = s.profile_id
      WHERE s.session_token_hash = ? AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP AND p.is_active = 1 LIMIT 1`
  ).bind(tokenHash).first();
  return row ? { ...row, tokenHash, token } : null;
}

async function verifyGoogleIdToken(idToken, env, expectedNonce) {
  const response = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
  if (!response.ok) throw new Error("GOOGLE_TOKEN_INVALID");
  const claims = await response.json();
  const issuerOk = ["accounts.google.com", "https://accounts.google.com"].includes(claims.iss);
  if (!issuerOk || claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_TOKEN_CLAIMS_INVALID");
  if (!claims.sub || !claims.email || claims.email_verified !== "true") throw new Error("GOOGLE_EMAIL_UNVERIFIED");
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= Math.floor(Date.now() / 1000)) {
    throw new Error("GOOGLE_TOKEN_EXPIRED");
  }
  if (claims.nonce !== expectedNonce) throw new Error("GOOGLE_NONCE_MISMATCH");
  return claims;
}

async function allowOAuthStart(request, env) {
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipKey = await hmac(`kp-exam-oauth-start:v1:${clientIp}`, env.SESSION_SECRET);
  // One atomic INSERT/SELECT enforces the per-IP window without a separate
  // read/write race. Only a keyed digest of the edge IP is stored in the audit log.
  const accepted = await env.DB.prepare(
    `INSERT INTO auth_audit_log (event_type, event_detail)
     SELECT 'oauth_start', ?
      WHERE (
        SELECT COUNT(*) FROM auth_audit_log
         WHERE event_type = 'oauth_start'
           AND event_detail = ?
           AND created_at >= datetime('now', '-1 minute')
      ) < ?
     RETURNING id`
  ).bind(ipKey, ipKey, OAUTH_START_LIMIT).first();
  return !!accepted;
}

async function startGoogle(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI ||
      typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) {
    return json({ error: "OAUTH_NOT_CONFIGURED" }, 503);
  }

  if (!await allowOAuthStart(request, env)) {
    return json({ error: "OAUTH_RATE_LIMITED", retry_after: 60 }, 429, { "retry-after": "60" });
  }

  // Expired one-time states are removed on every accepted start. Callback
  // consumption remains atomic through DELETE ... RETURNING.
  await env.DB.prepare(
    "DELETE FROM auth_oauth_states WHERE expires_at <= CURRENT_TIMESTAMP"
  ).run();

  const state = await randomToken();
  const nonce = await randomToken();
  const stateHash = await sha256(state);
  const expiresAt = new Date(Date.now() + OAUTH_TTL_SECONDS * 1000).toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare(
    "INSERT INTO auth_oauth_states (state_hash, nonce, expires_at) VALUES (?, ?, ?)"
  ).bind(stateHash, nonce, expiresAt).run();

  const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account"
  }).toString();
  const headers = new Headers({ location: target.toString() });
  headers.append("set-cookie", `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${OAUTH_TTL_SECONDS}`);
  return new Response(null, { status: 302, headers });
}

async function googleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !state || cookieValue(request, OAUTH_STATE_COOKIE) !== state ||
      !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI ||
      typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) {
    return json({ error: "OAUTH_CALLBACK_INVALID" }, 400);
  }

  const stateHash = await sha256(state);
  const saved = await env.DB.prepare(
    "DELETE FROM auth_oauth_states WHERE state_hash = ? AND expires_at > CURRENT_TIMESTAMP RETURNING nonce"
  ).bind(stateHash).first();
  if (!saved) return json({ error: "OAUTH_STATE_INVALID" }, 400);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });
  if (!tokenResponse.ok) {
    await recordOAuthFailure(env);
    return json({ error: "OAUTH_CODE_EXCHANGE_FAILED" }, 401);
  }
  const tokenPayload = await tokenResponse.json();
  if (!tokenPayload.id_token) {
    await recordOAuthFailure(env);
    return json({ error: "GOOGLE_ID_TOKEN_MISSING" }, 401);
  }

  const claims = await verifyGoogleIdToken(tokenPayload.id_token, env, saved.nonce);
  const email = String(claims.email).toLowerCase();
  const role = adminEmails(env).includes(email) ? "admin" : "user";
  const profileId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO profiles (id, google_sub, email, display_name, picture_url, role, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email, display_name = excluded.display_name,
       picture_url = excluded.picture_url, role = excluded.role,
       last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`
  ).bind(profileId, claims.sub, email, claims.name || null, claims.picture || null, role).run();

  const profile = await env.DB.prepare("SELECT id, role, is_active FROM profiles WHERE google_sub = ?").bind(claims.sub).first();
  if (!profile?.id) throw new Error("PROFILE_UPSERT_FAILED");
  if (profile.is_active !== 1) {
    await env.DB.prepare(
      "INSERT INTO auth_audit_log (profile_id, event_type, event_detail) VALUES (?, 'login_blocked', 'account_disabled')"
    ).bind(profile.id).run();
    return json({ error: "ACCOUNT_DISABLED" }, 403);
  }

  const session = await randomToken();
  const csrf = await csrfForSession(session, env);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare(
    "INSERT INTO auth_sessions (session_token_hash, profile_id, csrf_token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(await sha256(session), profile.id, await sha256(csrf), expiresAt).run();
  await env.DB.prepare(
    "INSERT INTO auth_audit_log (profile_id, event_type) VALUES (?, 'login_success')"
  ).bind(profile.id).run();

  const headers = new Headers({ location: env.AUTH_SUCCESS_REDIRECT || "/" });
  headers.append("set-cookie", `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  for (const value of sessionCookieHeaders(session, csrf)) headers.append("set-cookie", value);
  return new Response(null, { status: 302, headers });
}

async function recordOAuthFailure(env) {
  try {
    await env.DB.prepare(
      "INSERT INTO auth_audit_log (event_type, event_detail) VALUES ('login_failure', 'oauth_callback_failed')"
    ).run();
  } catch {
    // Failure logging must never replace the generic OAuth error response.
  }
}

export async function handleAuth(request, env, url) {
  if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/auth/")) {
    if (env.APP_ENV !== "preview") return json({ error: "AUTH_NOT_ENABLED" }, 404);
    if (env.AUTH_ENABLED !== "true") return json({ error: "AUTH_NOT_CONFIGURED" }, 503);
  }
  if (url.pathname === "/auth/google/start" && request.method === "GET") {
    return startGoogle(request, env);
  }
  if (url.pathname === "/auth/google/callback" && request.method === "GET") {
    try {
      return await googleCallback(request, env);
    } catch {
      await recordOAuthFailure(env);
      return json({ error: "OAUTH_CALLBACK_FAILED" }, 401);
    }
  }
  if (url.pathname === "/api/auth/session" && request.method === "GET") {
    const session = await getSession(request, env);
    if (!session) return json({ authenticated: false }, 401);

    const csrf = await csrfForSession(session.token, env);
    if (await sha256(csrf) !== session.csrf_token_hash) {
      const headers = new Headers();
      for (const value of clearCookieHeaders()) headers.append("set-cookie", value);
      return json({ authenticated: false, error: "SESSION_REAUTH_REQUIRED" }, 401, headers);
    }

    await env.DB.prepare(
      "UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_token_hash = ? AND revoked_at IS NULL"
    ).bind(session.tokenHash).run();

    const headers = new Headers();
    headers.append("set-cookie", `${CSRF_COOKIE}=${csrf}; Path=/; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`);
    return json({ authenticated: true, profile: {
      email: session.email, display_name: session.display_name,
      picture_url: session.picture_url, role: session.role
    }, csrf_token: csrf }, 200, headers);
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    if (!allowedOrigin(request, env)) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
    const session = await getSession(request, env);
    if (!session) {
      const headers = new Headers();
      for (const value of clearCookieHeaders()) headers.append("set-cookie", value);
      return json({ error: "UNAUTHENTICATED" }, 401, headers);
    }
    const csrf = request.headers.get("X-CSRF-Token") || "";
    const csrfCookie = cookieValue(request, CSRF_COOKIE);
    if (!csrf || csrf !== csrfCookie || await sha256(csrf) !== session.csrf_token_hash) {
      return json({ error: "CSRF_INVALID" }, 403);
    }
    await env.DB.prepare(
      "UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_token_hash = ? AND revoked_at IS NULL"
    ).bind(session.tokenHash).run();
    await env.DB.prepare(
      "INSERT INTO auth_audit_log (profile_id, event_type) VALUES (?, 'logout')"
    ).bind(session.profile_id).run();
    const headers = new Headers();
    for (const value of clearCookieHeaders()) headers.append("set-cookie", value);
    return json({ ok: true }, 200, headers);
  }
  return null;
}
