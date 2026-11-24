export function quotaGroupMeta(group = {}, index = 0) {
  const displayName = String(group.displayName || '').trim();
  const bucketIds = (Array.isArray(group.buckets) ? group.buckets : []).map(b => String(b?.bucketId || '')).join(' ');
  const combined = `${displayName} ${bucketIds}`;
  if (/argon/i.test(combined)) {
    return { key: 'argon', shortName: 'Argon', compactName: 'Argon' };
  }
  if (/claude|gpt|\b3p\b/i.test(combined)) {
    return { key: 'claude', shortName: 'Claude / GPT', compactName: 'Claude/GPT' };
  }
  if (/gemini/i.test(combined)) {
    return { key: 'gemini', shortName: 'Gemini', compactName: 'Gemini' };
  }
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const label = displayName || `Group ${index + 1}`;
  return { key: slug || `group-${index}`, shortName: label, compactName: label };
}

export function accountBucketStatus(bucket = {}, now = Date.now(), opts = {}) {
  const isActive = Boolean(opts?.isActive);
  const syncedAtMs = Number.isFinite(opts?.syncedAtMs) ? opts.syncedAtMs : null;
  const rawFraction = typeof bucket.remainingFraction === 'number' && Number.isFinite(bucket.remainingFraction)
    ? Math.max(0, Math.min(1, bucket.remainingFraction))
    : null;
  const rawResetMs = Number.isFinite(bucket.resetTimeMs) ? bucket.resetTimeMs : null;
  const resetTimeMs = (rawFraction != null && rawFraction >= 1 && bucket.description === '') ? null : rawResetMs;
  const window = bucket.window === 'weekly' || /weekly/i.test(bucket.bucketId || '') ? 'weekly' : '5h';
  const snapshotAfterReset = syncedAtMs != null && resetTimeMs != null && syncedAtMs >= resetTimeMs;
  const isReset = Boolean(
    !isActive &&
    !snapshotAfterReset &&
    resetTimeMs != null &&
    now >= resetTimeMs &&
    rawFraction != null &&
    rawFraction < 1
  );
  const effectiveFraction = isReset ? 1 : rawFraction;
  const tone = effectiveFraction == null
    ? 'unknown'
    : effectiveFraction < 0.1
      ? 'critical'
      : effectiveFraction < 0.25
        ? 'warning'
        : 'ok';
  return {
    bucketId: bucket.bucketId || '',
    window,
    rawFraction,
    effectiveFraction,
    resetTimeMs,
    isReset,
    tone
  };
}

export function summarizeAccountQuota(account = {}, now = Date.now(), opts = {}) {
  const isActive = Boolean(opts?.isActive);
  const syncedAtMs = Number.isFinite(opts?.syncedAtMs)
    ? opts.syncedAtMs
    : (Number.isFinite(account?.syncedAtMs) ? account.syncedAtMs : null);
  const bucketOpts = { isActive, syncedAtMs };
  const seenKeys = new Set();
  const groups = (Array.isArray(account.groups) ? account.groups : []).map((g, index) => {
    const meta = quotaGroupMeta(g, index);
    let key = meta.key;
    if (seenKeys.has(key)) key = `${key}-${index}`;
    seenKeys.add(key);
    return {
      displayName: g.displayName || meta.shortName,
      shortName: meta.shortName,
      compactName: meta.compactName,
      key,
      buckets: (Array.isArray(g.buckets) ? g.buckets : [])
        .filter(b => b && b.disabled !== true)
        .map(b => accountBucketStatus(b, now, bucketOpts))
    };
  });
  const allBuckets = groups.flatMap(g => g.buckets);
  let lowestBucket = null;
  for (const b of allBuckets) {
    if (b.effectiveFraction == null) continue;
    if (!lowestBucket || b.effectiveFraction < lowestBucket.effectiveFraction ||
      (b.effectiveFraction === lowestBucket.effectiveFraction && b.window === '5h' && lowestBucket.window !== '5h')) {
      lowestBucket = b;
    }
  }
  const hasResetBucket = allBuckets.some(b => b.isReset);
  const overallTone = allBuckets.some(b => b.tone === 'critical')
    ? 'critical'
    : allBuckets.some(b => b.tone === 'warning')
      ? 'warning'
      : lowestBucket != null
        ? 'ok'
        : 'unknown';
  return { groups, lowestBucket, hasResetBucket, overallTone };
}

export function formatRelativeTime(timestampMs, now = Date.now(), language = 'zh-CN') {
  if (!Number.isFinite(timestampMs)) return '-';
  const en = language === 'en', tw = language === 'zh-TW';
  const diffSec = Math.max(0, Math.floor((now - timestampMs) / 1000));
  if (diffSec < 60) return en ? 'Just now' : tw ? '剛剛' : '刚刚';
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return en ? `${m}m ago` : tw ? `${m} 分鐘前` : `${m} 分钟前`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return en ? `${h}h ago` : tw ? `${h} 小時前` : `${h} 小时前`;
  }
  const d = Math.floor(diffSec / 86400);
  return en ? `${d}d ago` : `${d} 天前`;
}

export function formatResetCountdown(resetTimeMs, now = Date.now(), language = 'zh-CN') {
  if (!Number.isFinite(resetTimeMs)) return '';
  const en = language === 'en', tw = language === 'zh-TW';
  const diffMs = resetTimeMs - now;
  if (diffMs <= 0) return '';
  const totalMin = Math.max(1, Math.ceil(diffMs / 60000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) {
    if (en) return hours > 0 ? `Resets in ${days}d ${hours}h` : `Resets in ${days}d`;
    return tw
      ? (hours > 0 ? `${days} 天 ${hours} 小時後重置` : `${days} 天後重置`)
      : (hours > 0 ? `${days} 天 ${hours} 小时后重置` : `${days} 天后重置`);
  }
  if (hours > 0) {
    if (en) return mins > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${hours}h`;
    return tw
      ? (mins > 0 ? `${hours} 小時 ${mins} 分鐘後重置` : `${hours} 小時後重置`)
      : (mins > 0 ? `${hours} 小时 ${mins} 分钟后重置` : `${hours} 小时后重置`);
  }
  return en ? `Resets in ${mins}m` : tw ? `${mins} 分鐘後重置` : `${mins} 分钟后重置`;
}

export function formatCompactCountdown(resetTimeMs, now = Date.now()) {
  if (!Number.isFinite(resetTimeMs)) return '';
  const diffMs = resetTimeMs - now;
  if (diffMs <= 0) return '';
  const totalMin = Math.max(1, Math.ceil(diffMs / 60000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

export function accountInitials(account = {}) {
  const source = String(account.name || account.email || account.alias || 'A').trim();
  return Array.from(source)[0]?.toUpperCase() || 'A';
}

export function officialTierCatalog() {
  return {
    ultra20: { key: 'ultra20', label: 'Ultra 20x', zhLabel: 'Ultra 20x', rank: 6, weight: 20, officialMonthlyUsd: 199.99, restricted: false },
    ultra5: { key: 'ultra5', label: 'Ultra 5x', zhLabel: 'Ultra 5x', rank: 5, weight: 5, officialMonthlyUsd: 99.99, restricted: false },
    team: { key: 'team', label: 'Enterprise', zhLabel: '企业版', rank: 4.5, weight: 5, officialMonthlyUsd: 30, restricted: false },
    pro: { key: 'pro', label: 'Pro', zhLabel: 'Pro', rank: 4, weight: 1, officialMonthlyUsd: 19.99, restricted: false },
    unknown: { key: 'unknown', label: '-', zhLabel: '未知', rank: 3, weight: 1, officialMonthlyUsd: 0, restricted: false },
    'pro-trial': { key: 'pro-trial', label: 'Pro Trial', zhLabel: 'Pro 试用', rank: 2, weight: 0.5, officialMonthlyUsd: 0, restricted: true },
    plus: { key: 'plus', label: 'Plus', zhLabel: 'Plus', rank: 2, weight: 0.5, officialMonthlyUsd: 4.99, restricted: true },
    free: { key: 'free', label: 'Free', zhLabel: 'Free', rank: 1, weight: 0.25, officialMonthlyUsd: 0, restricted: true }
  };
}

export function normalizeModelCapability(label = '') {
  const clean = String(label || '')
    .toLowerCase()
    .replace(/\(\s*(?:minimal|low|medium|high|xhigh|extra\s*high|max|thinking)\s*\)/gi, ' ')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/(claude-(?:opus|sonnet|haiku)-\d+)\.(\d+)/g, '$1-$2');
  return clean.replace(/-(?:minimal|low|medium|extra-high|high|xhigh|extra|max|thinking)$/i, '');
}

export function accountTierProfile(account = {}, now = Date.now(), opts = {}) {
  const catalog = officialTierCatalog();
  const override = typeof account?.tierOverride === 'string' ? account.tierOverride.trim().toLowerCase() : '';
  const tierId = String(account?.tier?.id || '').trim().toLowerCase();
  const tierName = String(account?.tier?.name || '').trim();
  const combined = `${tierName} ${tierId}`;
  const avail = Array.isArray(account?.availableModels)
    ? [...new Set(account.availableModels.map(normalizeModelCapability).filter(Boolean))]
    : [];
  const hasFrontierModel = avail.some(m => /carbon|neon|argon|claude|orchestrator/i.test(m));
  const summary = summarizeAccountQuota(account, now);
  const has5hBucket = summary.groups.some(g => g.buckets.some(b => b.window === '5h'));

  let tierKey = 'unknown';
  let inferredTrial = false;
  if (override && Object.hasOwn(catalog, override)) {
    tierKey = override;
  } else if (/ultra/i.test(combined)) {
    if (/lite|(?:\bultra[\s_-]*|\b)5\s*[x×](?=$|[\W_])/i.test(combined)) tierKey = 'ultra5';
    else tierKey = 'ultra20';
  } else if (/trial|starter/i.test(combined)) {
    tierKey = 'pro-trial';
  } else if (/\bpro\b/i.test(combined)) {
    if ((avail.length > 0 && !hasFrontierModel) || (summary.groups.length > 0 && !has5hBucket)) {
      tierKey = 'pro-trial';
      inferredTrial = true;
    } else {
      tierKey = 'pro';
    }
  } else if (/plus/i.test(combined)) {
    tierKey = 'plus';
  } else if (/team|business|enterprise/i.test(combined)) {
    tierKey = 'team';
  } else if (/free|standard|default/i.test(combined)) {
    tierKey = 'free';
  }
  const meta = catalog[tierKey] || catalog.unknown;

  const rawExp = typeof account?.expiresAt === 'string' ? account.expiresAt.trim() : '';
  const expMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawExp);
  let expiresAt = '';
  let expiresMs = null;
  let daysUntilExpiry = null;
  if (expMatch) {
    const y = Number(expMatch[1]), m = Number(expMatch[2]), d = Number(expMatch[3]);
    const expEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
    if (expEnd.getFullYear() === y && expEnd.getMonth() === m - 1 && expEnd.getDate() === d) {
      expiresAt = rawExp;
      expiresMs = expEnd.getTime();
      const nowDate = new Date(now);
      const todayUtc = Date.UTC(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
      const expUtc = Date.UTC(y, m - 1, d);
      daysUntilExpiry = Math.round((expUtc - todayUtc) / 86400000);
    }
  }
  const isExpired = Boolean(Number.isFinite(expiresMs) && now > expiresMs);
  const expiringSoon = Boolean(!isExpired && daysUntilExpiry != null && daysUntilExpiry <= 7);

  const familyMode = ['family-exclusive', 'family-shared'].includes(account?.familyMode)
    ? account.familyMode
    : 'standalone';
  const familyRole = ['manager', 'member'].includes(account?.familyRole)
    ? account.familyRole
    : '';
  const familyGroupId = typeof account?.familyGroupId === 'string' ? account.familyGroupId.trim() : '';
  const familyMembers = Number.isInteger(account?.familyMembers) && account.familyMembers >= 2
    ? Math.min(12, account.familyMembers)
    : null;
  const customWeight = typeof account?.customWeight === 'number' && Number.isFinite(account.customWeight) && account.customWeight > 0
    ? account.customWeight
    : null;
  const observedQuotaUsd = typeof account?.observedQuotaUsd === 'number' && Number.isFinite(account.observedQuotaUsd) && account.observedQuotaUsd > 0
    ? account.observedQuotaUsd
    : null;
  const baselineProUsd = typeof opts?.baselineProUsd === 'number' && Number.isFinite(opts.baselineProUsd) && opts.baselineProUsd > 0
    ? opts.baselineProUsd
    : null;

  let effectiveWeight = meta.weight;
  let weightSource = 'tier';
  if (customWeight != null) {
    effectiveWeight = customWeight;
    weightSource = 'custom';
  } else if (familyMode === 'family-shared') {
    if (observedQuotaUsd != null && baselineProUsd != null) {
      effectiveWeight = Math.max(0.1, Math.min(meta.weight, Number((observedQuotaUsd / baselineProUsd).toFixed(2))));
      weightSource = 'observed';
    } else {
      const divisor = familyMembers || 2;
      effectiveWeight = Number((meta.weight / divisor).toFixed(3));
      weightSource = 'shared';
    }
  }

  const treatAsFree = Boolean(account?.treatAsFree);
  const hasCustomPrice = typeof account?.monthlyPriceUsd === 'number' && Number.isFinite(account.monthlyPriceUsd) && account.monthlyPriceUsd >= 0;
  const effectiveMonthlyUsd = treatAsFree ? 0 : (hasCustomPrice ? account.monthlyPriceUsd : meta.officialMonthlyUsd);
  const unitCost = effectiveWeight > 0 ? effectiveMonthlyUsd / effectiveWeight : Infinity;

  return {
    tierKey,
    tierMeta: meta,
    inferredTrial,
    availableModels: avail,
    expiresAt,
    expiresMs: Number.isFinite(expiresMs) ? expiresMs : null,
    isExpired,
    daysUntilExpiry,
    expiringSoon,
    familyMode,
    familyRole,
    familyGroupId,
    familyMembers,
    effectiveWeight,
    weightSource,
    treatAsFree,
    hasCustomPrice,
    effectiveMonthlyUsd,
    unitCost
  };
}

export function accountSupportsModel(account = {}, activeModel = '', targetGroupKey = 'gemini', now = Date.now()) {
  const summary = summarizeAccountQuota(account, now);
  const profile = accountTierProfile(account, now);
  const normModel = normalizeModelCapability(activeModel);
  const isClaudeModel = Boolean(normModel && /claude|gpt/i.test(normModel));
  const isArgonModel = Boolean(normModel && /argon/i.test(normModel));
  const isFrontierGemini = Boolean(normModel && /carbon|neon|argon|orchestrator/i.test(normModel));

  const effectiveKey = targetGroupKey || (isClaudeModel ? 'claude' : isArgonModel ? 'argon' : 'gemini');
  let matchedGroup = summary.groups.find(g => g.key === effectiveKey) || null;
  if (!matchedGroup && effectiveKey === 'argon') {
    const geminiGroup = summary.groups.find(g => g.key === 'gemini') || null;
    if (geminiGroup && (profile.availableModels.some(m => /argon/i.test(m)) || (!profile.availableModels.length && !profile.tierMeta.restricted))) {
      matchedGroup = geminiGroup;
    }
  }
  if (!matchedGroup && !targetGroupKey && summary.groups.length > 0) {
    matchedGroup = summary.groups[0];
  }
  if (!matchedGroup) return { supported: false, group: null, reason: 'missing-pool' };

  if (profile.availableModels.length > 0 && normModel) {
    if (isClaudeModel) {
      const hasExactOrFamily = profile.availableModels.some(m => m === normModel || /claude|gpt/i.test(m));
      if (!hasExactOrFamily) return { supported: false, group: matchedGroup, reason: 'model-unsupported' };
    } else if (/orchestrator/i.test(normModel)) {
      const hasFrontier = profile.availableModels.some(m => /carbon|neon|argon|orchestrator/i.test(m));
      if (!hasFrontier) return { supported: false, group: matchedGroup, reason: 'model-unsupported' };
    } else if (isArgonModel) {
      const hasArgon = profile.availableModels.some(m => /argon/i.test(m));
      if (!hasArgon) return { supported: false, group: matchedGroup, reason: 'model-unsupported' };
    } else if (isFrontierGemini) {
      const hasModel = profile.availableModels.some(m => m === normModel);
      const hasAnyFrontier = profile.availableModels.some(m => /carbon|neon|argon/i.test(m));
      if (!hasModel && !hasAnyFrontier) return { supported: false, group: matchedGroup, reason: 'model-unsupported' };
    }
  } else if (normModel && (isClaudeModel || isFrontierGemini) && profile.tierMeta.restricted) {
    return { supported: false, group: matchedGroup, reason: 'restricted-tier' };
  }

  return { supported: true, group: matchedGroup, reason: '' };
}

export function evaluateAutoSwitchTrigger(groups = [], opts = {}) {
  if (!Array.isArray(groups) || !groups.length) return null;
  const thresholdPct = Number.isFinite(opts?.thresholdPct) ? Math.max(0, Math.min(25, opts.thresholdPct)) : 0;
  const thresholdFrac = thresholdPct / 100;
  const include3p = Boolean(opts?.include3p);
  const normModel = normalizeModelCapability(opts?.activeModel || '');
  const isClaudeActive = Boolean(normModel && /claude|gpt/i.test(normModel));
  const isArgonActive = Boolean(normModel && /argon/i.test(normModel));

  const desiredKeys = [];
  if (isClaudeActive) {
    if (!include3p) return null;
    desiredKeys.push('claude');
  } else if (isArgonActive) {
    desiredKeys.push('argon', 'gemini');
  } else {
    desiredKeys.push('gemini');
    if (include3p) desiredKeys.push('claude');
  }

  for (const wantKey of desiredKeys) {
    const group = groups.find((g, i) => quotaGroupMeta(g, i).key === wantKey);
    if (!group) continue;
    const hit = (Array.isArray(group.buckets) ? group.buckets : [])
      .filter(b => b && b.disabled !== true && typeof b.remainingFraction === 'number' && Number.isFinite(b.remainingFraction) && b.remainingFraction <= thresholdFrac)
      .sort((a, b) => a.remainingFraction - b.remainingFraction)[0];
    if (hit) {
      const meta = quotaGroupMeta(group);
      const isWeekly = hit.window === 'weekly' || /weekly/i.test(hit.bucketId || '');
      return {
        groupKey: meta.key,
        groupName: meta.shortName,
        bucketId: String(hit.bucketId || ''),
        window: isWeekly ? 'weekly' : '5h',
        fraction: hit.remainingFraction,
        resetTimeMs: Number.isFinite(hit.resetTimeMs) ? hit.resetTimeMs : null
      };
    }
    if (isArgonActive && wantKey === 'argon') break;
  }
  return null;
}

export function rankAutoSwitchCandidates(accounts = [], activeId = '', options = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  const now = Number.isFinite(options?.now) ? options.now : Date.now();
  const strategy = typeof options?.strategy === 'string' && options.strategy ? options.strategy : 'smart';
  const depletedGroupKey = typeof options?.depletedGroupKey === 'string' ? options.depletedGroupKey : '';
  const activeModel = typeof options?.activeModel === 'string' ? options.activeModel : '';
  const thresholdFrac = Number.isFinite(options?.thresholdPct) ? Math.max(0, Math.min(0.25, options.thresholdPct / 100)) : 0;
  const minFraction = Number.isFinite(options?.minFraction) ? options.minFraction : Math.max(0.05, thresholdFrac + 0.02);
  const skipSet = new Set(Array.isArray(options?.skipIds) ? options.skipIds : []);

  const activeAcct = list.find(a => a && a.id === activeId) || null;
  const activeProfile = activeAcct ? accountTierProfile(activeAcct, now) : null;
  const activeSharedGroup = activeProfile?.familyMode === 'family-shared' && activeProfile.familyGroupId
    ? activeProfile.familyGroupId.toLowerCase()
    : '';

  // Estimate baseline Pro quota USD from non-shared Pro accounts if observed locally.
  const proUsdSamples = [];
  for (const acct of list) {
    if (!acct) continue;
    const p = accountTierProfile(acct, now);
    if (p.tierKey === 'pro' && p.familyMode !== 'family-shared' && Number.isFinite(acct.observedQuotaUsd) && acct.observedQuotaUsd > 0) {
      proUsdSamples.push(acct.observedQuotaUsd);
    }
  }
  const baselineProUsd = proUsdSamples.length
    ? proUsdSamples.reduce((sum, v) => sum + v, 0) / proUsdSamples.length
    : null;

  const eligible = [];
  const skipped = [];

  for (let index = 0; index < list.length; index++) {
    const acct = list[index];
    if (!acct || acct.id === activeId) continue;
    if (acct.disabled) { skipped.push({ id: acct.id, reason: 'disabled' }); continue; }
    if (acct.hasCredential === false) { skipped.push({ id: acct.id, reason: 'no-credential' }); continue; }
    if (skipSet.has(acct.id)) { skipped.push({ id: acct.id, reason: 'skipped' }); continue; }

    const profile = accountTierProfile(acct, now, { baselineProUsd });
    if (profile.isExpired) { skipped.push({ id: acct.id, reason: 'expired' }); continue; }
    if (activeSharedGroup && profile.familyMode === 'family-shared' && profile.familyGroupId.toLowerCase() === activeSharedGroup) {
      skipped.push({ id: acct.id, reason: 'same-shared-family' });
      continue;
    }

    const compat = accountSupportsModel(acct, activeModel, depletedGroupKey, now);
    if (!compat.supported) { skipped.push({ id: acct.id, reason: compat.reason }); continue; }

    const allBuckets = compat.group ? compat.group.buckets : [];
    const b5 = allBuckets.find(b => b.window === '5h');
    const bw = allBuckets.find(b => b.window === 'weekly');
    if (b5 && b5.effectiveFraction != null && b5.effectiveFraction <= minFraction) {
      skipped.push({ id: acct.id, reason: 'low-5h' });
      continue;
    }
    if (bw && bw.effectiveFraction != null && bw.effectiveFraction <= minFraction) {
      skipped.push({ id: acct.id, reason: 'low-weekly' });
      continue;
    }

    const frac5h = b5?.effectiveFraction ?? (bw?.effectiveFraction ?? 0.5);
    const fracWeekly = bw?.effectiveFraction ?? 1;
    const usableFrac = Math.min(frac5h, fracWeekly);
    const weightedRemaining = Number((usableFrac * profile.effectiveWeight).toFixed(4));
    const weighted5h = Number((frac5h * profile.effectiveWeight).toFixed(4));

    const running5h = Boolean(b5 && !b5.isReset && Number.isFinite(b5.resetTimeMs) && b5.resetTimeMs > now && frac5h < 1);
    const runningWeekly = Boolean(bw && !bw.isReset && Number.isFinite(bw.resetTimeMs) && bw.resetTimeMs > now && fracWeekly < 1);
    const runningResets = [running5h ? b5.resetTimeMs : null, runningWeekly ? bw.resetTimeMs : null].filter(Number.isFinite);
    const soonestResetMs = runningResets.length ? Math.min(...runningResets) : Infinity;
    const hasRunningTimer = runningResets.length > 0;
    const runningWithBuffer = hasRunningTimer && usableFrac >= 0.15;

    eligible.push({
      acct,
      index,
      profile,
      frac5h,
      fracWeekly,
      usableFrac,
      weightedRemaining,
      weighted5h,
      hasRunningTimer,
      runningWithBuffer,
      soonestResetMs,
      lastUsed: acct.lastUsedAtMs || 0
    });
  }

  const cmpExpiry = (a, b) => {
    if (a.profile.expiringSoon !== b.profile.expiringSoon) return a.profile.expiringSoon ? -1 : 1;
    if (a.profile.expiringSoon && b.profile.expiringSoon && a.profile.daysUntilExpiry !== b.profile.daysUntilExpiry) {
      return (a.profile.daysUntilExpiry ?? 999) - (b.profile.daysUntilExpiry ?? 999);
    }
    return 0;
  };

  eligible.sort((a, b) => {
    if (strategy === 'priority') {
      return a.index - b.index;
    }
    if (strategy === 'tier-first') {
      if (b.profile.tierMeta.rank !== a.profile.tierMeta.rank) return b.profile.tierMeta.rank - a.profile.tierMeta.rank;
      if (b.weightedRemaining !== a.weightedRemaining) return b.weightedRemaining - a.weightedRemaining;
      return a.index - b.index;
    }
    if (strategy === 'weighted-quota') {
      if (b.weightedRemaining !== a.weightedRemaining) return b.weightedRemaining - a.weightedRemaining;
      if (b.weighted5h !== a.weighted5h) return b.weighted5h - a.weighted5h;
      if (b.fracWeekly !== a.fracWeekly) return b.fracWeekly - a.fracWeekly;
      return a.index - b.index;
    }
    if (strategy === 'earliest-reset') {
      const exp = cmpExpiry(a, b);
      if (exp !== 0) return exp;
      if (a.hasRunningTimer !== b.hasRunningTimer) return a.hasRunningTimer ? -1 : 1;
      if (a.soonestResetMs !== b.soonestResetMs) return a.soonestResetMs - b.soonestResetMs;
      if (b.weightedRemaining !== a.weightedRemaining) return b.weightedRemaining - a.weightedRemaining;
      return a.index - b.index;
    }
    if (strategy === 'cost-low') {
      const aFree = a.profile.effectiveMonthlyUsd <= 0;
      const bFree = b.profile.effectiveMonthlyUsd <= 0;
      if (aFree !== bFree) return aFree ? -1 : 1;
      if (aFree && bFree) {
        if (b.weightedRemaining !== a.weightedRemaining) return b.weightedRemaining - a.weightedRemaining;
        return a.index - b.index;
      }
      if (Math.abs(a.profile.unitCost - b.profile.unitCost) > 1e-6) return a.profile.unitCost - b.profile.unitCost;
      if (b.weightedRemaining !== a.weightedRemaining) return b.weightedRemaining - a.weightedRemaining;
      return a.index - b.index;
    }
    if (strategy === 'cost-high') {
      const aPaid = a.profile.effectiveMonthlyUsd > 0;
      const bPaid = b.profile.effectiveMonthlyUsd > 0;
      if (aPaid !== bPaid) return aPaid ? -1 : 1;
      if (b.profile.effectiveMonthlyUsd !== a.profile.effectiveMonthlyUsd) return b.profile.effectiveMonthlyUsd - a.profile.effectiveMonthlyUsd;
      if (a.runningWithBuffer !== b.runningWithBuffer) return a.runningWithBuffer ? -1 : 1;
      if (b.weightedRemaining !== a.weightedRemaining) return b.weightedRemaining - a.weightedRemaining;
      return a.index - b.index;
    }
    // Default: 'smart' (anti-waste: expiring soon -> active ticking window before untouched 100% -> weighted capacity -> drag order)
    const exp = cmpExpiry(a, b);
    if (exp !== 0) return exp;
    if (a.runningWithBuffer !== b.runningWithBuffer) return a.runningWithBuffer ? -1 : 1;
    if (a.runningWithBuffer && b.runningWithBuffer && a.soonestResetMs !== b.soonestResetMs) {
      return a.soonestResetMs - b.soonestResetMs;
    }
    if (b.weightedRemaining !== a.weightedRemaining) return b.weightedRemaining - a.weightedRemaining;
    if (b.profile.tierMeta.rank !== a.profile.tierMeta.rank) return b.profile.tierMeta.rank - a.profile.tierMeta.rank;
    return a.index - b.index;
  });

  const reasonFor = item => {
    if (!item) return '';
    if (item.profile.expiringSoon && (strategy === 'smart' || strategy === 'earliest-reset')) return 'expiring-soon';
    if (strategy === 'priority') return 'priority';
    if (strategy === 'tier-first') return 'tier-first';
    if (strategy === 'weighted-quota') return 'weighted-quota';
    if (strategy === 'earliest-reset') return item.hasRunningTimer ? 'earliest-reset' : 'weighted-quota';
    if (strategy === 'cost-low') return item.profile.treatAsFree ? 'treated-free' : 'cost-low';
    if (strategy === 'cost-high') return 'cost-high';
    return item.runningWithBuffer ? 'running-reset' : 'weighted-quota';
  };

  const candidates = eligible.map(item => ({
    account: item.acct,
    usableFrac: item.usableFrac,
    weightedRemaining: item.weightedRemaining,
    soonestResetMs: Number.isFinite(item.soonestResetMs) ? item.soonestResetMs : null,
    tierKey: item.profile.tierKey,
    effectiveWeight: item.profile.effectiveWeight,
    effectiveMonthlyUsd: item.profile.effectiveMonthlyUsd,
    treatAsFree: item.profile.treatAsFree,
    daysUntilExpiry: item.profile.daysUntilExpiry,
    reason: reasonFor(item)
  }));

  return {
    candidate: candidates[0]?.account || null,
    candidates,
    strategy,
    skipped
  };
}

export function selectAutoSwitchCandidate(
  accounts = [],
  activeId = '',
  depletedGroupKey = '',
  now = Date.now(),
  minFraction = 0.05,
  opts = {}
) {
  return rankAutoSwitchCandidates(accounts, activeId, {
    depletedGroupKey,
    now,
    minFraction,
    strategy: opts?.strategy || 'weighted-quota',
    activeModel: opts?.activeModel || '',
    skipIds: opts?.skipIds || []
  }).candidate;
}
