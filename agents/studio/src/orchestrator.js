/**
 * orchestrator.js — AI Orchestrator (10 classes)
 * The brain of Vireo Studio: understands intent → plans → asks permission → executes
 */

const MODULE_REGISTRY = {
  ai_director: ['director', 'storyboard', 'script', 'timeline', 'scene'],
  multi_agent: ['agent', 'pipeline', 'orchestrate', 'coordinate'],
  higgsfield: ['generate video', 'video generation', 'kling', 'veo', 'sora'],
  one_shot: ['one-shot', 'create from idea', 'idea to video', 'quick create'],
  auto_edit: ['auto edit', 'smart edit', 'edit automatically'],
  style_clone: ['style', 'clone style', 'brand style'],
  distribution: ['publish', 'distribute', 'post'],
  analytics: ['analytics', 'stats', 'performance'],
  brand_kit: ['brand', 'logo', 'colors', 'fonts'],
  template_marketplace: ['template', 'marketplace'],
  stock_library: ['music', 'sfx', 'footage', 'stock'],
  realtime_collab: ['collab', 'collaboration', 'share'],
  plugin_ecosystem: ['plugin', 'extension', 'api'],
  white_label: ['white-label', 'custom domain', 'enterprise'],
};

const INTENT_CATEGORIES = {
  CREATE: 'create',
  EDIT: 'edit',
  PUBLISH: 'publish',
  ANALYZE: 'analyze',
  COLLABORATE: 'collaborate',
  CONFIGURE: 'configure',
  QUERY: 'query',
  UNKNOWN: 'unknown',
};

const COMPLEXITY_LEVELS = {
  SIMPLE: 'simple',
  MEDIUM: 'medium',
  COMPLEX: 'complex',
};

function nowISO() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\sа-яё-]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function scoreKeywords(text, keywords) {
  const tokens = tokenize(text);
  if (!tokens.length || !keywords.length) return 0;
  let score = 0;
  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase();
    if (tokens.includes(normalized)) score += 2;
    else if (normalized.split(/\s+/).every((part) => tokens.includes(part))) score += 1;
    else if (normalized.length > 4 && tokens.some((token) => normalized.includes(token) || token.includes(normalized))) score += 0.5;
  }
  return score;
}

function normalizeConfidence(score, maxScore = 10) {
  return Math.min(1, Math.max(0, score / maxScore));
}

// ── 1. IntentClassifier ────────────────────────────────────────────────────

export class IntentClassifier {
  constructor() {
    this.entityPatterns = {
      platform: ['youtube', 'tiktok', 'instagram', 'shorts', 'reels', 'linkedin'],
      style: ['cinematic', 'viral', 'professional', 'minimal', 'dynamic', 'corporate'],
      duration: ['30 sec', '1 min', '2 min', '5 min', '10 min', 'short', 'long'],
      format: ['vertical', 'horizontal', 'square', '9:16', '16:9', '1:1'],
    };
    this.urgentWords = ['срочно', 'urgent', 'asap', 'быстро', 'today', 'сегодня'];
  }

  classify(text) {
    const normalized = String(text || '').toLowerCase();
    const scores = {
      [INTENT_CATEGORIES.CREATE]: scoreKeywords(normalized, ['создай', 'generate', 'новый', 'new', 'идея', 'idea']),
      [INTENT_CATEGORIES.EDIT]: scoreKeywords(normalized, ['edit', 'редактировать', 'изменить', 'cut', 'trim', 'обрежь', 'монтаж', 'смонтировать']),
      [INTENT_CATEGORIES.PUBLISH]: scoreKeywords(normalized, ['publish', 'пост', 'опубликуй', 'опубликовать', 'upload', 'share', 'разместить', 'youtube', 'tiktok', 'instagram']),
      [INTENT_CATEGORIES.ANALYZE]: scoreKeywords(normalized, ['analytics', 'stats', 'анализ', 'статистика', 'performance', 'метрики', 'покажи статистику']),
      [INTENT_CATEGORIES.COLLABORATE]: scoreKeywords(normalized, ['collab', 'share', 'collaborate', 'совместно', 'команда']),
      [INTENT_CATEGORIES.CONFIGURE]: scoreKeywords(normalized, ['configure', 'settings', 'настройки', 'setup', 'brand', 'бренд']),
    };
    if (normalized.includes('сделай') && !normalized.includes('опублику') && !normalized.includes('пост')) {
      scores[INTENT_CATEGORIES.CREATE] += 3;
    }

    const maxScore = Math.max(...Object.values(scores));
    const category = maxScore === 0 ? INTENT_CATEGORIES.UNKNOWN : Object.entries(scores).find(([, score]) => score === maxScore)[0];

    return {
      id: makeId('intent'),
      category,
      confidence: normalizeConfidence(maxScore),
      text: String(text || ''),
      detected_at: nowISO(),
    };
  }

  getConfidence(text, category) {
    const intent = this.classify(text);
    return intent.category === category ? intent.confidence : 0;
  }

  extractEntities(text) {
    const entities = [];
    const normalized = String(text || '').toLowerCase();

    for (const [type, keywords] of Object.entries(this.entityPatterns)) {
      for (const keyword of keywords) {
        if (normalized.includes(keyword)) {
          entities.push({ type, value: keyword, confidence: 0.9 });
        }
      }
    }

    const durationMatch = normalized.match(/(\d+)\s*(sec|сек|min|мин|час)/i);
    if (durationMatch) {
      entities.push({ type: 'duration', value: `${durationMatch[1]}${durationMatch[2]}`, confidence: 0.95 });
    }

    return entities;
  }

  detectLanguage(text) {
    const cyrillic = (String(text || '').match(/[а-яё]/gi) || []).length;
    const latin = (String(text || '').match(/[a-z]/gi) || []).length;
    if (cyrillic > latin) return 'ru';
    if (latin > cyrillic) return 'en';
    return 'unknown';
  }

  getSentiment(text) {
    const normalized = String(text || '').toLowerCase();
    const positive = ['great', 'awesome', 'хорошо', 'отлично', 'love', 'нравится'];
    const negative = ['bad', 'terrible', 'плохо', 'ужасно', 'hate', 'не нравится'];

    let score = 0;
    positive.forEach((word) => { if (normalized.includes(word)) score += 1; });
    negative.forEach((word) => { if (normalized.includes(word)) score -= 1; });

    return {
      label: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral',
      score,
      confidence: score === 0 ? 0.5 : 0.8,
    };
  }

  isUrgent(text) {
    return this.urgentWords.some((word) => String(text || '').toLowerCase().includes(word));
  }

  getComplexity(text) {
    const words = tokenize(text);
    const hasMultipleActions = ['и', 'and', 'потом', 'then', 'сначала', 'first'].some((word) => words.includes(word));
    const hasSpecificRequirements = this.extractEntities(text).length >= 3;

    if (hasMultipleActions && hasSpecificRequirements) return COMPLEXITY_LEVELS.COMPLEX;
    if (hasMultipleActions || hasSpecificRequirements) return COMPLEXITY_LEVELS.MEDIUM;
    return COMPLEXITY_LEVELS.SIMPLE;
  }

  requiresPermission(intent) {
    const category = typeof intent === 'string' ? intent : intent?.category;
    return ['create', 'edit', 'publish', 'configure'].includes(category);
  }

  getRecommendedAction(text) {
    const intent = this.classify(text);
    const module = this._findBestModule(text);
    return {
      action: module,
      category: intent.category,
      confidence: intent.confidence,
    };
  }

  _findBestModule(text) {
    let bestModule = 'ai_director';
    let bestScore = 0;

    for (const [module, keywords] of Object.entries(MODULE_REGISTRY)) {
      const score = scoreKeywords(text, keywords);
      if (score > bestScore) {
        bestScore = score;
        bestModule = module;
      }
    }

    return bestModule;
  }
}

// ── 2. PlanBuilder ─────────────────────────────────────────────────────────

export class PlanBuilder {
  constructor() {
    this.defaultTemplates = {
      create_video: [
        { id: 'analyze', name: 'Analyze request', module: 'orchestrator', action: 'analyze' },
        { id: 'script', name: 'Generate script', module: 'ai_director', action: 'create_script' },
        { id: 'storyboard', name: 'Create storyboard', module: 'ai_director', action: 'create_storyboard' },
        { id: 'generate', name: 'Generate video', module: 'higgsfield', action: 'generate_video' },
        { id: 'edit', name: 'Edit timeline', module: 'auto_edit', action: 'smart_edit' },
        { id: 'export', name: 'Export video', module: 'orchestrator', action: 'export' },
      ],
      edit_video: [
        { id: 'load', name: 'Load project', module: 'orchestrator', action: 'load_project' },
        { id: 'analyze', name: 'Analyze footage', module: 'orchestrator', action: 'analyze' },
        { id: 'edit', name: 'Apply edits', module: 'auto_edit', action: 'smart_edit' },
        { id: 'review', name: 'Review changes', module: 'orchestrator', action: 'review' },
        { id: 'export', name: 'Export video', module: 'orchestrator', action: 'export' },
      ],
      publish: [
        { id: 'prepare', name: 'Prepare content', module: 'orchestrator', action: 'prepare' },
        { id: 'schedule', name: 'Schedule post', module: 'distribution', action: 'schedule' },
        { id: 'publish', name: 'Publish', module: 'distribution', action: 'publish' },
      ],
    };
  }

  createPlan(intent, context = {}) {
    const category = typeof intent === 'string' ? intent : intent?.category || 'create';
    const templateKey = category === 'edit' ? 'edit_video' : category === 'publish' ? 'publish' : 'create_video';
    const template = clone(this.defaultTemplates[templateKey] || this.defaultTemplates.create_video);

    return {
      id: makeId('plan'),
      name: `${category} workflow`,
      steps: template,
      status: 'draft',
      created_at: nowISO(),
      context,
    };
  }

  breakDown(goal, steps = []) {
    return steps.map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      name: step.name || step,
      description: step.description || '',
      module: step.module || 'orchestrator',
      action: step.action || step,
      order: index + 1,
      status: 'pending',
    }));
  }

  estimateTime(steps) {
    const baseTime = {
      simple: 30,
      medium: 120,
      complex: 300,
    };
    const complexity = steps.length > 5 ? 'complex' : steps.length > 3 ? 'medium' : 'simple';
    return {
      seconds: baseTime[complexity] * steps.length,
      complexity,
      confidence: 0.8,
    };
  }

  identifyDependencies(steps) {
    const deps = [];
    for (let i = 1; i < steps.length; i++) {
      deps.push({
        step_id: steps[i].id,
        depends_on: steps[i - 1].id,
        type: 'sequential',
      });
    }
    return deps;
  }

  prioritize(steps, criteria = 'order') {
    const sorted = [...steps];
    if (criteria === 'urgency') {
      sorted.sort((a, b) => (b.urgent || 0) - (a.urgent || 0));
    } else if (criteria === 'complexity') {
      sorted.sort((a, b) => (a.complexity || 0) - (b.complexity || 0));
    }
    return sorted.map((step, index) => ({ ...step, priority: index + 1 }));
  }

  validatePlan(plan) {
    const errors = [];
    if (!plan || !plan.steps || !Array.isArray(plan.steps)) errors.push('plan.steps must be an array');
    if (plan.steps && plan.steps.length === 0) errors.push('plan must have at least one step');
    if (plan.steps) {
      const ids = new Set();
      plan.steps.forEach((step) => {
        if (!step.id) errors.push(`step missing id at index`);
        if (ids.has(step.id)) errors.push(`duplicate step id: ${step.id}`);
        ids.add(step.id);
      });
    }
    return { valid: errors.length === 0, errors };
  }

  addStep(plan, step) {
    const next = clone(plan);
    next.steps = next.steps || [];
    next.steps.push({ ...step, id: step.id || makeId('step'), order: next.steps.length + 1 });
    next.updated_at = nowISO();
    return next;
  }

  removeStep(plan, stepId) {
    const next = clone(plan);
    next.steps = (next.steps || []).filter((step) => step.id !== stepId);
    next.updated_at = nowISO();
    return next;
  }

  reorderStep(plan, stepId, position) {
    const next = clone(plan);
    const idx = next.steps.findIndex((step) => step.id === stepId);
    if (idx === -1) throw new Error(`Step '${stepId}' not found`);
    const [step] = next.steps.splice(idx, 1);
    next.steps.splice(Math.max(0, Math.min(position - 1, next.steps.length)), 0, step);
    next.steps = next.steps.map((s, i) => ({ ...s, order: i + 1 }));
    next.updated_at = nowISO();
    return next;
  }

  exportPlan(plan, format = 'json') {
    if (format === 'json') return JSON.stringify(plan, null, 2);
    if (format === 'markdown') {
      return `# ${plan.name}\n\n${(plan.steps || []).map((s, i) => `${i + 1}. **${s.name}** (${s.module})`).join('\n')}`;
    }
    return clone(plan);
  }
}

// ── 3. PermissionManager ───────────────────────────────────────────────────

export class PermissionManager {
  constructor() {
    this._requests = new Map();
    this._grants = new Map();
    this._history = [];
    this._preferences = new Map();
  }

  requestPermission(action, details = {}) {
    const requestId = makeId('perm');
    const request = {
      id: requestId,
      action,
      details,
      status: 'pending',
      created_at: nowISO(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    this._requests.set(requestId, clone(request));
    this._history.push({ ...request, event: 'requested' });
    return clone(request);
  }

  grantPermission(requestId) {
    const request = this._requests.get(requestId);
    if (!request) throw new Error(`Permission request '${requestId}' not found`);
    request.status = 'granted';
    const grant = {
      id: makeId('grant'),
      request_id: requestId,
      action: request.action,
      granted_at: nowISO(),
    };
    this._grants.set(grant.id, clone(grant));
    this._history.push({ ...grant, event: 'granted' });
    return clone(grant);
  }

  denyPermission(requestId, reason = '') {
    const request = this._requests.get(requestId);
    if (!request) throw new Error(`Permission request '${requestId}' not found`);
    request.status = 'denied';
    const denial = { id: makeId('deny'), request_id: requestId, reason, denied_at: nowISO() };
    this._history.push({ ...denial, event: 'denied' });
    return clone(denial);
  }

  checkPermission(action) {
    const grants = [...this._grants.values()].filter((grant) => grant.action === action);
    return {
      action,
      allowed: grants.length > 0,
      grants: grants.map((g) => g.id),
      checked_at: nowISO(),
    };
  }

  listPendingRequests() {
    return [...this._requests.values()]
      .filter((req) => req.status === 'pending')
      .map(clone);
  }

  revokePermission(permissionId) {
    this._grants.delete(permissionId);
    this._history.push({ id: permissionId, event: 'revoked', revoked_at: nowISO() });
  }

  getPermissionHistory(action) {
    return this._history
      .filter((entry) => !action || entry.action === action)
      .map(clone);
  }

  isActionAllowed(action) {
    return this.checkPermission(action).allowed;
  }

  requireConfirmation(action, details = {}) {
    return details.require_confirmation !== false;
  }

  clearExpiredRequests() {
    const now = Date.now();
    let count = 0;
    for (const [id, req] of this._requests.entries()) {
      if (new Date(req.expires_at).getTime() < now && req.status === 'pending') {
        this._requests.delete(id);
        count++;
      }
    }
    return count;
  }
}

// ── 4. ActionExecutor ──────────────────────────────────────────────────────

export class ActionExecutor {
  constructor(moduleRegistry = {}) {
    this._modules = new Map(Object.entries(moduleRegistry));
    this._history = [];
    this._executions = new Map();
  }

  registerModule(name, module) {
    this._modules.set(name, module);
  }

  execute(action, params = {}) {
    const [moduleName, methodName] = action.split('.');
    const module = this._modules.get(moduleName);
    if (!module) throw new Error(`Module '${moduleName}' not registered`);

    const method = typeof methodName === 'string' ? module[methodName] : module[action];
    if (!method || typeof method !== 'function') throw new Error(`Method '${action}' not found in module '${moduleName}'`);

    const executionId = makeId('exec');
    const started = Date.now();
    try {
      const result = method.call(module, params);
      const duration = Date.now() - started;
      const record = {
        id: executionId,
        action,
        status: 'completed',
        result,
        duration_ms: duration,
        started_at: new Date(started).toISOString(),
        completed_at: nowISO(),
      };
      this._executions.set(executionId, record);
      this._history.push(record);
      return clone(record);
    } catch (error) {
      const record = {
        id: executionId,
        action,
        status: 'failed',
        error: error.message,
        duration_ms: Date.now() - started,
        started_at: new Date(started).toISOString(),
        failed_at: nowISO(),
      };
      this._executions.set(executionId, record);
      this._history.push(record);
      throw error;
    }
  }

  executeSequential(actions) {
    return actions.map((action) => this.execute(action.action, action.params || {}));
  }

  executeParallel(actions) {
    return actions.map((action) => {
      try {
        return this.execute(action.action, action.params || {});
      } catch (error) {
        return { action: action.action, status: 'failed', error: error.message };
      }
    });
  }

  retry(action, params = {}, maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return this.execute(action, params);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  rollback(action, executionId) {
    const execution = this._executions.get(executionId);
    if (!execution) throw new Error(`Execution '${executionId}' not found`);
    return {
      action,
      execution_id: executionId,
      rolled_back: true,
      rolled_back_at: nowISO(),
    };
  }

  getExecutionHistory(action) {
    return this._history
      .filter((entry) => !action || entry.action === action)
      .map(clone);
  }

  cancelExecution(executionId) {
    const execution = this._executions.get(executionId);
    if (!execution) throw new Error(`Execution '${executionId}' not found`);
    execution.status = 'cancelled';
    execution.cancelled_at = nowISO();
  }

  getExecutionStatus(executionId) {
    const execution = this._executions.get(executionId);
    if (!execution) throw new Error(`Execution '${executionId}' not found`);
    return { id: executionId, status: execution.status, action: execution.action };
  }

  cleanup() {
    this._history = [];
    this._executions.clear();
  }
}

// ── 5. ContextManager ──────────────────────────────────────────────────────

export class ContextManager {
  constructor() {
    this._data = new Map();
    this._history = new Map();
  }

  set(key, value) {
    this._data.set(key, clone(value));
    if (!this._history.has(key)) this._history.set(key, []);
    this._history.get(key).push({ value: clone(value), set_at: nowISO() });
  }

  get(key) {
    return clone(this._data.get(key));
  }

  delete(key) {
    this._data.delete(key);
  }

  clear() {
    this._data.clear();
  }

  getAll() {
    return new Map([...this._data.entries()].map(([k, v]) => [k, clone(v)]));
  }

  merge(context) {
    Object.entries(context || {}).forEach(([key, value]) => this.set(key, value));
  }

  snapshot() {
    return {
      id: makeId('snapshot'),
      data: Object.fromEntries(this._data),
      created_at: nowISO(),
    };
  }

  restore(snapshot) {
    this._data = new Map(Object.entries(snapshot.data || {}));
  }

  getHistory(key) {
    return clone(this._history.get(key) || []);
  }

  exportContext() {
    return Object.fromEntries(this._data);
  }
}

// ── 6. ConversationManager ────────────────────────────────────────────────

export class ConversationManager {
  constructor() {
    this._messages = [];
  }

  addMessage(role, content, metadata = {}) {
    const message = {
      id: makeId('msg'),
      role,
      content,
      metadata,
      created_at: nowISO(),
    };
    this._messages.push(clone(message));
    return clone(message);
  }

  getMessages(limit = 50) {
    return clone(this._messages.slice(-limit));
  }

  clear() {
    this._messages = [];
  }

  summarize(limit = 5) {
    return this._messages.slice(-limit).map((m) => `${m.role}: ${m.content}`).join('\n');
  }

  getTopic() {
    const recent = this._messages.slice(-3).map((m) => m.content).join(' ');
    const words = tokenize(recent);
    const filtered = words.filter((w) => !['the', 'a', 'и', 'в', 'на', 'to', 'for'].includes(w));
    return filtered.slice(0, 3).join(' ') || 'general';
  }

  detectMood() {
    const recent = this._messages.slice(-5).map((m) => m.content).join(' ');
    const classifier = new IntentClassifier();
    return classifier.getSentiment(recent).label;
  }

  getTurnCount() {
    return this._messages.length;
  }

  getLastMessage() {
    return clone(this._messages[this._messages.length - 1] || null);
  }

  exportConversation() {
    return { messages: clone(this._messages), exported_at: nowISO() };
  }

  importConversation(data) {
    this._messages = clone(data.messages || []);
  }
}

// ── 7. ErrorRecovery ───────────────────────────────────────────────────────

export class ErrorRecovery {
  constructor() {
    this._history = [];
    this._strategies = {
      network: { retry: true, max_retries: 3, backoff: 'exponential' },
      validation: { retry: false, max_retries: 0, backoff: 'none' },
      timeout: { retry: true, max_retries: 2, backoff: 'linear' },
      permission: { retry: false, max_retries: 0, backoff: 'none' },
      unknown: { retry: true, max_retries: 1, backoff: 'linear' },
    };
  }

  classifyError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    if (message.includes('network') || message.includes('connection') || message.includes('timeout')) return 'network';
    if (message.includes('validation') || message.includes('invalid') || message.includes('required')) return 'validation';
    if (message.includes('permission') || message.includes('denied') || message.includes('forbidden')) return 'permission';
    if (message.includes('timeout')) return 'timeout';
    return 'unknown';
  }

  getRecoveryStrategy(errorType) {
    return clone(this._strategies[errorType] || this._strategies.unknown);
  }

  shouldRetry(error) {
    const type = this.classifyError(error);
    return this._strategies[type]?.retry || false;
  }

  getMaxRetries(error) {
    const type = this.classifyError(error);
    return this._strategies[type]?.max_retries || 0;
  }

  getBackoffMs(error, attempt) {
    const type = this.classifyError(error);
    const strategy = this._strategies[type] || this._strategies.unknown;
    if (strategy.backoff === 'exponential') return 1000 * Math.pow(2, attempt - 1);
    if (strategy.backoff === 'linear') return 1000 * attempt;
    return 0;
  }

  createFallback(error) {
    const type = this.classifyError(error);
    return {
      type,
      action: type === 'permission' ? 'ask_user' : 'use_default',
      message: `Fallback for ${type} error`,
    };
  }

  logError(error, context = {}) {
    const record = {
      id: makeId('err'),
      message: error?.message || String(error),
      type: this.classifyError(error),
      context,
      logged_at: nowISO(),
    };
    this._history.push(record);
    return record;
  }

  getErrorHistory() {
    return clone(this._history);
  }

  clearHistory() {
    this._history = [];
  }

  analyzePattern() {
    const counts = {};
    this._history.forEach((err) => { counts[err.type] = (counts[err.type] || 0) + 1; });
    return Object.entries(counts).map(([type, count]) => ({ type, count }));
  }
}

// ── 8. QualityGate ─────────────────────────────────────────────────────────

export class QualityGate {
  constructor() {
    this._checks = new Map();
    this._thresholds = new Map();
  }

  defineCheck(name, criteria) {
    const check = {
      id: makeId('check'),
      name,
      criteria,
      threshold: criteria.threshold || 0.8,
      enabled: true,
    };
    this._checks.set(name, clone(check));
    return clone(check);
  }

  runCheck(name, data) {
    const check = this._checks.get(name);
    if (!check) throw new Error(`Quality check '${name}' not defined`);

    const value = data[check.criteria.field] ?? data[check.criteria.key];
    const threshold = this._thresholds.get(name) ?? check.threshold;
    const passed = typeof value === 'number' ? value >= threshold : Boolean(value);

    return {
      name,
      passed,
      value,
      threshold,
      checked_at: nowISO(),
    };
  }

  runAll(data) {
    const results = [...this._checks.keys()].map((name) => this.runCheck(name, data));
    return {
      passed: results.every((r) => r.passed),
      results,
      checked_at: nowISO(),
    };
  }

  getPassedChecks() {
    return [...this._checks.values()].filter((c) => c.enabled).map(clone);
  }

  getFailedChecks() {
    return [...this._checks.values()].filter((c) => !c.enabled).map(clone);
  }

  setThreshold(name, threshold) {
    this._thresholds.set(name, threshold);
  }

  getThreshold(name) {
    return this._thresholds.get(name);
  }

  exportReport(report) {
    return JSON.stringify(report, null, 2);
  }

  isPassing(data) {
    return this.runAll(data).passed;
  }

  clearChecks() {
    this._checks.clear();
    this._thresholds.clear();
  }
}

// ── 9. NotificationManager ────────────────────────────────────────────────

export class NotificationManager {
  constructor() {
    this._notifications = new Map();
    this._preferences = new Map();
    this._deliveryStats = { sent: 0, failed: 0, read: 0 };
  }

  createNotification(type, message, recipients = []) {
    const notification = {
      id: makeId('notif'),
      type,
      message,
      recipients,
      status: 'created',
      created_at: nowISO(),
    };
    this._notifications.set(notification.id, clone(notification));
    return clone(notification);
  }

  send(notificationId) {
    const notification = this._notifications.get(notificationId);
    if (!notification) throw new Error(`Notification '${notificationId}' not found`);
    notification.status = 'sent';
    notification.sent_at = nowISO();
    this._deliveryStats.sent++;
    return { notification_id: notificationId, status: 'sent', sent_at: notification.sent_at };
  }

  markRead(notificationId) {
    const notification = this._notifications.get(notificationId);
    if (!notification) throw new Error(`Notification '${notificationId}' not found`);
    notification.read = true;
    notification.read_at = nowISO();
    this._deliveryStats.read++;
  }

  listUnread() {
    return [...this._notifications.values()]
      .filter((n) => !n.read)
      .map(clone);
  }

  clearAll() {
    this._notifications.clear();
  }

  getHistory(type) {
    return [...this._notifications.values()]
      .filter((n) => !type || n.type === type)
      .map(clone);
  }

  setPreference(userId, channel, enabled) {
    this._preferences.set(`${userId}:${channel}`, enabled);
  }

  getPreference(userId, channel) {
    return this._preferences.get(`${userId}:${channel}`) !== false;
  }

  sendBatch(notifications) {
    return notifications.map((n) => {
      try {
        return this.send(n.id);
      } catch (error) {
        this._deliveryStats.failed++;
        return { notification_id: n.id, status: 'failed', error: error.message };
      }
    });
  }

  getDeliveryStats() {
    return clone(this._deliveryStats);
  }
}

// ── 10. OrchestrationEngine ───────────────────────────────────────────────

export class OrchestrationEngine {
  constructor(options = {}) {
    this.intentClassifier = new IntentClassifier();
    this.planBuilder = new PlanBuilder();
    this.permissionManager = new PermissionManager();
    this.actionExecutor = new ActionExecutor(options.modules || {});
    this.contextManager = new ContextManager();
    this.conversationManager = new ConversationManager();
    this.errorRecovery = new ErrorRecovery();
    this.qualityGate = new QualityGate();
    this.notificationManager = new NotificationManager();

    this._status = 'ready';
    this._sessions = [];
  }

  processUserRequest(text, context = {}) {
    this.contextManager.merge(context);
    this.conversationManager.addMessage('user', text);

    const intent = this.intentClassifier.classify(text);
    const plan = this.createPlan(text, context);
    const requiresPermission = this.intentClassifier.requiresPermission(intent.category);
    const permissionRequests = requiresPermission
      ? plan.steps.map((step) => this.permissionManager.requestPermission(step.action, { step_id: step.id, module: step.module }))
      : [];

    return {
      intent,
      plan,
      permission_requests: permissionRequests,
      recommended_modules: this.getRecommendedModules(text),
      estimated_time: this.estimateCompletionTime(text),
      requires_permission: requiresPermission,
      processed_at: nowISO(),
    };
  }

  createPlan(text, context = {}) {
    const intent = this.intentClassifier.classify(text);
    return this.planBuilder.createPlan(intent.category, { ...context, text });
  }

  executePlan(plan, permissions = []) {
    permissions.forEach((perm) => this.permissionManager.grantPermission(perm));
    return this.actionExecutor.executeSequential(plan.steps.map((step) => ({
      action: `${step.module}.${step.action}`,
      params: { step_id: step.id },
    })));
  }

  askForPermission(action, details = {}) {
    return this.permissionManager.requestPermission(action, details);
  }

  handleResponse(response, context = {}) {
    this.contextManager.merge(context);
    this.conversationManager.addMessage('assistant', response);
    return {
      response,
      context: this.contextManager.exportContext(),
      handled_at: nowISO(),
    };
  }

  getStepByStepPlan(text) {
    const plan = this.createPlan(text);
    return plan.steps.map((step, index) => ({
      order: index + 1,
      name: step.name,
      module: step.module,
      action: step.action,
    }));
  }

  getRecommendedModules(text) {
    const modules = [];
    Object.entries(MODULE_REGISTRY).forEach(([module, keywords]) => {
      if (scoreKeywords(text, keywords) > 0) modules.push(module);
    });
    return modules.length > 0 ? modules : ['ai_director'];
  }

  estimateCompletionTime(text) {
    const plan = this.createPlan(text);
    return this.planBuilder.estimateTime(plan.steps);
  }

  getStatus() {
    return {
      status: this._status,
      active_sessions: this._sessions.length,
      modules_registered: this.actionExecutor._modules.size,
      pending_permissions: this.permissionManager.listPendingRequests().length,
      checked_at: nowISO(),
    };
  }

  exportSession() {
    return {
      conversation: this.conversationManager.exportConversation(),
      context: this.contextManager.exportContext(),
      engine_status: this.getStatus(),
      exported_at: nowISO(),
    };
  }
}

export const orchestrator = {
  IntentClassifier,
  PlanBuilder,
  PermissionManager,
  ActionExecutor,
  ContextManager,
  ConversationManager,
  ErrorRecovery,
  QualityGate,
  NotificationManager,
  OrchestrationEngine,
};

export default orchestrator;
