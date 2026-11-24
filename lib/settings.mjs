import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PROXY_BYPASS, isValidProxyBypass, isValidProxyUrl, normalizeProxyBypass, normalizeProxyUrl } from './proxy.mjs';

export const OVERVIEW_RANGE_OPTIONS = Object.freeze(['weeklyQuota', 'today', '24h', 'yesterday', 'week', 'month', '30d', 'all']);
export const USER_BUBBLE_PRESETS = Object.freeze(['accent', 'slate', 'ocean', 'sage', 'sand', 'plum', 'custom']);
export const QUICK_PANEL_MODES = Object.freeze(['full', 'compact', 'custom']);
export const QUICK_PANEL_TAB_KEYS = Object.freeze(['overview', 'requests', 'errors', 'quota', 'pricing', 'settings']);
export const DEFAULT_QUICK_PANEL_TABS = Object.freeze({
  overview: 'full',
  requests: 'full',
  errors: 'full',
  quota: 'full',
  pricing: 'full',
  settings: 'full'
});
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const isValidQuickPanelTabs = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (!keys.length) return false;
  for (const k of keys) {
    if (!QUICK_PANEL_TAB_KEYS.includes(k)) return false;
    const v = value[k];
    if (k === 'pricing' ? !['full', 'hidden'].includes(v) : !['full', 'compact', 'hidden'].includes(v)) return false;
  }
  const merged = { ...DEFAULT_QUICK_PANEL_TABS, ...value };
  return QUICK_PANEL_TAB_KEYS.some(k => merged[k] !== 'hidden');
};
const coerceQuickPanelTabs = value => Object.fromEntries(
  QUICK_PANEL_TAB_KEYS.map(k => [k, value?.[k] ?? DEFAULT_QUICK_PANEL_TABS[k]])
);

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  compact: true, userBubbleTint: false, userBubblePreset: 'accent', userBubbleColor: '#2F75C3', userBubbleStrength: 20, contextRing: true, speedStats: true, timing: true, toolDetails: true,
  responseBranch: true, messageEdit: true, fileContextMenu: true, sessionSearch: true, progress: true, overviewQuota: false, titlebarQuickPanel: true, titlebarQuickPanelMode: 'full', titlebarQuickPanelTabs: DEFAULT_QUICK_PANEL_TABS, composerQuotaHalo: false, composerQuotaHaloWindow: 'auto', subagentTelemetry: true, keepTurnOutline:true, keepOverviewOpen:true, taskbarBadge:true, multiAccount:false, accountSwitcher:true, accountViewMode:'list', accountQuotaWindow:'5h', autoSwitchAccount:false, proxyEnabled:false, proxyUrl:'', proxyBypass:DEFAULT_PROXY_BYPASS, proxyForceHttp1:false, stageUpdates:true, efficientIO:false, language: 'zh-CN', overviewRange: 'weeklyQuota', contextLimit: 0, sidebarProjectLimit: 0
});
const validSetting = (key,value) => key === 'language' ? ['zh-CN','zh-TW','en'].includes(value) : key === 'overviewRange' ? OVERVIEW_RANGE_OPTIONS.includes(value) : key === 'userBubblePreset' ? USER_BUBBLE_PRESETS.includes(value) : key === 'userBubbleColor' ? (typeof value === 'string' && HEX_COLOR_RE.test(value.trim())) : key === 'userBubbleStrength' ? (Number.isInteger(value) && value >= 10 && value <= 100) : key === 'titlebarQuickPanelMode' ? QUICK_PANEL_MODES.includes(value) : key === 'titlebarQuickPanelTabs' ? isValidQuickPanelTabs(value) : key === 'accountViewMode' ? ['list','card'].includes(value) : key === 'accountQuotaWindow' ? ['5h','weekly'].includes(value) : key === 'composerQuotaHaloWindow' ? ['auto','weekly','5h'].includes(value) : key === 'contextLimit' ? [0,256000,500000,1000000].includes(value) : key === 'sidebarProjectLimit' ? [0,1,2,3,4,5,10,-1].includes(value) : key === 'proxyUrl' ? isValidProxyUrl(value) : key === 'proxyBypass' ? isValidProxyBypass(value) : typeof value === 'boolean';
const coerceSetting = (key, value) => key === 'proxyUrl' ? (normalizeProxyUrl(value) || '') : key === 'proxyBypass' ? (normalizeProxyBypass(value) || DEFAULT_PROXY_BYPASS) : key === 'userBubbleColor' ? value.trim().toUpperCase() : key === 'titlebarQuickPanelTabs' ? coerceQuickPanelTabs(value) : value;
export function normalizeSettings(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [key, validSetting(key,value[key]) ? coerceSetting(key,value[key]) : (key === 'titlebarQuickPanelTabs' ? { ...fallback } : fallback)]));
}
export function createSettingsStore(directory = join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-powertools')) {
  const path = join(directory, 'settings.json');
  return {
    get() {
      try { return normalizeSettings(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}); }
      catch { return { ...DEFAULT_SETTINGS }; }
    },
    set(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置格式无效');
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(DEFAULT_SETTINGS, key) || !validSetting(key,value)) throw new Error('设置选项无效');
      }
      const value = normalizeSettings({ ...this.get(), ...patch });
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n', 'utf8');
      renameSync(`${path}.tmp`, path);
      return value;
    }
  };
}
