import test from "node:test";
import assert from "node:assert/strict";

const apiBase = process.env.API_PREVIEW_URL;
const frontendOrigin = process.env.FRONTEND_PREVIEW_ORIGIN;

async function fetchPreview(path, options = {}) {
  const url = apiBase.replace(/\/$/, "") + path;
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, options);
      if (response.status < 500 && response.status !== 404) return response;
      lastError = new Error(`Preview returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 3_000));
  }
  throw lastError || new Error("Preview did not become ready within 90 seconds");
}

test("preview D1/API and frontend CORS integration", { skip: !apiBase || !frontendOrigin }, async () => {
  const health = await fetchPreview("/api/health", {
    headers: { Origin: frontendOrigin }
  });
  assert.equal(health.status, 200, "API preview must be reachable from the frontend preview");
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.database, "connected");

  const years = await fetchPreview("/api/exam-years", {
    headers: { Origin: frontendOrigin, Accept: "application/json" }
  });
  assert.equal(years.status, 200);
  assert.equal(years.headers.get("access-control-allow-origin"), frontendOrigin);
  assert.equal(years.headers.get("access-control-allow-credentials"), "true");
  const yearsBody = await years.json();
  assert.ok(Array.isArray(yearsBody.data?.exam_years));

  const preflight = await fetchPreview("/api/exam-years", {
    method: "OPTIONS",
    headers: {
      Origin: frontendOrigin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "content-type,authorization"
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), frontendOrigin);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");

  const history = await fetchPreview("/api/attempts", {
    headers: { Origin: frontendOrigin, Accept: "application/json" }
  });
  assert.equal(history.status, 401, "attempt history must require an authenticated session");

  const autosave = await fetchPreview("/api/attempts/00000000-0000-4000-8000-000000000001/answers", {
    method: "PATCH",
    headers: {
      Origin: frontendOrigin,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ answers: [] })
  });
  assert.equal(autosave.status, 401, "answer autosave must require an authenticated session");

  const appAssetUrl = new URL("/js/app.js?staging-smoke=" + Date.now(), frontendOrigin);
  const appAsset = await fetch(appAssetUrl);
  assert.equal(appAsset.status, 200, "Staging frontend must serve the updated application bundle");
  const appSource = await appAsset.text();
  assert.match(appSource, /queueAutosave/, "Staging frontend must include answer autosave");
  assert.match(appSource, /resumeSavedAttempt/, "Staging frontend must include attempt resume");
  assert.match(appSource, /start-mock/, "Staging frontend must include the Mock Exam entry point");

  const adapterAsset = await fetch(new URL("/js/exam-engine.js?staging-smoke=" + Date.now(), frontendOrigin));
  assert.equal(adapterAsset.status, 200, "Staging frontend must serve the updated Exam Engine adapter");
  assert.match(await adapterAsset.text(), /saveAnswers/, "Staging adapter must call the autosave API");
});
