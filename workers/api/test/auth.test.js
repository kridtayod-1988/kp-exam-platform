import test from "node:test";
import assert from "node:assert/strict";
import { handleAuth } from "../src/auth.js";

function dbStub(firstResult = null) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() { statements.push({ sql, values: this.values, operation: "first" }); return firstResult; },
        async run() { statements.push({ sql, values: this.values }); return { success: true }; }
      };
    }
  };
}

test("Google OAuth start creates one-time state and redirects to Google", async () => {
  const DB = dbStub();
  const response = await handleAuth(
    new Request("https://api.example.test/auth/google/start"),
    { DB, APP_ENV: "preview", AUTH_ENABLED: "true", GOOGLE_CLIENT_ID: "staging-client-id", GOOGLE_REDIRECT_URI: "https://api.example.test/auth/google/callback" },
    new URL("https://api.example.test/auth/google/start")
  );
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get("location"));
  assert.equal(target.origin, "https://accounts.google.com");
  assert.equal(target.pathname, "/o/oauth2/v2/auth");
  assert.equal(target.searchParams.get("response_type"), "code");
  assert.ok(target.searchParams.get("state"));
  assert.ok(target.searchParams.get("nonce"));
  assert.match(response.headers.get("set-cookie"), /__Host-kp_oauth_state=.*HttpOnly.*Secure.*SameSite=Lax/);
  assert.equal(DB.statements.length, 1);
  assert.match(DB.statements[0].sql, /INSERT INTO auth_oauth_states/);
});

test("Google OAuth start fails closed when Staging credentials are not configured", async () => {
  const response = await handleAuth(
    new Request("https://api.example.test/auth/google/start"),
    { DB: dbStub(), APP_ENV: "preview", AUTH_ENABLED: "true" },
    new URL("https://api.example.test/auth/google/start")
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "OAUTH_NOT_CONFIGURED");
});

test("session endpoint does not authenticate without a session cookie", async () => {
  const response = await handleAuth(
    new Request("https://api.example.test/api/auth/session"),
    { DB: dbStub(), APP_ENV: "preview", AUTH_ENABLED: "true" },
    new URL("https://api.example.test/api/auth/session")
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { authenticated: false });
});

test("logout rejects an untrusted Origin before touching session state", async () => {
  const DB = dbStub();
  const response = await handleAuth(
    new Request("https://api.example.test/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://attacker.example" }
    }),
    { DB, APP_ENV: "preview", AUTH_ENABLED: "true", CORS_ALLOWED_ORIGINS: "https://frontend.example" },
    new URL("https://api.example.test/api/auth/logout")
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "ORIGIN_NOT_ALLOWED");
  assert.equal(DB.statements.length, 0);
});


async function hashToken(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

test("OAuth callback rejects a state that is not bound to the browser cookie", async () => {
  const DB = dbStub();
  const response = await handleAuth(
    new Request("https://api.example.test/auth/google/callback?code=abc&state=query-state", {
      headers: { Cookie: "__Host-kp_oauth_state=other-state" }
    }),
    { DB, APP_ENV: "preview", AUTH_ENABLED: "true", GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_REDIRECT_URI: "https://api.example.test/auth/google/callback" },
    new URL("https://api.example.test/auth/google/callback?code=abc&state=query-state")
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "OAUTH_CALLBACK_INVALID");
  assert.equal(DB.statements.length, 0);
});

test("OAuth callback rejects expired, consumed, or unknown state before exchanging the code", async () => {
  const DB = dbStub();
  const response = await handleAuth(
    new Request("https://api.example.test/auth/google/callback?code=abc&state=valid-state", {
      headers: { Cookie: "__Host-kp_oauth_state=valid-state" }
    }),
    { DB, APP_ENV: "preview", AUTH_ENABLED: "true", GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_REDIRECT_URI: "https://api.example.test/auth/google/callback" },
    new URL("https://api.example.test/auth/google/callback?code=abc&state=valid-state")
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "OAUTH_STATE_INVALID");
  assert.match(DB.statements[0].sql, /DELETE FROM auth_oauth_states/);
  assert.match(DB.statements[0].sql, /expires_at > CURRENT_TIMESTAMP/);
});

test("expired or revoked sessions are not authenticated", async () => {
  const response = await handleAuth(
    new Request("https://api.example.test/api/auth/session", {
      headers: { Cookie: "__Host-kp_session=expired-session" }
    }),
    { DB: dbStub(null), APP_ENV: "preview", AUTH_ENABLED: "true" },
    new URL("https://api.example.test/api/auth/session")
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { authenticated: false });
});

test("logout rejects a missing or incorrect CSRF token without revoking the session", async () => {
  const DB = dbStub({
    profile_id: "profile-1",
    csrf_token_hash: await hashToken("expected-csrf"),
    expires_at: "2099-01-01 00:00:00",
    email: "user@example.test",
    role: "user"
  });
  const response = await handleAuth(
    new Request("https://api.example.test/api/auth/logout", {
      method: "POST",
      headers: {
        Origin: "https://frontend.example",
        Cookie: "__Host-kp_session=known-session",
        "X-CSRF-Token": "wrong-csrf"
      }
    }),
    { DB, APP_ENV: "preview", AUTH_ENABLED: "true", CORS_ALLOWED_ORIGINS: "https://frontend.example" },
    new URL("https://api.example.test/api/auth/logout")
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "CSRF_INVALID");
  assert.equal(DB.statements.some(({ sql }) => /UPDATE auth_sessions SET revoked_at|INSERT INTO auth_audit_log/.test(sql)), false);
});

test("logout revokes the session and records an audit event with a valid CSRF token", async () => {
  const DB = dbStub({
    profile_id: "profile-1",
    csrf_token_hash: await hashToken("expected-csrf"),
    expires_at: "2099-01-01 00:00:00",
    email: "user@example.test",
    role: "user"
  });
  const response = await handleAuth(
    new Request("https://api.example.test/api/auth/logout", {
      method: "POST",
      headers: {
        Origin: "https://frontend.example",
        Cookie: "__Host-kp_session=known-session",
        "X-CSRF-Token": "expected-csrf"
      }
    }),
    { DB, APP_ENV: "preview", AUTH_ENABLED: "true", CORS_ALLOWED_ORIGINS: "https://frontend.example" },
    new URL("https://api.example.test/api/auth/logout")
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
  assert.ok(DB.statements.some(({ sql }) => /UPDATE auth_sessions SET revoked_at/.test(sql)));
  assert.ok(DB.statements.some(({ sql }) => /INSERT INTO auth_audit_log/.test(sql)));
});
