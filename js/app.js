// --- CLOCK & HUD ---
function updateHUDClock() {
  const now = new Date();
  document.getElementById('hudClock').textContent = now.toLocaleTimeString();
  document.getElementById('hudDate').textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
setInterval(updateHUDClock, 1000);
updateHUDClock();

function renderHUD() {
  document.getElementById('currentXP').textContent = state.xp.toLocaleString();
  document.getElementById('targetXP').textContent = state.targetXP.toLocaleString();
  document.getElementById('levelTitle').textContent = state.levelTitle;
  document.getElementById('streakCount').textContent = state.streak + ' Days';
  
  const pct = Math.min(100, Math.max(0, (state.xp / state.targetXP) * 100));
  document.getElementById('xpBar').style.width = pct + '%';
}

function addXP(amount) {
  state.xp += amount;
  if (state.xp >= state.targetXP) {
    state.targetXP += 1000;
    playSuccessChime();
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  } else {
    playBeep(880, 'sine', 0.15);
  }
  saveState();
}

function changeTheme(themeName) {
  document.documentElement.className = `dark ${themeName}`;
  state.theme = themeName;
  saveState();
}

// --- TAB & STAGE SWITCHING ---
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.dock-btn').forEach(el => {
    el.classList.remove('active', 'accent-text');
    el.classList.add('text-slate-400');
  });

  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.add('active');

  const targetDock = document.getElementById(`dock-${tabId}`);
  if (targetDock) {
    targetDock.classList.add('active', 'accent-text');
    targetDock.classList.remove('text-slate-400');
  }

  playBeep(500, 'sine', 0.05);
}

function switchLabStage(stageId) {
  ['stage2', 'stage3', 'stage4'].forEach(st => {
    const stageEl = document.getElementById(`labS${st.slice(1)}`);
    const btnEl = document.getElementById(`btnS${st.slice(1)}`);
    if (stageEl) stageEl.classList.add('hidden');
    if (btnEl) {
      btnEl.classList.remove('bg-slate-800', 'accent-text');
      btnEl.classList.add('bg-slate-900', 'text-slate-400');
    }
  });
  const activeStage = document.getElementById(`labS${stageId.slice(1)}`);
  const activeBtn = document.getElementById(`btnS${stageId.slice(1)}`);
  if (activeStage) activeStage.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.classList.add('bg-slate-800', 'accent-text');
    activeBtn.classList.remove('bg-slate-900', 'text-slate-400');
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
      <div class="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex justify-between items-center">
        <div>
          <span class="font-bold text-xs text-slate-100 block">${e.title}</span>
          <span class="text-[10px] font-mono text-slate-400">${e.date}</span>
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
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  try { initCellularCanvas(); } catch(e) { console.error(e); }
  try { initAudioVisualizer(); } catch(e) { console.error(e); }
  try { initKnowledgeGraph(); } catch(e) { console.error(e); }
  try { initPhysicsSim(); } catch(e) { console.error(e); }

  if (typeof state === 'undefined') {
    alert('js/storage.js failed to load. Check that the file is named js/storage.js (all lowercase) on GitHub.');
    return;
  }

  try { initIndexedDB(); } catch(e) { console.error(e); }
  try { changeTheme(state.theme); } catch(e) { console.error(e); }
  try { renderHUD(); } catch(e) { console.error(e); }
  try { renderStudyMap(); } catch(e) { console.error(e); }
  try { renderCard(); } catch(e) { console.error(e); }
  try { renderSmartLinks(); } catch(e) { console.error(e); }
  try { renderMnemonics(); } catch(e) { console.error(e); }
  try { updateMarkdownPreview(); } catch(e) { console.error(e); }

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
};
