import test from "node:test";
import assert from "node:assert/strict";
import { handleAuth } from "../src/auth.js";

function dbStub() {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() { return null; },
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
