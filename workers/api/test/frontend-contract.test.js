import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../../../js/app.js", import.meta.url), "utf8");
const adapter = await readFile(new URL("../../../js/exam-engine.js", import.meta.url), "utf8");

test("exam UI initializes all attempt and autosave state", () => {
  for (const declaration of [
    "let activeAttempt=null;",
    "let attemptAnswers={};",
    "let currentQuestionIndex=0;",
    "let submitting=false;",
    "let autosaveInFlight=false;",
    "let autosaveQueued=false;"
  ]) assert.ok(app.includes(declaration), "missing state declaration: " + declaration);
});

test("exam UI serializes autosave and supports resuming saved attempts", () => {
  assert.match(app, /if\(autosaveInFlight\)\{autosaveQueued=true;return;\}/);
  assert.match(app, /async function resumeSavedAttempt\(/);
  assert.match(app, /data-resume-attempt/);
  assert.match(app, /startCountdown\(\)/);
});

test("Exam Engine adapter exposes autosave, resume, submit, and history", () => {
  assert.match(adapter, /async function saveAnswers\(/);
  assert.match(adapter, /async function resumeAttempt\(/);
  assert.match(adapter, /async function submitAttempt\(/);
  assert.match(adapter, /async function getHistory\(/);
});
