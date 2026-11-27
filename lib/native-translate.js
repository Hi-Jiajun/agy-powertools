(() => {
  const TOOL_TERMINAL_SKIP = '[data-testid*="terminal"]:not([data-testid="overview-panel-row-terminal"]):not([data-testid="aux-pane-terminals-section"]):not([data-testid="toggle-bottom-terminal-panel"]):not([data-testid="bottom-terminal-panel-new"]):not([data-testid="bottom-terminal-panel-close"]):not([data-testid="terminal-add-button"]):not([data-testid="new-tab-card-new-terminal"])';
  const TOOL_SKIP_BG_TASK_SELECTOR = `[data-agy-powertools-root],[data-agy-translate-root],[data-agy-translate-hidden],[data-agy-management-page],[data-testid="user-input-step"],[data-testid="agent-input-box"],[data-testid="worked-for-collapsible"],[data-testid="agy-completion-tools-toggle"],[data-testid="agy-response-actions"],[data-testid="turn-cards-container"],[data-testid="changed-files-card"],[data-testid="thinking-collapsible-trigger"],[data-testid="planner-response-text"],[data-testid="progress-update-response-text"],[data-testid="planner-response-debug-error"],[data-markdown-root],pre,code,kbd,samp,script,style,svg,textarea,input,[contenteditable],.monaco-editor,.monaco-diff-editor,.view-lines,.cm-editor,.cm-content,.xterm,.code-block,.shiki,.hljs,[data-testid*="diff"],${TOOL_TERMINAL_SKIP},[data-testid*="code-viewer"],[data-testid*="file-viewer"],a[href^="file:"]`;
  const TOOL_SKIP_SELECTOR = `${TOOL_SKIP_BG_TASK_SELECTOR},.font-mono`;
  const BLOCK_CODE_SKIP_SELECTOR = 'pre,code,kbd,samp,script,style';
  const TECHNICAL_TOKEN_RE = /(`{3,}|~{3,})[\s\S]*?\1|`[^`\r\n]+`|https?:\/\/[^\s)>"'`\],;]+(?<![.,;:])|(?:(?<=^|[\s(\["'`=:,])(?:~|\.{1,2})?\/(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\/)*(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_.-]+\/){2,}(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_.-]+\\)+(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_-]*[0-9_.-][a-zA-Z0-9_.-]*\/(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)|[a-zA-Z0-9_.-]+\/(?:[a-zA-Z0-9_-]*[0-9_-][a-zA-Z0-9_.-]*|[a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+))(?:#L\d+(?:-L?\d+)?)?|[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+#L\d+(?:-L?\d+)?)|\b[a-zA-Z0-9_-]+\.(?:[mc]?js|tsx?|jsx?|py|go|rs|java|c|cpp|h|hpp|json|ya?ml|toml|md|css|scss|html|sh|bash|zsh|ps1|log|txt|sql|vue|svelte|mjs|cjs|mts|cts)(?:#L\d+(?:-L?\d+)?)?\b|(?:^|(?<=[\s(,]))--[a-zA-Z0-9][a-zA-Z0-9_-]*(?:=[^\s,;)]+)?|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|@[a-zA-Z0-9_.-]+|#\d+\b|\bv\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?\b/g;
  const SHELL_CMD_PREFIX_RE = /^(?:sudo|env|nohup|bash|sh|zsh|fish|pwsh|node|npm|npx|pnpm|yarn|bun|deno|python\d*|pip\d*|pytest|uv|cargo|rustc|git|gh|rg|fd|grep|sed|awk|cat|curl|wget|ssh|scp|rsync|docker|kubectl|cmake|ninja|systemctl|journalctl|pkill|lsof|netstat|chmod|chown|mkdir)(?:\s|$)|^(?:[A-Z_][A-Z0-9_]*=\S+\s+|(?:~|\.\.?|\/)[^\s]+\/)|&&|\|\||\$\(|\s(?:--[a-zA-Z0-9_-]+|-[a-zA-Z]{1,3}\b)/;
  const LEADING_ACTION_VERB_RE = /^(?:check|read|edit|updat|creat|delet|remov|verif|test|build|runn|ran|start|stopp|install|compil|search|explor|list|inspect|fetch|load|writ|pars|patch|fix|debug|reinstall|rebuild|restart|sync|wait|ask|open|clos|generat|format|lint|migrat|deploy|configur|monitor|prob|scann|watch|upgrad|download|upload|clean)/i;
  const isLikelyShellCommand = text => Boolean(String(text || '').trim()) && SHELL_CMD_PREFIX_RE.test(String(text || '').trim());

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

  function shouldSkipTranslation(text, targetLang = 'zh-CN') {
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

  function sliceThinkingParagraphs(rawText, processedOffset = 0, isStreaming = false, { forceFlushTail = false } = {}) {
    const normalized = String(rawText || '').replace(/\r\n/g, '\n');
    if (!normalized || processedOffset >= normalized.length) {
      return { committed: [], nextOffset: normalized.length, pendingTail: '' };
    }
    const tail = normalized.slice(processedOffset);
    const lines = tail.split('\n');
    let inFence = false;
    let fenceChar = '';
    let fenceLen = 0;
    let paraStart = 0;
    let contentSeen = false;
    let blankRunStart = -1;
    let offset = 0;
    let lastCommittedEnd = 0;
    const committed = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = offset;
      const lineEnd = offset + line.length + (i < lines.length - 1 ? 1 : 0);
      offset = lineEnd;
      const trimmed = line.trimStart();
      const fenceMatch = /^(```+|~~~+)/.exec(trimmed);
      if (!inFence && trimmed === '') {
        if (contentSeen && blankRunStart < 0) blankRunStart = lineStart;
        continue;
      }
      if (!inFence && blankRunStart >= 0 && contentSeen) {
        const chunk = tail.slice(paraStart, blankRunStart).trim();
        if (chunk) committed.push(chunk);
        paraStart = lineStart;
        lastCommittedEnd = lineStart;
      }
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        const markerLen = fenceMatch[1].length;
        if (!inFence) { inFence = true; fenceChar = marker; fenceLen = markerLen; }
        else if (marker === fenceChar && markerLen >= fenceLen && trimmed.slice(markerLen).trim() === '') {
          inFence = false; fenceChar = ''; fenceLen = 0;
        }
      }
      contentSeen = true;
      blankRunStart = -1;
    }

    const remainder = tail.slice(lastCommittedEnd);
    const trimmedRem = remainder.trim();
    if (!isStreaming || forceFlushTail) {
      if (trimmedRem) committed.push(trimmedRem);
      return { committed, nextOffset: normalized.length, pendingTail: '' };
    }
    if (!inFence && blankRunStart >= paraStart && contentSeen && lineEndsWithBlank(tail)) {
      const chunk = tail.slice(paraStart, blankRunStart).trim();
      if (chunk) committed.push(chunk);
      return { committed, nextOffset: normalized.length, pendingTail: '' };
    }
    return { committed, nextOffset: processedOffset + lastCommittedEnd, pendingTail: trimmedRem };
  }

  function lineEndsWithBlank(text) {
    return /\n\s*\n\s*$/.test(text);
  }

  function isSafeHref(url) {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function appendInlineNodes(doc, parent, text) {
    const tokenRe = /`([^`\r\n]+)`|\*\*([^*\r\n]+)\*\*|\*([^*\r\n]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let last = 0;
    let m;
    const appendPlain = s => {
      if (s) parent.append(doc.createTextNode ? doc.createTextNode(s) : s);
    };
    while ((m = tokenRe.exec(text))) {
      if (m.index > last) appendPlain(text.slice(last, m.index));
      if (m[1] != null) {
        const code = doc.createElement('code');
        code.className = 'agy-tr-code';
        code.textContent = m[1];
        parent.append(code);
      } else if (m[2] != null) {
        const strong = doc.createElement('strong');
        strong.textContent = m[2];
        parent.append(strong);
      } else if (m[3] != null) {
        const em = doc.createElement('em');
        em.textContent = m[3];
        parent.append(em);
      } else if (m[4] != null && m[5] != null && isSafeHref(m[5])) {
        const link = doc.createElement('a');
        link.className = 'agy-tr-link';
        link.setAttribute('href', m[5]);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        link.textContent = m[4];
        parent.append(link);
      } else {
        appendPlain(m[0]);
      }
      last = tokenRe.lastIndex;
    }
    if (last < text.length) appendPlain(text.slice(last));
  }

  function clearChildren(el) {
    if (!el) return;
    if (typeof el.replaceChildren === 'function') { el.replaceChildren(); return; }
    while (el.firstChild) {
      if (typeof el.firstChild.remove === 'function') el.firstChild.remove();
      else if (typeof el.removeChild === 'function') el.removeChild(el.firstChild);
      else break;
    }
  }

  function renderMarkdownInto(doc, container, markdown) {
    clearChildren(container);
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length;) {
      const trimmed = lines[i].trim();
      if (!trimmed) { i++; continue; }
      const fence = /^(```+|~~~+)/.exec(trimmed);
      if (fence) {
        const fenceChar = fence[1][0];
        const fenceLen = fence[1].length;
        const codeLines = [];
        for (i++; i < lines.length; i++) {
          const curTrim = lines[i].trimStart();
          const closeMatch = fenceChar === '`' ? /^(`{3,})/.exec(curTrim) : /^(~{3,})/.exec(curTrim);
          if (closeMatch && closeMatch[1].length >= fenceLen && curTrim.slice(closeMatch[1].length).trim() === '') {
            i++;
            break;
          }
          codeLines.push(lines[i]);
        }
        const pre = doc.createElement('pre');
        pre.className = 'agy-tr-pre';
        const code = doc.createElement('code');
        code.textContent = codeLines.join('\n');
        pre.append(code);
        container.append(pre);
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        const p = doc.createElement('p');
        p.className = 'agy-tr-heading';
        const strong = doc.createElement('strong');
        appendInlineNodes(doc, strong, heading[2]);
        p.append(strong);
        container.append(p);
        i++;
        continue;
      }
      if (/^>\s?/.test(trimmed)) {
        const bq = doc.createElement('blockquote');
        bq.className = 'agy-tr-quote';
        const qLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) qLines.push(lines[i++].trim().replace(/^>\s?/, ''));
        appendInlineNodes(doc, bq, qLines.join(' '));
        container.append(bq);
        continue;
      }
      if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        const ordered = /^\d+\.\s+/.test(trimmed);
        const list = doc.createElement(ordered ? 'ol' : 'ul');
        list.className = 'agy-tr-list';
        const itemRe = ordered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/;
        while (i < lines.length) {
          const match = itemRe.exec(lines[i].trim());
          if (!match) break;
          const li = doc.createElement('li');
          appendInlineNodes(doc, li, match[1]);
          list.append(li);
          i++;
        }
        container.append(list);
        continue;
      }
      const paraLines = [];
      while (i < lines.length) {
        const curTrim = lines[i].trim();
        if (!curTrim || /^(```+|~~~+|#{1,6}\s+|>\s?|[-*]\s+|\d+\.\s+)/.test(curTrim)) break;
        paraLines.push(lines[i++].trimEnd());
      }
      const p = doc.createElement('p');
      p.className = 'agy-tr-p';
      appendInlineNodes(doc, p, paraLines.join('\n'));
      container.append(p);
    }
  }

  function extractDomMarkdownText(root) {
    if (!root) return '';
    const pieces = [];
    const walk = node => {
      if (!node) return;
      if (node.nodeType === 3) { pieces.push(node.nodeValue || ''); return; }
      if (node.nodeType !== 1) return;
      const tag = String(node.tagName || '').toUpperCase();
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'SVG') return;
      if (tag === 'PRE') {
        const rawCode = node.textContent || '';
        const runs = rawCode.match(/`+/g) || [];
        const maxTicks = Math.max(2, ...runs.map(r => r.length));
        const fence = '`'.repeat(maxTicks + 1);
        pieces.push(`\n${fence}\n${rawCode}\n${fence}\n`);
        return;
      }
      if (tag === 'CODE') { pieces.push('`' + (node.textContent || '') + '`'); return; }
      const isBlock = tag === 'P' || tag === 'DIV' || tag === 'LI' || tag === 'BLOCKQUOTE' || /^H[1-6]$/.test(tag);
      for (const child of node.childNodes || []) walk(child);
      if (isBlock) pieces.push('\n\n');
    };
    walk(root);
    return pieces.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  function createDetailTranslator({ doc = globalThis.document, request, getOptions, uiText } = {}) {
    if (!doc) return { sync() {}, handleEvent() {}, dispose() {} };

    let disposed = false;
    let streamSeq = 0;
    let batchSeq = 0;
    let syncTimer = null;
    let batchTimer = null;
    let styleEl = null;
    let domObserver = null;
    let lastConfigSig = '';

    const blocks = new WeakMap();
    const blockList = new Set();
    const activeStreams = new Map();
    const activeBatches = new Set();
    const segmentCache = new Map();
    const inlineOriginals = new Map();
    const pendingInlineQueue = new Map();
    let inFlightInlineNodes = new WeakMap();

    const visibleSet = new WeakSet();
    const observedTargets = new Set();
    const observedTargetStates = new WeakMap();

    function currentConfig() {
      const opts = getOptions?.() || {};
      const active = Boolean(opts.enabled && opts.detailTranslation && opts.language !== 'en');
      const targetLang = opts.language && opts.language !== 'en' ? opts.language : 'zh-CN';
      const mode = opts.detailTranslationMode === 'bilingual' ? 'bilingual' : 'replace';
      const engine = opts.detailTranslationEngine || 'openai';
      const model = opts.detailTranslationModel || '';
      const baseUrl = opts.detailTranslationBaseUrl || '';
      return { active, targetLang, mode, engine, model, baseUrl, sig: `${active}|${targetLang}|${mode}|${engine}|${baseUrl}|${model}` };
    }

    function rememberSegment(key, val) {
      if (!val?.text) return;
      segmentCache.delete(key);
      segmentCache.set(key, val);
      if (segmentCache.size > 1500) segmentCache.delete(segmentCache.keys().next().value);
    }

    function ensureStyle() {
      if (styleEl && styleEl.isConnected) return;
      if (!doc.head || typeof doc.createElement !== 'function') return;
      styleEl = doc.createElement('style');
      styleEl.dataset.agyTranslateStyle = '';
      styleEl.textContent = `
        [data-agy-translate-hidden="true"]{display:none!important}
        [data-agy-translate-pending="true"]{opacity:.84;transition:opacity 140ms ease-out}
        [data-agy-translate-bilingual-src="true"]{opacity:.62;font-size:.92em;border-left:2px solid var(--border);padding-left:8px;margin-bottom:6px}
        [data-agy-translate-root="block"]{display:flex;flex-direction:column;gap:8px;color:inherit;font-size:inherit;line-height:1.625;overflow-wrap:break-word;user-select:text}
        [data-agy-translate-root="block"] .agy-tr-segs,[data-agy-translate-root="block"] .agy-tr-seg{display:flex;flex-direction:column;gap:8px}
        html[data-agy-compact] [data-agy-translate-root="block"],html[data-agy-compact] [data-agy-translate-root="block"] .agy-tr-segs,html[data-agy-compact] [data-agy-translate-root="block"] .agy-tr-seg{line-height:1.4;gap:6px}
        [data-agy-translate-root="block"] .agy-tr-p{margin:0}
        [data-agy-translate-root="block"] strong,[data-agy-translate-root="block"] b{font-weight:600}
        [data-agy-translate-root="block"] .agy-tr-heading{margin:8px 0 4px;font-weight:600}
        [data-agy-translate-root="block"] .agy-tr-heading:first-child{margin-top:0}
        [data-agy-translate-root="block"] .agy-tr-list{margin:4px 0;padding-left:18px;display:flex;flex-direction:column;gap:2px}
        [data-agy-translate-root="block"] ul.agy-tr-list{list-style:disc}
        [data-agy-translate-root="block"] ol.agy-tr-list{list-style:decimal}
        [data-agy-translate-root="block"] .agy-tr-quote{margin:4px 0;padding-left:8px;border-left:2px solid var(--border);opacity:.9}
        [data-agy-translate-root="block"] .agy-tr-code{font-family:var(--font-mono,ui-monospace,monospace);font-size:.9em;padding:2px 4px;border-radius:4px;background:var(--muted,color-mix(in srgb,var(--secondary) 75%,transparent));color:var(--code,var(--code-foreground,inherit))}
        [data-agy-translate-root="block"] .agy-tr-pre{margin:6px 0;padding:8px 10px;border-radius:6px;background:var(--muted,color-mix(in srgb,var(--secondary) 70%,transparent));overflow:auto;font-family:var(--font-mono,ui-monospace,monospace);font-size:.88em;line-height:1.4}
        [data-agy-translate-root="block"] .agy-tr-link{color:var(--primary);text-decoration:underline;text-underline-offset:2px}
        .agy-tr-tail{margin:0;color:var(--muted-foreground);opacity:.58;white-space:pre-wrap}
        [data-agy-translate-host="true"],:has(> [data-agy-translate-root="toggle"]){position:relative}
        .agy-tr-toggle-wrap{position:absolute;top:4px;right:6px;z-index:3;display:inline-flex;align-items:center;gap:4px;opacity:0;pointer-events:none;transition:opacity 150ms ease}
        [data-agy-translate-host="true"]:hover .agy-tr-toggle-wrap,:has(> [data-agy-translate-root="toggle"]):hover > [data-agy-translate-root="toggle"],[data-agy-translate-host="true"]:focus-within .agy-tr-toggle-wrap,:has(> [data-agy-translate-root="toggle"]):focus-within > [data-agy-translate-root="toggle"],.agy-tr-toggle-wrap[data-pinned="true"]{opacity:1;pointer-events:auto}
        .agy-tr-toggle{height:18px;padding:0 6px;border-radius:5px;border:1px solid color-mix(in srgb,var(--border) 68%,transparent);background:color-mix(in srgb,var(--card,var(--muted)) 92%,transparent);color:var(--secondary-foreground,var(--foreground));font:inherit;font-size:11px;line-height:1;cursor:pointer;opacity:.92}
        .agy-tr-toggle:hover,.agy-tr-toggle:focus-visible{opacity:1;color:var(--foreground);border-color:color-mix(in srgb,var(--border) 95%,var(--foreground))}
        .agy-tr-toggle[data-showing-original="true"]{color:var(--foreground);opacity:1}
      `;
      doc.head.append(styleEl);
    }

    const TURN_FOLLOWING_ACTIVITY_SEL = '[data-testid="planner-response-text"], [data-testid="progress-update-response-text"], [data-testid="thinking-collapsible-trigger"], [data-testid="tool-group-collapsible"], [data-testid="subagent-node"], [data-testid="browser-subagent-row"], [data-testid="agent-loading"]';

    function isThinkingBlockStreaming(trigger, wrapper) {
      const trigText = (trigger?.textContent || '').trim();
      if (/^(?:Thought for \d+|思考了 \d+|Thought Process|思考过程|思考過程)/.test(trigText)) return false;
      if (wrapper?.getAttribute?.('data-streaming') === 'true') return true;
      if (trigger?.querySelector?.('.animate-spin, .animate-pulse, [data-streaming="true"]')) return true;
      return /^(?:Thinking|正在思考|思考中|Réflexion en cours|考え中|생각 중|Denkt nach|Pensando|Думает|Đang suy nghĩ|Đang suy luận)(?:\.\.\.|…)?$/i.test(trigText);
    }

    function hasFollowingActivityInTurn(el) {
      const turn = el?.closest?.('[data-testid="agent-response"]');
      if (!turn) return false;
      if (typeof el.compareDocumentPosition === 'function') {
        for (const node of turn.querySelectorAll?.(TURN_FOLLOWING_ACTIVITY_SEL) || []) {
          if (node !== el && !el.contains?.(node) && !node.contains?.(el) && (el.compareDocumentPosition(node) & 4)) return true;
        }
        return false;
      }
      let seenSelf = false;
      let found = false;
      const walk = node => {
        if (!node || found) return;
        if (node === el) { seenSelf = true; return; }
        if (seenSelf && node.nodeType === 1) {
          const tid = node.getAttribute?.('data-testid') || '';
          if (['planner-response-text', 'progress-update-response-text', 'thinking-collapsible-trigger', 'tool-group-collapsible', 'subagent-node', 'browser-subagent-row', 'agent-loading'].includes(tid)) {
            found = true;
            return;
          }
        }
        for (const child of node.children || []) walk(child);
      };
      walk(turn);
      return found;
    }

    function isNarrationStreaming(el) {
      if (!el?.isConnected) return false;
      if (el.getAttribute?.('data-streaming') === 'true') return true;
      return Boolean(el.querySelector?.('.animate-pulse, .animate-spin, [data-streaming="true"]'));
    }

    function resolveVisibleBox(el) {
      let cur = el;
      for (let d = 0; cur && d < 6; d++) {
        let isContents = false;
        try { isContents = globalThis.getComputedStyle?.(cur)?.display === 'contents'; } catch {}
        const rect = typeof cur.getBoundingClientRect === 'function' ? cur.getBoundingClientRect() : null;
        if (!isContents && rect && (rect.height > 0 || rect.width > 0)) return { target: cur, rect };
        if (!cur.parentElement || cur.parentElement === doc.body) break;
        cur = cur.parentElement;
      }
      return { target: el, rect: el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null };
    }

    const io = typeof globalThis.IntersectionObserver === 'function'
      ? new globalThis.IntersectionObserver(entries => {
          let wokeAny = false;
          for (const entry of entries) {
            if (entry.isIntersecting) { visibleSet.add(entry.target); wokeAny = true; }
            else visibleSet.delete(entry.target);
          }
          if (wokeAny && !disposed) scheduleSync(40);
        }, { rootMargin: '600px 0px' })
      : null;

    function isElementVisible(el) {
      const { target, rect } = resolveVisibleBox(el);
      if (!target?.isConnected) return false;
      if (visibleSet.has(target) || !io) return true;
      if (rect && rect.height > 0 && rect.bottom >= -600 && rect.top <= (globalThis.innerHeight || 900) + 600) {
        visibleSet.add(target);
        return true;
      }
      return false;
    }

    function unobserveTargetIfUnused(target, ignoreState = null) {
      if (!io || !target) return;
      for (const st of blockList) {
        if (st !== ignoreState && observedTargetStates.get(st) === target) return;
      }
      try { io.unobserve?.(target); } catch {}
      observedTargets.delete(target);
      visibleSet.delete(target);
    }

    function observeVisibility(el, hostKey = null) {
      if (!io || !el) return;
      const { target } = resolveVisibleBox(el);
      if (!target) return;
      const state = hostKey ? blocks.get(hostKey) : null;
      if (state) {
        const prevTarget = observedTargetStates.get(state);
        if (prevTarget && prevTarget !== target) {
          observedTargetStates.delete(state);
          unobserveTargetIfUnused(prevTarget, state);
        }
        observedTargetStates.set(state, target);
      }
      if (!observedTargets.has(target)) {
        observedTargets.add(target);
        try { io.observe(target); } catch {}
      }
    }

    function pruneDetachedObservations() {
      for (const target of [...observedTargets]) {
        if (!target?.isConnected) {
          try { io?.unobserve?.(target); } catch {}
          observedTargets.delete(target);
          visibleSet.delete(target);
        }
      }
    }

    function abortBatch(batchId) {
      if (!activeBatches.has(batchId)) return;
      activeBatches.delete(batchId);
      void request?.('translate.abort', { batchId }).catch(() => {});
    }

    function abortStream(streamId) {
      const entry = activeStreams.get(streamId);
      if (!entry) return;
      activeStreams.delete(streamId);
      void request?.('translate.abort', { streamId }).catch(() => {});
    }

    function cleanupBlockState(state) {
      if (!state) return;
      state.disposed = true;
      if (state.tailTimer) { clearTimeout(state.tailTimer); state.tailTimer = null; }
      for (const seg of state.segments) if (seg.streamId) abortStream(seg.streamId);
      const obsTarget = observedTargetStates.get(state);
      if (obsTarget) {
        observedTargetStates.delete(state);
        unobserveTargetIfUnused(obsTarget, state);
      }
      state.mountEl?.remove?.();
      state.toggleWrapEl?.remove?.();
      state.toggleAnchor?.removeAttribute?.('data-agy-translate-host');
      if (state.nativeMd) {
        state.nativeMd.removeAttribute?.('data-agy-translate-hidden');
        state.nativeMd.removeAttribute?.('data-agy-translate-pending');
        state.nativeMd.removeAttribute?.('data-agy-translate-bilingual-src');
      }
      if (state.hostEl) blocks.delete(state.hostEl);
      blockList.delete(state);
    }

    function applyBlockVisibility(state, cfg) {
      const showOrigin = Boolean(state.showOriginal);
      const hasReady = state.segments.some(s => s.renderedLen > 0 || s.status === 'done');
      if (state.toggleBtn) {
        state.toggleBtn.textContent = showOrigin ? uiText('译文', 'Translated') : uiText('原文', 'Original');
        state.toggleBtn.setAttribute('data-showing-original', showOrigin ? 'true' : 'false');
      }
      if (state.toggleWrapEl) {
        if (showOrigin) state.toggleWrapEl.setAttribute('data-pinned', 'true');
        else state.toggleWrapEl.removeAttribute('data-pinned');
      }
      if (state.nativeMd) {
        if (showOrigin) {
          state.nativeMd.removeAttribute('data-agy-translate-hidden');
          state.nativeMd.removeAttribute('data-agy-translate-pending');
          state.nativeMd.removeAttribute('data-agy-translate-bilingual-src');
        } else if (!hasReady) {
          state.nativeMd.removeAttribute('data-agy-translate-hidden');
          state.nativeMd.removeAttribute('data-agy-translate-bilingual-src');
          if (state.segments.some(s => s.status === 'pending' || s.status === 'streaming')) {
            state.nativeMd.setAttribute('data-agy-translate-pending', 'true');
          } else {
            state.nativeMd.removeAttribute('data-agy-translate-pending');
          }
        } else if (cfg.mode === 'bilingual') {
          state.nativeMd.removeAttribute('data-agy-translate-hidden');
          state.nativeMd.removeAttribute('data-agy-translate-pending');
          state.nativeMd.setAttribute('data-agy-translate-bilingual-src', 'true');
        } else {
          state.nativeMd.removeAttribute('data-agy-translate-pending');
          state.nativeMd.removeAttribute('data-agy-translate-bilingual-src');
          state.nativeMd.setAttribute('data-agy-translate-hidden', 'true');
        }
      }
      if (state.mountEl) {
        if (showOrigin || !hasReady) state.mountEl.setAttribute('data-agy-translate-hidden', 'true');
        else state.mountEl.removeAttribute('data-agy-translate-hidden');
      }
    }

    function renderPendingTail(state) {
      if (!state.tailEl) return;
      const tail = (state.pendingTail || '').trim();
      const hasReady = state.segments.some(s => s.renderedLen > 0 || s.status === 'done');
      const hasIncomplete = state.segments.some(s => s.status !== 'done' || s.renderedLen === 0);
      if (state.showOriginal || !hasReady || !tail || hasIncomplete) {
        state.tailEl.setAttribute('data-agy-translate-hidden', 'true');
        state.tailEl.textContent = '';
        return;
      }
      state.tailEl.removeAttribute('data-agy-translate-hidden');
      state.tailEl.textContent = tail;
    }

    function ensureBlockUi(state, cfg) {
      if (!state.mountEl || !state.mountEl.isConnected) {
        const mount = doc.createElement('div');
        mount.setAttribute('data-agy-translate-root', 'block');
        const list = doc.createElement('div');
        list.className = 'agy-tr-segs';
        const tailEl = doc.createElement('p');
        tailEl.className = 'agy-tr-tail';
        tailEl.setAttribute('data-agy-translate-hidden', 'true');
        mount.append(list, tailEl);
        state.mountEl = mount;
        state.segsEl = list;
        state.tailEl = tailEl;
        if (state.nativeMd?.parentElement) {
          if (state.nativeMd.nextSibling) state.nativeMd.parentElement.insertBefore(mount, state.nativeMd.nextSibling);
          else state.nativeMd.parentElement.append(mount);
        } else {
          state.bodyHost.append(mount);
        }
      }
      if (state.toggleAnchor && !state.toggleAnchor.hasAttribute?.('data-agy-translate-host')) {
        state.toggleAnchor.setAttribute?.('data-agy-translate-host', 'true');
      }
      if (!state.toggleWrapEl || !state.toggleWrapEl.isConnected) {
        state.toggleAnchor?.setAttribute?.('data-agy-translate-host', 'true');
        const wrap = doc.createElement('div');
        wrap.setAttribute('data-agy-translate-root', 'toggle');
        wrap.className = 'agy-tr-toggle-wrap';
        (state.toggleAnchor || state.bodyHost).append(wrap);
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'agy-tr-toggle';
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          state.showOriginal = !state.showOriginal;
          applyBlockVisibility(state, currentConfig());
          renderPendingTail(state);
        });
        wrap.append(btn);
        state.toggleWrapEl = wrap;
        state.toggleBtn = btn;
      }
      applyBlockVisibility(state, cfg);
    }

    const makeCacheKey = (cfg, ctx, rawText) =>
      `${cfg.targetLang}|${cfg.engine}|${cfg.baseUrl}|${cfg.model}|${String(ctx || '').slice(-100)}|${String(rawText || '').trim()}`;

    function appendCommittedSegments(state, committed) {
      for (const piece of committed) {
        const segEl = doc.createElement('div');
        segEl.className = 'agy-tr-seg';
        segEl.setAttribute('data-agy-translate-hidden', 'true');
        state.segsEl.append(segEl);
        state.segments.push({ raw: piece, status: 'pending', translated: '', liveText: '', renderedLen: 0, streamId: '', el: segEl });
      }
    }

    async function drainBlockQueue(state, cfg) {
      if (state.running || disposed) return;
      state.running = true;
      try {
        while (!disposed && !state.disposed && state.hostEl.isConnected) {
          const nextSeg = state.segments.find(s => s.status === 'pending');
          if (!nextSeg) break;
          const segIdx = state.segments.indexOf(nextSeg);
          const prevSeg = segIdx > 0 ? state.segments[segIdx - 1] : null;
          const ctx = prevSeg?.translated ? prevSeg.translated.slice(-220) : '';
          const cKey = makeCacheKey(cfg, ctx, nextSeg.raw);
          const hit = segmentCache.get(cKey);
          if (hit) {
            nextSeg.translated = hit.text;
            nextSeg.status = 'done';
            nextSeg.renderedLen = hit.text.length;
            nextSeg.el.removeAttribute?.('data-agy-translate-hidden');
            renderMarkdownInto(doc, nextSeg.el, hit.text);
            applyBlockVisibility(state, cfg);
            renderPendingTail(state);
            continue;
          }
          if (shouldSkipTranslation(nextSeg.raw, cfg.targetLang)) {
            nextSeg.translated = nextSeg.raw;
            nextSeg.status = 'done';
            nextSeg.renderedLen = nextSeg.raw.length;
            nextSeg.el.removeAttribute?.('data-agy-translate-hidden');
            renderMarkdownInto(doc, nextSeg.el, nextSeg.raw);
            applyBlockVisibility(state, cfg);
            renderPendingTail(state);
            continue;
          }

          nextSeg.status = 'streaming';
          const streamId = `tr-${++streamSeq}`;
          nextSeg.streamId = streamId;
          const streamState = { state, segment: nextSeg, text: '' };
          activeStreams.set(streamId, streamState);
          applyBlockVisibility(state, cfg);
          renderPendingTail(state);
          try {
            const reply = await request('translate.stream', { streamId, text: nextSeg.raw, context: ctx, targetLang: cfg.targetLang });
            if (disposed || state.disposed || nextSeg.streamId !== streamId) break;
            const finalText = typeof reply?.text === 'string' && reply.text ? reply.text : (streamState.text || nextSeg.raw);
            nextSeg.translated = finalText;
            nextSeg.status = 'done';
            nextSeg.streamId = '';
            nextSeg.renderedLen = finalText.length;
            nextSeg.el.removeAttribute?.('data-agy-translate-hidden');
            renderMarkdownInto(doc, nextSeg.el, finalText);
            if (!reply?.skipped) rememberSegment(cKey, { text: finalText, provider: reply?.provider });
          } catch {
            if (disposed || state.disposed || nextSeg.streamId !== streamId) break;
            const fallbackText = streamState.text || nextSeg.raw;
            nextSeg.translated = fallbackText;
            nextSeg.status = 'done';
            nextSeg.streamId = '';
            nextSeg.renderedLen = fallbackText.length;
            nextSeg.el.removeAttribute?.('data-agy-translate-hidden');
            renderMarkdownInto(doc, nextSeg.el, fallbackText);
          } finally {
            activeStreams.delete(streamId);
            applyBlockVisibility(state, currentConfig());
            renderPendingTail(state);
          }
        }
      } finally {
        state.running = false;
      }
    }

    function syncBlock(kind, hostEl, anchorEl, bodyHost, nativeMd, rawText, isStreaming, cfg) {
      if (!rawText || (!isStreaming && shouldSkipTranslation(rawText, cfg.targetLang))) return;
      let state = blocks.get(hostEl);
      if (state && !rawText.startsWith(state.lastRawPrefix || '')) {
        cleanupBlockState(state);
        state = null;
      }
      if (!state) {
        state = {
          kind, hostEl, toggleAnchor: anchorEl, bodyHost, nativeMd,
          processedOffset: 0, lastRaw: '', lastRawPrefix: rawText.slice(0, 48),
          segments: [], pendingTail: '', showOriginal: false,
          running: false, disposed: false, tailTimer: null,
          mountEl: null, segsEl: null, tailEl: null, toggleWrapEl: null, toggleBtn: null
        };
        blocks.set(hostEl, state);
        blockList.add(state);
      } else {
        state.toggleAnchor = anchorEl;
        state.bodyHost = bodyHost;
        state.nativeMd = nativeMd;
      }
      ensureBlockUi(state, cfg);
      if (rawText !== state.lastRaw || !isStreaming) {
        state.lastRaw = rawText;
        const sliced = sliceThinkingParagraphs(rawText, state.processedOffset, isStreaming);
        appendCommittedSegments(state, sliced.committed);
        state.processedOffset = sliced.nextOffset;
        state.pendingTail = sliced.pendingTail;
        applyBlockVisibility(state, cfg);
        renderPendingTail(state);
        if (state.tailTimer) { clearTimeout(state.tailTimer); state.tailTimer = null; }
        if (isStreaming && state.pendingTail.trim()) {
          state.tailTimer = setTimeout(() => {
            if (disposed || state.disposed) return;
            const flushed = sliceThinkingParagraphs(state.lastRaw, state.processedOffset, true, { forceFlushTail: true });
            appendCommittedSegments(state, flushed.committed);
            state.processedOffset = flushed.nextOffset;
            state.pendingTail = '';
            applyBlockVisibility(state, currentConfig());
            renderPendingTail(state);
            void drainBlockQueue(state, currentConfig());
          }, 480);
          state.tailTimer.unref?.();
        }
      }
      if (state.segments.some(s => s.status === 'pending')) void drainBlockQueue(state, cfg);
    }

    function syncThinkingBlocks(cfg) {
      const triggers = [...(doc.querySelectorAll?.('[data-testid="thinking-collapsible-trigger"]') || [])];
      const liveHosts = new Set();
      for (const trig of triggers) {
        const wrapper = trig.parentElement;
        if (!wrapper) continue;
        const bodyWrapper = [...(wrapper.children || [])].find(c => c !== trig && !c.hasAttribute?.('data-agy-translate-root'));
        const expanded = trig.getAttribute?.('aria-expanded') === 'true' || Boolean(bodyWrapper);
        if (!expanded || !bodyWrapper) {
          const existing = blocks.get(wrapper);
          if (existing) cleanupBlockState(existing);
          continue;
        }
        const nativeMd = bodyWrapper.querySelector?.('[data-markdown-root]') || bodyWrapper.firstElementChild || bodyWrapper;
        const bodyHost = nativeMd?.parentElement || bodyWrapper;
        const visTarget = nativeMd === bodyWrapper ? wrapper : bodyWrapper;
        const existing = blocks.get(wrapper);
        observeVisibility(visTarget, wrapper);
        const mountVis = existing?.mountEl && !existing.mountEl.hasAttribute?.('data-agy-translate-hidden') ? isElementVisible(existing.mountEl) : false;
        if (!isElementVisible(visTarget) && !mountVis) {
          if (existing) liveHosts.add(wrapper);
          continue;
        }
        liveHosts.add(wrapper);
        syncBlock('thinking', wrapper, wrapper, bodyHost, nativeMd, extractDomMarkdownText(nativeMd), isThinkingBlockStreaming(trig, wrapper), cfg);
        observeVisibility(visTarget, wrapper);
      }
      for (const st of [...blockList]) {
        if (st.kind === 'thinking' && (!st.hostEl.isConnected || !liveHosts.has(st.hostEl))) cleanupBlockState(st);
      }
    }

    function isInsideThinkingBody(el) {
      let cur = el;
      for (let d = 0; cur && d < 5; d++) {
        const parent = cur.parentElement;
        if (parent && [...(parent.children || [])].some(c => c.getAttribute?.('data-testid') === 'thinking-collapsible-trigger')) return true;
        cur = parent;
      }
      return false;
    }

    function syncNarrationBlocks(cfg) {
      const selector = '[data-testid="progress-update-response-text"], [data-testid="agent-response"] [data-testid="planner-response-text"], [data-testid="agent-response"] [data-markdown-root], [data-testid="subagent-tab-conversation"] [data-testid="planner-response-text"], [data-testid="subagent-tab-conversation"] [data-markdown-root]';
      const liveHosts = new Set();
      for (const el of doc.querySelectorAll?.(selector) || []) {
        if (!el.closest?.('[data-testid="agent-response"], [data-testid="subagent-tab-conversation"]')) continue;
        if (el.closest?.('[data-agy-translate-root],[data-testid="user-input-step"],[data-testid="ask-question-entry-readonly"],[data-testid="ask-question-option"],[data-testid="changed-files-card"]')) continue;
        if (isInsideThinkingBody(el)) continue;
        if (el.hasAttribute?.('data-markdown-root') && el.closest?.('[data-testid="progress-update-response-text"], [data-testid="planner-response-text"]')) continue;
        const isProgress = el.getAttribute?.('data-testid') === 'progress-update-response-text';
        const inSubagent = Boolean(el.closest?.('[data-testid="subagent-tab-conversation"]'));
        if (!isProgress && !inSubagent && !hasFollowingActivityInTurn(el)) continue;
        const nativeMd = el.hasAttribute?.('data-markdown-root') ? el : (el.querySelector?.('[data-markdown-root]') || el);
        const bodyHost = nativeMd === el ? (el.parentElement || el) : (nativeMd.parentElement || el);
        const visTarget = nativeMd === el ? bodyHost : el;
        const existing = blocks.get(el);
        observeVisibility(visTarget, el);
        const mountVis = existing?.mountEl && !existing.mountEl.hasAttribute?.('data-agy-translate-hidden') ? isElementVisible(existing.mountEl) : false;
        if (!isElementVisible(visTarget) && !mountVis) {
          if (existing) liveHosts.add(el);
          continue;
        }
        liveHosts.add(el);
        const rawText = extractDomMarkdownText(nativeMd);
        if (!rawText) continue;
        syncBlock('narration', el, bodyHost, bodyHost, nativeMd, rawText, isNarrationStreaming(el), cfg);
        observeVisibility(visTarget, el);
      }
      for (const st of [...blockList]) {
        if (st.kind === 'narration' && (!st.hostEl.isConnected || !liveHosts.has(st.hostEl))) cleanupBlockState(st);
      }
    }

    function restoreInlineOriginals() {
      for (const [node, entry] of inlineOriginals) {
        if (node.isConnected && node.nodeValue === entry.last) node.nodeValue = entry.original;
        if (entry.hostEl?.isConnected) {
          if (entry.hostEl.getAttribute?.('data-agy-translated') === 'inline') entry.hostEl.removeAttribute?.('data-agy-translated');
          if (entry.hadTip) entry.hostEl.setAttribute?.('data-pt-tip', entry.prevTip);
          else entry.hostEl.removeAttribute?.('data-pt-tip');
        }
      }
      inlineOriginals.clear();
      pendingInlineQueue.clear();
      inFlightInlineNodes = new WeakMap();
      if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    }

    function pruneDisconnectedInline() {
      for (const [node] of inlineOriginals) if (!node?.isConnected) inlineOriginals.delete(node);
      for (const [node] of pendingInlineQueue) if (!node?.isConnected) pendingInlineQueue.delete(node);
    }

    function applyInlineTranslation(node, entry, translated, origText) {
      if (!node?.isConnected || typeof translated !== 'string' || !translated || translated === origText) return;
      const cur = node.nodeValue || '';
      const expected = typeof entry.expectedValue === 'string' ? entry.expectedValue : entry.original;
      if (cur !== expected) {
        if (inlineOriginals.get(node)?.last !== cur) scheduleSync(20);
        return;
      }
      const origTrim = origText.trim();
      const updated = (entry.prefix || entry.suffix)
        ? `${entry.prefix || ''}${translated.trim()}${entry.suffix || ''}`
        : (origTrim && entry.original.includes(origTrim) ? entry.original.replace(origTrim, translated.trim()) : translated);
      if (entry.hostEl) {
        entry.hostEl.setAttribute?.('data-agy-translated', 'inline');
        const ancestorTip = entry.hostEl.parentElement?.closest?.('[data-pt-tip]');
        if (!entry.hadTip && entry.hostEl.hasAttribute?.('data-pt-tip')) {
          entry.hadTip = true;
          entry.prevTip = entry.hostEl.getAttribute('data-pt-tip') || '';
        }
        if (!ancestorTip && !entry.hadTip) entry.hostEl.setAttribute?.('data-pt-tip', entry.original.trim());
      }
      if (node.nodeValue !== updated) node.nodeValue = updated;
      inlineOriginals.set(node, {
        hostEl: entry.hostEl,
        original: entry.original,
        prefix: entry.prefix,
        suffix: entry.suffix,
        hadTip: entry.hadTip,
        prevTip: entry.prevTip,
        last: updated
      });
    }

    async function flushInlineBatch() {
      batchTimer = null;
      if (disposed || !pendingInlineQueue.size) return;
      const cfg = currentConfig();
      if (!cfg.active) { pendingInlineQueue.clear(); return; }
      const snapshot = [...pendingInlineQueue.values()];
      pendingInlineQueue.clear();
      const uncached = [];
      for (const item of snapshot) {
        if (!item.node?.isConnected) continue;
        const cKey = `${cfg.targetLang}|${cfg.engine}|${cfg.baseUrl}|${cfg.model}|inline|${item.query || item.original}`;
        const hit = segmentCache.get(cKey);
        if (hit) {
          applyInlineTranslation(
            item.node,
            { hostEl: item.hostEl, original: item.original, expectedValue: item.expectedValue, prefix: item.prefix, suffix: item.suffix, hadTip: item.hadTip, prevTip: item.prevTip },
            hit.text,
            item.query || item.original
          );
        } else {
          inFlightInlineNodes.set(item.node, item.original);
          uncached.push({ idx: String(uncached.length), item, cKey });
        }
      }
      if (!uncached.length) return;
      const batchId = `b-${++batchSeq}`;
      const batchMap = inFlightInlineNodes;
      activeBatches.add(batchId);
      try {
        const reply = await request('translate.batch', {
          batchId,
          targetLang: cfg.targetLang,
          items: uncached.map(u => ({ id: u.idx, text: (u.item.query || u.item.original).trim() }))
        });
        if (disposed || cfg.sig !== currentConfig().sig || !activeBatches.has(batchId)) return;
        for (const res of Array.isArray(reply?.results) ? reply.results : []) {
          const entry = uncached[Number(res.id)];
          if (!entry || res.error || !res.text || res.skipped) continue;
          rememberSegment(entry.cKey, { text: res.text, provider: res.provider });
          applyInlineTranslation(
            entry.item.node,
            { hostEl: entry.item.hostEl, original: entry.item.original, expectedValue: entry.item.expectedValue, prefix: entry.item.prefix, suffix: entry.item.suffix, hadTip: entry.item.hadTip, prevTip: entry.item.prevTip },
            res.text,
            entry.item.query || entry.item.original
          );
        }
      } catch {
        // Leave original inline text untouched on failure.
      } finally {
        activeBatches.delete(batchId);
        for (const u of uncached) if (batchMap.get(u.item.node) === u.item.original) batchMap.delete(u.item.node);
      }
    }

    function syncInlineTools(cfg) {
      pruneDisconnectedInline();
      const chatScopes = [...(doc.querySelectorAll?.('[data-testid="agent-response"], [data-testid="subagent-tab-conversation"], [data-testid="idle-status-text"], [data-testid="agent-loading"], [data-testid="subagent-node"], [data-testid="background-task-row"], [data-testid="side-question-question"], [data-testid="side-question-row"], [data-testid="browser-subagent-row"], [data-testid="subagent-group-title"], [data-testid="tool-group-collapsible"], .agy-aux-tab-title') || [])];
      const progressScopes = [...(doc.querySelectorAll?.('[data-agy-powertools-root="progress"] .pt-trail-label, [data-agy-powertools-root="progress"] .pt-task-label, [data-agy-powertools-root="progress"] .pt-progress-title, [data-agy-powertools-root="progress"] .pt-progress-sub') || [])];
      let queuedAny = false;
      const visited = new Set();
      const NF = globalThis.NodeFilter || { SHOW_TEXT: 4 };
      const visitTextNode = (node, { allowProgressRoot = false } = {}) => {
        if (visited.has(node)) return;
        visited.add(node);
        const parent = node.parentElement;
        if (!parent) return;
        const inBgTask = Boolean(parent.closest?.('[data-testid="background-task-row"]'));
        const matchedSkip = parent.closest?.(inBgTask ? TOOL_SKIP_BG_TASK_SELECTOR : TOOL_SKIP_SELECTOR);
        if (matchedSkip && !(allowProgressRoot && matchedSkip.getAttribute?.('data-agy-powertools-root') === 'progress')) return;
        if (parent.closest?.(BLOCK_CODE_SKIP_SELECTOR) || parent.closest?.('[data-testid="agy-subagent-badge"]')) return;
        const prev = inlineOriginals.get(node);
        const curVal = node.nodeValue || '';
        const orig = prev && curVal === prev.last ? prev.original : curVal;
        let inlinePrefix = '';
        let inlineSuffix = '';
        let inlineQuery = orig;
        if (allowProgressRoot) {
          const pm = orig.match(/^(\s*(?:子智能体运行中：|子智能體執行中：|等待操作确认：|等待操作確認：|正在执行：|正在執行：|等待批准以))([\s\S]+)$/);
          if (pm) {
            inlinePrefix = pm[1];
            inlineQuery = pm[2];
            const wm = inlineQuery.match(/^((?:蜂群成员|蜂群成員)\s*\()([\s\S]+?)(\)\s*)$/);
            if (wm) { inlinePrefix += wm[1]; inlineQuery = wm[2]; inlineSuffix = wm[3]; }
          }
        }
        const trimmed = inlineQuery.trim();
        if (trimmed.length < 4 || trimmed.length > 260) return;
        if (inBgTask && isLikelyShellCommand(trimmed)) return;
        if (shouldSkipTranslation(trimmed, cfg.targetLang)) return;
        observeVisibility(parent);
        if (!isElementVisible(parent)) return;
        const cKey = `${cfg.targetLang}|${cfg.engine}|${cfg.baseUrl}|${cfg.model}|inline|${inlineQuery}`;
        if (prev && curVal === prev.last && segmentCache.has(cKey)) return;
        const hit = segmentCache.get(cKey);
        const hadTip = prev ? prev.hadTip : Boolean(parent.hasAttribute?.('data-pt-tip'));
        const prevTip = prev ? prev.prevTip : (parent.getAttribute?.('data-pt-tip') || '');
        if (hit && hit.text) {
          applyInlineTranslation(node, { hostEl: parent, original: orig, expectedValue: curVal, prefix: inlinePrefix, suffix: inlineSuffix, hadTip, prevTip }, hit.text, inlineQuery);
          return;
        }
        if (inFlightInlineNodes.get(node) === orig) return;
        pendingInlineQueue.set(node, { node, hostEl: parent, original: orig, expectedValue: curVal, query: inlineQuery, prefix: inlinePrefix, suffix: inlineSuffix, hadTip, prevTip });
        queuedAny = true;
      };
      for (const scope of chatScopes) {
        const walker = doc.createTreeWalker?.(scope, NF.SHOW_TEXT, null);
        if (!walker) continue;
        let node;
        while ((node = walker.nextNode())) visitTextNode(node);
      }
      for (const scope of progressScopes) {
        const walker = doc.createTreeWalker?.(scope, NF.SHOW_TEXT, null);
        if (!walker) continue;
        let node;
        while ((node = walker.nextNode())) visitTextNode(node, { allowProgressRoot: true });
      }
      if (queuedAny && !batchTimer) {
        batchTimer = setTimeout(() => { void flushInlineBatch(); }, 60);
        batchTimer.unref?.();
      }
    }

    function handleEvent(event) {
      if (disposed || !event || event.type !== 'delta' || typeof event.streamId !== 'string' || !event.delta) return;
      const streamState = activeStreams.get(event.streamId);
      const seg = streamState?.segment;
      if (!seg || seg.status !== 'streaming') return;
      streamState.text += event.delta;
      seg.liveText = streamState.text;
      seg.renderedLen = streamState.text.length;
      seg.el.removeAttribute?.('data-agy-translate-hidden');
      renderMarkdownInto(doc, seg.el, streamState.text);
      applyBlockVisibility(streamState.state, currentConfig());
      renderPendingTail(streamState.state);
    }

    function stopObserver() {
      if (domObserver) { try { domObserver.disconnect(); } catch {} domObserver = null; }
    }

    function ensureObserver() {
      if (domObserver || disposed || !doc.body || typeof globalThis.MutationObserver !== 'function') return;
      const IGNORE_SEL = '[data-agy-translate-root],[data-agy-powertools-root]:not([data-agy-powertools-root="progress"]),[data-agy-management-page],[data-testid="user-input-step"],[data-testid="agent-input-box"],[contenteditable],textarea,input,.pt-tip-pop';
      domObserver = new globalThis.MutationObserver(records => {
        if (disposed) return;
        let hasRemovals = false;
        let shouldSchedule = false;
        for (const r of records) {
          if (r.removedNodes?.length) hasRemovals = true;
          if (r.type === 'characterData') {
            const entry = inlineOriginals.get(r.target);
            if (entry && entry.last === r.target.nodeValue) continue;
          }
          const t = r.type === 'characterData' ? r.target?.parentElement : r.target;
          if (!t || t.closest?.(IGNORE_SEL)) continue;
          if (r.attributeName && String(r.attributeName).startsWith('data-agy-translate')) continue;
          shouldSchedule = true;
        }
        if (hasRemovals) { pruneDisconnectedInline(); pruneDetachedObservations(); }
        if (shouldSchedule) scheduleSync(60);
      });
      try {
        domObserver.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-expanded'] });
      } catch { domObserver = null; }
    }

    function resetAllTranslations() {
      stopObserver();
      for (const batchId of [...activeBatches]) abortBatch(batchId);
      for (const id of [...activeStreams.keys()]) abortStream(id);
      for (const st of [...blockList]) cleanupBlockState(st);
      for (const target of [...observedTargets]) { try { io?.unobserve?.(target); } catch {} }
      observedTargets.clear();
      restoreInlineOriginals();
    }

    function sync() {
      if (disposed) return;
      const cfg = currentConfig();
      if (cfg.sig !== lastConfigSig) { lastConfigSig = cfg.sig; resetAllTranslations(); }
      if (!cfg.active) return;
      ensureStyle();
      ensureObserver();
      pruneDetachedObservations();
      syncThinkingBlocks(cfg);
      syncNarrationBlocks(cfg);
      syncInlineTools(cfg);
    }

    function scheduleSync(delay = 60) {
      if (disposed || syncTimer) return;
      syncTimer = setTimeout(() => { syncTimer = null; sync(); }, delay);
      syncTimer.unref?.();
    }

    function dispose() {
      disposed = true;
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
      resetAllTranslations();
      io?.disconnect?.();
      styleEl?.remove?.();
      styleEl = null;
      segmentCache.clear();
    }

    return { sync, scheduleSync, handleEvent, dispose };
  }

  globalThis.__agyDetailTranslator = createDetailTranslator;
  globalThis.__agyDetailTranslatorHelpers = {
    shouldSkipTranslation,
    isLikelyShellCommand,
    sliceThinkingParagraphs,
    renderMarkdownInto,
    extractDomMarkdownText
  };
})();
