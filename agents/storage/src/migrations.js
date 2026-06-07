// Vireo SQL migrations. Each migration is applied idempotently.
// All migrations are kept in one file for simplicity; in production, switch to
// a tool like Knex or Drizzle for proper versioning + rollback support.

export const MIGRATIONS = [
  {
    name: "001_initial",
    sql: `
      -- Jobs (publish queue) ---
      CREATE TABLE IF NOT EXISTS vireo_jobs (
        id text PRIMARY KEY,
        content_id text,
        platform text NOT NULL,
        scheduled_at timestamptz NOT NULL,
        published_at timestamptz,
        status text NOT NULL DEFAULT 'pending',
        platform_post_id text,
        error text,
        metadata jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_jobs_status_idx ON vireo_jobs(status);
      CREATE INDEX IF NOT EXISTS vireo_jobs_scheduled_idx ON vireo_jobs(scheduled_at);
      CREATE INDEX IF NOT EXISTS vireo_jobs_content_idx ON vireo_jobs(content_id);
      CREATE INDEX IF NOT EXISTS vireo_jobs_platform_idx ON vireo_jobs(platform);

      -- EU AI Act audit log ---
      CREATE TABLE IF NOT EXISTS vireo_audit (
        id text PRIMARY KEY,
        job_id text,
        content_id text,
        platform text NOT NULL,
        platform_post_id text,
        published_at timestamptz,
        ai_generated boolean DEFAULT true,
        eu_ai_act_logged boolean DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_audit_content_idx ON vireo_audit(content_id);

      -- Engagement metrics ---
      CREATE TABLE IF NOT EXISTS vireo_metrics (
        id text PRIMARY KEY,
        content_id text NOT NULL,
        platform text NOT NULL,
        views int DEFAULT 0,
        likes int DEFAULT 0,
        comments int DEFAULT 0,
        shares int DEFAULT 0,
        saves int DEFAULT 0,
        watch_time_sec int DEFAULT 0,
        engagement_rate numeric DEFAULT 0,
        captured_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_metrics_content_idx ON vireo_metrics(content_id);
      CREATE INDEX IF NOT EXISTS vireo_metrics_platform_idx ON vireo_metrics(platform);
    `,
  },
  {
    name: "002_auth",
    sql: `
      -- Users (auth) ---
      CREATE TABLE IF NOT EXISTS vireo_users (
        id text PRIMARY KEY,
        email text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        name text,
        plan text DEFAULT 'free',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_users_email_idx ON vireo_users(email);
    `,
  },
  {
    name: "003_billing",
    sql: `
      -- Subscriptions ---
      CREATE TABLE IF NOT EXISTS vireo_subscriptions (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        plan text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        cancel_at_period_end boolean DEFAULT false,
        stripe_subscription_id text,
        stripe_customer_id text,
        current_period_end timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_subs_user_idx ON vireo_subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS vireo_subs_status_idx ON vireo_subscriptions(status);

      -- Usage ---
      CREATE TABLE IF NOT EXISTS vireo_usage (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        counter text NOT NULL,
        year_month text NOT NULL,
        value int DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, counter, year_month)
      );
      CREATE INDEX IF NOT EXISTS vireo_usage_user_idx ON vireo_usage(user_id);

      -- Invoices ---
      CREATE TABLE IF NOT EXISTS vireo_invoices (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        amount_cents int DEFAULT 0,
        currency text DEFAULT 'EUR',
        status text DEFAULT 'pending',
        plan text,
        paid_at timestamptz,
        stripe_invoice_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_inv_user_idx ON vireo_invoices(user_id);
    `,
  },
  {
    name: "004_oauth",
    sql: `
      -- Connected platform accounts (OAuth tokens) ---
      CREATE TABLE IF NOT EXISTS vireo_oauth_tokens (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        platform text NOT NULL,
        access_token text NOT NULL,
        refresh_token text,
        expires_at timestamptz,
        scope text,
        profile jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, platform)
      );
      CREATE INDEX IF NOT EXISTS vireo_oauth_user_idx ON vireo_oauth_tokens(user_id);

      -- CSRF state store for OAuth flows ---
      CREATE TABLE IF NOT EXISTS vireo_oauth_states (
        state text PRIMARY KEY,
        user_id text NOT NULL,
        platform text NOT NULL,
        code_verifier text,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_oauth_states_expires_idx ON vireo_oauth_states(expires_at);
    `,
  },
  {
    name: "005_style_dna",
    sql: `
      -- StyleDNA persistence (per creator) ---
      CREATE TABLE IF NOT EXISTS vireo_style_dna (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        name text,
        tone text,
        pacing text,
        vocabulary jsonb DEFAULT '[]'::jsonb,
        humor text,
        hooks jsonb DEFAULT '[]'::jsonb,
        ctas jsonb DEFAULT '[]'::jsonb,
        topics jsonb DEFAULT '[]'::jsonb,
        confidence numeric DEFAULT 0,
        source_corpus_size int DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, name)
      );
      CREATE INDEX IF NOT EXISTS vireo_style_dna_user_idx ON vireo_style_dna(user_id);
    `,
  },
  {
    name: "006_projects",
    sql: `
      -- Projects (user's content projects) ---
      CREATE TABLE IF NOT EXISTS vireo_projects (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        name text NOT NULL,
        niche text,
        description text,
        target_platforms jsonb DEFAULT '["youtube"]'::jsonb,
        style_dna_id text,
        status text DEFAULT 'active',
        metadata jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_projects_user_idx ON vireo_projects(user_id);
      CREATE INDEX IF NOT EXISTS vireo_projects_status_idx ON vireo_projects(status);

      -- Content pieces (script drafts, transcripts, generated text) ---
      CREATE TABLE IF NOT EXISTS vireo_content_pieces (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        project_id text,
        source text NOT NULL DEFAULT 'manual',
        source_id text,
        kind text NOT NULL DEFAULT 'script',
        language text DEFAULT 'en',
        text text NOT NULL,
        metadata jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_content_pieces_user_idx ON vireo_content_pieces(user_id);
      CREATE INDEX IF NOT EXISTS vireo_content_pieces_project_idx ON vireo_content_pieces(project_id);
      CREATE INDEX IF NOT EXISTS vireo_content_pieces_source_idx ON vireo_content_pieces(source, source_id);
    `,
  },
  {
    name: "007_chat",
    sql: `
      -- Conversations (chat sessions with AI agent) ---
      CREATE TABLE IF NOT EXISTS vireo_conversations (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        project_id text,
        title text,
        system_prompt text,
        metadata jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_conversations_user_idx ON vireo_conversations(user_id);
      CREATE INDEX IF NOT EXISTS vireo_conversations_project_idx ON vireo_conversations(project_id);

      -- Messages (chat history) ---
      CREATE TABLE IF NOT EXISTS vireo_messages (
        id text PRIMARY KEY,
        conversation_id text NOT NULL,
        user_id text NOT NULL,
        role text NOT NULL,
        content text NOT NULL,
        tool_calls jsonb,
        tool_results jsonb,
        tokens_used int DEFAULT 0,
        cost_usd numeric DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_messages_conversation_idx ON vireo_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS vireo_messages_user_idx ON vireo_messages(user_id);
      CREATE INDEX IF NOT EXISTS vireo_messages_created_idx ON vireo_messages(created_at);
    `,
  },
  {
    name: "008_message_seq",
    sql: `
      -- Monotonic per-message sequence number --------------------------------
      -- Why: created_at has 1ms granularity, so the user message and the
      -- assistant reply in a single LLM turn share a timestamp. Real
      -- Postgres' ORDER BY created_at is non-deterministic for ties (it
      -- falls back to ctid / physical order, which can change after
      -- VACUUM). That makes the "rewind to message X" flow unreliable:
      -- findIndex on a list tied by created_at may land on the wrong row.
      --
      -- A sequence-backed BIGINT seq is strictly monotonic across the whole
      -- table, so listForConversation ORDER BY seq ASC and
      -- deleteAfter WHERE seq > anchor.seq are both deterministic. Existing
      -- rows are backfilled from ROW_NUMBER() ordered by created_at, id
      -- (which is the same order the in-memory store already uses).
      CREATE SEQUENCE IF NOT EXISTS vireo_messages_seq_seq;
      ALTER TABLE vireo_messages ADD COLUMN IF NOT EXISTS seq BIGINT;
      -- Backfill (idempotent — only fills NULLs, so re-running the migration
      -- is a no-op).
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
        FROM vireo_messages
        WHERE seq IS NULL
      )
      UPDATE vireo_messages m
      SET seq = numbered.rn
      FROM numbered
      WHERE m.id = numbered.id;
      -- After backfill, any remaining NULLs would break the NOT NULL
      -- constraint, so fall back to the sequence for stragglers (shouldn't
      -- happen in practice, but keeps the migration from failing on weird
      -- states).
      UPDATE vireo_messages
      SET seq = nextval('vireo_messages_seq_seq')
      WHERE seq IS NULL;
      ALTER TABLE vireo_messages ALTER COLUMN seq SET DEFAULT nextval('vireo_messages_seq_seq');
      ALTER TABLE vireo_messages ALTER COLUMN seq SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS vireo_messages_seq_idx ON vireo_messages(seq);
    `,
  },
  {
    name: "009_user_prefs",
    sql: `
      -- Long-term user preferences (Wave 1: "memory per user").
      --
      -- One row per user. Stores everything the chat LLM needs to stop
      -- asking the same onboarding questions every session: niche,
      -- primary platforms, tone, voice keywords, default output
      -- duration + aspect ratio, audience description, short-term goals.
      --
      -- Why a new table instead of expanding vireo_welcome_answers:
      --   - welcome_answers is a one-shot interview snapshot (niche,
      --     platforms, tone, goals only). Prefs grows organically as the
      --     user refines defaults (target_sec, aspect_ratio, voice
      --     keywords) and the welcome flow stays untouched.
      --   - vireo_welcome_answers has a UNIQUE(user_id) constraint; if
      --     we ever want to backfill prefs from welcome, we keep them
      --     separate so neither write is blocked.
      --   - The chat handler reads this row on every /api/chat call and
      --     injects it into the system prompt, so it must be cheap to
      --     fetch (one indexed PK lookup).
      CREATE TABLE IF NOT EXISTS vireo_user_prefs (
        user_id text PRIMARY KEY,
        niche text,
        platforms jsonb DEFAULT '[]'::jsonb,
        tone text,
        goals text,
        audience text,
        voice_keywords jsonb DEFAULT '[]'::jsonb,
        default_target_sec int DEFAULT 30,
        default_aspect_ratio text DEFAULT '9:16',
        metadata jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_user_prefs_updated_idx ON vireo_user_prefs(updated_at);
    `,
  },
  {
    // Renamed from "002_feedback" → "010_feedback" to avoid colliding with
    // 002_auth. applyMigrations() skips by exact name, so a duplicate "002_*"
    // would have caused one of the two to be silently skipped on first apply.
    name: "010_feedback",
    sql: `
      -- Per-message feedback (thumbs up/down + free-text comment) ----------
      -- Powers the future "auto-tune prompts from feedback" pipeline. For
      -- now it gives product a real signal to look at weekly.
      CREATE TABLE IF NOT EXISTS vireo_message_feedback (
        id text PRIMARY KEY,
        message_id text NOT NULL,
        conversation_id text NOT NULL,
        user_id text NOT NULL,
        rating smallint NOT NULL,           -- 1 = thumbs up, -1 = thumbs down
        comment text,
        metadata jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS vireo_feedback_message_idx ON vireo_message_feedback(message_id);
      CREATE INDEX IF NOT EXISTS vireo_feedback_user_idx ON vireo_message_feedback(user_id);
      CREATE INDEX IF NOT EXISTS vireo_feedback_created_idx ON vireo_message_feedback(created_at);

      -- Welcome interview snapshot ------------------------------------------
      -- One row per user. Captures niche + platforms + style preferences so
      -- we can suggest the right agent on the next visit without re-asking.
      CREATE TABLE IF NOT EXISTS vireo_welcome_answers (
        user_id text PRIMARY KEY,
        niche text,
        platforms jsonb DEFAULT '[]'::jsonb,
        tone text,
        goals text,
        metadata jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
];

export async function applyMigrations(pool) {
  // Create migrations table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vireo_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  for (const m of MIGRATIONS) {
    const r = await pool.query("SELECT 1 FROM vireo_migrations WHERE name = $1", [m.name]);
    if (r.rows.length > 0) continue;
    await pool.query(m.sql);
    await pool.query("INSERT INTO vireo_migrations (name) VALUES ($1)", [m.name]);
  }
}

/**
 * Read the set of already-applied migration names, ordered by apply time.
 * Returns [] if the migrations table doesn't exist yet (caller can interpret
 * this as "no migrations applied" rather than an error).
 */
export async function listAppliedMigrations(pool) {
  const r = await pool.query(
    "SELECT name, applied_at FROM vireo_migrations ORDER BY applied_at ASC"
  ).catch(() => ({ rows: [] }));
  return r.rows;
}
