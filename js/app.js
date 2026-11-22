// --- CANONICAL THEME SYSTEM (4 PALETTES × 2 APPEARANCES) ---
const VALID_PALETTES = ['emerald', 'indigo', 'teal', 'plum'];
const VALID_APPEARANCES = ['dark', 'light'];
const DEFAULT_THEME_SETTINGS = { palette: 'emerald', appearance: 'dark' };

const LEGACY_THEME_MAP = {
  'theme-matrix': { palette: 'emerald', appearance: 'dark' },
  'theme-cyan': { palette: 'teal', appearance: 'dark' },
  'theme-slate': { palette: 'indigo', appearance: 'dark' },
  'theme-amber': { palette: 'indigo', appearance: 'dark' },
  'theme-violet': { palette: 'plum', appearance: 'dark' },
  'theme-crimson': { palette: 'plum', appearance: 'dark' }
};

function normalizeThemeSettings(rawSettings, legacyTheme) {
  const hasSettingsObj = typeof rawSettings === 'object' && rawSettings !== null && !Array.isArray(rawSettings);
  const rawPalette = hasSettingsObj ? rawSettings.palette : null;
  const rawAppearance = hasSettingsObj ? rawSettings.appearance : null;

  const hasValidPalette = VALID_PALETTES.includes(rawPalette);
  const hasValidAppearance = VALID_APPEARANCES.includes(rawAppearance);

  // If canonical settings are valid, preserve them directly
  if (hasValidPalette && hasValidAppearance) {
    return { palette: rawPalette, appearance: rawAppearance };
  }

  // Fallback to recognized legacy theme preference if available
  const legacyMatch = typeof legacyTheme === 'string' ? LEGACY_THEME_MAP[legacyTheme] : null;

  // Also handle derived mirror strings like "teal-light" if present
  let derivedPalette = null;
  let derivedAppearance = null;
  if (!legacyMatch && typeof legacyTheme === 'string' && legacyTheme.includes('-')) {
    const parts = legacyTheme.split('-');
    if (VALID_PALETTES.includes(parts[0])) derivedPalette = parts[0];
    if (VALID_APPEARANCES.includes(parts[1])) derivedAppearance = parts[1];
  }

  const palette = hasValidPalette
    ? rawPalette
    : (legacyMatch ? legacyMatch.palette : (derivedPalette || DEFAULT_THEME_SETTINGS.palette));

  const appearance = hasValidAppearance
    ? rawAppearance
    : (legacyMatch ? legacyMatch.appearance : (derivedAppearance || DEFAULT_THEME_SETTINGS.appearance));

  return { palette, appearance };
}

function syncThemeControls(settings) {
  const paletteSelect = document.getElementById('paletteSelect');
  if (paletteSelect) {
    paletteSelect.value = settings.palette;
  }

  const appearanceBtn = document.getElementById('appearanceToggleBtn');
  const appearanceIcon = document.getElementById('appearanceIcon');
  const appearanceLabel = document.getElementById('appearanceLabel');

  if (appearanceBtn) {
    const isDark = settings.appearance === 'dark';
    appearanceBtn.setAttribute('aria-pressed', String(!isDark));
    appearanceBtn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
  }
  if (appearanceIcon) {
    appearanceIcon.setAttribute('data-lucide', settings.appearance === 'dark' ? 'moon' : 'sun');
  }
  if (appearanceLabel) {
    appearanceLabel.textContent = settings.appearance === 'dark' ? 'Dark' : 'Light';
  }
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function applyTheme(shouldSave = false) {
  const normalized = normalizeThemeSettings(state.themeSettings, state.theme);
  const derivedMirror = `${normalized.palette}-${normalized.appearance}`;

  const needsSync =
    !state.themeSettings ||
    state.themeSettings.palette !== normalized.palette ||
    state.themeSettings.appearance !== normalized.appearance ||
    state.theme !== derivedMirror;

  state.themeSettings = {
    palette: normalized.palette,
    appearance: normalized.appearance
  };
  state.theme = derivedMirror;

  const root = document.documentElement;
  root.setAttribute('data-palette', normalized.palette);
  root.setAttribute('data-appearance', normalized.appearance);
  root.classList.toggle('dark', normalized.appearance === 'dark');

  syncThemeControls(state.themeSettings);

  if (typeof window.refreshCanvasThemeColors === 'function') {
    window.refreshCanvasThemeColors();
  }

  if (typeof window.resetGraphView === 'function') {
    const stage3 = document.getElementById('labStage3');
    if (stage3 && !stage3.classList.contains('hidden')) {
      requestAnimationFrame(() => window.resetGraphView());
    }
  }

  if (shouldSave || needsSync) {
    saveState();
  }
}

function setPalette(palette) {
  if (!VALID_PALETTES.includes(palette)) return;
  const current = normalizeThemeSettings(state.themeSettings, state.theme);
  state.themeSettings = {
    palette: palette,
    appearance: current.appearance
  };
  applyTheme(true);
}

function setAppearance(appearance) {
  if (!VALID_APPEARANCES.includes(appearance)) return;
  const current = normalizeThemeSettings(state.themeSettings, state.theme);
  state.themeSettings = {
    palette: current.palette,
    appearance: appearance
  };
  applyTheme(true);
}

function toggleAppearance() {
  const current = normalizeThemeSettings(state.themeSettings, state.theme);
  setAppearance(current.appearance === 'dark' ? 'light' : 'dark');
}

// Backward-compatible wrapper for any legacy caller
function changeTheme(themeName) {
  if (VALID_PALETTES.includes(themeName)) {
    setPalette(themeName);
    return;
  }
  if (VALID_APPEARANCES.includes(themeName)) {
    setAppearance(themeName);
    return;
  }
  const mapped = LEGACY_THEME_MAP[themeName];
  if (mapped) {
    state.themeSettings = { palette: mapped.palette, appearance: mapped.appearance };
    applyTheme(true);
  }
}

// --- CLOCK & HUD ---
function updateHUDClock() {
  const now = new Date();
  document.getElementById('hudClock').textContent = now.toLocaleTimeString();
  document.getElementById('hudDate').textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
setInterval(updateHUDClock, 1000);
updateHUDClock();

function getLevelInfo(xp) {
  const safeXP = Math.max(0, Number(xp) || 0);
  const level = safeXP < 500 ? 1 : Math.floor((safeXP - 500) / 1000) + 2;
  const targetXP = level === 1 ? 500 : 500 + (level - 1) * 1000;
  const ranks = [
    'Initiate',
    'Apprentice',
    'Scholar',
    'Adept',
    'Specialist',
    'Master',
    'Grandmaster',
    'Vault Legend'
  ];
  const rankName = ranks[Math.min(level - 1, ranks.length - 1)];
  return {
    level,
    targetXP,
    levelTitle: `Level ${level}: ${rankName}`
  };
}

function renderHUD() {
  const levelInfo = getLevelInfo(state.xp);
  state.targetXP = levelInfo.targetXP;
  state.levelTitle = levelInfo.levelTitle;

  document.getElementById('currentXP').textContent = state.xp.toLocaleString();
  document.getElementById('targetXP').textContent = state.targetXP.toLocaleString();
  document.getElementById('levelTitle').textContent = state.levelTitle;
  document.getElementById('streakCount').textContent = state.streak + ' Days';

  const pct = Math.min(100, Math.max(0, (state.xp / state.targetXP) * 100));
  document.getElementById('xpBar').style.width = pct + '%';
}

function addXP(amount) {
  const prevLevel = getLevelInfo(state.xp).level;
  state.xp = Math.max(0, state.xp + amount);
  const nextInfo = getLevelInfo(state.xp);
  state.targetXP = nextInfo.targetXP;
  state.levelTitle = nextInfo.levelTitle;

  if (nextInfo.level > prevLevel) {
    playSuccessChime();
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  } else {
    playBeep(880, 'sine', 0.15);
  }
  saveState();
}

// --- TAB & STAGE SWITCHING ---
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.dock-btn').forEach(el => {
    el.classList.remove('active', 'accent-text');
    el.classList.add('text-muted');
  });

  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.add('active');

  const targetDock = document.getElementById(`dock-${tabId}`);
  if (targetDock) {
    targetDock.classList.add('active', 'accent-text');
    targetDock.classList.remove('text-muted');
  }

  if (tabId === 'labs') {
    const stage3 = document.getElementById('labStage3');
    if (stage3 && !stage3.classList.contains('hidden') && typeof window.resetGraphView === 'function') {
      requestAnimationFrame(() => window.resetGraphView());
    }
  }

  playBeep(500, 'sine', 0.05);
}

function switchLabStage(stageId) {
  ['stage2', 'stage3', 'stage4'].forEach(st => {
    const stageEl = document.getElementById(`labS${st.slice(1)}`);
    const btnEl = document.getElementById(`btnS${st.slice(1)}`);
    if (stageEl) stageEl.classList.add('hidden');
    if (btnEl) {
      btnEl.classList.remove('is-active', 'accent-text');
    }
  });
  const activeStage = document.getElementById(`labS${stageId.slice(1)}`);
  const activeBtn = document.getElementById(`btnS${stageId.slice(1)}`);
  if (activeStage) activeStage.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.classList.add('is-active', 'accent-text');
  }

  if (stageId === 'stage3' && typeof window.resetGraphView === 'function') {
    requestAnimationFrame(() => window.resetGraphView());
  }
}

// --- MODAL UTILITIES ---
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  if (id === 'examModal') renderExamList();
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function renderExamList() {
  const list = document.getElementById('examList');
  list.innerHTML = state.exams.map(e => {
    const days = Math.ceil((new Date(e.date) - new Date()) / (1000 * 60 * 60 * 24));
    return `
      <div class="p-3 rounded-xl surface-elevated flex justify-between items-center">
        <div>
          <span class="font-semibold text-xs text-main block">${e.title}</span>
          <span class="text-[10px] font-mono text-muted">${e.date}</span>
        </div>
        <span class="text-xs font-bold font-mono accent-text">${days > 0 ? days + ' Days Left' : 'Today'}</span>
      </div>
    `;
  }).join('');
}

function addExam() {
  const title = document.getElementById('newExamTitle').value;
  const date = document.getElementById('newExamDate').value;
  if (title && date) {
    state.exams.push({ id: Date.now(), title, date });
    saveState();
    renderExamList();
  }
}

// --- WINDOW ONLOAD INITIALIZATION ---
window.onload = function() {
  if (typeof state === 'undefined') {
    alert('js/storage.js failed to load. Check that the file is named js/storage.js (all lowercase) on GitHub.');
    return;
  }

  try { applyTheme(false); } catch(e) { console.error(e); }

  try { initCellularCanvas(); } catch(e) { console.error(e); }
  try { initAudioVisualizer(); } catch(e) { console.error(e); }
  try { initKnowledgeGraph(); } catch(e) { console.error(e); }
  try { initPhysicsSim(); } catch(e) { console.error(e); }

  try { initIndexedDB(); } catch(e) { console.error(e); }
  try { renderHUD(); } catch(e) { console.error(e); }
  try { renderStudyMap(); } catch(e) { console.error(e); }
  try { renderCard(); } catch(e) { console.error(e); }
  try { renderSmartLinks(); } catch(e) { console.error(e); }
  try { renderMnemonics(); } catch(e) { console.error(e); }
  try { updateMarkdownPreview(); } catch(e) { console.error(e); }

  // Sync SFX icon with saved mute state
  const sfxIcon = document.getElementById('sfxIcon');
  if (sfxIcon && state.sfxMuted) {
    sfxIcon.setAttribute('data-lucide', 'volume-x');
  }

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
};
