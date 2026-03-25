import {
  authenticate,
  isDemoMode,
  isReplayMode,
  fetchReplayEvent,
  getBalance as getRgsBalance,
  formatCurrency,
  getCurrentCurrency,
  getReplayAmount,
  getReplayMode,
  getReplayEventId,
  play as rgsPlay,
  endRound as rgsEndRound,
  betEvent as rgsBetEvent
} from './rgs-client.js';

/**
 * SYSTEM BREACH — L'Infection
 * Logique du jeu : grille 5x5, virus, multiplicateurs, cash out.
 */

const GRID_SIZE = 25;
const ROWS = 5;
const COLS = 5;
const RGS_CARD_PATH_BET = 0.01; // chemin play→end par carte, sans impacter l'UI

// Règles de mise par devise (fallback local si RGS config absente/incomplète)
const BET_RULES_BY_CURRENCY = {
  USD: { min: 0.10, max: 1000, default: 1.00, decimals: 2 },
  JPY: { min: 10, max: 150000, default: 100, decimals: 0 },
  MXN: { min: 1, max: 15000, default: 10, decimals: 2 }
};

// État du jeu
let balance = 0;
let currentBet = 10;
let virusCount = 3;
let grid = [];           // 'virus' | number (multiplicateur)
let revealed = [];       // booléen par index
let currentMultiplier = 1;
let stakeInPlay = 0;     // GAINS ACTUELS (cagnotte en jeu)
let gameStarted = false;
let gameOver = false;
let virusAnimationActive = false;
let history = [];
let rgsClickBusy = false;         // verrou pendant un cycle play→endRound
let autoplayActive = false;      // mode auto : lance, révèle les cartes, cash out au seuil

// Contraintes de mise actives (dépendent de la devise)
let betMin = 0.10;
let betMax = 1000;
let betDefault = 1.00;
let betDecimals = 2;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function normalizeBetForCurrency(amount, currency) {
  const rules = BET_RULES_BY_CURRENCY[currency] || null;
  const decimals = rules ? rules.decimals : 2;
  const factor = Math.pow(10, decimals);
  return Math.round(amount * factor) / factor;
}

function getCurrencyRules(currency) {
  const rules = BET_RULES_BY_CURRENCY[currency];
  if (!rules) return null;
  return { ...rules };
}

function setBetRulesFromCurrency(currency) {
  const rules = getCurrencyRules(currency);
  if (!rules) return;
  betMin = rules.min;
  betMax = rules.max;
  betDefault = rules.default;
  betDecimals = rules.decimals;
}

function clampBetToRules(amount) {
  const cappedByBalance = Math.min(balance, betMax);
  const n = clamp(amount, betMin, cappedByBalance);
  return normalizeBetForCurrency(n, getCurrentCurrency());
}

// Éléments DOM
const balanceEl = document.getElementById('balance');
const betInput = document.getElementById('bet-input');
const betMinus = document.getElementById('bet-minus');
const betPlus = document.getElementById('bet-plus');
const betHalf = document.getElementById('bet-half');
const betDouble = document.getElementById('bet-double');
const virusSlider = document.getElementById('virus-slider');
const virusCountEl = document.getElementById('virus-count');
const btnLaunch = document.getElementById('btn-launch');
const gainsDisplay = document.getElementById('gains-display');
const btnCashout = document.getElementById('btn-cashout');
const autoCashoutToggle = document.getElementById('auto-cashout-toggle');
const autoCashoutValue = document.getElementById('auto-cashout-value');
const btnAutoplay = document.getElementById('btn-autoplay');
const gameMessage = document.getElementById('game-message');
const gridContainer = document.getElementById('grid-container');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const historyProgress = document.getElementById('history-progress');
const virusOverlay = document.getElementById('virus-overlay');
const betDisplay = document.getElementById('bet-display');
const gameMessageWrap = document.getElementById('game-message-wrap');
const gameMessageSub = document.getElementById('game-message-sub');
const gameMessageWrapSuccess = document.getElementById('game-message-wrap-success');
const virusMaxEl = document.getElementById('virus-max');
const btnInfo = document.getElementById('btn-info');
const infoOverlay = document.getElementById('info-overlay');
const infoClose = document.getElementById('info-close');

// Son joué quand le joueur clique sur une carte virus (défaite)
const soundVirusLose = new Audio('assets/virus-lose.m4a');
// Son joué à chaque clic sur une carte (révélation)
const soundCardClick = new Audio('assets/card-click.mp3');
// Son joué à la 6e carte saine révélée (remplace le clic pour cette carte)
const soundSafeStreak = new Audio('assets/safe-streak.mp3');
// Musique de fond en boucle
const bgMusic = new Audio('assets/bg-music.mp3');
bgMusic.loop = true;
bgMusic.volume = 0.5;
// Son de l'intro (splash)
const introMusic = new Audio();
introMusic.preload = 'auto';
introMusic.volume = 0.8;
introMusic.muted = false;
introMusic.src = 'assets/intro-music.m4a';
introMusic.load();
// Mise à jour affichage solde et gains
function updateUI() {
  if (balanceEl) balanceEl.textContent = balance.toFixed(2);
  const bet = Number(betInput && betInput.value) || betDefault;
  // Pendant la partie, le joueur "joue" avec la cagnotte (gains actuels),
  // pas avec la mise initiale. On l'affiche aussi dans le bloc "MISE".
  if (betDisplay) {
    const shownBet = gameStarted ? stakeInPlay : bet;
    betDisplay.textContent = shownBet.toFixed(2) + ' €';
  }
  if (gainsDisplay) {
    gainsDisplay.textContent = (gameStarted ? stakeInPlay : 0).toFixed(2) + ' €';
  }
  if (virusMaxEl && virusSlider) virusMaxEl.textContent = virusSlider.value + '/24';
}

// Génère les multiplicateurs pour les cartes saines (plus de virus = multiplicateurs plus élevés)
function generateMultipliers(numSafe) {
  const mults = [];
  const virusRatio = virusCount / 24;
  const minMult = 1 + 0.03 + virusRatio * 0.15;
  const maxMult = 1 + 0.2 + virusRatio * 2.5;
  for (let i = 0; i < numSafe; i++) {
    const t = numSafe > 1 ? i / (numSafe - 1) : 0.5;
    const range = minMult + (maxMult - minMult) * (0.3 + 0.7 * Math.random());
    mults.push(Number((range).toFixed(2)));
  }
  return mults.sort((a, b) => a - b);
}

// Mélange Fisher-Yates
function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Construit la grille de données (virus + multiplicateurs)
function buildGrid() {
  const numSafe = GRID_SIZE - virusCount;
  const multipliers = generateMultipliers(numSafe);
  const cells = [];
  for (let i = 0; i < virusCount; i++) cells.push('virus');
  for (let i = 0; i < numSafe; i++) cells.push(multipliers[i]);
  return shuffle(cells);
}

// Crée les 25 cartes dans le DOM
function renderGrid() {
  if (!gridContainer) return;
  gridContainer.innerHTML = '';
  for (let i = 0; i < GRID_SIZE; i++) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.index = i;
    card.setAttribute('aria-label', 'Carte ' + (i + 1));
    card.innerHTML = `
      <div class="card-face back">
        <span class="circuit" aria-hidden="true"></span>
        <div class="card-back-inner" aria-hidden="true">
          <span class="lock-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              <rect x="4" y="11" width="16" height="10" rx="2" ry="2"/>
              <ellipse cx="12" cy="16" rx="1.5" ry="1.8"/>
            </svg>
          </span>
        </div>
      </div>
      <div class="card-face front" style="display:none;"></div>
      <div class="card-face virus-face" style="display:none;"></div>
    `;
    gridContainer.appendChild(card);
  }
}

// Affiche la grille face cachée (après Lancer)
function showGridFaceDown() {
  if (!gridContainer) return;
  gridContainer.querySelectorAll('.card').forEach((card) => {
    card.classList.remove('revealed', 'virus', 'blocked');
    card.querySelector('.card-face.back').style.display = 'flex';
    card.querySelector('.card-face.front').style.display = 'none';
    card.querySelector('.card-face.virus-face').style.display = 'none';
  });
}

// Animation hack virus : plein écran (part de la carte) + infection des cartes
const VIRUS_ANIMATION_DURATION_MS = 2200;

function playVirusHackAnimation(virusCardEl) {
  virusAnimationActive = true;
  if (btnCashout) btnCashout.disabled = true;
  document.body.classList.add('virus-display-active');

  const rect = virusCardEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const spreadEl = virusOverlay.querySelector('.virus-overlay-spread');
  if (spreadEl) {
    spreadEl.style.left = centerX + 'px';
    spreadEl.style.top = centerY + 'px';
    spreadEl.style.width = '200vmax';
    spreadEl.style.height = '200vmax';
    spreadEl.style.marginLeft = '-100vmax';
    spreadEl.style.marginTop = '-100vmax';
  }

  gridContainer.querySelectorAll('.card').forEach(card => {
    card.classList.add('infected');
  });
  virusOverlay.classList.add('active');

  setTimeout(() => {
    virusAnimationActive = false;
    document.body.classList.remove('virus-display-active');
    virusOverlay.classList.remove('active');
    gridContainer.querySelectorAll('.card').forEach(card => {
      card.classList.remove('infected');
    });
    if (spreadEl) {
      spreadEl.style.left = '';
      spreadEl.style.top = '';
      spreadEl.style.marginLeft = '';
      spreadEl.style.marginTop = '';
    }
    endGame(false);
  }, VIRUS_ANIMATION_DURATION_MS);
}

// Cycle invisible : play → endRound (vrai débit RGS)
async function rgsInvisibleRound(betAmount) {
  const resp = await rgsPlay(betAmount, 'base');
  const active = !!resp?.round?.active;
  if (active) {
    try { await rgsEndRound(); } catch (_) {}
  }
  return resp;
}

// Révèle une carte (multiplicateur ou virus)
// En mode RGS : chaînage invisible — chaque carte = play → endRound en arrière-plan
async function revealCard(index) {
  if (!gridContainer || revealed[index] || gameOver || rgsClickBusy) return;
  const cardEl = gridContainer.children[index];
  if (!cardEl) return;
  const value = grid[index];
  if (value === undefined) return;

  const useRgs = !isDemoMode() && !isReplayMode();

  // --- Chemin invisible par carte : play → end ---
  // Ce chemin ne doit JAMAIS modifier le solde principal affiché pendant la partie.
  if (useRgs) {
    rgsClickBusy = true;
    try {
      // On envoie un petit montant constant pour garder le chemin côté RGS
      // sans que l'UI du solde principal suive les micro-débits/crédits.
      await rgsInvisibleRound(RGS_CARD_PATH_BET);
    } catch (err) {
      rgsClickBusy = false;
      return;
    }
    rgsClickBusy = false;
  }

  // --- Révélation visuelle (identique demo / RGS) ---
  revealed[index] = true;
  cardEl.classList.add('revealed');

  if (value === 'virus') {
    try { soundVirusLose.currentTime = 0; soundVirusLose.play(); } catch (_) {}
    cardEl.classList.add('virus');
    const back = cardEl.querySelector('.card-face.back');
    const virusFace = cardEl.querySelector('.virus-face');
    if (back) back.style.display = 'none';
    if (virusFace) {
      virusFace.style.display = 'flex';
      virusFace.innerHTML = `
      <div class="virus-inner">
        <span class="virus-icon" aria-hidden="true">💀</span>
        <span class="virus-label">VIRUS</span>
      </div>
    `;
    }
    playVirusHackAnimation(cardEl);
    return;
  }

  currentMultiplier *= value;
  // La somme en jeu est remisée à chaque carte saine.
  stakeInPlay = stakeInPlay * value;
  const back = cardEl.querySelector('.card-face.back');
  const front = cardEl.querySelector('.card-face.front');
  if (back) back.style.display = 'none';
  if (!front) return;
  front.style.display = 'flex';
  const isGreen = value >= 1.25;
  if (isGreen) {
    front.classList.add('mult-green');
    cardEl.classList.add('mult-green');
  } else {
    front.classList.remove('mult-green');
    cardEl.classList.remove('mult-green');
  }
  front.innerHTML = `<span class="multiplier">x${value.toFixed(2)}</span>`;

  updateUI();
  if (btnCashout) btnCashout.disabled = false;

  if (autoCashoutToggle && autoCashoutToggle.checked && autoCashoutValue) {
    const target = parseFloat(autoCashoutValue.value) || 2;
    if (currentMultiplier >= target) {
      cashOut();
      return;
    }
  }
}

// Démarre une nouvelle partie
// PAS d'appel RGS ici — les rounds invisibles se font sur chaque carte
function startRound() {
  const betVal = Number(betInput && betInput.value) || 10;
  const bet = Math.max(0.01, Math.min(balance, betVal));
  if (bet > balance) {
    if (gameMessage) gameMessage.textContent = 'Insufficient balance.';
    if (gameMessageSub) gameMessageSub.textContent = '';
    if (gameMessage) gameMessage.className = 'game-message';
    if (gameMessageWrap) gameMessageWrap.classList.add('visible');
    return;
  }
  if (betInput) betInput.value = bet.toFixed(2);

  currentBet = bet;
  virusCount = Math.max(1, Math.min(24, Number(virusSlider && virusSlider.value) || 3));
  if (virusCountEl) virusCountEl.textContent = '(' + virusCount + ')';

  // 2 soldes:
  // - balance = solde principal
  // - stakeInPlay = gains actuels (cagnotte)
  // Au lancement on transfère la mise: balance → gains actuels.
  balance -= currentBet;
  stakeInPlay = currentBet;

  grid = buildGrid();
  revealed = new Array(GRID_SIZE).fill(false);
  currentMultiplier = 1;
  gameStarted = true;
  gameOver = false;
  rgsClickBusy = false;

  updateUI();
  if (gameMessage) gameMessage.textContent = '';
  if (gameMessageSub) gameMessageSub.textContent = '';
  if (gameMessage) gameMessage.className = 'game-message';
  if (gameMessageWrap) gameMessageWrap.classList.remove('visible', 'infection');
  if (gameMessageWrapSuccess) gameMessageWrapSuccess.classList.remove('visible');
  if (btnLaunch) btnLaunch.disabled = true;
  if (btnCashout) btnCashout.disabled = true;

  showGridFaceDown();
  if (gridContainer) {
    gridContainer.querySelectorAll('.card').forEach((card) => {
      card.classList.remove('blocked');
    });
  }
}

// Révèle automatiquement une carte au hasard (autoplay)
const AUTOPLAY_REVEAL_DELAY_MS = 550;
async function autoRevealNext() {
  if (!autoplayActive || !gameStarted || gameOver || virusAnimationActive || rgsClickBusy) return;
  const unrevealed = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    if (!revealed[i]) unrevealed.push(i);
  }
  if (unrevealed.length === 0) return;
  const index = unrevealed[Math.floor(Math.random() * unrevealed.length)];
  try {
    soundCardClick.currentTime = 0;
    soundCardClick.play().catch(function() {});
  } catch (_) {}
  await revealCard(index);
  if (!autoplayActive || gameOver) return;
  if (gameStarted && !virusAnimationActive) {
    setTimeout(autoRevealNext, AUTOPLAY_REVEAL_DELAY_MS);
  }
}

// Programme le prochain round en mode autoplay
function scheduleNextAutoplayRound(won) {
  if (!autoplayActive) return;
  const delay = won ? 1400 : (VIRUS_ANIMATION_DURATION_MS + 900);
  setTimeout(() => {
    if (!autoplayActive) return;
    const betVal = Number(betInput && betInput.value) || 10;
    if (balance < betVal) {
      autoplayActive = false;
      if (btnAutoplay) btnAutoplay.classList.remove('autoplay-on');
      return;
    }
    startRound();
    setTimeout(autoRevealNext, 700);
  }, delay);
}

function updateAutoplayButton() {
  if (btnAutoplay) {
    btnAutoplay.classList.toggle('autoplay-on', autoplayActive);
    btnAutoplay.setAttribute('aria-pressed', autoplayActive ? 'true' : 'false');
  }
}

// Fin de partie (infection ou cash out)
// Pas d'appel RGS : chaque round invisible est déjà settlé dans revealCard
function endGame(won) {
  gameOver = true;
  gameStarted = false;
  rgsClickBusy = false;
  if (btnLaunch) btnLaunch.disabled = false;
  if (btnCashout) btnCashout.disabled = true;

  if (gridContainer) {
    gridContainer.querySelectorAll('.card').forEach((card) => {
      card.classList.add('blocked');
    });
  }

  if (autoplayActive) scheduleNextAutoplayRound(won);

  if (won) {
    // Cashout: on retransfère la cagnotte vers le solde principal.
    const winnings = stakeInPlay;
    balance += winnings;
    history.unshift({ mult: currentMultiplier, win: winnings });
    if (history.length > 20) history.pop();
    renderHistory();
    if (gameMessageWrap) gameMessageWrap.classList.remove('visible', 'infection');
    if (gameMessageWrapSuccess) gameMessageWrapSuccess.classList.add('visible');
  } else {
    if (gameMessageWrapSuccess) gameMessageWrapSuccess.classList.remove('visible');
    if (gameMessageWrap) gameMessageWrap.classList.add('visible', 'infection');
    if (gameMessage) {
      gameMessage.textContent = 'BOOM! YOU LOST!';
      gameMessage.className = 'game-message infection';
    }
    if (gameMessageSub) gameMessageSub.textContent = 'YOU LOST YOUR BET';
  }
  // Fin de round: la cagnotte est terminée (cashout ou perdu)
  stakeInPlay = 0;
  updateUI();
}

// Cash out
function cashOut() {
  if (gameOver || !gameStarted || virusAnimationActive) return;
  const atLeastOneSafeRevealed = revealed.some((isRevealed, i) => isRevealed && grid[i] !== 'virus');
  if (!atLeastOneSafeRevealed) return;
  endGame(true); // async: endRound + refresh balance en mode RGS
}

// Historique
function renderHistory() {
  if (history.length === 0) {
    historyEmpty.style.display = 'block';
    historyList.querySelectorAll('.history-item').forEach(el => el.remove());
  } else {
    historyEmpty.style.display = 'none';
    const existing = historyList.querySelectorAll('.history-item');
    existing.forEach(el => el.remove());
    history.slice(0, 15).forEach(({ mult, win }) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `<span class="icon">🔒</span><span class="value">x${mult.toFixed(2)}</span>`;
      historyList.appendChild(item);
    });
  }
  const pct = Math.min(100, history.length * 5);
  historyProgress.style.width = pct + '%';
}

// Clic sur une carte
function onCardClick(e) {
  const card = e.target.closest('.card');
  if (!card || !gameStarted || gameOver || virusAnimationActive || rgsClickBusy) return;
  const index = parseInt(card.dataset.index, 10);
  if (revealed[index]) return;
  const safeAlready = revealed.filter((_, i) => grid[i] !== 'virus').length;
  const thisCardIsSafe = grid[index] !== 'virus';
  const isSixthSafeCard = thisCardIsSafe && safeAlready === 5;
  try {
    if (isSixthSafeCard) {
      soundSafeStreak.currentTime = 0;
      soundSafeStreak.play().catch(function() {});
    } else {
      soundCardClick.currentTime = 0;
      soundCardClick.play().catch(function() {});
    }
  } catch (_) {}
  revealCard(index);
}

// Événements (après chargement du DOM)
function initGame() {
  function openInfo() {
    if (!infoOverlay) return;
    infoOverlay.classList.add('visible');
    infoOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('info-open');
  }

  function closeInfo() {
    if (!infoOverlay) return;
    infoOverlay.classList.remove('visible');
    infoOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('info-open');
  }

  if (btnInfo) btnInfo.addEventListener('click', openInfo);
  if (infoClose) infoClose.addEventListener('click', closeInfo);
  if (infoOverlay) {
    infoOverlay.addEventListener('click', (e) => {
      if (e.target === infoOverlay) closeInfo();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeInfo();
  });

  if (betMinus) betMinus.addEventListener('click', () => {
    const v0 = Number(betInput.value) || betDefault;
    const step = betDecimals === 0 ? 10 : 1; // JPY: pas fin au centime, step "simple"
    const v = clampBetToRules(v0 - step);
    betInput.value = v.toFixed(betDecimals);
    updateUI();
  });
  if (betPlus) betPlus.addEventListener('click', () => {
    const v0 = Number(betInput.value) || betDefault;
    const step = betDecimals === 0 ? 10 : 1;
    const v = clampBetToRules(v0 + step);
    betInput.value = v.toFixed(betDecimals);
    updateUI();
  });
  if (betHalf) betHalf.addEventListener('click', () => {
    const v0 = Number(betInput.value) || betDefault;
    const v = clampBetToRules(v0 / 2);
    betInput.value = v.toFixed(betDecimals);
    updateUI();
  });
  if (betDouble) betDouble.addEventListener('click', () => {
    const v0 = Number(betInput.value) || betDefault;
    const v = clampBetToRules(v0 * 2);
    betInput.value = v.toFixed(betDecimals);
    updateUI();
  });

  function updateVirusSliderFill() {
    if (virusSlider) {
      const val = parseInt(virusSlider.value, 10);
      const pct = ((val - 1) / 23) * 100;
      virusSlider.style.setProperty('--virus-pct', String(pct));
    }
  }
  if (virusSlider) {
    updateVirusSliderFill();
    virusSlider.addEventListener('input', () => {
      if (virusCountEl) virusCountEl.textContent = '(' + virusSlider.value + ')';
      if (virusMaxEl) virusMaxEl.textContent = virusSlider.value + '/24';
      updateVirusSliderFill();
    });
  }

  if (betInput) {
    betInput.addEventListener('input', updateUI);
    betInput.addEventListener('change', () => {
      const v0 = Number(betInput.value) || betDefault;
      const v = clampBetToRules(v0);
      betInput.value = v.toFixed(betDecimals);
      updateUI();
    });
  }

  if (btnLaunch) btnLaunch.addEventListener('click', startRound);
  if (btnCashout) btnCashout.addEventListener('click', cashOut);

  if (autoCashoutToggle) {
    autoCashoutToggle.addEventListener('change', () => {
      if (autoCashoutValue) autoCashoutValue.disabled = !autoCashoutToggle.checked;
    });
  }

  if (btnAutoplay) {
    btnAutoplay.addEventListener('click', () => {
      autoplayActive = !autoplayActive;
      updateAutoplayButton();
      if (autoplayActive) {
        if (!autoCashoutToggle || !autoCashoutToggle.checked) {
          if (autoCashoutToggle) autoCashoutToggle.checked = true;
          if (autoCashoutValue) autoCashoutValue.disabled = false;
        }
        const betVal = Number(betInput && betInput.value) || 10;
        if (balance < betVal) {
          autoplayActive = false;
          updateAutoplayButton();
          return;
        }
        if (!gameStarted) {
          startRound();
          setTimeout(autoRevealNext, 700);
        } else {
          setTimeout(autoRevealNext, 300);
        }
      }
    });
  }

  if (gridContainer) {
    gridContainer.addEventListener('click', onCardClick);
    renderGrid();
  }

  soundSafeStreak.load();
  initSoundControl();
  updateUI();
  renderHistory();
  initBackgroundParticles();
}

function initSoundControl() {
  const panel = document.getElementById('sound-panel');
  const toggle = document.getElementById('sound-toggle');
  const musicSlider = document.getElementById('sound-music');
  const sfxSlider = document.getElementById('sound-sfx');
  if (!panel || !toggle || !musicSlider || !sfxSlider) return;

  toggle.addEventListener('click', function() {
    panel.classList.toggle('hidden');
    toggle.textContent = panel.classList.contains('hidden') ? '🔇' : '🔊';
  });

  function applyMusicVolume() {
    const v = Number(musicSlider.value) / 100;
    bgMusic.volume = v;
  }
  function applySfxVolume() {
    const v = Number(sfxSlider.value) / 100;
    soundCardClick.volume = v;
    soundVirusLose.volume = v;
    soundSafeStreak.volume = v;
  }

  musicSlider.addEventListener('input', applyMusicVolume);
  sfxSlider.addEventListener('input', applySfxVolume);
  applyMusicVolume();
  applySfxVolume();
}

function startBgMusic() {
  bgMusic.load();
  function tryPlay() {
    bgMusic.play().catch(function() {});
  }
  tryPlay();
  window.addEventListener('load', tryPlay);
  document.body.addEventListener('click', function firstClick() {
    tryPlay();
    document.body.removeEventListener('click', firstClick);
  }, { once: true });
}

// Particules lumineuses dynamiques sur le fond (cyberpunk)
function initBackgroundParticles() {
  const container = document.getElementById('bg-particles');
  if (!container) return;
  const colors = [
    'rgba(34, 211, 238, 0.9)',
    'rgba(192, 38, 211, 0.85)',
    'rgba(232, 121, 249, 0.8)',
    'rgba(34, 197, 94, 0.7)',
    'rgba(139, 92, 246, 0.8)'
  ];
  for (let i = 0; i < 28; i++) {
    const dot = document.createElement('div');
    dot.className = 'particle-dot';
    dot.style.left = Math.random() * 100 + '%';
    dot.style.top = Math.random() * 100 + '%';
    dot.style.background = colors[Math.floor(Math.random() * colors.length)];
    dot.style.animationDelay = (Math.random() * 2) + 's';
    dot.style.animationDuration = (1.5 + Math.random() * 1.5) + 's';
    container.appendChild(dot);
  }
}

function hideSplash() {
  if (introMusic) {
    introMusic.pause();
    introMusic.currentTime = 0;
  }
  startBgMusic();
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
    setTimeout(function() {
      splash.remove();
    }, 900);
  }
}

function createRisingLights() {
  const container = document.getElementById('splash-rising-lights');
  if (!container) return;
  const colors = ['', 'cyan', 'magenta'];
  for (let i = 0; i < 48; i++) {
    const light = document.createElement('span');
    light.className = 'rising-light ' + (colors[Math.floor(Math.random() * colors.length)]);
    light.style.left = (Math.random() * 100) + '%';
    light.style.animationDelay = (Math.random() * 6) + 's';
    light.style.animationDuration = (4 + Math.random() * 3.5) + 's';
    light.style.width = (5 + Math.random() * 8) + 'px';
    light.style.height = light.style.width;
    container.appendChild(light);
  }
}

function initSplash() {
  createRisingLights();
  const logoImg = document.getElementById('splash-logo-img');
  const fallback = document.getElementById('splash-logo-fallback');
  const splash = document.getElementById('splash');

  var introAlreadyStarted = false;
  function tryPlayIntro() {
    if (!introMusic || introAlreadyStarted) return;
    introAlreadyStarted = true;
    introMusic.muted = false;
    introMusic.volume = 0.8;
    introMusic.currentTime = 0;
    var p = introMusic.play();
    if (p && p.catch) p.catch(function() { introAlreadyStarted = false; });
  }

  function whenCanPlay(fn) {
    if (introMusic.readyState >= 2) {
      fn();
    } else {
      introMusic.addEventListener('canplay', fn, { once: true });
      introMusic.addEventListener('canplaythrough', fn, { once: true });
      introMusic.addEventListener('error', function() {
        introMusic.src = 'assets/intro-music.mp3';
        introMusic.load();
        introMusic.addEventListener('canplay', fn, { once: true });
      }, { once: true });
    }
  }

  whenCanPlay(tryPlayIntro);

  if (logoImg) {
    logoImg.addEventListener('load', function() {
      logoImg.classList.add('loaded');
    });
    logoImg.addEventListener('error', function() {
      logoImg.style.display = 'none';
      if (fallback) fallback.classList.add('active');
    });
    if (logoImg.complete && logoImg.naturalWidth > 0) {
      logoImg.classList.add('loaded');
    } else if (logoImg.complete) {
      logoImg.style.display = 'none';
      if (fallback) fallback.classList.add('active');
    }
  }

  if (splash) {
    setInterval(function() {
      if (!splash.classList.contains('hidden')) {
        splash.classList.add('glitch-active');
        setTimeout(function() {
          splash.classList.remove('glitch-active');
        }, 280);
      }
    }, 2800 + Math.random() * 1800);
  }
}

async function initRgsIntegration() {
  try {
    const auth = await authenticate();
    const API_MULTIPLIER = 1000000;

    function toGameAmountMaybeMicro(v) {
      if (v == null) return null;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return null;
      // Heuristique: les montants API sont souvent en micro-unités.
      if (Math.abs(n) >= 10000) return n / API_MULTIPLIER;
      return n;
    }

    function pickRoundBetAmount(round) {
      if (!round) return null;
      // Formats possibles selon RGS: round.bet.amount, round.amount, round.wager, etc.
      const candidates = [
        round?.bet?.amount,
        round?.betAmount,
        round?.amount,
        round?.wager,
        round?.wagerAmount,
        round?.stake,
        round?.stakeAmount
      ];
      for (const c of candidates) {
        const amt = toGameAmountMaybeMicro(c);
        if (typeof amt === 'number' && amt > 0) return amt;
      }
      return null;
    }

    if (isReplayMode()) {
      // Mode REPLAY : on affiche les infos de la mise rejouée
      const replayAmount = getReplayAmount();
      const replayMode = getReplayMode();
      const replayEventId = getReplayEventId();
      balance = getRgsBalance() || 0;
      if (betInput) betInput.value = replayAmount.toFixed(2);
      if (gameMessage) gameMessage.textContent = 'REPLAY MODE';
      if (gameMessageSub) {
        gameMessageSub.textContent = `Event ${replayEventId} — mode ${replayMode}`;
      }
    } else {
      // Mode réel ou démo : on récupère le solde depuis le RGS client
      const rgsBal = getRgsBalance();
      if (typeof rgsBal === 'number' && rgsBal > 0) {
        balance = rgsBal;
      } else if (auth && typeof auth.balance === 'number') {
        // auth.balance est en micro-unités
        balance = auth.balance / 1000000;
      } else {
        // Fallback si aucune info : même comportement qu’avant
        balance = 100;
      }

      // Applique les règles de mise par devise demandées (min/max/default)
      const currency = getCurrentCurrency() || auth?.currency || 'EUR';
      setBetRulesFromCurrency(currency);

      // Gestion des rafraîchissements:
      // si un round est en cours, on restaure la mise exacte depuis /authenticate
      // (sinon, on peut restaurer un bet par défaut depuis la config).
      const isActive = !!auth?.round?.active;
      const roundBet = isActive ? pickRoundBetAmount(auth.round) : null;
      const defaultBet = toGameAmountMaybeMicro(auth?.defaultBetLevel);
      const restoredRaw = roundBet ?? defaultBet ?? betDefault;
      if (betInput && typeof restoredRaw === 'number' && restoredRaw > 0) {
        const restored = clampBetToRules(restoredRaw);
        betInput.value = restored.toFixed(betDecimals);
      }
    }
  } catch (e) {
    // Si le RGS n’est pas configuré, on reste en pur mode démo local
    balance = 100;
  }

  updateUI();
}

function boot() {
  initSplash();
  initRgsIntegration().then(() => {
    initGame();
  });
  setTimeout(hideSplash, 4200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
