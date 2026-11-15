import test from "node:test";
import assert from "node:assert/strict";
import { handleAuth } from "../src/auth.js";

const SESSION_SECRET = "integration-test-session-secret-at-least-32-bytes";
const GOOGLE_CLIENT_ID = "staging-client-id";
const GOOGLE_REDIRECT_URI = "https://api.example.test/auth/google/callback";

async function hashToken(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function makeDb({ nonce = "expected-nonce", profile = { id: "profile-1", role: "admin" }, sessionRow = null, rateLimitAllowed = true } = {}) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() {
          statements.push({ sql, values, operation: "first" });
          if (sql.includes("INSERT INTO auth_audit_log") && sql.includes("SELECT 'oauth_start'")) {
            return rateLimitAllowed ? { id: 1 } : null;
          }
          if (sql.startsWith("DELETE FROM auth_oauth_states")) return { nonce };
          if (sql.includes("SELECT id, role FROM profiles")) return profile;
          if (sql.includes("FROM auth_sessions s JOIN profiles")) return sessionRow;
          return null;
        },
        async run() {
          statements.push({ sql, values, operation: "run" });
          return { success: true };
        }
      };
    }
  };
}

function parseSetCookie(headers, name) {
  const values = headers.getSetCookie?.() || [];
  const value = values.find(item => item.startsWith(name + "="));
  assert.ok(value, "expected cookie " + name);
  return value.split(";")[0].slice(name.length + 1);
}

function authEnv(DB) {
  return {
    DB,
    APP_ENV: "preview",
    AUTH_ENABLED: "true",
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    GOOGLE_REDIRECT_URI,
    SESSION_SECRET,
    ADMIN_EMAILS: "admin@example.test",
    AUTH_SUCCESS_REDIRECT: "https://frontend.example/"
  };
}

function mockGoogle(t, { tokenStatus = 200, claims = {} } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      return new Response(JSON.stringify(claims), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(tokenStatus === 200 ? JSON.stringify({ id_token: "mock-id-token" }) : "denied", {
        status: tokenStatus,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error("Unexpected external request");
  };
  t.after(() => { globalThis.fetch = originalFetch; });
}

function validClaims(nonce, overrides = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: GOOGLE_CLIENT_ID,
    exp: String(Math.floor(Date.now() / 1000) + 300),
    sub: "google-subject-1",
    email: "admin@example.test",
    email_verified: "true",
    nonce,
    name: "Test Admin",
    picture: "https://example.test/avatar.png",
    ...overrides
  };
}

test("OAuth success creates server-derived Admin profile and secure session; CSRF remains stable across tabs", async t => {
  mockGoogle(t, { claims: validClaims("expected-nonce") });
  const DB = makeDb();
  const callbackUrl = "https://api.example.test/auth/google/callback?code=mock-code&state=known-state";
  const response = await handleAuth(
    new Request(callbackUrl, { headers: { Cookie: "__Host-kp_oauth_state=known-state" } }),
    authEnv(DB),
    new URL(callbackUrl)
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://frontend.example/");
  const sessionToken = parseSetCookie(response.headers, "__Host-kp_session");
  const csrfToken = parseSetCookie(response.headers, "__Host-kp_csrf");
  const sessionCookie = "__Host-kp_session=" + sessionToken;
  const csrfCookie = "__Host-kp_csrf=" + csrfToken;

  const profileInsert = DB.statements.find(item => item.sql.includes("INSERT INTO profiles"));
  assert.ok(profileInsert);
  assert.equal(profileInsert.values[5], "admin", "role must be derived from server ADMIN_EMAILS");
  assert.ok(DB.statements.some(item => item.sql.includes("INSERT INTO auth_sessions")));
  assert.ok(DB.statements.some(item => item.sql.includes("login_success")));

  const cookieHeaders = sessionCookie + "; " + csrfCookie;
  const sessionDb = makeDb({
    sessionRow: {
      profile_id: "profile-1",
      csrf_token_hash: await hashToken(csrfToken),
      expires_at: "2099-01-01 00:00:00",
      email: "admin@example.test",
      display_name: "Test Admin",
      picture_url: null,
      role: "admin"
    }
  });
  for (let tab = 0; tab < 2; tab += 1) {
    const sessionUrl = "https://api.example.test/api/auth/session";
    const sessionResponse = await handleAuth(
      new Request(sessionUrl, { headers: { Cookie: cookieHeaders } }),
      authEnv(sessionDb),
      new URL(sessionUrl)
    );
    assert.equal(sessionResponse.status, 200);
    const payload = await sessionResponse.json();
    assert.equal(payload.csrf_token, csrfToken, "each tab must receive the same session-bound CSRF token");
    assert.equal(payload.profile.role, "admin");
  }
  assert.equal(
    sessionDb.statements.some(item => item.sql.includes("csrf_token_hash =")),
    false,
    "GET /api/auth/session must not rotate the stored CSRF hash"
  );
});

test("OAuth failure at Google token exchange does not create a profile or session", async t => {
  mockGoogle(t, { tokenStatus: 400 });
  const DB = makeDb();
  const callbackUrl = "https://api.example.test/auth/google/callback?code=bad-code&state=known-state";
  const response = await handleAuth(
    new Request(callbackUrl, { headers: { Cookie: "__Host-kp_oauth_state=known-state" } }),
    authEnv(DB),
    new URL(callbackUrl)
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "OAUTH_CODE_EXCHANGE_FAILED");
  assert.equal(DB.statements.some(item => item.sql.includes("INSERT INTO profiles")), false);
  assert.equal(DB.statements.some(item => item.sql.includes("INSERT INTO auth_sessions")), false);
  assert.ok(DB.statements.some(item => item.sql.includes("login_failure")));
});

test("OAuth failure on nonce mismatch is rejected before profile or session creation", async t => {
  mockGoogle(t, { claims: validClaims("wrong-nonce") });
  const DB = makeDb();
  const callbackUrl = "https://api.example.test/auth/google/callback?code=mock-code&state=known-state";
  const response = await handleAuth(
    new Request(callbackUrl, { headers: { Cookie: "__Host-kp_oauth_state=known-state" } }),
    authEnv(DB),
    new URL(callbackUrl)
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "OAUTH_CALLBACK_FAILED");
  assert.equal(DB.statements.some(item => item.sql.includes("INSERT INTO profiles")), false);
  assert.equal(DB.statements.some(item => item.sql.includes("INSERT INTO auth_sessions")), false);
  assert.ok(DB.statements.some(item => item.sql.includes("login_failure")));
});

test("OAuth start rate limit rejects excess requests and does not create state", async () => {
  const DB = makeDb({ rateLimitAllowed: false });
  const startUrl = "https://api.example.test/auth/google/start";
  const response = await handleAuth(
    new Request(startUrl, { headers: { "CF-Connecting-IP": "203.0.113.10" } }),
    authEnv(DB),
    new URL(startUrl)
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(DB.statements.some(item => item.sql.includes("INSERT INTO auth_oauth_states")), false);
});

test("OAuth start removes expired state records before creating a new state", async () => {
  const DB = makeDb();
  const startUrl = "https://api.example.test/auth/google/start";
  const response = await handleAuth(
    new Request(startUrl, { headers: { "CF-Connecting-IP": "203.0.113.11" } }),
    authEnv(DB),
    new URL(startUrl)
  );
  assert.equal(response.status, 302);
  const cleanupIndex = DB.statements.findIndex(item => item.sql.includes("DELETE FROM auth_oauth_states WHERE expires_at <= CURRENT_TIMESTAMP"));
  const insertIndex = DB.statements.findIndex(item => item.sql.includes("INSERT INTO auth_oauth_states"));
  assert.ok(cleanupIndex >= 0);
  assert.ok(insertIndex > cleanupIndex, "expired states must be cleaned before inserting a new state");
});
