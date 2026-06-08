// C3: Onboarding state machine tests (2026-06-08).
//
// Pure-function tests for computeOnboardingState and
// buildOnboardingGreeting. These functions derive the user's
// onboarding state from existing data, so we test the
// decision matrix directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOnboardingState, buildOnboardingGreeting } from "../src/onboarding.js";

test("C3: 'new' state for user with no welcome row and no projects", () => {
  const r = computeOnboardingState({ welcome: null, projects: [], conversations: [] });
  assert.equal(r.state, "new");
  assert.equal(r.nextStep, "open_app");
  assert.ok(r.suggestions.length >= 1);
});

test("C3: 'active' state when user has projects but no welcome", () => {
  const r = computeOnboardingState({
    welcome: null,
    projects: [{ id: "p1" }],
    conversations: [],
  });
  assert.equal(r.state, "active");
  assert.equal(r.nextStep, null);
});

test("C3: 'complete' state when welcome is finished and has projects", () => {
  const r = computeOnboardingState({
    welcome: { completed: true },
    projects: [{ id: "p1" }, { id: "p2" }],
    conversations: [{ id: "c1" }],
  });
  assert.equal(r.state, "complete");
  assert.equal(r.nextStep, null);
});

test("C3: 'complete' state suggests creating first project when done but 0 projects", () => {
  const r = computeOnboardingState({
    welcome: { completed: true },
    projects: [],
    conversations: [],
  });
  assert.equal(r.state, "complete");
  assert.equal(r.nextStep, "create_first_project");
  assert.ok(r.suggestions.length >= 1);
});

test("C3: 'in_progress' state when welcome started but not finished", () => {
  const r = computeOnboardingState({
    welcome: { started: true, completed: false },
    projects: [],
    conversations: [],
  });
  assert.equal(r.state, "in_progress");
  assert.equal(r.nextStep, "finish_welcome");
});

test("C3: 'skipped' state preserves user choice", () => {
  const r = computeOnboardingState({
    welcome: { skipped: true },
    projects: [],
    conversations: [],
  });
  assert.equal(r.state, "skipped");
  assert.equal(r.nextStep, "create_first_project");
});

test("C3: skipped + has projects = no nudge", () => {
  const r = computeOnboardingState({
    welcome: { skipped: true },
    projects: [{ id: "p1" }],
    conversations: [{ id: "c1" }],
  });
  assert.equal(r.state, "skipped");
  assert.equal(r.nextStep, null);
});

test("C3: 2+ conversations without welcome row = 'active' (user skipped by using)", () => {
  const r = computeOnboardingState({
    welcome: null,
    projects: [],
    conversations: [{ id: "c1" }, { id: "c2" }],
  });
  assert.equal(r.state, "active");
});

test("C3: buildOnboardingGreeting returns greeting for 'new' state in English", () => {
  const g = buildOnboardingGreeting({ state: "new", detectedLanguage: "en" });
  assert.ok(g.reply.length > 20);
  assert.equal(g.followUp, "open_welcome");
});

test("C3: buildOnboardingGreeting returns Russian greeting when language is 'ru'", () => {
  const g = buildOnboardingGreeting({ state: "new", detectedLanguage: "ru" });
  assert.ok(g.reply.length > 20);
  // Russian reply should contain a Cyrillic character
  assert.ok(/[а-яё]/i.test(g.reply), "Russian greeting should contain Cyrillic");
  assert.equal(g.followUp, "open_welcome");
});

test("C3: returning user gets short, warm greeting", () => {
  const g = buildOnboardingGreeting({ state: "complete", detectedLanguage: "en" });
  // Returning user should NOT get a long onboarding prompt
  assert.ok(g.reply.length < 50, `expected short reply, got: ${g.reply}`);
});

test("C3: returning user in Russian gets a Russian short greeting", () => {
  const g = buildOnboardingGreeting({ state: "active", detectedLanguage: "ru" });
  assert.ok(/[а-яё]/i.test(g.reply), "Russian greeting should contain Cyrillic");
  assert.ok(g.reply.length < 50, "should be short");
});

test("C3: skipped user gets a 'dive in' greeting", () => {
  const g = buildOnboardingGreeting({ state: "skipped", detectedLanguage: "en" });
  assert.ok(g.reply.length > 5);
  assert.equal(g.followUp, null);
});

test("C3: buildOnboardingGreeting handles unknown state gracefully", () => {
  const g = buildOnboardingGreeting({ state: "weird_state" });
  assert.ok(g.reply);
});
