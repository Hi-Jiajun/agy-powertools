import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SUPPORTED_LANGUAGES } from './locales/index.mjs';
import { createCredentialVault } from './credential-vault.mjs';
import { createProxyFetcher } from './proxy.mjs';

export const TRANSLATION_ENGINES = Object.freeze(['openai', 'gemini', 'google', 'azure']);
export const TRANSLATION_DISPLAY_MODES = Object.freeze(['replace', 'bilingual']);
const TARGET_LANG_META = Object.freeze({
  'zh-CN': Object.freeze({ google: 'zh-CN', azure: 'zh-Hans', llmLabel: '简体中文' }),
  'zh-TW': Object.freeze({ google: 'zh-TW', azure: 'zh-Hant', llmLabel: '繁體中文（台灣科技與軟體開發常用術語）' }),
  fr: Object.freeze({ google: 'fr', azure: 'fr', llmLabel: 'French (natural, concise technical French)' }),
  ja: Object.freeze({ google: 'ja', azure: 'ja', llmLabel: 'Japanese (natural, concise technical Japanese)' }),
  ko: Object.freeze({ google: 'ko', azure: 'ko', llmLabel: 'Korean (natural, concise technical Korean)' }),
  de: Object.freeze({ google: 'de', azure: 'de', llmLabel: 'German (natural, concise technical German)' }),
  es: Object.freeze({ google: 'es', azure: 'es', llmLabel: 'Spanish (natural, concise technical Spanish)' }),
  ru: Object.freeze({ google: 'ru', azure: 'ru', llmLabel: 'Russian (natural, concise technical Russian)' }),
  vi: Object.freeze({ google: 'vi', azure: 'vi', llmLabel: 'Vietnamese (natural, concise technical Vietnamese)' })
});
const targetLangMeta = lang => TARGET_LANG_META[lang] || TARGET_LANG_META['zh-CN'];

const DEFAULT_BASE_URLS = Object.freeze({
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  google: 'https://translation.googleapis.com/language/translate/v2',
  azure: 'https://api.cognitive.microsofttranslator.com'
});

export const LLM_PRESETS = Object.freeze({
  openai: Object.freeze({ engine: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }),
  deepseek: Object.freeze({ engine: 'openai', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
  gemini: Object.freeze({ engine: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' }),
  openrouter: Object.freeze({ engine: 'openai', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' }),
  ollama: Object.freeze({ engine: 'openai', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' }),
  google: Object.freeze({ engine: 'google', label: 'Google Cloud', baseUrl: 'https://translation.googleapis.com/language/translate/v2', model: '' }),
  azure: Object.freeze({ engine: 'azure', label: 'Azure Translator', baseUrl: 'https://api.cognitive.microsofttranslator.com', model: '' })
});

const MAX_CACHE_ENTRIES = 4000;
const BATCH_CONCURRENCY = 3;
const MT_BATCH_MAX_ITEMS = 25;
const MT_BATCH_MAX_CHARS = 8000;
const HTTP_TIMEOUT_MS = 20_000;

export function normalizeTranslationBaseUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${path}`;
  } catch {
    return trimmed;
  }
}

export function isValidTranslationBaseUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 300 || /[\s"'<>\x00-\x1f]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function stripTranslationBaseUrlSecrets(raw) {
  if (typeof raw !== 'string') return { url: raw, stripped: false };
  const trimmed = raw.trim();
  if (!trimmed) return { url: raw, stripped: false };
  let parsed;
  try { parsed = new URL(trimmed); } catch { return { url: raw, stripped: false }; }
  if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
    return { url: raw, stripped: false };
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return { url: `${parsed.origin}${path}`, stripped: true };
}

export function resolveTranslationSecretScope({ engine, baseUrl } = {}) {
  if (!TRANSLATION_ENGINES.includes(engine)) return null;
  const effective = normalizeTranslationBaseUrl(baseUrl) || DEFAULT_BASE_URLS[engine];
  let parsed;
  try { parsed = new URL(effective); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
  const origin = parsed.origin.toLowerCase();
  const keyId = `${engine}_${createHash('sha256').update(`${engine}\0${origin}`).digest('hex').slice(0, 24)}`;
  return { engine, origin, keyId };
}

export function normalizeTranslationModel(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isValidTranslationModel(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return trimmed.length <= 120 && !/[\s\x00-\x1f"'<>]/.test(trimmed);
}

export function maskApiKey(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  if (!key) return '';
  if (key.length < 8) return '***';
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

// Single-pass token pattern ordered from broadest structural constructs to short refs.
const TECHNICAL_TOKEN_RE = /(`{3,}|~{3,})[\s\S]*?\1|`[^`\r\n]+`|https?:\/\/[^\s)>"'`\],;]+(?<![.,;:])|(?:(?<=^|[\s(\["'`=:,])(?:~|\.{1,2})?\/(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\/)*(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_.-]+\/){2,}(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_.-]+\\)+(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_-]*[0-9_.-][a-zA-Z0-9_.-]*\/(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)|[a-zA-Z0-9_.-]+\/(?:[a-zA-Z0-9_-]*[0-9_-][a-zA-Z0-9_.-]*|[a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+))(?:#L\d+(?:-L?\d+)?)?|[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+#L\d+(?:-L?\d+)?)|\b[a-zA-Z0-9_-]+\.(?:[mc]?js|tsx?|jsx?|py|go|rs|java|c|cpp|h|hpp|json|ya?ml|toml|md|css|scss|html|sh|bash|zsh|ps1|log|txt|sql|vue|svelte|mjs|cjs|mts|cts)(?:#L\d+(?:-L?\d+)?)?\b|(?:^|(?<=[\s(,]))--[a-zA-Z0-9][a-zA-Z0-9_-]*(?:=[^\s,;)]+)?|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|@[a-zA-Z0-9_.-]+|#\d+\b|\bv\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?\b/g;

function chooseMarkerPair(text) {
  for (const [open, close] of [['⟦', '⟧'], ['⟨', '⟩'], ['〚', '〛']]) {
    if (!text.includes(open) && !text.includes(close)) return [open, close];
  }
  return ['⟦', '⟧'];
}

export function maskTechnicalTokens(text) {
  if (typeof text !== 'string' || !text) {
    return { masked: String(text || ''), tokens: [], open: '⟦', close: '⟧' };
  }
  const [open, close] = chooseMarkerPair(text);
  const tokens = [];
  const masked = text.replace(TECHNICAL_TOKEN_RE, match => {
    const idx = tokens.length;
    tokens.push(match);
    return `${open}${idx}${close}`;
  });
  return { masked, tokens, open, close };
}

export function unmaskTechnicalTokens(translated, tokens = [], { open = '⟦', close = '⟧' } = {}) {
  if (typeof translated !== 'string') return { text: '', intact: tokens.length === 0, missingCount: tokens.length };
  if (!Array.isArray(tokens) || !tokens.length) return { text: translated, intact: true, missingCount: 0 };
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(open)}\\s*(\\d+)\\s*${esc(close)}`, 'g');
  const seen = new Set();
  const restored = translated.replace(re, (full, rawIdx) => {
    const idx = Number(rawIdx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= tokens.length) return full;
    seen.add(idx);
    return tokens[idx];
  });
  const missingCount = tokens.length - seen.size;
  return { text: restored, intact: missingCount === 0, missingCount };
}

const LEADING_ACTION_VERB_RE = /^(?:check|read|edit|updat|creat|delet|remov|verif|test|build|runn|ran|start|stopp|install|compil|search|explor|list|inspect|fetch|load|writ|pars|patch|fix|debug|reinstall|rebuild|restart|sync|wait|ask|open|clos|generat|format|lint|migrat|deploy|configur|monitor|prob|scann|watch|upgrad|download|upload|clean)/i;

function isStandaloneJson(raw) {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t || !((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) return false;
  try {
    const parsed = JSON.parse(t);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

export function shouldSkipTranslation(text, targetLang = 'zh-CN') {
  if (typeof text !== 'string' || !text.trim() || targetLang === 'en') return true;
  if (isStandaloneJson(text)) return true;
  const plainNoNums = text.replace(/\b\d+(?:\.\d+)?\b/g, ' ').trim();
  const stripped = text.replace(TECHNICAL_TOKEN_RE, ' ').replace(/\b\d+(?:\.\d+)?\b/g, ' ').trim();
  if (!stripped) return true;
  const hadTechToken = stripped !== plainNoNums;
  const enWords = stripped.match(/\b[A-Za-z][A-Za-z'-]{1,}\b/g) || [];
  const latinChars = (stripped.match(/[A-Za-z]/g) || []).length;
  const cjkChars = (stripped.match(/[\u4e00-\u9fff]/g) || []).length;
  if (targetLang === 'ja') {
    const kanaChars = (stripped.match(/[\u3040-\u30ff]/g) || []).length;
    const jpChars = kanaChars + cjkChars;
    if (kanaChars >= 4 && (enWords.length <= 4 || (jpChars >= 12 && (jpChars / (jpChars + enWords.length * 2)) >= 0.65))) return true;
  } else if (targetLang === 'ko') {
    const hangulChars = (stripped.match(/[\uac00-\ud7af]/g) || []).length;
    if (hangulChars >= 4 && (enWords.length <= 4 || (hangulChars >= 12 && (hangulChars / (hangulChars + enWords.length * 2)) >= 0.65))) return true;
  } else if (targetLang === 'ru') {
    const cyrillicChars = (stripped.match(/[\u0400-\u04ff]/g) || []).length;
    if (cyrillicChars >= 4 && (enWords.length <= 4 || (cyrillicChars >= 20 && (cyrillicChars / (cyrillicChars + latinChars)) >= 0.65))) return true;
  } else if (targetLang === 'vi') {
    const viChars = (stripped.match(/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/gi) || []).length;
    if (viChars >= 3 && (viChars / Math.max(1, latinChars + viChars)) >= 0.15) return true;
  }
  if (enWords.length < 2 || latinChars < 5) {
    return !(enWords.length === 1 && latinChars >= 5 && hadTechToken && LEADING_ACTION_VERB_RE.test(enWords[0]));
  }
  if (targetLang === 'zh-CN' || targetLang === 'zh-TW') {
    const ratio = cjkChars / (cjkChars + enWords.length * 2);
    if ((cjkChars >= 4 && enWords.length <= 4 && ratio >= 0.45) || (cjkChars >= 12 && ratio >= 0.65)) return true;
  }
  return false;
}

const normalizePromptText = text => String(text || '').replace(/\r\n/g, '\n');

const makeCacheKey = (scope, targetLang, text, context = '') =>
  createHash('sha256')
    .update(`${scope}\0${targetLang}\0${context ? context.slice(-160) : ''}\0${normalizePromptText(text)}`)
    .digest('hex');

function safeJsonRead(file, fallback) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function atomicWriteJson(file, data) {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8' });
  renameSync(tmp, file);
}

function combineSignals(outerSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!outerSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([outerSignal, timeoutSignal]);
  const controller = new AbortController();
  const forward = sig => { if (!controller.signal.aborted) controller.abort(sig.reason); };
  if (outerSignal.aborted) forward(outerSignal);
  else outerSignal.addEventListener('abort', () => forward(outerSignal), { once: true });
  timeoutSignal.addEventListener('abort', () => forward(timeoutSignal), { once: true });
  return controller.signal;
}

const isAbortError = error => error?.name === 'AbortError' || error?.code === 'ABORT_ERR';

function buildLlmPrompts(text, { targetLang = 'zh-CN', context = '' } = {}) {
  const langLabel = targetLangMeta(targetLang).llmLabel;
  const system = [
    `You are a precise technical translator translating AI coding agent reasoning and tool logs into natural, concise ${langLabel}.`,
    'Rules:',
    '1. Preserve ALL Markdown structure (headings, lists, blockquotes, bold/italic, links) exactly.',
    '2. Keep fenced code blocks, inline `code`, file paths, line references (#L1-L20), symbol names, CLI flags, ALL_CAPS constants, @mentions, #numbers, URLs, and model names completely unchanged.',
    '3. Output ONLY the translation with zero preamble, notes, or surrounding quotes.',
    '4. If already mostly in the target language, polish awkward literal fragments minimally while keeping technical terms intact.'
  ].join('\n');
  const trimmedCtx = typeof context === 'string' ? context.trim() : '';
  const user = trimmedCtx
    ? `<previous_translation_context>\n${trimmedCtx.slice(-300)}\n</previous_translation_context>\nTranslate ONLY the following segment (use context only for continuity; NEVER repeat it):\n\n${text}`
    : text;
  return { system, user };
}

function buildOpenAiEndpoint(baseUrl) {
  const clean = normalizeTranslationBaseUrl(baseUrl) || DEFAULT_BASE_URLS.openai;
  return /\/chat\/completions(?:\?|$)/i.test(clean) ? clean : `${clean}/chat/completions`;
}

function buildGeminiEndpoint(baseUrl, model) {
  const cleanBase = normalizeTranslationBaseUrl(baseUrl) || DEFAULT_BASE_URLS.gemini;
  const cleanModel = (normalizeTranslationModel(model) || 'gemini-2.5-flash').replace(/^models\//, '');
  if (/\/models\/.+:(?:stream)?GenerateContent/i.test(cleanBase)) return cleanBase;
  return `${cleanBase}/models/${encodeURIComponent(cleanModel)}:streamGenerateContent?alt=sse`;
}

function buildGoogleCloudEndpoint(baseUrl) {
  const clean = normalizeTranslationBaseUrl(baseUrl) || DEFAULT_BASE_URLS.google;
  if (/\/v2$/i.test(clean)) return clean;
  if (/\/language\/translate$/i.test(clean)) return `${clean}/v2`;
  return `${clean}/language/translate/v2`;
}

function buildAzureEndpoint(baseUrl, targetLang) {
  const clean = normalizeTranslationBaseUrl(baseUrl) || DEFAULT_BASE_URLS.azure;
  const path = /\/translate$/i.test(clean) ? clean : `${clean}/translate`;
  return `${path}?api-version=3.0&to=${encodeURIComponent(targetLangMeta(targetLang).azure)}`;
}

async function* iterateResponseChunks(body, signal) {
  if (typeof body?.getReader === 'function') {
    const reader = body.getReader();
    try {
      while (true) {
        if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
        const { value, done } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
    return;
  }
  if (!body) return;
  try {
    for await (const chunk of body) {
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
      yield chunk;
    }
  } finally {
    if (signal?.aborted) try { body?.destroy?.(); } catch {}
  }
}

async function readSseStream(response, extractDelta, onDelta, signal) {
  const ctype = (response.headers?.get?.('content-type') || response.headers?.['content-type'] || '').toLowerCase();
  if (!response.body || (ctype.includes('application/json') && !ctype.includes('event-stream'))) {
    const payload = await response.json();
    const errObj = Array.isArray(payload) ? payload[0] : payload;
    if (errObj?.error?.message) throw new Error(errObj.error.message);
    const full = extractDelta(payload);
    if (full) onDelta?.(full);
    return full || '';
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let sawAnyEvent = false;
  const rawChunks = [];

  const handleEventLines = block => {
    const dataLines = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart());
    if (!dataLines.length) return;
    sawAnyEvent = true;
    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') return;
    let json;
    try { json = JSON.parse(data); } catch { return; }
    const errObj = Array.isArray(json) ? json[0] : json;
    if (errObj?.error?.message) throw new Error(errObj.error.message);
    const delta = extractDelta(json);
    if (delta) {
      fullText += delta;
      onDelta?.(delta);
    }
  };

  for await (const value of iterateResponseChunks(response.body, signal)) {
    const decoded = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
    rawChunks.push(decoded);
    buffer += decoded;
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? '';
    for (const block of parts) handleEventLines(block);
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleEventLines(buffer);
  if (!sawAnyEvent && !fullText && rawChunks.length) {
    let json = null;
    try { json = JSON.parse(rawChunks.join('').trim()); } catch {}
    const errObj = Array.isArray(json) ? json[0] : json;
    if (errObj?.error?.message) throw new Error(errObj.error.message);
    if (json) {
      const text = extractDelta(json);
      if (text) {
        fullText = text;
        onDelta?.(text);
      }
    }
  }
  return fullText;
}

async function readHttpError(res, label) {
  let detail = `${label} HTTP ${res.status}`;
  try {
    const errBody = await res.json();
    const errObj = Array.isArray(errBody) ? errBody[0] : errBody;
    if (errObj?.error?.message) detail = `${detail}: ${errObj.error.message}`;
  } catch {}
  return new Error(detail);
}

export function createTranslatorStore(
  dataDir = join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-powertools'),
  { getSettings = () => ({}), fetchImpl, vault = createCredentialVault(), home = homedir() } = {}
) {
  const doFetch = fetchImpl || createProxyFetcher({ home });
  const cacheFile = join(dataDir, 'translation-cache.json');
  const cache = new Map();
  const secretCache = new Map();
  let cacheLoaded = false;
  let flushTimer = null;

  function ensureCacheLoaded() {
    if (cacheLoaded) return;
    cacheLoaded = true;
    const entries = safeJsonRead(cacheFile, null)?.entries;
    if (!Array.isArray(entries)) return;
    for (const entry of entries.slice(-MAX_CACHE_ENTRIES)) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1]?.text === 'string') {
        cache.set(entry[0], entry[1]);
      }
    }
  }

  function flushCache() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!cacheLoaded) return;
    try { atomicWriteJson(cacheFile, { version: 1, entries: [...cache.entries()].slice(-MAX_CACHE_ENTRIES) }); } catch {}
  }

  function getCached(key) {
    ensureCacheLoaded();
    const hit = cache.get(key);
    if (!hit) return null;
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  function putCached(key, text, provider) {
    if (!text) return;
    ensureCacheLoaded();
    cache.delete(key);
    cache.set(key, { text, provider, at: Date.now() });
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    if (!flushTimer) {
      flushTimer = setTimeout(() => { flushTimer = null; flushCache(); }, 1500);
      flushTimer.unref?.();
    }
  }

  function resolveConfig(override = {}) {
    const cfg = getSettings() || {};
    const requestedLang = override.targetLang || cfg.language;
    const targetLang = SUPPORTED_LANGUAGES.includes(requestedLang) ? requestedLang : 'zh-CN';
    const rawEngine = override.engine || cfg.detailTranslationEngine;
    const engine = TRANSLATION_ENGINES.includes(rawEngine) ? rawEngine : 'openai';
    const rawBase = override.baseUrl !== undefined ? override.baseUrl : cfg.detailTranslationBaseUrl;
    if (typeof rawBase === 'string' && rawBase.trim() && !isValidTranslationBaseUrl(rawBase)) {
      throw new Error('无效的接口地址（仅支持 http/https，且不能包含查询参数、锚点或认证信息）');
    }
    const baseUrl = normalizeTranslationBaseUrl(rawBase);
    const model = override.model !== undefined ? normalizeTranslationModel(override.model) : normalizeTranslationModel(cfg.detailTranslationModel);
    return { targetLang, engine, baseUrl, model };
  }

  function readApiKey({ engine, baseUrl } = {}) {
    const scope = resolveTranslationSecretScope({ engine, baseUrl });
    if (!scope) return '';
    if (secretCache.has(scope.keyId)) return secretCache.get(scope.keyId);
    if (!vault?.probe?.()?.supported) return '';
    const res = vault.readSecret(vault.secretTargetFor('translator', scope.keyId));
    if (!res?.ok || !res.exists || !res.value) return '';
    const key = String(res.value).trim();
    if (key) secretCache.set(scope.keyId, key);
    return key;
  }

  function setSecret({ apiKey, engine, baseUrl } = {}) {
    const cfg = resolveConfig({ engine, baseUrl });
    const clean = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (clean.length > 512) throw new Error('API Key 长度超出限制');
    const scope = resolveTranslationSecretScope({ engine: cfg.engine, baseUrl: cfg.baseUrl });
    if (!scope) throw new Error('当前翻译引擎不支持 API Key 存储');
    const target = vault.secretTargetFor('translator', scope.keyId);
    const probe = vault?.probe?.();
    if (!clean) {
      secretCache.delete(scope.keyId);
      if (probe?.supported) {
        const removed = vault.remove(target);
        if (removed && removed.ok === false) throw new Error(removed.error || '清除 API Key 失败');
      }
      return status({ engine: cfg.engine, baseUrl: cfg.baseUrl });
    }
    if (!probe?.supported) throw new Error(probe?.reason || '系统凭据库不可用，无法安全保存 API Key');
    const written = vault.writeSecret(target, clean);
    if (!written?.ok) throw new Error(written?.error || '写入系统凭据库失败');
    secretCache.set(scope.keyId, clean);
    return status({ engine: cfg.engine, baseUrl: cfg.baseUrl });
  }

  function status({ engine, baseUrl } = {}) {
    ensureCacheLoaded();
    const probe = vault?.probe?.() || { supported: false, backend: 'unsupported', reason: '系统凭据库不可用' };
    let cfg;
    try {
      cfg = resolveConfig({ engine, baseUrl });
    } catch {
      return {
        hasApiKey: false,
        maskedKey: '',
        secretOrigin: '',
        vaultSupported: Boolean(probe.supported),
        vaultBackend: probe.backend || 'unsupported',
        vaultReason: probe.reason || '',
        cacheEntries: cache.size
      };
    }
    const scope = resolveTranslationSecretScope({ engine: cfg.engine, baseUrl: cfg.baseUrl });
    const apiKey = readApiKey({ engine: cfg.engine, baseUrl: cfg.baseUrl });
    return {
      hasApiKey: Boolean(apiKey),
      maskedKey: maskApiKey(apiKey),
      secretOrigin: scope?.origin || '',
      vaultSupported: Boolean(probe.supported),
      vaultBackend: probe.backend || 'unsupported',
      vaultReason: probe.reason || '',
      cacheEntries: cache.size
    };
  }

  function clearCache() {
    ensureCacheLoaded();
    cache.clear();
    flushCache();
    return { ok: true, cacheEntries: 0 };
  }

  async function translateOpenAi(text, { targetLang, context, baseUrl, model, apiKey, onDelta, signal }) {
    const endpoint = buildOpenAiEndpoint(baseUrl);
    const { system, user } = buildLlmPrompts(text, { targetLang, context });
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: normalizeTranslationModel(model) || 'gpt-4o-mini',
        stream: true,
        temperature: 0.1,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      }),
      redirect: 'error',
      signal: combineSignals(signal, HTTP_TIMEOUT_MS)
    });
    if (!res.ok) throw await readHttpError(res, 'OpenAI');
    const full = await readSseStream(
      res,
      json => {
        const d = json?.choices?.[0]?.delta?.content;
        if (typeof d === 'string') return d;
        const m = json?.choices?.[0]?.message?.content;
        return typeof m === 'string' ? m : '';
      },
      onDelta,
      signal
    );
    if (!full.trim()) throw new Error('OpenAI returned empty content');
    return full;
  }

  async function translateGemini(text, { targetLang, context, baseUrl, model, apiKey, onDelta, signal }) {
    if (!apiKey) throw new Error('Gemini 引擎需要配置 API Key');
    const endpoint = buildGeminiEndpoint(baseUrl, model);
    const { system, user } = buildLlmPrompts(text, { targetLang, context });
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.1 }
      }),
      redirect: 'error',
      signal: combineSignals(signal, HTTP_TIMEOUT_MS)
    });
    if (!res.ok) throw await readHttpError(res, 'Gemini');
    const extractGeminiParts = payload => {
      const candidates = Array.isArray(payload) ? payload : [payload];
      let out = '';
      for (const item of candidates) {
        const parts = item?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) continue;
        for (const p of parts) {
          if (typeof p?.text === 'string' && !p?.thought) out += p.text;
        }
      }
      return out;
    };
    const full = await readSseStream(res, extractGeminiParts, onDelta, signal);
    if (!full.trim()) throw new Error('Gemini returned empty content');
    return full;
  }

  async function translateOfficialMtBatch(texts, engine, { targetLang, baseUrl, model: region, apiKey, signal }) {
    if (!apiKey) {
      throw new Error(engine === 'google' ? 'Google Cloud 翻译需要配置 API Key' : 'Azure 翻译需要配置 API Key');
    }
    const maskedList = texts.map(t => maskTechnicalTokens(t));
    const isGoogle = engine === 'google';
    const endpoint = isGoogle ? buildGoogleCloudEndpoint(baseUrl) : buildAzureEndpoint(baseUrl, targetLang);
    const headers = { 'Content-Type': 'application/json' };
    if (isGoogle) {
      headers['X-Goog-Api-Key'] = apiKey;
    } else {
      headers['Ocp-Apim-Subscription-Key'] = apiKey;
      if (region) headers['Ocp-Apim-Subscription-Region'] = region;
    }
    const body = isGoogle
      ? JSON.stringify({ q: maskedList.map(m => m.masked), target: targetLangMeta(targetLang).google, format: 'text' })
      : JSON.stringify(maskedList.map(m => ({ Text: m.masked })));

    const res = await doFetch(endpoint, { method: 'POST', headers, body, redirect: 'error', signal: combineSignals(signal, HTTP_TIMEOUT_MS) });
    if (!res.ok) throw await readHttpError(res, isGoogle ? 'Google Cloud' : 'Azure Translator');
    const data = await res.json();
    const rawItems = isGoogle ? data?.data?.translations : data;
    if (!Array.isArray(rawItems) || rawItems.length !== texts.length) {
      throw new Error(`${isGoogle ? 'Google Cloud' : 'Azure Translator'} returned invalid payload`);
    }
    return rawItems.map((entry, idx) => {
      const translatedText = isGoogle ? entry?.translatedText : entry?.translations?.[0]?.text;
      if (typeof translatedText !== 'string' || !translatedText) {
        throw new Error(`${isGoogle ? 'Google Cloud' : 'Azure Translator'} returned empty item`);
      }
      const m = maskedList[idx];
      const unmasked = unmaskTechnicalTokens(translatedText, m.tokens, { open: m.open, close: m.close });
      if (!unmasked.intact && m.tokens.length > 0 && unmasked.missingCount / m.tokens.length > 0.34) {
        return texts[idx];
      }
      return unmasked.text;
    });
  }

  async function translateSegment({ text, targetLang: reqLang, context = '', engine: reqEngine, baseUrl: reqBaseUrl, model: reqModel, skipCache = false, onDelta, signal } = {}) {
    const clean = normalizePromptText(text);
    const cfg = resolveConfig({ targetLang: reqLang, engine: reqEngine, baseUrl: reqBaseUrl, model: reqModel });
    if (shouldSkipTranslation(clean, cfg.targetLang)) {
      return { text: clean, provider: 'skipped', cached: false, skipped: true };
    }
    const scope = `${cfg.engine}:${cfg.baseUrl}:${cfg.model}`;
    const key = cacheKeyFor(scope, cfg.targetLang, clean, (cfg.engine === 'openai' || cfg.engine === 'gemini') ? context : '');
    if (!skipCache) {
      const hit = getCached(key);
      if (hit) return { text: hit.text, provider: hit.provider, cached: true, skipped: false };
    }
    const apiKey = readApiKey({ engine: cfg.engine, baseUrl: cfg.baseUrl });
    let translated;
    if (cfg.engine === 'openai') {
      translated = await translateOpenAi(clean, { ...cfg, context, apiKey, onDelta, signal });
    } else if (cfg.engine === 'gemini') {
      translated = await translateGemini(clean, { ...cfg, context, apiKey, onDelta, signal });
    } else {
      const [itemText] = await translateOfficialMtBatch([clean], cfg.engine, { ...cfg, apiKey, signal });
      translated = itemText;
      onDelta?.(translated);
    }
    putCached(key, translated, cfg.engine);
    return { text: translated, provider: cfg.engine, cached: false, skipped: false };
  }

  function cacheKeyFor(scope, targetLang, clean, context) {
    return makeCacheKey(scope, targetLang, clean, context);
  }

  async function translateBatch({ items = [], targetLang: reqLang, signal } = {}) {
    const list = Array.isArray(items) ? items.slice(0, 40) : [];
    const results = new Array(list.length);
    const cfg = resolveConfig({ targetLang: reqLang });
    const scope = `${cfg.engine}:${cfg.baseUrl}:${cfg.model}`;

    if (cfg.engine === 'google' || cfg.engine === 'azure') {
      const pending = [];
      for (let i = 0; i < list.length; i++) {
        const raw = list[i];
        const id = typeof raw?.id === 'string' ? raw.id : String(i);
        const text = normalizePromptText(typeof raw?.text === 'string' ? raw.text : '');
        if (shouldSkipTranslation(text, cfg.targetLang)) {
          results[i] = { id, text, provider: 'skipped', cached: false, skipped: true };
          continue;
        }
        const key = makeCacheKey(scope, cfg.targetLang, text);
        const hit = getCached(key);
        if (hit) {
          results[i] = { id, text: hit.text, provider: hit.provider, cached: true, skipped: false };
        } else {
          pending.push({ idx: i, id, text, key });
        }
      }
      const apiKey = readApiKey({ engine: cfg.engine, baseUrl: cfg.baseUrl });
      let pos = 0;
      while (pos < pending.length) {
        if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
        const chunk = [];
        let chars = 0;
        while (pos < pending.length && chunk.length < MT_BATCH_MAX_ITEMS) {
          const itemLen = pending[pos].text.length;
          if (chunk.length > 0 && chars + itemLen > MT_BATCH_MAX_CHARS) break;
          chars += itemLen;
          chunk.push(pending[pos++]);
        }
        try {
          const translatedTexts = await translateOfficialMtBatch(chunk.map(c => c.text), cfg.engine, { ...cfg, apiKey, signal });
          for (let j = 0; j < chunk.length; j++) {
            const out = translatedTexts[j];
            putCached(chunk[j].key, out, cfg.engine);
            results[chunk[j].idx] = { id: chunk[j].id, text: out, provider: cfg.engine, cached: false, skipped: false };
          }
        } catch (error) {
          if (isAbortError(error) && signal?.aborted) throw error;
          for (const entry of chunk) {
            results[entry.idx] = { id: entry.id, text: entry.text, error: error.message || '翻译失败' };
          }
        }
      }
      return { results };
    }

    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
        const idx = cursor++;
        const raw = list[idx];
        const id = typeof raw?.id === 'string' ? raw.id : String(idx);
        const text = typeof raw?.text === 'string' ? raw.text : '';
        try {
          const out = await translateSegment({ text, targetLang: cfg.targetLang, engine: cfg.engine, signal });
          results[idx] = { id, ...out };
        } catch (error) {
          if (isAbortError(error) && signal?.aborted) throw error;
          results[idx] = { id, text, error: error.message || '翻译失败' };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, Math.max(1, list.length)) }, worker));
    return { results };
  }

  async function testConnection({ engine, baseUrl, model, targetLang } = {}) {
    const cfg = resolveConfig({ engine, baseUrl, model, targetLang });
    const sample = 'Verifying `lib/native-ui.js#L10-L20` with `--dry-run` before continuing.';
    const targetLangClean = cfg.targetLang === 'en' ? 'zh-CN' : cfg.targetLang;
    const startedAt = Date.now();
    let streamed = '';
    const apiKey = readApiKey({ engine: cfg.engine, baseUrl: cfg.baseUrl });
    let text = '';
    if (cfg.engine === 'openai') {
      text = await translateOpenAi(sample, { ...cfg, targetLang: targetLangClean, apiKey, onDelta: c => { streamed += c; } }) || streamed;
    } else if (cfg.engine === 'gemini') {
      text = await translateGemini(sample, { ...cfg, targetLang: targetLangClean, apiKey, onDelta: c => { streamed += c; } }) || streamed;
    } else {
      const [out] = await translateOfficialMtBatch([sample], cfg.engine, { ...cfg, targetLang: targetLangClean, apiKey });
      text = out;
    }
    return {
      ok: true,
      engine: cfg.engine,
      provider: cfg.engine,
      latencyMs: Math.max(1, Date.now() - startedAt),
      sample: text
    };
  }

  function dispose() {
    secretCache.clear();
    flushCache();
  }

  return {
    translateSegment,
    translateBatch,
    testConnection,
    status,
    setSecret,
    clearCache,
    dispose
  };
}
