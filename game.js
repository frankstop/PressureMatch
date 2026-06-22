const SIZE = 8;
const PIECES = [
  { id: 'red', symbol: '◆' },
  { id: 'blue', symbol: '●' },
  { id: 'green', symbol: '▲' },
  { id: 'yellow', symbol: '✦' },
  { id: 'purple', symbol: '⬟' }
];

const state = {
  board: [],
  selected: null,
  busy: false,
  paused: false,
  gameOver: false,
  score: 0,
  highScore: Number(localStorage.getItem('pressureMatchHighScore') || 0),
  pressure: 0,
  moves: 0,
  matches: 0,
  cascades: 0,
  largestCascade: 0,
  reshuffles: 0,
  startedAt: Date.now(),
  elapsed: 0,
  timer: null
};

const els = {
  board: document.getElementById('board'),
  score: document.getElementById('score'),
  highScore: document.getElementById('highScore'),
  pressureText: document.getElementById('pressureText'),
  pressureFill: document.getElementById('pressureFill'),
  pressurePanel: document.querySelector('.pressure-panel'),
  moves: document.getElementById('moves'),
  time: document.getElementById('time'),
  tier: document.getElementById('tier'),
  matches: document.getElementById('matches'),
  largestCascade: document.getElementById('largestCascade'),
  reshuffles: document.getElementById('reshuffles'),
  message: document.getElementById('message'),
  restartBtn: document.getElementById('restartBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  overlay: document.getElementById('overlay'),
  overlayKicker: document.getElementById('overlayKicker'),
  overlayTitle: document.getElementById('overlayTitle'),
  finalStats: document.getElementById('finalStats'),
  resumeBtn: document.getElementById('resumeBtn'),
  overlayRestartBtn: document.getElementById('overlayRestartBtn'),
  themeBtn: document.getElementById('themeBtn'),
  themeLabel: document.getElementById('themeLabel')
};

function randomPiece() {
  return PIECES[Math.floor(Math.random() * PIECES.length)].id;
}

function createBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      let piece = randomPiece();
      while (
        (col >= 2 && board[row][col - 1] === piece && board[row][col - 2] === piece) ||
        (row >= 2 && board[row - 1][col] === piece && board[row - 2][col] === piece)
      ) {
        piece = randomPiece();
      }
      board[row][col] = piece;
    }
  }
  return ensureMove(board);
}

function ensureMove(board) {
  let attempts = 0;
  while (!hasValidMove(board) && attempts < 40) {
    board = createBoard();
    attempts += 1;
  }
  return board;
}

function render() {
  els.board.innerHTML = '';
  state.board.forEach((row, rowIndex) => {
    row.forEach((pieceId, colIndex) => {
      const piece = PIECES.find(item => item.id === pieceId);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `${pieceId} piece at row ${rowIndex + 1}, column ${colIndex + 1}`);
      cell.dataset.row = rowIndex;
      cell.dataset.col = colIndex;
      if (state.selected && state.selected.row === rowIndex && state.selected.col === colIndex) {
        cell.classList.add('selected');
      }
      cell.innerHTML = `<div class="gem ${pieceId}"><span>${piece.symbol}</span></div>`;
      cell.addEventListener('click', () => handleCellClick(rowIndex, colIndex));
      els.board.appendChild(cell);
    });
  });
  updateHud();
}

function updateHud() {
  const pressurePercent = `${Math.min(100, state.pressure)}%`;
  const horizontalPressure = window.matchMedia('(max-width: 920px)').matches;
  els.score.textContent = state.score.toLocaleString();
  els.highScore.textContent = state.highScore.toLocaleString();
  els.pressureText.textContent = `${Math.round(state.pressure)}%`;
  els.pressureFill.style.height = horizontalPressure ? '100%' : pressurePercent;
  els.pressureFill.style.width = horizontalPressure ? pressurePercent : '100%';
  els.pressurePanel.classList.toggle('danger', state.pressure >= 78);
  els.moves.textContent = state.moves;
  els.time.textContent = formatTime(state.elapsed);
  els.matches.textContent = state.matches;
  els.largestCascade.textContent = state.largestCascade;
  els.reshuffles.textContent = state.reshuffles;
  els.tier.textContent = getTier();
}

function getTier() {
  if (state.score >= 10000) return 'Hostile';
  if (state.score >= 5000) return 'Unstable';
  if (state.score >= 2000) return 'Squeezing';
  return 'Opening';
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

async function handleCellClick(row, col) {
  if (state.busy || state.paused || state.gameOver) return;
  if (!state.selected) {
    state.selected = { row, col };
    render();
    return;
  }

  const from = state.selected;
  const to = { row, col };

  if (from.row === to.row && from.col === to.col) {
    state.selected = null;
    render();
    return;
  }

  if (!isAdjacent(from, to)) {
    state.selected = to;
    render();
    return;
  }

  state.selected = null;
  await attemptSwap(from, to);
}

function isAdjacent(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

async function attemptSwap(a, b) {
  state.busy = true;
  swap(a, b);
  render();
  await wait(120);

  const matches = findMatches(state.board);
  if (!matches.length) {
    swap(a, b);
    setMessage('That swap does not make a match.');
    render();
    state.busy = false;
    return;
  }

  state.moves += 1;
  state.pressure += pressureGain();
  await resolveBoard(matches);
  if (!hasValidMove(state.board)) {
    state.reshuffles += 1;
    state.pressure += 25;
    setMessage('Dead board. Pressure jumped and the board reshuffled.');
    state.board = createBoard();
  }
  checkEnd();
  render();
  state.busy = false;
}

function pressureGain() {
  if (state.score >= 10000) return 18;
  if (state.score >= 5000) return 16;
  if (state.score >= 2000) return 14;
  return 12;
}

async function resolveBoard(initialMatches) {
  let matches = initialMatches;
  let cascade = 0;
  let totalCleared = 0;

  while (matches.length) {
    cascade += 1;
    const cells = new Map();
    let bestRun = 0;
    matches.forEach(match => {
      bestRun = Math.max(bestRun, match.cells.length);
      match.cells.forEach(cell => cells.set(`${cell.row}-${cell.col}`, cell));
    });

    const clearCount = cells.size;
    totalCleared += clearCount;
    state.matches += matches.length;
    if (cascade > 1) state.cascades += 1;
    state.largestCascade = Math.max(state.largestCascade, cascade - 1);

    const base = scoreFor(bestRun, clearCount);
    const cascadeBonus = Math.round(base * (1 + (cascade - 1) * 0.5));
    state.score += cascadeBonus;
    state.pressure = Math.max(0, state.pressure - pressureRelief(bestRun, cascade));
    setMessage(cascade === 1 ? `Matched ${clearCount} for ${cascadeBonus}.` : `Cascade ${cascade - 1}: +${cascadeBonus}.`);
    markClearing([...cells.values()]);
    await wait(150);
    clearCells([...cells.values()]);
    applyGravity();
    refill();
    render();
    await wait(120);
    matches = findMatches(state.board);
  }

  if (totalCleared >= 24) {
    state.score += 1000;
    setMessage('Board break bonus: +1,000.');
  }

  if (state.score > state.highScore) {
    state.highScore = state.score;
    localStorage.setItem('pressureMatchHighScore', String(state.highScore));
  }
}

function scoreFor(bestRun, clearCount) {
  if (bestRun >= 5) return 500 + (clearCount - 5) * 80;
  if (bestRun === 4) return 250 + (clearCount - 4) * 70;
  return 100 + Math.max(0, clearCount - 3) * 50;
}

function pressureRelief(bestRun, cascade) {
  const matchRelief = bestRun >= 5 ? 18 : bestRun === 4 ? 10 : 5;
  return matchRelief + Math.max(0, cascade - 1) * 8;
}

function markClearing(cells) {
  cells.forEach(({ row, col }) => {
    const index = row * SIZE + col;
    els.board.children[index]?.classList.add('clearing');
  });
}

function clearCells(cells) {
  cells.forEach(({ row, col }) => {
    state.board[row][col] = null;
  });
}

function applyGravity() {
  for (let col = 0; col < SIZE; col += 1) {
    const stack = [];
    for (let row = SIZE - 1; row >= 0; row -= 1) {
      if (state.board[row][col]) stack.push(state.board[row][col]);
    }
    for (let row = SIZE - 1; row >= 0; row -= 1) {
      state.board[row][col] = stack.shift() || null;
    }
  }
}

function refill() {
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (!state.board[row][col]) state.board[row][col] = randomPiece();
    }
  }
}

function findMatches(board) {
  const matches = [];
  for (let row = 0; row < SIZE; row += 1) {
    let run = [{ row, col: 0 }];
    for (let col = 1; col <= SIZE; col += 1) {
      if (col < SIZE && board[row][col] && board[row][col] === board[row][col - 1]) {
        run.push({ row, col });
      } else {
        if (run.length >= 3) matches.push({ type: 'row', cells: [...run] });
        run = [{ row, col }];
      }
    }
  }

  for (let col = 0; col < SIZE; col += 1) {
    let run = [{ row: 0, col }];
    for (let row = 1; row <= SIZE; row += 1) {
      if (row < SIZE && board[row][col] && board[row][col] === board[row - 1][col]) {
        run.push({ row, col });
      } else {
        if (run.length >= 3) matches.push({ type: 'column', cells: [...run] });
        run = [{ row, col }];
      }
    }
  }
  return matches;
}

function hasValidMove(board) {
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const current = { row, col };
      const neighbors = [
        { row: row + 1, col },
        { row, col: col + 1 }
      ];
      for (const next of neighbors) {
        if (next.row >= SIZE || next.col >= SIZE) continue;
        swapOnBoard(board, current, next);
        const valid = findMatches(board).length > 0;
        swapOnBoard(board, current, next);
        if (valid) return true;
      }
    }
  }
  return false;
}

function swap(a, b) {
  swapOnBoard(state.board, a, b);
}

function swapOnBoard(board, a, b) {
  const temp = board[a.row][a.col];
  board[a.row][a.col] = board[b.row][b.col];
  board[b.row][b.col] = temp;
}

function checkEnd() {
  if (state.pressure >= 100) {
    state.pressure = 100;
    showGameOver();
  }
}

function showGameOver() {
  state.gameOver = true;
  clearInterval(state.timer);
  render();
  els.overlayKicker.textContent = getRank();
  els.overlayTitle.textContent = 'Game Over';
  els.finalStats.innerHTML = finalStatsMarkup();
  els.resumeBtn.classList.add('hidden');
  els.overlay.classList.remove('hidden');
}

function getRank() {
  if (state.score >= 10000) return 'Board Killer';
  if (state.score >= 6000) return 'Dangerous';
  if (state.score >= 3000) return 'Decent Run';
  if (state.score >= 1000) return 'Still Learning';
  return 'Crushed';
}

function finalStatsMarkup() {
  return [
    ['Final Score', state.score.toLocaleString()],
    ['High Score', state.highScore.toLocaleString()],
    ['Time', formatTime(state.elapsed)],
    ['Matches', state.matches],
    ['Largest Cascade', state.largestCascade],
    ['Reshuffles', state.reshuffles]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function togglePause() {
  if (state.gameOver || state.busy) return;
  state.paused = !state.paused;
  if (state.paused) {
    els.overlayKicker.textContent = 'Paused';
    els.overlayTitle.textContent = 'Run Paused';
    els.finalStats.innerHTML = finalStatsMarkup();
    els.resumeBtn.classList.remove('hidden');
    els.overlay.classList.remove('hidden');
  } else {
    els.overlay.classList.add('hidden');
  }
}

function setMessage(text) {
  els.message.textContent = text;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startTimer() {
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (!state.paused && !state.gameOver) {
      state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      updateHud();
    }
  }, 500);
}

function restart() {
  Object.assign(state, {
    board: createBoard(),
    selected: null,
    busy: false,
    paused: false,
    gameOver: false,
    score: 0,
    pressure: 0,
    moves: 0,
    matches: 0,
    cascades: 0,
    largestCascade: 0,
    reshuffles: 0,
    startedAt: Date.now(),
    elapsed: 0
  });
  els.overlay.classList.add('hidden');
  els.resumeBtn.classList.remove('hidden');
  setMessage('Make a match to start the run.');
  render();
  startTimer();
}

function setTheme(theme) {
  const bright = theme === 'bright';
  document.body.classList.toggle('bright', bright);
  els.themeLabel.textContent = bright ? 'Night' : 'Bright';
  els.themeBtn.setAttribute('aria-label', bright ? 'Switch to night mode' : 'Switch to bright mode');
  els.themeBtn.setAttribute('aria-pressed', String(bright));
  localStorage.setItem('pressureMatchTheme', theme);
}

function toggleTheme() {
  setTheme(document.body.classList.contains('bright') ? 'night' : 'bright');
}

els.restartBtn.addEventListener('click', restart);
els.overlayRestartBtn.addEventListener('click', restart);
els.pauseBtn.addEventListener('click', togglePause);
els.resumeBtn.addEventListener('click', togglePause);
els.themeBtn.addEventListener('click', toggleTheme);
window.addEventListener('resize', updateHud);

const requestedTheme = new URLSearchParams(window.location.search).get('theme');
setTheme(requestedTheme === 'bright' ? 'bright' : localStorage.getItem('pressureMatchTheme') || 'night');
restart();
