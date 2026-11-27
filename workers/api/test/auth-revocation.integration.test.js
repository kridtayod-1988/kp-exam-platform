import test from "node:test";
import assert from "node:assert/strict";
import { handleAuth } from "../src/auth.js";

const SESSION_SECRET = "phase-three-test-session-secret-at-least-32-bytes";
const SESSION_TOKEN = "opaque-existing-session-token";

async function hashToken(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function csrfForSession(sessionToken, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("kp-exam-csrf:v1:" + sessionToken)
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function makeStatefulDb(csrfHash) {
  let revoked = false;
  const statements = [];
  const sessionRow = {
    profile_id: "profile-1",
    csrf_token_hash: csrfHash,
    expires_at: "2099-01-01 00:00:00",
    email: "user@example.test",
    display_name: "Test User",
    picture_url: null,
    role: "user",
    is_active: 1
  };
  return {
    statements,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() {
          statements.push({ sql, values, operation: "first" });
          if (sql.includes("FROM auth_sessions s JOIN profiles")) {
            return revoked ? null : { ...sessionRow };
          }
          return null;
        },
        async run() {
          statements.push({ sql, values, operation: "run" });
          if (sql.includes("UPDATE auth_sessions SET revoked_at")) revoked = true;
          return { success: true };
        }
      };
    }
  };
}

test("the same old session token is rejected after successful logout", async () => {
  const csrfToken = await csrfForSession(SESSION_TOKEN, SESSION_SECRET);
  const DB = makeStatefulDb(await hashToken(csrfToken));
  const env = {
    DB,
    APP_ENV: "preview",
    AUTH_ENABLED: "true",
    SESSION_SECRET,
    CORS_ALLOWED_ORIGINS: "https://frontend.example"
  };
  const cookies = "__Host-kp_session=" + SESSION_TOKEN + "; __Host-kp_csrf=" + csrfToken;
  const logoutUrl = "https://api.example.test/api/auth/logout";
  const logout = await handleAuth(new Request(logoutUrl, {
    method: "POST",
    headers: {
      Origin: "https://frontend.example",
      Cookie: cookies,
      "X-CSRF-Token": csrfToken
    }
  }), env, new URL(logoutUrl));

  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });
  assert.ok(DB.statements.some(item => item.sql.includes("UPDATE auth_sessions SET revoked_at")));

  const sessionUrl = "https://api.example.test/api/auth/session";
  const replay = await handleAuth(new Request(sessionUrl, {
    headers: { Cookie: cookies }
  }), env, new URL(sessionUrl));

  assert.equal(replay.status, 401);
  assert.deepEqual(await replay.json(), { authenticated: false });
});
