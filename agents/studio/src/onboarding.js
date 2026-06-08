// C3: Onboarding state machine (2026-06-08).
//
// Tracks where the user is in their first-run experience.
// The bot uses this to:
//   1. Show a contextual welcome message on the first chat
//   2. Decide when to nudge for next steps
//   3. Skip the welcome in subsequent sessions
//
// The state machine is simple — it's a single record per user
// with a "step" field. The bot advances the step automatically
// as the user takes actions.
//
// We don't have a separate table for this — we derive state
// from the existing data (welcome row, projects, conversations)
// to keep the data model simple.
//
// Onboarding states:
//   "new"          — never opened the app (no welcome row)
//   "in_progress"  — opened the app but didn't complete the welcome
//   "active"       — has at least one project or 2+ conversations
//   "skipped"      — user explicitly chose to skip
//   "complete"     — finished the welcome interview

/**
 * Compute the user's onboarding state from existing data.
 * Pure function — no side effects. Easy to test.
 *
 * @param {object} opts
 * @param {object|null} opts.welcome - the welcome interview row, or null
 * @param {Array} opts.projects - user's projects
 * @param {Array} opts.conversations - user's conversations
 * @returns {{state: string, nextStep: string|null, suggestions: string[]}}
 */
export function computeOnboardingState({ welcome, projects = [], conversations = [] } = {}) {
  const projectCount = projects.length;
  const convCount = conversations.length;

  // User explicitly completed the welcome interview
  if (welcome?.completed) {
    if (projectCount === 0) {
      return {
        state: "complete",
        nextStep: "create_first_project",
        suggestions: [
          "Try: \"Create a project called 'My First Show'\"",
          "Or: \"I make videos about cooking, help me set up\"",
        ],
      };
    }
    return { state: "complete", nextStep: null, suggestions: [] };
  }

  // User explicitly skipped
  if (welcome?.skipped) {
    if (projectCount === 0 && convCount === 0) {
      return {
        state: "skipped",
        nextStep: "create_first_project",
        suggestions: [
          "When you're ready: \"Create a project\" or \"Help me brainstorm\"",
        ],
      };
    }
    return { state: "skipped", nextStep: null, suggestions: [] };
  }

  // No welcome row at all
  if (!welcome) {
    if (projectCount > 0 || convCount >= 2) {
      // User skipped welcome by using the product directly
      return { state: "active", nextStep: null, suggestions: [] };
    }
    return {
      state: "new",
      nextStep: "open_app",
      suggestions: [
        "Take 30 seconds to tell me your niche — I'll suggest a first project",
        "Or just start: \"I make videos about X\"",
      ],
    };
  }

  // Welcome started but not finished
  if (welcome?.started && !welcome?.completed && !welcome?.skipped) {
    return {
      state: "in_progress",
      nextStep: "finish_welcome",
      suggestions: [
        "Finish setting up your profile (2 more questions)",
        "Or skip and dive in: just start chatting",
      ],
    };
  }

  // Default: active
  return { state: "active", nextStep: null, suggestions: [] };
}

/**
 * Build the greeting message for the user's first chat turn
 * based on their onboarding state. Returns { reply, followUp }.
 *
 * The reply is what the bot shows. The followUp is a suggested
 * action the UI can render as a button.
 */
export function buildOnboardingGreeting({ state, detectedLanguage = "en" } = {}) {
  if (state === "new" || state === "in_progress") {
    if (detectedLanguage === "ru") {
      return {
        reply: "Привет! Я Vireo. Чтобы я мог помочь по-настоящему, расскажи в двух словах: что за ниша и какие платформы? Это займёт 30 секунд. Или сразу кидай задачу — разберёмся по ходу.",
        followUp: "open_welcome",
      };
    }
    return {
      reply: "Hey, I'm Vireo. Two quick questions so I can actually help: what's your niche, and which platforms are you publishing on? Takes 30 seconds. Or just throw a task at me — we'll figure it out as we go.",
      followUp: "open_welcome",
    };
  }
  if (state === "skipped") {
    if (detectedLanguage === "ru") {
      return {
        reply: "Привет! Я Vireo. Скажи что-нибудь — \"сделай мне рилс про X\" или \"покажи мои проекты\" — и поехали.",
        followUp: null,
      };
    }
    return {
      reply: "Hey, I'm Vireo. Throw me anything — 'make me a reel about X' or 'show my projects' — and we're off.",
      followUp: null,
    };
  }
  if (state === "complete" || state === "active") {
    // Returning user — short, warm
    if (detectedLanguage === "ru") {
      return {
        reply: "С возвращением. Что делаем?",
        followUp: null,
      };
    }
    return {
      reply: "Welcome back. What's up?",
      followUp: null,
    };
  }
  // Fallback
  return { reply: "Hey, I'm Vireo.", followUp: null };
}
