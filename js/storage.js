// --- APP STATE & INITIAL STORAGE DATA ---
const STORAGE_KEY = 'garageVaultV4';
const ROLLBACK_KEY = 'garageVaultRollback';

const defaultVaultState = {
  xp: 0,
  targetXP: 500,
  levelTitle: 'Level 1: Initiate',
  streak: 0,
  theme: 'theme-cyan',
  sfxMuted: false,
  exams: [
    { id: 1, title: 'Quantum Mechanics Midterm', date: '2026-12-05' },
    { id: 2, title: 'Organic Chemistry Finals', date: '2026-12-15' }
  ],
  flashcards: [
    { id: 1, topic: 'Physics', question: 'What is Heisenberg\'s Uncertainty Principle?', answer: 'It states that one cannot simultaneously know both the exact position and momentum of a particle with absolute precision.', missedCount: 0 },
    { id: 2, topic: 'Computer Science', question: 'What is the time complexity of QuickSort average case?', answer: 'O(n log n).', missedCount: 0 },
    { id: 3, topic: 'Mathematics', question: 'What is Euler\'s Identity formula?', answer: 'e^(i*pi) + 1 = 0.', missedCount: 0 }
  ],
  studyMap: [
    {
      id: 'lvl-1',
      title: 'Level 1: Quantum Foundations',
      subtopics: [
        { id: 'st-1', title: 'Wave-Particle Duality', completed: false },
        { id: 'st-2', title: 'Schrödinger Wave Equation', completed: false }
      ]
    },
    {
      id: 'lvl-2',
      title: 'Level 2: Advanced Mechanics',
      subtopics: [
        { id: 'st-3', title: 'Hilbert Spaces & Bra-Ket Notation', completed: false },
        { id: 'st-4', title: 'Quantum Entanglement & Bell Inequality', completed: false }
      ]
    }
  ],
  smartLinks: [
    { id: 1, title: 'MIT 8.04 Quantum Physics Lectures', url: 'https://ocw.mit.edu', category: 'Lectures' },
    { id: 2, title: 'Linear Algebra Cheat Sheet PDF', url: 'https://example.com/sheet.pdf', category: 'PDFs' },
    { id: 3, title: 'Interactive Physics Simulations', url: 'https://phet.colorado.edu', category: 'Websites' }
  ],
  mnemonics: [
    { id: 1, title: 'Euler\'s Formula', text: 'e^(iθ) = cos(θ) + i sin(θ)' },
    { id: 2, title: 'Newton\'s 2nd Law', text: 'F = m × a' }
  ]
};

let isStorageLockedForRecovery = false;
let rawCorruptedStorageValue = null;

function cloneVaultState(source) {
  return JSON.parse(JSON.stringify(source));
}

function validateVaultState(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, error: 'Backup root must be a valid JSON object.' };
  }
  if (typeof data.xp !== 'number' || !Number.isFinite(data.xp) || data.xp < 0) {
    return { valid: false, error: 'Invalid or missing "xp" (must be a non-negative number).' };
  }
  if (typeof data.targetXP !== 'number' || !Number.isFinite(data.targetXP) || data.targetXP <= 0) {
    return { valid: false, error: 'Invalid or missing "targetXP" (must be a positive number).' };
  }
  if (typeof data.levelTitle !== 'string') {
    return { valid: false, error: 'Invalid or missing "levelTitle" (must be a string).' };
  }
  if (typeof data.streak !== 'number' || !Number.isFinite(data.streak) || data.streak < 0) {
    return { valid: false, error: 'Invalid or missing "streak" (must be a non-negative number).' };
  }
  if (typeof data.theme !== 'string') {
    return { valid: false, error: 'Invalid or missing "theme" (must be a string).' };
  }
  if (typeof data.sfxMuted !== 'boolean') {
    return { valid: false, error: 'Invalid or missing "sfxMuted" (must be a boolean).' };
  }

  if (!Array.isArray(data.exams) || !data.exams.every(e =>
    typeof e === 'object' && e !== null && typeof e.title === 'string' && typeof e.date === 'string'
  )) {
    return { valid: false, error: 'Invalid or missing "exams" list.' };
  }

  if (!Array.isArray(data.flashcards) || !data.flashcards.every(c =>
    typeof c === 'object' && c !== null && typeof c.question === 'string' && typeof c.answer === 'string'
  )) {
    return { valid: false, error: 'Invalid or missing "flashcards" list.' };
  }

  if (!Array.isArray(data.studyMap) || !data.studyMap.every(lvl =>
    typeof lvl === 'object' && lvl !== null &&
    typeof lvl.title === 'string' &&
    Array.isArray(lvl.subtopics) &&
    lvl.subtopics.every(st =>
      typeof st === 'object' && st !== null &&
      typeof st.title === 'string' &&
      typeof st.completed === 'boolean'
    )
  )) {
    return { valid: false, error: 'Invalid or missing "studyMap" structure.' };
  }

  if (!Array.isArray(data.smartLinks) || !data.smartLinks.every(l =>
    typeof l === 'object' && l !== null &&
    typeof l.title === 'string' &&
    typeof l.url === 'string' &&
    typeof l.category === 'string'
  )) {
    return { valid: false, error: 'Invalid or missing "smartLinks" list.' };
  }

  if (!Array.isArray(data.mnemonics) || !data.mnemonics.every(m =>
    typeof m === 'object' && m !== null &&
    typeof m.title === 'string' &&
    typeof m.text === 'string'
  )) {
    return { valid: false, error: 'Invalid or missing "mnemonics" list.' };
  }

  return { valid: true, error: null };
}

function loadInitialState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.error('Unable to read localStorage:', err);
    return cloneVaultState(defaultVaultState);
  }

  if (raw === null) {
    return cloneVaultState(defaultVaultState);
  }

  try {
    const parsed = JSON.parse(raw);
    const check = validateVaultState(parsed);
    if (!check.valid) {
      throw new Error(check.error);
    }
    return parsed;
  } catch (err) {
    isStorageLockedForRecovery = true;
    rawCorruptedStorageValue = raw;
    console.error('Corrupted vault data detected in localStorage key "' + STORAGE_KEY + '". Original raw data preserved untouched.', err);
    setTimeout(() => {
      alert(
        'Warning: Saved vault data in "' + STORAGE_KEY + '" appears corrupted and could not be loaded.\n\n' +
        'Your original raw data has been preserved untouched in browser storage. The app is running in temporary safe mode (auto-save is paused) until you import a valid backup or reset the vault from the Database modal.'
      );
    }, 300);
    return cloneVaultState(defaultVaultState);
  }
}

let state = loadInitialState();

// --- INDEXEDDB STORAGE SUITE ---
const DB_NAME = 'StudyVaultDB';
const DB_VERSION = 1;
let dbInstance = null;

function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const stores = ['assessments', 'studyPlans', 'books', 'journal', 'citations', 'skills', 'timelines', 'scenarios', 'challenges', 'discoveries', 'simulations', 'meta'];
      stores.forEach(store => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
        }
      });
    };
    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };
    req.onerror = (e) => reject(e);
  });
}

function saveState() {
  if (isStorageLockedForRecovery) {
    console.warn('Auto-save skipped to preserve original corrupted data in "' + STORAGE_KEY + '". Use Import or Reset to unlock storage.');
    if (typeof renderHUD === 'function') renderHUD();
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save vault state to localStorage:', err);
  }

  if (typeof renderHUD === 'function') renderHUD();
}

// --- DATABASE & BACKUP VAULT MODAL ACTIONS ---
function openDatabaseModal() {
  openModal('databaseModal');
  const bytes = new Blob([JSON.stringify(state)]).size;
  document.getElementById('localStoreSize').textContent = (bytes / 1024).toFixed(1) + ' KB';
}

function exportVaultJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `garage_study_vault_v4_backup_${Date.now()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function importVaultJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedData = JSON.parse(e.target.result);
      const validation = validateVaultState(importedData);
      if (!validation.valid) {
        alert('Import rejected: ' + validation.error);
        event.target.value = '';
        return;
      }

      // Save rollback snapshot only after validation passes and only if current storage is healthy
      if (!isStorageLockedForRecovery) {
        localStorage.setItem(ROLLBACK_KEY, JSON.stringify(state));
      }

      isStorageLockedForRecovery = false;
      rawCorruptedStorageValue = null;
      state = cloneVaultState(importedData);
      saveState();
      location.reload();
    } catch (err) {
      alert('Import rejected: Invalid JSON backup file format.');
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function rollbackImport() {
  const rollback = localStorage.getItem(ROLLBACK_KEY);
  if (!rollback) {
    alert('No rollback snapshot available.');
    return;
  }

  try {
    const parsedRollback = JSON.parse(rollback);
    const validation = validateVaultState(parsedRollback);
    if (!validation.valid) {
      alert('Rollback aborted: Saved rollback snapshot is invalid (' + validation.error + ').');
      return;
    }

    isStorageLockedForRecovery = false;
    rawCorruptedStorageValue = null;
    state = cloneVaultState(parsedRollback);
    saveState();
    location.reload();
  } catch (err) {
    alert('Rollback aborted: Saved rollback snapshot could not be parsed.');
  }
}

function confirmResetVault() {
  if (confirm('Are you sure you want to reset all data to default state?')) {
    isStorageLockedForRecovery = false;
    rawCorruptedStorageValue = null;
    state = cloneVaultState(defaultVaultState);
    saveState();
    location.reload();
  }
}
