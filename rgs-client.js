// ============================================
// SYSTEM BREACH - RGS Client (simple pattern)
// Inspiré du client RGS de Jungle Rush
// ============================================

const API_MULTIPLIER = 1000000;

// Lecture des paramètres d'URL
const getParam = (key) => new URLSearchParams(window.location.search).get(key);

// Flags de debug (pas de console spam en prod)
const DEBUG = getParam('debug') === '1';
const log = DEBUG ? console.log.bind(console, '[RGS]') : () => {};
const warn = DEBUG ? console.warn.bind(console, '[RGS]') : () => {};
const errorLog = DEBUG ? console.error.bind(console, '[RGS]') : () => {};

// ============================================================
// SÉCURITÉ RUNTIME : on fige les paramètres RGS au chargement
// ============================================================
const _INITIAL_SEARCH = String(window.location.search || '');
const _INITIAL_PARAMS = new URLSearchParams(_INITIAL_SEARCH);
const _INITIAL_RGS_URL = _INITIAL_PARAMS.get('rgs_url');
const _INITIAL_SESSION_ID = _INITIAL_PARAMS.get('sessionID');

function _getInitialParam(key) {
  return _INITIAL_PARAMS.get(key);
}

function _assertRuntimeParamsUnchanged() {
  const now = new URLSearchParams(window.location.search || '');
  const nowRgs = now.get('rgs_url');
  const nowSession = now.get('sessionID');
  const initialRgs = _INITIAL_RGS_URL;
  const initialSession = _INITIAL_SESSION_ID;

  if ((initialRgs || nowRgs) && nowRgs !== initialRgs) {
    throw new Error('RGS URL changed');
  }
  if ((initialSession || nowSession) && nowSession !== initialSession) {
    throw new Error('Session changed');
  }
}

// ============================================
// FORMATAGE MONNAIE (copié du pattern Jungle)
// ============================================
const CURRENCY_CONFIG = {
  EUR: { symbol: '€', decimals: 2, symbolAfter: false },
  USD: { symbol: '$', decimals: 2, symbolAfter: false },
  GC: { symbol: 'GC', decimals: 2, symbolAfter: true },
  SC: { symbol: 'SC', decimals: 2, symbolAfter: true }
};

let currentCurrency = 'EUR';

function addThousandSpaces(fixedNumberString) {
  const [rawInt, rawFrac] = String(fixedNumberString).split('.');
  const sign = rawInt.startsWith('-') ? '-' : '';
  const intPart = sign ? rawInt.slice(1) : rawInt;
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return rawFrac != null ? `${sign}${grouped}.${rawFrac}` : `${sign}${grouped}`;
}

export function formatCurrency(amount, currency = null) {
  const cur = currency || currentCurrency;
  const config = CURRENCY_CONFIG[cur] || { symbol: cur, decimals: 2, symbolAfter: true };
  const formattedAmount = addThousandSpaces(amount.toFixed(config.decimals));
  if (config.symbolAfter) {
    return `${formattedAmount} ${config.symbol}`;
  }
  return `${config.symbol}${formattedAmount}`;
}

export function getCurrentCurrency() {
  return currentCurrency;
}

function toNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toGameAmount(value) {
  if (value == null) return null;
  const raw = typeof value === 'object' ? (value.amount ?? value.value ?? value) : value;
  const n = toNumber(raw);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) >= 10000) return n / API_MULTIPLIER;
  return n;
}

// ===========================
// ÉTAT RGS
// ===========================
let isAuthenticated = false;
let currentBalance = 0; // en micro-unités (API_MULTIPLIER)
let lastAuthConfig = null;

// ===========================
// MODE REPLAY
// ===========================
export const getReplayGameId = () => getParam('game') || getParam('gameid') || getParam('gameId');
export const getReplayVersion = () => getParam('version') || '1';
export const getReplayModeRaw = () => getParam('mode') || 'BASE';
export const getReplayEventId = () => getParam('event') || getParam('eventId');
export const getReplayAmount = () => toGameAmount(getParam('amount')) || 1;

export const isReplayMode = () => (
  _getInitialParam('replay') === 'true' &&
  !!_INITIAL_RGS_URL &&
  !!getReplayGameId() &&
  !!getReplayVersion() &&
  !!getReplayModeRaw() &&
  (getReplayEventId() != null && String(getReplayEventId()).length > 0)
);

// Demo = pas de sessionID ou pas de rgs_url (et pas en replay)
export const isDemoMode = () =>
  !isReplayMode() && (!_INITIAL_SESSION_ID || !_INITIAL_RGS_URL);

export const getReplayMode = () => {
  const raw = String(getReplayModeRaw() || '').trim();
  const up = raw.toUpperCase();
  if (up === 'SUPER' || up === 'BUY_SUPER') return 'buy_super';
  if (up === 'BONUS' || up === 'BUY_BONUS') return 'buy_bonus';
  if (up === 'BONUS_HUNT' || up === 'HUNT' || up === 'BONUSHUNT') return 'bonus_hunt';
  if (up === 'BASE') return 'base';
  if (raw === 'buy_super' || raw === 'buy_bonus' || raw === 'bonus_hunt' || raw === 'base') return raw;
  return 'base';
};

function getBaseUrl() {
  _assertRuntimeParamsUnchanged();
  const rgsUrl = _INITIAL_RGS_URL;
  if (!rgsUrl) throw new Error('No rgs_url provided');
  return rgsUrl.startsWith('http://') || rgsUrl.startsWith('https://')
    ? rgsUrl
    : `https://${rgsUrl}`;
}

async function getRGSResponse(endpoint, body) {
  _assertRuntimeParamsUnchanged();
  const base = getBaseUrl();
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.code || 'RGS Error');
  }
  return data;
}

// Récupération d’un event de replay
export async function fetchReplayEvent() {
  if (!isReplayMode()) throw new Error('Not in replay mode');
  const base = getBaseUrl();
  const game = getReplayGameId();
  const version = getReplayVersion();
  const mode = String(getReplayModeRaw() || '').trim();
  const event = String(getReplayEventId());
  const lang = getParam('lang') || getParam('language') || 'fr';
  const url = `${base}/bet/replay/${encodeURIComponent(game)}/${encodeURIComponent(
    version
  )}/${encodeURIComponent(mode)}/${encodeURIComponent(event)}?language=${encodeURIComponent(lang)}`;
  const response = await fetch(url, { method: 'GET' });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.code || 'RGS Replay Error');
  }
  return data;
}

// Authentification
export async function authenticate() {
  currentCurrency = getParam('currency') || 'EUR';

  // Mode replay : pas d’auth requise
  if (isReplayMode()) {
    currentBalance = 0;
    isAuthenticated = true;
    return {
      balance: currentBalance,
      currency: currentCurrency,
      isReplay: true,
      eventId: getReplayEventId(),
      mode: getReplayMode(),
      betLevels: [getReplayAmount()],
      defaultBetLevel: getReplayAmount()
    };
  }

  // Mode démo : pas de RGS
  if (isDemoMode()) {
    log('Demo Mode');
    currentBalance = 1000 * API_MULTIPLIER;
    isAuthenticated = true;
    return { balance: currentBalance, currency: currentCurrency };
  }

  // Auth réelle RGS
  try {
    const response = await getRGSResponse('/wallet/authenticate', {
      sessionID: _INITIAL_SESSION_ID,
      language: getParam('lang') || getParam('language') || 'fr'
    });

    currentBalance = response.balance.amount;
    currentCurrency = response.balance.currency || currentCurrency;
    isAuthenticated = true;
    log('RGS Authenticated - Balance:', formatCurrency(currentBalance / API_MULTIPLIER));

    const cfg = response?.config || null;
    lastAuthConfig = cfg;

    const betLevels = Array.isArray(cfg?.betLevels)
      ? cfg.betLevels.map(toGameAmount).filter((v) => typeof v === 'number' && v > 0)
      : null;
    const minBet = toGameAmount(cfg?.minBet);
    const maxBet = toGameAmount(cfg?.maxBet);
    const stepBet = toGameAmount(cfg?.stepBet);
    const defaultBetLevel = toGameAmount(cfg?.defaultBetLevel ?? cfg?.defaultBet);

    return {
      balance: currentBalance,
      currency: currentCurrency,
      betLevels,
      minBet,
      maxBet,
      stepBet,
      defaultBetLevel,
      round: response?.round ?? null
    };
  } catch (error) {
    // Fallback replay si jamais auth indisponible
    if (isReplayMode()) {
      currentBalance = parseInt(getParam('balance') || '1000000000', 10);
      isAuthenticated = true;
      return {
        balance: currentBalance,
        currency: currentCurrency,
        isReplay: true,
        eventId: getReplayEventId(),
        mode: getReplayMode()
      };
    }
    errorLog('Auth failed:', error);
    throw error;
  }
}

export async function balanceRequest() {
  if (isDemoMode() || isReplayMode()) return null;
  if (!isAuthenticated) throw new Error('Not authenticated');

  const response = await getRGSResponse('/wallet/balance', {
    sessionID: _INITIAL_SESSION_ID
  });

  if (response.balance?.amount != null) {
    currentBalance = response.balance.amount;
  }
  if (response.balance?.currency) {
    currentCurrency = response.balance.currency;
  }
  log('Balance:', response);
  return response;
}

export async function play(amount, mode = 'base') {
  if (isDemoMode() || isReplayMode()) {
    // Dans SYSTEM BREACH, la logique de jeu locale gère déjà la round math :
    // ici on ne fait rien en démo/replay.
    return null;
  }
  if (!isAuthenticated) {
    throw new Error('Not authenticated');
  }

  const response = await getRGSResponse('/wallet/play', {
    sessionID: _INITIAL_SESSION_ID,
    mode: String(mode || 'base').toLowerCase(),
    currency: currentCurrency,
    amount: Math.round(amount * API_MULTIPLIER)
  });

  if (response.balance?.amount != null) {
    currentBalance = response.balance.amount;
  }

  log('Play:', response);
  return response;
}

export async function endRound() {
  if (isDemoMode() || isReplayMode()) return null;

  try {
    const response = await getRGSResponse('/wallet/end-round', {
      sessionID: _INITIAL_SESSION_ID
    });

    if (response.balance?.amount != null) {
      currentBalance = response.balance.amount;
    }

    return response;
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('does not have active bet')) {
      return null;
    }
    warn('End round:', error.message);
    return null;
  }
}

export async function betEvent(event) {
  if (isDemoMode() || isReplayMode()) return null;
  if (!isAuthenticated) throw new Error('Not authenticated');

  const response = await getRGSResponse('/bet/event', {
    sessionID: _INITIAL_SESSION_ID,
    event
  });
  log('bet/event:', response);
  return response;
}

export function getLastAuthConfig() {
  return lastAuthConfig;
}

export function getBalance() {
  return currentBalance / API_MULTIPLIER;
}

export function getBalanceRaw() {
  return currentBalance;
}

