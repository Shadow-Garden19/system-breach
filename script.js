/**
 * SYSTEM BREACH — L'Infection
 * Logique du jeu : grille 5x5, virus, multiplicateurs, cash out.
 */

const GRID_SIZE = 25;
const ROWS = 5;
const COLS = 5;

// État du jeu
let balance = 100;
let currentBet = 10;
let virusCount = 3;
let grid = [];           // 'virus' | number (multiplicateur)
let revealed = [];       // booléen par index
let currentMultiplier = 1;
let gameStarted = false;
let gameOver = false;
let history = [];

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
const gameMessage = document.getElementById('game-message');
const gridContainer = document.getElementById('grid-container');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const historyProgress = document.getElementById('history-progress');
const virusOverlay = document.getElementById('virus-overlay');
const betDisplay = document.getElementById('bet-display');
const gameMessageWrap = document.getElementById('game-message-wrap');
const gameMessageSub = document.getElementById('game-message-sub');
const virusMaxEl = document.getElementById('virus-max');

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
// Mise à jour affichage solde et gains
function updateUI() {
  if (balanceEl) balanceEl.textContent = balance.toFixed(2);
  const bet = Number(betInput && betInput.value) || 10;
  if (betDisplay) betDisplay.textContent = bet.toFixed(2) + ' €';
  if (gainsDisplay) gainsDisplay.textContent = (currentBet * currentMultiplier).toFixed(2) + ' €';
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

// Révèle une carte (multiplicateur ou virus)
function revealCard(index) {
  if (!gridContainer || revealed[index] || gameOver) return;
  const cardEl = gridContainer.children[index];
  if (!cardEl) return;
  const value = grid[index];
  if (value === undefined) return;

  revealed[index] = true;
  cardEl.classList.add('revealed');

  if (value === 'virus') {
    try {
      soundVirusLose.currentTime = 0;
      soundVirusLose.play();
    } catch (_) { /* lecture bloquée par le navigateur */ }
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
}

// Démarre une nouvelle partie (verrouille la grille)
function startRound() {
  const betVal = Number(betInput && betInput.value) || 10;
  const bet = Math.max(0.01, Math.min(balance, betVal));
  if (bet > balance) {
    if (gameMessage) gameMessage.textContent = 'Solde insuffisant.';
    if (gameMessageSub) gameMessageSub.textContent = '';
    if (gameMessage) gameMessage.className = 'game-message';
    if (gameMessageWrap) gameMessageWrap.classList.add('visible');
    return;
  }
  if (betInput) betInput.value = bet.toFixed(2);

  currentBet = bet;
  virusCount = Math.max(1, Math.min(24, Number(virusSlider && virusSlider.value) || 3));
  if (virusCountEl) virusCountEl.textContent = '(' + virusCount + ')';

  grid = buildGrid();
  revealed = new Array(GRID_SIZE).fill(false);
  currentMultiplier = 1;
  gameStarted = true;
  gameOver = false;

  balance -= currentBet;
  updateUI();
  if (gameMessage) gameMessage.textContent = '';
  if (gameMessageSub) gameMessageSub.textContent = '';
  if (gameMessage) gameMessage.className = 'game-message';
  if (gameMessageWrap) gameMessageWrap.classList.remove('visible', 'infection');
  if (btnLaunch) btnLaunch.disabled = true;
  if (btnCashout) btnCashout.disabled = true;

  showGridFaceDown();
  if (gridContainer) {
    gridContainer.querySelectorAll('.card').forEach((card) => {
      card.classList.remove('blocked');
    });
  }
}

// Fin de partie (infection ou cash out)
function endGame(won) {
  gameOver = true;
  gameStarted = false;
  if (btnLaunch) btnLaunch.disabled = false;
  if (btnCashout) btnCashout.disabled = true;

  if (gridContainer) {
    gridContainer.querySelectorAll('.card').forEach((card) => {
      card.classList.add('blocked');
    });
  }

  if (won) {
    const winnings = currentBet * currentMultiplier;
    balance += winnings;
    history.unshift({ mult: currentMultiplier, win: winnings });
    if (history.length > 20) history.pop();
    renderHistory();
    gameMessage.textContent = 'Encaissement réussi !';
    gameMessageSub.textContent = '';
    gameMessage.className = 'game-message';
    if (gameMessageWrap) {
      gameMessageWrap.classList.add('visible');
      gameMessageWrap.classList.remove('infection');
    }
  } else {
    if (gameMessageWrap) {
      gameMessageWrap.classList.add('visible', 'infection');
    }
    gameMessage.textContent = 'EXPLOSION ! PERDU !';
    gameMessageSub.textContent = 'VOUS AVEZ PERDU LA MISE';
    gameMessage.className = 'game-message infection';
  }
  updateUI();
}

// Cash out
function cashOut() {
  if (gameOver || !gameStarted) return;
  const atLeastOneSafe = revealed.some((_, i) => grid[i] !== 'virus');
  if (!atLeastOneSafe) return;
  endGame(true);
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
  if (!card || !gameStarted || gameOver) return;
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
  } catch (_) { /* lecture bloquée par le navigateur */ }
  revealCard(index);
}

// Événements (après chargement du DOM)
function initGame() {
  if (betMinus) betMinus.addEventListener('click', () => {
    const v = Math.max(0.5, (Number(betInput.value) || 10) - 1);
    betInput.value = v.toFixed(2);
    updateUI();
  });
  if (betPlus) betPlus.addEventListener('click', () => {
    const v = Math.min(balance, (Number(betInput.value) || 10) + 1);
    betInput.value = v.toFixed(2);
    updateUI();
  });
  if (betHalf) betHalf.addEventListener('click', () => {
    const v = Math.max(0.5, (Number(betInput.value) || 10) / 2);
    betInput.value = v.toFixed(2);
    updateUI();
  });
  if (betDouble) betDouble.addEventListener('click', () => {
    const v = Math.min(balance, (Number(betInput.value) || 10) * 2);
    betInput.value = v.toFixed(2);
    updateUI();
  });

  if (virusSlider) {
    virusSlider.addEventListener('input', () => {
      if (virusCountEl) virusCountEl.textContent = '(' + virusSlider.value + ')';
      if (virusMaxEl) virusMaxEl.textContent = virusSlider.value + '/24';
    });
  }

  if (betInput) {
    betInput.addEventListener('input', updateUI);
    betInput.addEventListener('change', () => {
      const v = Math.max(0.5, Math.min(balance, Number(betInput.value) || 10));
      betInput.value = v.toFixed(2);
      updateUI();
    });
  }

  if (btnLaunch) btnLaunch.addEventListener('click', startRound);
  if (btnCashout) btnCashout.addEventListener('click', cashOut);

  if (gridContainer) {
    gridContainer.addEventListener('click', onCardClick);
    renderGrid();
  }

  soundSafeStreak.load();
  startBgMusic();
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
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
    setTimeout(function() {
      splash.remove();
    }, 850);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    initGame();
    setTimeout(hideSplash, 4200);
  });
} else {
  initGame();
  setTimeout(hideSplash, 4200);
}
