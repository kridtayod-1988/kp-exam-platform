import test from "node:test";
import assert from "node:assert/strict";

const apiBase = process.env.API_PREVIEW_URL;

test("Staging Google OAuth start uses the configured callback and binds state cookie", {
  skip: !apiBase
}, async () => {
  const response = await fetch(apiBase.replace(/\/$/, "") + "/auth/google/start", {
    redirect: "manual",
    signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 302);
  const authorizationUrl = new URL(response.headers.get("location"));
  assert.equal(authorizationUrl.hostname, "accounts.google.com");
  assert.ok(authorizationUrl.searchParams.get("client_id"));
  assert.equal(
    authorizationUrl.searchParams.get("redirect_uri"),
    apiBase.replace(/\/$/, "") + "/auth/google/callback"
  );
  const stateCookie = (response.headers.get("set-cookie") || "")
    .match(/__Host-kp_oauth_state=([^;]+)/);
  assert.ok(stateCookie, "OAuth state cookie must be set");
  assert.equal(stateCookie[1], authorizationUrl.searchParams.get("state"));
});


const frontendOrigin = process.env.FRONTEND_PREVIEW_ORIGIN;

test("Staging frontend serves initialized and serialized autosave state", {
  skip: !frontendOrigin
}, async () => {
  const response = await fetch(new URL("/js/app.js?state-smoke=" + Date.now(), frontendOrigin), {
    signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200);
  const source = await response.text();
  assert.match(source, /let activeAttempt=null;/);
  assert.match(source, /let autosaveInFlight=false;/);
  assert.match(source, /if\\(autosaveInFlight\\)\\{autosaveQueued=true;return;\\}/);
  assert.match(source, /สามารถกลับมาทำต่อจากประวัติการสอบได้/);
});
