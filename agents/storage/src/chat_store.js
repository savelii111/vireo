// Postgres-backed stores for projects, content_pieces, conversations, messages.
// All stores require a `pool` that has a .query(sql, params) method.

import { randomUUID } from "node:crypto";
import {
  createEmptyTimelineDocument,
  deserializeTimelineDocument,
  validateTimelineDocument,
} from "@vireo/shared";

// ---- Projects ----

export class ProjectStore {
  constructor(pool) { this.pool = pool; }

  async create({ userId, name, niche = null, description = null, targetPlatforms = ["youtube"], styleDnaId = null, metadata = {} }) {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO vireo_projects (id, user_id, name, niche, description, target_platforms, style_dna_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, userId, name, niche, description, JSON.stringify(targetPlatforms), styleDnaId, JSON.stringify(metadata)],
    );
    return await this.get(id);
  }

  async get(id) {
    const r = await this.pool.query("SELECT * FROM vireo_projects WHERE id = $1", [id]);
    if (r.rows.length === 0) return null;
    return this._row(r.rows[0]);
  }

  async listForUser(userId, { limit = 50, status = null } = {}) {
    const params = [userId];
    let where = "user_id = $1";
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    params.push(limit);
    const r = await this.pool.query(
      `SELECT * FROM vireo_projects WHERE ${where} ORDER BY updated_at DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows.map(row => this._row(row));
  }

  async update(id, { userId, ...fields }) {
    const sets = [];
    const params = [id];
    if (userId) { params.push(userId); sets.push(`user_id = $${params.length}`); }
    const fieldMap = {
      name: "name", niche: "niche", description: "description",
      targetPlatforms: "target_platforms", styleDnaId: "style_dna_id",
      status: "status", metadata: "metadata",
    };
    for (const [k, v] of Object.entries(fields)) {
      if (fieldMap[k] === undefined) continue;
      params.push(k === "targetPlatforms" || k === "metadata" ? JSON.stringify(v) : v);
      sets.push(`${fieldMap[k]} = $${params.length}`);
    }
    if (sets.length === 0) return await this.get(id);
    sets.push("updated_at = now()");
    params.push(userId);
    await this.pool.query(
      `UPDATE vireo_projects SET ${sets.join(", ")} WHERE id = $1 AND user_id = $${params.length}`,
      params,
    );
    return await this.get(id);
  }

  async delete(id, userId) {
    const r = await this.pool.query(
      "DELETE FROM vireo_projects WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return r.rowCount > 0;
  }

  _row(row) {
    return {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      niche: row.niche,
      description: row.description,
      target_platforms: typeof row.target_platforms === "string" ? JSON.parse(row.target_platforms) : row.target_platforms,
      style_dna_id: row.style_dna_id,
      status: row.status,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

// ---- Studio assets and timelines ----

export class StudioAssetStore {
  constructor(pool) { this.pool = pool; }

  async create({
    userId,
    projectId = null,
    kind = "video",
    source = "upload",
    filename = null,
    mime = null,
    storagePath = null,
    durationSec = null,
    width = null,
    height = null,
    sizeBytes = null,
    status = "ready",
    metadata = {},
  }) {
    const id = `ast_${randomUUID()}`;
    await this.pool.query(
      `INSERT INTO vireo_assets (
         id, user_id, project_id, kind, source, filename, mime, storage_path,
         duration_sec, width, height, size_bytes, status, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        userId,
        projectId,
        kind,
        source,
        filename,
        mime,
        storagePath,
        durationSec,
        width,
        height,
        sizeBytes,
        status,
        JSON.stringify(metadata || {}),
      ],
    );
    return await this.get(id);
  }

  async get(id) {
    const r = await this.pool.query("SELECT * FROM vireo_assets WHERE id = $1", [id]);
    return r.rows.length > 0 ? this._row(r.rows[0]) : null;
  }

  async listForUser(userId, { projectId = null, limit = 100 } = {}) {
    const params = [userId];
    let where = "user_id = $1";
    if (projectId) {
      params.push(projectId);
      where += ` AND project_id = $${params.length}`;
    }
    params.push(limit);
    const r = await this.pool.query(
      `SELECT * FROM vireo_assets WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows.map((row) => this._row(row));
  }

  async delete(id, userId) {
    const r = await this.pool.query(
      "DELETE FROM vireo_assets WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return r.rowCount > 0;
  }

  _row(row) {
    return {
      id: row.id,
      user_id: row.user_id,
      project_id: row.project_id,
      kind: row.kind,
      source: row.source,
      filename: row.filename,
      mime: row.mime,
      storage_path: row.storage_path,
      duration_sec: row.duration_sec,
      width: row.width,
      height: row.height,
      size_bytes: row.size_bytes,
      status: row.status,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

export class StudioTimelineStore {
  constructor(pool) { this.pool = pool; }

  async get(projectId) {
    const r = await this.pool.query("SELECT * FROM vireo_timelines WHERE project_id = $1", [projectId]);
    return r.rows.length > 0 ? this._row(r.rows[0]) : null;
  }

  async getOrCreate(projectId, userId) {
    const existing = await this.get(projectId);
    if (existing) return existing;

    const id = `tl_${randomUUID()}`;
    const doc = createEmptyTimelineDocument({ projectId, userId, timelineId: id });
    await this.pool.query(
      `INSERT INTO vireo_timelines (id, project_id, user_id, doc, version)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, projectId, userId, JSON.stringify(doc), 1],
    );
    return this._row({ id, project_id: projectId, user_id: userId, doc: JSON.stringify(doc), version: 1 });
  }

  async save(projectId, userId, { doc, version }) {
    const expectedVersion = Number(version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw Object.assign(new Error("version must be a positive integer"), { code: "validation", httpStatus: 400 });
    }
    validateTimelineDocument(doc);
    doc = { ...doc, projectId, userId, version: expectedVersion };
    const r = await this.pool.query(
      `UPDATE vireo_timelines
       SET doc = $2, version = version + 1, updated_at = now()
       WHERE project_id = $1 AND user_id = $3 AND version = $4
       RETURNING *`,
      [projectId, JSON.stringify(doc), userId, expectedVersion],
    );
    return r.rows.length > 0 ? this._row(r.rows[0]) : null;
  }

  _row(row) {
    return {
      id: row.id,
      project_id: row.project_id,
      user_id: row.user_id,
      doc: typeof row.doc === "string" ? deserializeTimelineDocument(row.doc) : row.doc,
      version: Number(row.version),
      undo_cursor_seq: row.undo_cursor_seq == null ? null : Number(row.undo_cursor_seq),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

// ---- Content Pieces ----

export class ContentPieceStorePg {
  constructor(pool) { this.pool = pool; }

  async add({ userId, projectId = null, source = "manual", sourceId = null, kind = "script", language = "en", text, metadata = {} }) {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO vireo_content_pieces (id, user_id, project_id, source, source_id, kind, language, text, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, userId, projectId, source, sourceId, kind, language, text, JSON.stringify(metadata)],
    );
    return await this.get(id);
  }

  async get(id) {
    const r = await this.pool.query("SELECT * FROM vireo_content_pieces WHERE id = $1", [id]);
    return r.rows.length > 0 ? this._row(r.rows[0]) : null;
  }

  async listForUser(userId, { limit = 100, projectId = null, source = null } = {}) {
    const params = [userId];
    let where = "user_id = $1";
    if (projectId) { params.push(projectId); where += ` AND project_id = $${params.length}`; }
    if (source) { params.push(source); where += ` AND source = $${params.length}`; }
    params.push(limit);
    const r = await this.pool.query(
      `SELECT * FROM vireo_content_pieces WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows.map(row => this._row(row));
  }

  async bySource(userId, source, sourceId) {
    const r = await this.pool.query(
      "SELECT * FROM vireo_content_pieces WHERE user_id = $1 AND source = $2 AND source_id = $3 ORDER BY created_at",
      [userId, source, sourceId],
    );
    return r.rows.map(row => this._row(row));
  }

  async delete(id, userId) {
    const r = await this.pool.query(
      "DELETE FROM vireo_content_pieces WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return r.rowCount > 0;
  }

  _row(row) {
    return {
      id: row.id,
      user_id: row.user_id,
      project_id: row.project_id,
      source: row.source,
      source_id: row.source_id,
      kind: row.kind,
      language: row.language,
      text: row.text,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

// ---- Conversations & Messages ----

export class ConversationStore {
  constructor(pool) { this.pool = pool; }

  async create({ userId, projectId = null, title = null, systemPrompt = null, metadata = {} }) {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO vireo_conversations (id, user_id, project_id, title, system_prompt, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, projectId, title, systemPrompt, JSON.stringify(metadata)],
    );
    return await this.get(id);
  }

  async get(id) {
    const r = await this.pool.query("SELECT * FROM vireo_conversations WHERE id = $1", [id]);
    return r.rows.length > 0 ? this._row(r.rows[0]) : null;
  }

  async listForUser(userId, { limit = 50, projectId = null } = {}) {
    const params = [userId];
    let where = "user_id = $1";
    if (projectId) { params.push(projectId); where += ` AND project_id = $${params.length}`; }
    params.push(limit);
    const r = await this.pool.query(
      `SELECT * FROM vireo_conversations WHERE ${where} ORDER BY updated_at DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows.map(row => this._row(row));
  }

  async update(id, userId, { title, metadata }) {
    const sets = [];
    const params = [id];
    if (title !== undefined) { params.push(title); sets.push(`title = $${params.length}`); }
    if (metadata !== undefined) { params.push(JSON.stringify(metadata)); sets.push(`metadata = $${params.length}`); }
    if (sets.length === 0) return await this.get(id);
    sets.push("updated_at = now()");
    params.push(userId);
    await this.pool.query(
      `UPDATE vireo_conversations SET ${sets.join(", ")} WHERE id = $1 AND user_id = $${params.length}`,
      params,
    );
    return await this.get(id);
  }

  async touch(id) {
    await this.pool.query("UPDATE vireo_conversations SET updated_at = now() WHERE id = $1", [id]);
  }

  async delete(id, userId) {
    const r = await this.pool.query(
      "DELETE FROM vireo_conversations WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return r.rowCount > 0;
  }

  _row(row) {
    return {
      id: row.id,
      user_id: row.user_id,
      project_id: row.project_id,
      title: row.title,
      system_prompt: row.system_prompt,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

export class MessageStore {
  constructor(pool) { this.pool = pool; }

  async add({ conversationId, userId, role, content, toolCalls = null, toolResults = null, tokensUsed = 0, costUsd = 0 }) {
    const id = randomUUID();
    // seq is auto-assigned by the vireo_messages_seq_seq sequence (see
    // migration 008_message_seq). Don't pass it explicitly — keeps the
    // app stateless and lets the DB own monotonicity across processes.
    await this.pool.query(
      `INSERT INTO vireo_messages (id, conversation_id, user_id, role, content, tool_calls, tool_results, tokens_used, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, conversationId, userId, role, content,
       toolCalls ? JSON.stringify(toolCalls) : null,
       toolResults ? JSON.stringify(toolResults) : null,
       tokensUsed, costUsd],
    );
    return await this.get(id);
  }

  async get(id) {
    const r = await this.pool.query("SELECT * FROM vireo_messages WHERE id = $1", [id]);
    return r.rows.length > 0 ? this._row(r.rows[0]) : null;
  }

  async listForConversation(conversationId, { limit = 100, beforeId = null } = {}) {
    // Order by seq (strictly monotonic sequence) rather than created_at,
    // because ISO timestamps have 1ms granularity and user/assistant in
    // the same turn tie — real Postgres' tie-break for ORDER BY
    // created_at is non-deterministic (depends on ctid), which would make
    // rewind/position lookups land on the wrong row.
    const params = [conversationId];
    let where = "conversation_id = $1";
    if (beforeId) { params.push(beforeId); where += ` AND id < $${params.length}`; }
    params.push(limit);
    const r = await this.pool.query(
      `SELECT * FROM vireo_messages WHERE ${where} ORDER BY seq ASC LIMIT $${params.length}`,
      params,
    );
    return r.rows.map(row => this._row(row));
  }

  async deleteForConversation(conversationId, userId) {
    const r = await this.pool.query(
      "DELETE FROM vireo_messages WHERE conversation_id = $1 AND user_id = $2",
      [conversationId, userId],
    );
    return r.rowCount;
  }

  // Delete every message in a conversation that was created strictly after
  // the given anchor message id. Used by the rewind / edit-resend flow:
  // the user edited or removed the last user message, so everything that
  // came after it (the assistant reply, any tool calls/results) has to go
  // away before we can re-run the turn.
  //
  // We use the monotonic `seq` column (assigned by the sequence in
  // migration 008_message_seq) as the ordering key. This is one round-trip
  // and is robust to same-millisecond ties (which the old
  // `created_at > anchor.created_at` approach could not handle — the
  // user message and assistant reply in a single turn share a timestamp).
  async deleteAfter(conversationId, anchorMessageId, userId) {
    const r = await this.pool.query(
      `DELETE FROM vireo_messages
       WHERE conversation_id = $1
         AND user_id = $2
         AND seq > (SELECT seq FROM vireo_messages WHERE id = $3 AND user_id = $2)`,
      [conversationId, userId, anchorMessageId],
    );
    return r.rowCount;
  }

  // Update the content of a user message — used by Edit & resend.
  async updateContent(messageId, userId, content) {
    const r = await this.pool.query(
      `UPDATE vireo_messages
       SET content = $3
       WHERE id = $1 AND user_id = $2 AND role = 'user'`,
      [messageId, userId, content],
    );
    return r.rowCount;
  }

  _row(row) {
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      user_id: row.user_id,
      role: row.role,
      content: row.content,
      tool_calls: row.tool_calls ? (typeof row.tool_calls === "string" ? JSON.parse(row.tool_calls) : row.tool_calls) : null,
      tool_results: row.tool_results ? (typeof row.tool_results === "string" ? JSON.parse(row.tool_results) : row.tool_results) : null,
      tokens_used: row.tokens_used,
      cost_usd: typeof row.cost_usd === "string" ? parseFloat(row.cost_usd) : row.cost_usd,
      seq: row.seq != null ? Number(row.seq) : null,
      created_at: row.created_at,
    };
  }
}
