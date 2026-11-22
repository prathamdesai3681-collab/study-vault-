// --- APP STATE & INITIAL STORAGE DATA ---
const STORAGE_KEY = 'garageVaultV4';

const defaultVaultState = {
  xp: 1250,
  targetXP: 2000,
  levelTitle: 'Level 3: Scholar',
  streak: 5,
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
        { id: 'st-1', title: 'Wave-Particle Duality', completed: true },
        { id: 'st-2', title: 'Schrödinger Wave Equation', completed: true }
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

let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultVaultState;

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderHUD();
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

  // Pre-import rollback snapshot
  localStorage.setItem('garageVaultRollback', JSON.stringify(state));

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedData = JSON.parse(e.target.result);
      state = importedData;
      saveState();
      location.reload();
    } catch(err) {
      alert('Invalid JSON Backup file format.');
    }
  };
  reader.readAsText(file);
}

function rollbackImport() {
  const rollback = localStorage.getItem('garageVaultRollback');
  if (rollback) {
    state = JSON.parse(rollback);
    saveState();
    location.reload();
  } else {
    alert('No rollback snapshot available.');
  }
}

function confirmResetVault() {
  if (confirm('Are you sure you want to reset all data to default state?')) {
    state = defaultVaultState;
    saveState();
    location.reload();
  }
}
