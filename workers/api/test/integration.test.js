import test from "node:test";
import assert from "node:assert/strict";

const apiBase = process.env.API_PREVIEW_URL;
const frontendOrigin = process.env.FRONTEND_PREVIEW_ORIGIN;

test("preview D1/API and frontend CORS integration", { skip: !apiBase || !frontendOrigin }, async () => {
  const base = apiBase.replace(/\/$/, "");
  const health = await fetch(base + "/api/health", {
    headers: { Origin: frontendOrigin }
  });
  assert.equal(health.status, 200, "API preview must be reachable from the frontend preview");
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.database, "connected");

  const years = await fetch(base + "/api/exam-years", {
    headers: { Origin: frontendOrigin, Accept: "application/json" }
  });
  assert.equal(years.status, 200);
  assert.equal(years.headers.get("access-control-allow-origin"), frontendOrigin);
  assert.equal(years.headers.get("access-control-allow-credentials"), "true");
  const yearsBody = await years.json();
  assert.ok(Array.isArray(yearsBody.data?.exam_years));

  const preflight = await fetch(base + "/api/exam-years", {
    method: "OPTIONS",
    headers: {
      Origin: frontendOrigin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "content-type,authorization"
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), frontendOrigin);
});
