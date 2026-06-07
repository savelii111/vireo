// Vireo storage — feedback & welcome interview stores.
//
// Two tiny tables that back the P1 product features (thumbs up/down on
// assistant messages, and the one-time guided onboarding interview).
// Both are PG-backed when a pool is available, with in-memory shims
// in the same file for unit tests.

export class MessageFeedbackStore {
  constructor(pool) { this.pool = pool; }

  async add({ id, messageId, conversationId, userId, rating, comment, metadata = {} }) {
    const r = await this.pool.query(
      `INSERT INTO vireo_message_feedback
        (id, message_id, conversation_id, user_id, rating, comment, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING *`,
      [id, messageId, conversationId, userId, rating, comment || null, JSON.stringify(metadata || {})],
    );
    return r.rows[0];
  }

  async listForUser(userId, { limit = 100 } = {}) {
    const r = await this.pool.query(
      `SELECT * FROM vireo_message_feedback
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return r.rows.map(this._row);
  }

  async summaryForUser(userId) {
    const r = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total,
         SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)::int  AS upvotes,
         SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END)::int AS downvotes
       FROM vireo_message_feedback WHERE user_id = $1`,
      [userId],
    );
    return r.rows[0] || { total: 0, upvotes: 0, downvotes: 0 };
  }

  _row(row) {
    return {
      id: row.id,
      message_id: row.message_id,
      conversation_id: row.conversation_id,
      user_id: row.user_id,
      rating: row.rating,
      comment: row.comment,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      created_at: row.created_at,
    };
  }
}

export class WelcomeAnswersStore {
  constructor(pool) { this.pool = pool; }

  async upsert({ userId, niche, platforms, tone, goals, metadata = {} }) {
    const r = await this.pool.query(
      `INSERT INTO vireo_welcome_answers
        (user_id, niche, platforms, tone, goals, metadata, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE
         SET niche = EXCLUDED.niche,
             platforms = EXCLUDED.platforms,
             tone = EXCLUDED.tone,
             goals = EXCLUDED.goals,
             metadata = EXCLUDED.metadata,
             updated_at = now()
       RETURNING *`,
      [userId, niche || null, JSON.stringify(platforms || []), tone || null, goals || null, JSON.stringify(metadata || {})],
    );
    return r.rows[0];
  }

  async get(userId) {
    const r = await this.pool.query(
      `SELECT * FROM vireo_welcome_answers WHERE user_id = $1`,
      [userId],
    );
    return r.rows[0] || null;
  }

  _row(row) {
    return {
      user_id: row.user_id,
      niche: row.niche,
      platforms: typeof row.platforms === "string" ? JSON.parse(row.platforms) : row.platforms,
      tone: row.tone,
      goals: row.goals,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

// =============================================================================
// UserPreferencesStore (Wave 1: "memory per user")
// =============================================================================
//
// Long-term preferences that follow the user across sessions and are
// injected into the chat LLM's system prompt on every /api/chat call.
// Different from WelcomeAnswersStore in two important ways:
//
//   1. SCHEMA. Welcome captures the one-shot interview (niche, platforms,
//      tone, goals). Prefs grows with the user — voice_keywords get added
//      as Style DNA is analyzed, default_target_sec and aspect_ratio are
//      inferred from what the user actually publishes, audience gets
//      refined after they paste their bio. We keep them separate so the
//      one-shot write to welcome doesn't accidentally clobber a refined
//      pref field, and vice versa.
//
//   2. READ PATH. Welcome is read once on chat open (to decide whether to
//      show the welcome card). Prefs is read on EVERY /api/chat call, so
//      its row shape and indexes are tuned for fast PK lookup.
//
// SHAPE: same as WelcomeAnswersStore + a few extras. The chat handler
// exposes the full row to the LLM; the UI hides internal fields.

export class UserPreferencesStore {
  constructor(pool) { this.pool = pool; }

  // Upsert (insert or update) the user's full preferences row.
  //
  // Semantics: pass only the fields you want to set. NULL/undefined
  // fields are stored as NULL, but on update they KEEP the previous
  // value (we use a COALESCE pattern). This way the UI can PATCH
  // `voice_keywords` without erasing `niche`.
  //
  // Pass `merge: true` to enable COALESCE behaviour on update (default).
  // Pass `merge: false` to overwrite nulls with explicit NULLs.
  async upsert({
    userId,
    niche,
    platforms,
    tone,
    goals,
    audience,
    voiceKeywords,
    defaultTargetSec,
    defaultAspectRatio,
    metadata,
    merge = true,
  }) {
    if (merge) {
      // COALESCE(NULL, EXCLUDED.col) keeps the old value when the new
      // value is NULL. We do this for nullable text fields only;
      // voice_keywords / platforms / metadata always get replaced
      // because callers either pass a concrete array/object or omit.
      const r = await this.pool.query(
        `INSERT INTO vireo_user_prefs
          (user_id, niche, platforms, tone, goals, audience,
           voice_keywords, default_target_sec, default_aspect_ratio, metadata,
           created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6,
                 $7::jsonb, $8, $9, $10::jsonb,
                 now(), now())
         ON CONFLICT (user_id) DO UPDATE SET
           niche              = COALESCE(EXCLUDED.niche,              vireo_user_prefs.niche),
           platforms          = CASE WHEN EXCLUDED.platforms = '[]'::jsonb
                                     THEN vireo_user_prefs.platforms
                                     ELSE EXCLUDED.platforms END,
           tone               = COALESCE(EXCLUDED.tone,               vireo_user_prefs.tone),
           goals              = COALESCE(EXCLUDED.goals,              vireo_user_prefs.goals),
           audience           = COALESCE(EXCLUDED.audience,           vireo_user_prefs.audience),
           voice_keywords     = CASE WHEN EXCLUDED.voice_keywords = '[]'::jsonb
                                     THEN vireo_user_prefs.voice_keywords
                                     ELSE EXCLUDED.voice_keywords END,
           default_target_sec = COALESCE(EXCLUDED.default_target_sec, vireo_user_prefs.default_target_sec),
           default_aspect_ratio = COALESCE(EXCLUDED.default_aspect_ratio, vireo_user_prefs.default_aspect_ratio),
           metadata           = CASE WHEN EXCLUDED.metadata = '{}'::jsonb
                                     THEN vireo_user_prefs.metadata
                                     ELSE EXCLUDED.metadata END,
           updated_at         = now()
         RETURNING *`,
        [
          userId,
          niche ?? null,
          JSON.stringify(Array.isArray(platforms) ? platforms : []),
          tone ?? null,
          goals ?? null,
          audience ?? null,
          JSON.stringify(Array.isArray(voiceKeywords) ? voiceKeywords : []),
          Number.isFinite(defaultTargetSec) ? defaultTargetSec : 30,
          defaultAspectRatio ?? "9:16",
          JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
        ],
      );
      return this._row(r.rows[0]);
    }
    // Non-merge: explicit NULLs wipe the field.
    const r = await this.pool.query(
      `INSERT INTO vireo_user_prefs
        (user_id, niche, platforms, tone, goals, audience,
         voice_keywords, default_target_sec, default_aspect_ratio, metadata,
         created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6,
               $7::jsonb, $8, $9, $10::jsonb,
               now(), now())
       ON CONFLICT (user_id) DO UPDATE SET
         niche = EXCLUDED.niche,
         platforms = EXCLUDED.platforms,
         tone = EXCLUDED.tone,
         goals = EXCLUDED.goals,
         audience = EXCLUDED.audience,
         voice_keywords = EXCLUDED.voice_keywords,
         default_target_sec = EXCLUDED.default_target_sec,
         default_aspect_ratio = EXCLUDED.default_aspect_ratio,
         metadata = EXCLUDED.metadata,
         updated_at = now()
       RETURNING *`,
      [
        userId,
        niche ?? null,
        JSON.stringify(Array.isArray(platforms) ? platforms : []),
        tone ?? null,
        goals ?? null,
        audience ?? null,
        JSON.stringify(Array.isArray(voiceKeywords) ? voiceKeywords : []),
        Number.isFinite(defaultTargetSec) ? defaultTargetSec : 30,
        defaultAspectRatio ?? "9:16",
        JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
      ],
    );
    return this._row(r.rows[0]);
  }

  async get(userId) {
    const r = await this.pool.query(
      `SELECT * FROM vireo_user_prefs WHERE user_id = $1`,
      [userId],
    );
    return r.rows[0] ? this._row(r.rows[0]) : null;
  }

  // Partial update via JSON patch (for "the user added one keyword"
  // style flows). Returns the merged row.
  async appendVoiceKeyword(userId, keyword) {
    if (!keyword || typeof keyword !== "string") return this.get(userId);
    const k = keyword.toLowerCase().trim().slice(0, 64);
    if (!k) return this.get(userId);
    const r = await this.pool.query(
      `UPDATE vireo_user_prefs
         SET voice_keywords = (
           SELECT jsonb_agg(DISTINCT v)
           FROM jsonb_array_elements_text(COALESCE(voice_keywords, '[]'::jsonb)) AS v
           WHERE v <> ''
           UNION
           SELECT $2::text
         ),
         updated_at = now()
       WHERE user_id = $1
       RETURNING *`,
      [userId, k],
    );
    return r.rows[0] ? this._row(r.rows[0]) : null;
  }

  _row(row) {
    return {
      user_id: row.user_id,
      niche: row.niche,
      platforms: typeof row.platforms === "string" ? JSON.parse(row.platforms) : row.platforms,
      tone: row.tone,
      goals: row.goals,
      audience: row.audience,
      voice_keywords: typeof row.voice_keywords === "string" ? JSON.parse(row.voice_keywords) : row.voice_keywords,
      default_target_sec: row.default_target_sec,
      default_aspect_ratio: row.default_aspect_ratio,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
