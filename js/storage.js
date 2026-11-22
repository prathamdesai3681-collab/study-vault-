// --- APP STATE & INITIAL STORAGE DATA ---
const STORAGE_KEY = 'garageVaultV4';
const ROLLBACK_KEY = 'garageVaultRollback';

const defaultVaultState = {
  xp: 0,
  targetXP: 500,
  levelTitle: 'Level 1: Initiate',
  streak: 0,
  theme: 'theme-slate',
  sfxMuted: false,
  exams: [
    { id: 1, title: 'Core Subject Midterm', date: '2026-12-05' },
    { id: 2, title: 'Semester Final Assessment', date: '2026-12-15' }
  ],
  flashcards: [
    { id: 1, topic: 'Study Skills', question: 'What is Active Recall?', answer: 'Actively retrieving information from memory rather than passively re-reading notes or textbooks.', missedCount: 0 },
    { id: 2, topic: 'Study Skills', question: 'How does Spaced Repetition improve retention?', answer: 'Reviewing material at gradually increasing intervals right before forgetting strengthens long-term memory.', missedCount: 0 },
    { id: 3, topic: 'Study Skills', question: 'What is the Feynman Technique?', answer: 'Explaining a concept in plain, simple language to expose and fix gaps in your understanding.', missedCount: 0 }
  ],
  studyMap: [
    {
      id: 'lvl-1',
      title: 'Module 1: Core Foundations',
      subtopics: [
        { id: 'st-1', title: 'Key Concepts & Terminology', completed: false },
        { id: 'st-2', title: 'Summary Notes & Diagrams', completed: false }
      ]
    },
    {
      id: 'lvl-2',
      title: 'Module 2: Applied Practice',
      subtopics: [
        { id: 'st-3', title: 'Case Studies & Problem Sets', completed: false },
        { id: 'st-4', title: 'Past Papers & Mock Review', completed: false }
      ]
    }
  ],
  smartLinks: [
    { id: 1, title: 'MIT OpenCourseWare (All Disciplines)', url: 'https://ocw.mit.edu', category: 'Lectures' },
    { id: 2, title: 'Khan Academy Library', url: 'https://www.khanacademy.org', category: 'Websites' },
    { id: 3, title: 'OpenStax Free Textbooks (PDF)', url: 'https://openstax.org', category: 'PDFs' }
  ],
  mnemonics: [
    { id: 1, title: 'SQ3R Reading Method', text: 'Survey • Question • Read • Recite • Review' },
    { id: 2, title: 'SMART Study Goals', text: 'Specific • Measurable • Achievable • Relevant • Time-bound' }
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
