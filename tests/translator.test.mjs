import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TRANSLATION_ENGINES,
  createTranslatorStore,
  isValidTranslationBaseUrl,
  isValidTranslationModel,
  maskApiKey,
  maskTechnicalTokens,
  normalizeTranslationBaseUrl,
  resolveTranslationSecretScope,
  shouldSkipTranslation,
  stripTranslationBaseUrlSecrets,
  unmaskTechnicalTokens
} from '../lib/translator.mjs';

function makeMockVault({ supported = true, backend = 'linux-secret-service', reason = '' } = {}) {
  const entries = new Map();
  return {
    entries,
    supported,
    backend,
    probe: () => ({ supported, backend, reason }),
    secretTargetFor: (ns, keyId) => `agy-powertools:secret:${ns}:${keyId}`,
    readSecret(target) {
      if (!supported) return { ok: false, exists: false, value: '', error: reason || 'unsupported' };
      const value = entries.get(target);
      return value ? { ok: true, exists: true, value } : { ok: true, exists: false, value: '' };
    },
    writeSecret(target, value) {
      if (!supported) return { ok: false, error: reason || 'unsupported' };
      entries.set(target, value);
      return { ok: true };
    },
    remove(target) {
      entries.delete(target);
      return { ok: true };
    }
  };
}

function makeSseResponse(events, { status = 200, contentType = 'text/event-stream' } = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const ev of events) controller.enqueue(encoder.encode(ev));
      controller.close();
    }
  });
  return new Response(stream, { status, headers: { 'Content-Type': contentType } });
}

test('shouldSkipTranslation skips localized text and short tokens across 8 non-English locales while keeping English logs', () => {
  assert.equal(shouldSkipTranslation('', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('Checking the config', 'en'), true);
  assert.equal(shouldSkipTranslation('正在同步检查当前工作区状态。', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('Analyzed `lib/native-ui.js#L1-L20`', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('設定ファイルとテストを確認しています。', 'ja'), true);
  assert.equal(shouldSkipTranslation('구성 파일과 테스트를 확인하는 중입니다.', 'ko'), true);
  assert.equal(shouldSkipTranslation('Проверяем конфигурацию и результаты тестов.', 'ru'), true);
  assert.equal(shouldSkipTranslation('Đang kiểm tra cấu hình và chạy bộ kiểm thử.', 'vi'), true);
  assert.equal(shouldSkipTranslation('Checking configuration and running verification suite.', 'vi'), false);
  assert.equal(shouldSkipTranslation('Checking package.json', 'zh-CN'), false);
  assert.equal(shouldSkipTranslation('Compare symbols/strings cleanly.', 'zh-CN'), false);
  assert.equal(shouldSkipTranslation('Checking configuration and running verification suite.', 'fr'), false);
  // Already-localized technical paragraphs with 5+ bare English acronyms must be skipped cleanly
  assert.equal(
    shouldSkipTranslation(
      '对比 LINEAR 与 AFBC 两次 VDI 日志已证实：连续 AFBC 帧稳定在第二帧触发约 `151 ms` 内核提交阻塞（与 LINEAR 下 DPU 和 uevent 告警形成反差），并同步排查 Mali 栅栏契约。',
      'zh-CN'
    ),
    true
  );
  // Short CJK prefix + English payload still gets translated
  assert.equal(shouldSkipTranslation('已运行 run cadence probe diagnostic with dynamic HDC verification', 'zh-CN'), false);
  // Nested 4-backtick code fences and standalone JSON objects must skip translation
  assert.equal(shouldSkipTranslation('````json\n{"edits":[{"target":"Run tests with ```inner``` note"}]}\n````', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('{"bestEffort":true,"cwd":"/repo","edits":[{"target":"Run integration suite now"}]}', 'zh-CN'), true);
});

test('maskTechnicalTokens protects code, paths, flags, constants, and preserves English slash pairs', () => {
  const plain = maskTechnicalTokens('Compare symbols/strings and check read/write.');
  assert.deepEqual(plain.tokens, []);

  const input = 'Inspect lib/native-ui.js, ~/foo/bar, ./a/b, /etc/hosts, stage2_probe/run, foo\\bar, SKILL.md#L1-243, --dry-run=1, MAX_CACHE, @coord, #52, v2.16.10 and:\n```js\nconst a = 1;\n```';
  const { masked, tokens, open, close } = maskTechnicalTokens(input);
  assert.ok(tokens.includes('lib/native-ui.js'));
  assert.ok(tokens.includes('~/foo/bar'));
  assert.ok(tokens.includes('--dry-run=1'));
  assert.ok(tokens.includes('MAX_CACHE'));
  assert.equal(masked.includes('MAX_CACHE'), false);

  const restored = unmaskTechnicalTokens(masked.replace(`${open}0${close}`, `${open} 0 ${close}`), tokens, { open, close });
  assert.equal(restored.intact, true);
  assert.equal(restored.text, input);
  assert.equal(unmaskTechnicalTokens('incomplete', tokens, { open, close }).intact, false);
});

test('validators restrict official engines, reject query/auth URLs, and scope secrets by (engine, origin)', () => {
  assert.deepEqual([...TRANSLATION_ENGINES], ['openai', 'gemini', 'google', 'azure']);
  assert.equal(isValidTranslationBaseUrl(''), true);
  assert.equal(isValidTranslationBaseUrl('https://translation.googleapis.com/language/translate/v2'), true);
  assert.equal(normalizeTranslationBaseUrl(' https://api.openai.com/v1/// '), 'https://api.openai.com/v1');
  assert.equal(isValidTranslationBaseUrl('https://api.openai.com/v1?api_key=leak'), false);
  assert.equal(isValidTranslationBaseUrl('https://api.openai.com/v1#frag'), false);
  assert.equal(isValidTranslationBaseUrl('https://user:pass@example.com/v1'), false);
  assert.equal(isValidTranslationBaseUrl('ftp://example.com/v1'), false);
  assert.deepEqual(stripTranslationBaseUrlSecrets('https://user:pass@api.example.com/v1?key=secret#frag'), {
    url: 'https://api.example.com/v1',
    stripped: true
  });

  assert.equal(resolveTranslationSecretScope({ engine: 'free' }), null);
  const scopeOpenAi = resolveTranslationSecretScope({ engine: 'openai', baseUrl: 'https://api.openai.com/v1' });
  const scopeGoogle = resolveTranslationSecretScope({ engine: 'google' });
  const scopeAzure = resolveTranslationSecretScope({ engine: 'azure' });
  assert.equal(scopeGoogle.origin, 'https://translation.googleapis.com');
  assert.equal(scopeAzure.origin, 'https://api.cognitive.microsofttranslator.com');
  assert.notEqual(scopeOpenAi.keyId, scopeGoogle.keyId);
  assert.equal(isValidTranslationModel('bad model'), false);
  assert.equal(maskApiKey('sk-proj-abcdefgh1234'), 'sk-***1234');
});

test('OpenAI and Gemini official streaming protocols emit deltas, enforce errors & AbortSignal, and persist disk LRU cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tr-llm-'));
  try {
    let settings = {
      language: 'zh-CN',
      detailTranslationEngine: 'openai',
      detailTranslationBaseUrl: 'https://api.example.com/v1',
      detailTranslationModel: 'gpt-4o-mini'
    };
    const requests = [];
    const fetchMock = async (url, init) => {
      if (init?.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      const u = String(url);
      requests.push({ url: u, headers: init?.headers || {}, body: init?.body || '', redirect: init?.redirect });
      if (u.includes('fail.example.com')) {
        return new Response(JSON.stringify({ error: { message: 'Invalid key' } }), { status: 401 });
      }
      if (u.includes('/chat/completions')) {
        return makeSseResponse([
          'data: {"choices":[{"delta":{"content":"正在检查 "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"`lib/settings.mjs` 逻辑。"}}]}\n\n',
          'data: [DONE]\n\n'
        ]);
      }
      if (u.includes(':streamGenerateContent')) {
        return makeSseResponse([
          'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"skip"},{"text":"已验证 `package.json` 字段。"}]}}]}\n\n'
        ]);
      }
      throw new Error(`Unexpected URL: ${u}`);
    };

    const vault = makeMockVault();
    const store = createTranslatorStore(dir, { getSettings: () => settings, fetchImpl: fetchMock, vault });
    assert.equal(store.setSecret({ apiKey: 'sk-test-secret-9988' }).secretOrigin, 'https://api.example.com');
    assert.equal(existsSync(join(dir, 'translation-secrets.json')), false);

    const deltas = [];
    const oaRes = await store.translateSegment({ text: 'Inspecting `lib/settings.mjs` logic.', context: '上文。', onDelta: c => deltas.push(c) });
    assert.equal(oaRes.provider, 'openai');
    assert.equal(oaRes.text, '正在检查 `lib/settings.mjs` 逻辑。');
    assert.deepEqual(deltas, ['正在检查 ', '`lib/settings.mjs` 逻辑。']);
    assert.equal(requests[0].headers.Authorization, 'Bearer sk-test-secret-9988');

    settings = { ...settings, language: 'fr', detailTranslationEngine: 'gemini', detailTranslationBaseUrl: '', detailTranslationModel: 'gemini-2.5-flash' };
    assert.equal(store.status().hasApiKey, false);
    store.setSecret({ apiKey: 'gm-gemini-secret-1122' });
    const gemRes = await store.translateSegment({ text: 'Verified `package.json` fields.' });
    assert.equal(gemRes.provider, 'gemini');
    assert.equal(requests[1].headers['x-goog-api-key'], 'gm-gemini-secret-1122');
    assert.equal(requests[0].redirect, 'error');
    assert.equal(requests[1].redirect, 'error');

    // No silent fallback to unofficial scraping on error
    settings = { ...settings, detailTranslationEngine: 'openai', detailTranslationBaseUrl: 'https://fail.example.com/v1' };
    await assert.rejects(() => store.translateSegment({ text: 'Check error surfacing.' }), /401: Invalid key/);
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(() => store.translateSegment({ text: 'Abort cleanly.', signal: ac.signal }), err => err.name === 'AbortError');
    store.dispose();

    const store2 = createTranslatorStore(dir, {
      getSettings: () => ({ language: 'zh-CN', detailTranslationEngine: 'openai', detailTranslationBaseUrl: 'https://api.example.com/v1', detailTranslationModel: 'gpt-4o-mini' }),
      fetchImpl: async () => { throw new Error('Should not hit network on disk cache hit'); },
      vault
    });
    const hit = await store2.translateSegment({ text: 'Inspecting `lib/settings.mjs` logic.', context: '上文。' });
    assert.equal(hit.cached, true);
    assert.deepEqual(store2.clearCache(), { ok: true, cacheEntries: 0 });
    store2.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('official Google Cloud v2 and Azure AI Translator v3 use official auth headers and native array batching across 8 locales', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tr-official-mt-'));
  try {
    const seen = [];
    const tokensOf = s => (String(s || '').match(/⟦\d+⟧/g) || []).join(' ');
    const fetchMock = async (url, init) => {
      const target = String(url);
      const body = JSON.parse(init?.body || '{}');
      seen.push({ url: target, headers: init?.headers || {}, body, redirect: init?.redirect });
      if (target.includes('translation.googleapis.com/language/translate/v2')) {
        return new Response(JSON.stringify({
          data: { translations: (body.q || []).map(q => ({ translatedText: `gc(${body.target}) ${tokensOf(q)} ok` })) }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (target.includes('api.cognitive.microsofttranslator.com/translate')) {
        const to = new URL(target).searchParams.get('to');
        return new Response(JSON.stringify(
          (body || []).map(item => ({ translations: [{ text: `az(${to}) ${tokensOf(item.Text)} ok` }] }))
        ), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected URL: ${target}`);
    };

    let settings = { language: 'zh-CN', detailTranslationEngine: 'google', detailTranslationBaseUrl: '', detailTranslationModel: '' };
    const vault = makeMockVault();
    const store = createTranslatorStore(dir, { getSettings: () => settings, fetchImpl: fetchMock, vault });

    await assert.rejects(() => store.translateSegment({ text: 'Checking cloud key guard.' }), /Google Cloud 翻译需要配置 API Key/);
    store.setSecret({ apiKey: 'gc-official-key-5566', engine: 'google' });
    const gBatch = await store.translateBatch({
      items: [
        { id: '0', text: 'Running unit tests on `lib/translator.mjs` now' },
        { id: '1', text: '已是中文无需翻译。' },
        { id: '2', text: 'Updating pipeline config for `--dry-run`' }
      ],
      targetLang: 'zh-TW'
    });
    assert.equal(seen.length, 1, 'Google Cloud must send uncached items in ONE native array POST');
    assert.equal(seen[0].headers['X-Goog-Api-Key'], 'gc-official-key-5566');
    assert.equal(gBatch.results[0].text, 'gc(zh-TW) `lib/translator.mjs` ok');
    assert.equal(gBatch.results[1].skipped, true);
    assert.equal(gBatch.results[2].text, 'gc(zh-TW) `--dry-run` ok');

    settings = { language: 'zh-TW', detailTranslationEngine: 'azure', detailTranslationBaseUrl: '', detailTranslationModel: 'eastasia' };
    await assert.rejects(() => store.translateSegment({ text: 'Checking Azure key guard.' }), /Azure 翻译需要配置 API Key/);
    store.setSecret({ apiKey: 'az-official-key-7788', engine: 'azure' });
    const aBatch = await store.translateBatch({
      items: [
        { id: 'a', text: 'Inspecting workspace files carefully' },
        { id: 'b', text: 'Verifying `package.json` schema' }
      ],
      targetLang: 'zh-TW'
    });
    assert.equal(seen[1].headers['Ocp-Apim-Subscription-Key'], 'az-official-key-7788');
    assert.equal(seen[1].headers['Ocp-Apim-Subscription-Region'], 'eastasia');
    assert.ok(seen[1].url.includes('to=zh-Hant'));
    assert.equal(aBatch.results[0].provider, 'azure');
    assert.equal(aBatch.results[1].text, 'az(zh-Hant) `package.json` ok');

    assert.equal(seen[0].redirect, 'error');
    assert.equal(seen[1].redirect, 'error');
    const tested = await store.testConnection({ engine: 'google', targetLang: 'ja' });
    assert.equal(tested.ok, true);
    assert.equal(tested.provider, 'google');
    assert.ok(tested.sample.includes('`lib/native-ui.js#L10-L20`'));
    store.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('endpoint secrets isolate per origin, reject query/auth hijack, fail closed on unsupported vault, and route via createProxyFetcher', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tr-vault-iso-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'agy-tr-proxy-home-'));
  try {
    const vault = makeMockVault();
    const requests = [];
    let curSettings = { language: 'zh-CN', detailTranslationEngine: 'openai', detailTranslationBaseUrl: 'https://api.openai.com/v1', detailTranslationModel: 'gpt-4o-mini' };
    const fetchMock = async (url, init) => {
      requests.push({ url: String(url), auth: init?.headers?.Authorization || '' });
      return makeSseResponse(['data: {"choices":[{"delta":{"content":"已验证响应。"}}]}\n\n', 'data: [DONE]\n\n']);
    };

    const store = createTranslatorStore(dir, { getSettings: () => curSettings, fetchImpl: fetchMock, vault });
    store.setSecret({ apiKey: 'sk-openai-real-1111' });
    await store.translateSegment({ text: 'Checking OpenAI endpoint.', skipCache: true });
    assert.equal(requests.at(-1).auth, 'Bearer sk-openai-real-1111');

    curSettings = { ...curSettings, detailTranslationBaseUrl: 'https://attacker.example.com/v1' };
    assert.equal(store.status().hasApiKey, false);
    await store.translateSegment({ text: 'Checking isolated endpoint.', skipCache: true });
    assert.equal(requests.at(-1).auth, '');
    assert.throws(() => store.setSecret({ apiKey: 'sk-x', engine: 'openai', baseUrl: 'https://api.openai.com/v1?api_key=leak' }), /无效的接口地址/);
    store.dispose();

    const unsupportedStore = createTranslatorStore(dir, {
      getSettings: () => curSettings,
      fetchImpl: fetchMock,
      vault: makeMockVault({ supported: false, backend: 'unsupported', reason: 'no keychain' })
    });
    assert.equal(unsupportedStore.status().vaultSupported, false);
    assert.throws(() => unsupportedStore.setSecret({ apiKey: 'sk-refuse' }), /no keychain/);
    assert.equal(existsSync(join(dir, 'translation-secrets.json')), false);
    unsupportedStore.dispose();

    const fakeDataDir = join(homeDir, '.gemini', 'antigravity', 'plugin_data', 'agy-powertools');
    mkdirSync(fakeDataDir, { recursive: true });
    let proxyHit = false;
    const httpProxy = await new Promise(resolve => {
      const srv = net.createServer(sock => { proxyHit = true; sock.destroy(); });
      srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, close: () => new Promise(r => srv.close(r)) }));
    });
    writeFileSync(join(fakeDataDir, 'settings.json'), JSON.stringify({ proxyEnabled: true, proxyUrl: `http://127.0.0.1:${httpProxy.port}` }));
    const proxiedStore = createTranslatorStore(dir, {
      home: homeDir,
      getSettings: () => ({ language: 'zh-CN', detailTranslationEngine: 'openai', detailTranslationBaseUrl: 'https://api.proxy-translator.test/v1', detailTranslationModel: 'gpt-4o-mini' }),
      vault
    });
    await assert.rejects(() => proxiedStore.translateSegment({ text: 'Proxy tunnel attempted before error.' }));
    assert.equal(proxyHit, true, 'default translator store must route HTTPS through createProxyFetcher');
    proxiedStore.dispose();
    await httpProxy.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('translator.status fails closed on malformed URLs and surfaces Gemini array and JSON-worded errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tr-status-guard-'));
  try {
    const vault = makeMockVault();
    let mode = 'array-429';
    const fetchMock = async () => {
      if (mode === 'array-429') {
        return new Response(JSON.stringify([{ error: { message: 'Quota exceeded for quota metric' } }]), {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (mode === 'json-word-plain') {
        return new Response(JSON.stringify({ error: { message: 'Invalid JSON payload received by upstream' } }), {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      return new Response(JSON.stringify({ error: { message: 'Invalid JSON payload in 200 JSON response' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const store = createTranslatorStore(dir, {
      getSettings: () => ({
        language: 'zh-CN',
        detailTranslationEngine: 'openai',
        detailTranslationBaseUrl: 'https://api.openai.com/v1',
        detailTranslationModel: 'gpt-4o-mini'
      }),
      fetchImpl: fetchMock,
      vault
    });
    store.setSecret({ apiKey: 'sk-openai-saved-1234', engine: 'openai', baseUrl: 'https://api.openai.com/v1' });
    assert.equal(store.status({ engine: 'openai', baseUrl: 'https://api.openai.com/v1' }).hasApiKey, true);

    // Malformed / partial Base URLs must NEVER fall back to OpenAI secret status.
    for (const bad of [
      { engine: 'azure', baseUrl: 'https://' },
      { engine: 'google', baseUrl: 'https://api.example.com/v2?key=leak' },
      { engine: 'gemini', baseUrl: 'http://invalid host' }
    ]) {
      const st = store.status(bad);
      assert.equal(st.hasApiKey, false, `${bad.engine} with malformed URL must report hasApiKey=false`);
      assert.equal(st.maskedKey, '');
      assert.equal(st.secretOrigin, '');
    }

    store.setSecret({ apiKey: 'gm-key-1234', engine: 'gemini' });
    await assert.rejects(
      () => store.translateSegment({ text: 'Check array error extraction.', engine: 'gemini', skipCache: true }),
      /Gemini HTTP 429: Quota exceeded for quota metric/
    );

    mode = 'json-word-plain';
    await assert.rejects(
      () => store.translateSegment({ text: 'Check error containing JSON word.', engine: 'gemini', skipCache: true }),
      /Invalid JSON payload received by upstream/
    );
    mode = 'json-200';
    await assert.rejects(
      () => store.translateSegment({ text: 'Check 200 JSON error.', engine: 'gemini', skipCache: true }),
      /Invalid JSON payload in 200 JSON response/
    );
    store.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
