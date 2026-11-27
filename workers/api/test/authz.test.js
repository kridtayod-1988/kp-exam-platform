import test from "node:test";
import assert from "node:assert/strict";
import { requireAdmin } from "../src/authz.js";

function makeDb(sessionRow) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() {
          statements.push({ sql, values });
          if (sql.includes("FROM auth_sessions s JOIN profiles")) return sessionRow;
          return null;
        }
      };
    }
  };
}

const envFor = DB => ({ DB, APP_ENV: "preview", AUTH_ENABLED: "true" });
const request = headers => new Request("https://api.example.test/api/admin/example", { headers });

test("Admin guard returns 401 when no authenticated session exists", async () => {
  const result = await requireAdmin(request({}), envFor(makeDb(null)));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 401);
  assert.deepEqual(await result.response.json(), { error: "UNAUTHENTICATED" });
});

test("Admin guard returns 403 for a User even when client claims admin role", async () => {
  const DB = makeDb({
    profile_id: "user-profile",
    csrf_token_hash: "unused",
    expires_at: "2099-01-01 00:00:00",
    email: "user@example.test",
    display_name: "Test User",
    picture_url: null,
    role: "user",
    is_active: 1
  });
  const result = await requireAdmin(
    request({ Cookie: "__Host-kp_session=valid-session", "X-Role": "admin" }),
    envFor(DB)
  );
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 403);
  assert.deepEqual(await result.response.json(), { error: "FORBIDDEN" });
  assert.match(DB.statements[0].sql, /s\.revoked_at IS NULL/);
  assert.match(DB.statements[0].sql, /p\.is_active = 1/);
});

test("Admin guard allows an active Admin based on the database profile role", async () => {
  const result = await requireAdmin(
    request({ Cookie: "__Host-kp_session=valid-session", "X-Role": "user" }),
    envFor(makeDb({
      profile_id: "admin-profile",
      csrf_token_hash: "unused",
      expires_at: "2099-01-01 00:00:00",
      email: "admin@example.test",
      display_name: "Test Admin",
      picture_url: null,
      role: "admin",
      is_active: 1
    }))
  );
  assert.equal(result.ok, true);
  assert.equal(result.response, null);
  assert.equal(result.session.role, "admin");
});
