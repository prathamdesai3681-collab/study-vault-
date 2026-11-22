// --- TAB 1: FOCUS TIMER ---
let timerInterval = null;
let timerTotalSeconds = 25 * 60;
let timerRemainingSeconds = 25 * 60;
let isTimerRunning = false;

function updateTimerDisplay() {
  const mins = Math.floor(timerRemainingSeconds / 60);
  const secs = timerRemainingSeconds % 60;
  document.getElementById('timerDisplay').textContent = 
    `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // Ring SVG update
  const totalDash = 377;
  const offset = totalDash - (timerRemainingSeconds / timerTotalSeconds) * totalDash;
  document.getElementById('timerProgressCircle').style.strokeDashoffset = offset;
}

function toggleTimer() {
  if (isTimerRunning) {
    clearInterval(timerInterval);
    isTimerRunning = false;
    document.getElementById('startTimerText').textContent = 'Start Focus';
    document.getElementById('startTimerIcon').setAttribute('data-lucide', 'play');
  } else {
    isTimerRunning = true;
    document.getElementById('startTimerText').textContent = 'Pause Focus';
    document.getElementById('startTimerIcon').setAttribute('data-lucide', 'pause');
    timerInterval = setInterval(() => {
      if (timerRemainingSeconds > 0) {
        timerRemainingSeconds--;
        updateTimerDisplay();
      } else {
        clearInterval(timerInterval);
        isTimerRunning = false;
        addXP(50);
        playSuccessChime();
        confetti({ particleCount: 120, spread: 80 });
        resetTimer();
      }
    }, 1000);
  }
  lucide.createIcons();
}

function resetTimer() {
  clearInterval(timerInterval);
  isTimerRunning = false;
  timerRemainingSeconds = timerTotalSeconds;
  updateTimerDisplay();
  document.getElementById('startTimerText').textContent = 'Start Focus';
  document.getElementById('startTimerIcon').setAttribute('data-lucide', 'play');
  lucide.createIcons();
}

function setTimerPreset(seconds, isRelative = false) {
  if (isRelative || seconds < 0) {
    timerTotalSeconds = Math.max(60, timerTotalSeconds + seconds);
  } else {
    timerTotalSeconds = seconds;
  }
  timerRemainingSeconds = timerTotalSeconds;
  resetTimer();
}

function toggleZenMode() {
  const header = document.querySelector('header');
  header.classList.toggle('hidden');
}

function claimMissionXP(checkbox) {
  if (checkbox.checked) {
    addXP(25);
    checkbox.disabled = true;
  }
}

// --- TAB 2: STUDY MAP ---
function renderStudyMap() {
  const container = document.getElementById('studyMapContainer');
  container.innerHTML = state.studyMap.map(lvl => `
    <div class="glass-panel rounded-2xl p-4 sm:p-5 space-y-3">
      <div class="flex justify-between items-center gap-2">
        <h3 class="font-bold text-sm text-main">${lvl.title}</h3>
        <button type="button" onclick="addSubtopicPrompt('${lvl.id}')" class="text-xs text-sub hover:accent-text font-semibold whitespace-nowrap">+ Add Topic</button>
      </div>
      <div class="space-y-2">
        ${lvl.subtopics.map(st => `
          <div class="flex items-center justify-between gap-3 p-3 rounded-xl surface-elevated">
            <div class="flex items-center gap-3 min-w-0">
              <input type="checkbox" id="${st.id}" ${st.completed ? 'checked' : ''} onchange="toggleSubtopic('${lvl.id}', '${st.id}', this.checked)" class="w-4 h-4 shrink-0 rounded cursor-pointer">
              <label for="${st.id}" class="text-xs font-medium text-main cursor-pointer ${st.completed ? 'line-through opacity-55' : ''}">${st.title}</label>
            </div>
            <span class="text-[10px] font-mono status-success whitespace-nowrap">+10 XP</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function toggleSubtopic(lvlId, stId, isChecked) {
  const lvl = state.studyMap.find(l => l.id === lvlId);
  if (lvl) {
    const st = lvl.subtopics.find(s => s.id === stId);
    if (st) {
      st.completed = isChecked;
      if (isChecked) {
        addXP(10);
      } else {
        state.xp = Math.max(0, state.xp - 10);
      }
      saveState();
      renderStudyMap();
    }
  }
}

function addMapLevelPrompt() {
  const title = prompt('Enter new Module or Subject title:');
  if (title) {
    state.studyMap.push({
      id: 'lvl-' + Date.now(),
      title: title,
      subtopics: []
    });
    saveState();
    renderStudyMap();
  }
}

function addSubtopicPrompt(lvlId) {
  const title = prompt('Enter topic title:');
  if (title) {
    const lvl = state.studyMap.find(l => l.id === lvlId);
    if (lvl) {
      lvl.subtopics.push({ id: 'st-' + Date.now(), title, completed: false });
      saveState();
      renderStudyMap();
    }
  }
}

// --- TAB 3: FLASHCARDS ---
let currentCardIndex = 0;
let isCardFlipped = false;

function renderCard() {
  if (state.flashcards.length === 0) return;
  const card = state.flashcards[currentCardIndex];
  document.getElementById('cardTopic').textContent = card.topic || 'General';
  document.getElementById('cardCounter').textContent = `Card ${currentCardIndex + 1} of ${state.flashcards.length}`;
  document.getElementById('cardQuestion').textContent = card.question;
  document.getElementById('cardAnswer').textContent = card.answer;

  const inner = document.getElementById('flashcardInner');
  inner.classList.remove('rotate-y-180');
  isCardFlipped = false;
}

function flipCard() {
  const inner = document.getElementById('flashcardInner');
  isCardFlipped = !isCardFlipped;
  if (isCardFlipped) {
    inner.classList.add('rotate-y-180');
  } else {
    inner.classList.remove('rotate-y-180');
  }
  playBeep(700, 'sine', 0.05);
}

function prevCard() {
  if (currentCardIndex > 0) currentCardIndex--;
  else currentCardIndex = state.flashcards.length - 1;
  renderCard();
}

function nextCard() {
  if (currentCardIndex < state.flashcards.length - 1) currentCardIndex++;
  else currentCardIndex = 0;
  renderCard();
}

function rateCard(mastered) {
  const card = state.flashcards[currentCardIndex];
  if (mastered) {
    addXP(10);
    confetti({ particleCount: 50, spread: 60 });
  } else {
    card.missedCount = (card.missedCount || 0) + 1;
    saveState();
  }
  nextCard();
}

function saveNewCard() {
  const topic = document.getElementById('newCardTopic').value;
  const question = document.getElementById('newCardQuestion').value;
  const answer = document.getElementById('newCardAnswer').value;

  if (question && answer) {
    state.flashcards.push({ id: Date.now(), topic, question, answer, missedCount: 0 });
    saveState();
    renderCard();
    closeModal('addCardModal');
  }
}

// --- TAB 4: SMART LINK HUB ---
let currentLinkFilter = 'All';

function filterLinks(cat) {
  currentLinkFilter = cat;
  document.querySelectorAll('#linkCategoryPills .link-pill').forEach(btn => {
    const isMatch = btn.getAttribute('data-link-cat') === cat;
    btn.classList.toggle('is-active', isMatch);
  });
  renderSmartLinks();
}

function renderSmartLinks() {
  const query = document.getElementById('linkSearchInput').value.toLowerCase();
  const grid = document.getElementById('smartLinksGrid');

  const filtered = state.smartLinks.filter(item => {
    const matchesCat = (currentLinkFilter === 'All' || item.category === currentLinkFilter);
    const matchesSearch = item.title.toLowerCase().includes(query);
    return matchesCat && matchesSearch;
  });

  grid.innerHTML = filtered.map(link => `
    <div class="p-4 rounded-xl surface-elevated glass-panel-hover flex flex-col justify-between">
      <div>
        <div class="flex justify-between items-center mb-2">
          <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase surface-inset text-sub font-mono">${link.category}</span>
          <button type="button" onclick="deleteLink(${link.id})" class="text-muted hover:status-danger p-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>
        <h4 class="font-semibold text-sm text-main mb-2">${link.title}</h4>
      </div>
      <a href="${link.url}" target="_blank" rel="noopener" class="mt-4 text-xs font-semibold accent-text flex items-center gap-1 hover:underline">
        Open Resource <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
      </a>
    </div>
  `).join('');
  lucide.createIcons();
}

function saveNewLink() {
  const title = document.getElementById('newLinkTitle').value;
  const url = document.getElementById('newLinkURL').value;
  const category = document.getElementById('newLinkCategory').value;
  if (title && url) {
    state.smartLinks.push({ id: Date.now(), title, url, category });
    saveState();
    renderSmartLinks();
    closeModal('addLinkModal');
  }
}

function deleteLink(id) {
  state.smartLinks = state.smartLinks.filter(l => l.id !== id);
  saveState();
  renderSmartLinks();
}

// --- TAB 5: NOTES & MARKDOWN ---
function renderMnemonics() {
  const bar = document.getElementById('mnemonicsBar');
  bar.innerHTML = state.mnemonics.map(m => `
    <div class="flex-none p-3.5 rounded-xl surface-elevated min-w-[210px] flex justify-between items-center gap-3">
      <div>
        <span class="text-[10px] font-mono text-muted block">${m.title}</span>
        <span class="text-xs font-semibold text-main font-mono">${m.text}</span>
      </div>
      <button type="button" onclick="deleteMnemonic(${m.id})" class="text-muted hover:status-danger p-1"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
    </div>
  `).join('');
  lucide.createIcons();
}

function saveNewMnemonic() {
  const title = document.getElementById('newMnemonicTitle').value;
  const formula = document.getElementById('newMnemonicFormula').value;
  if (title && formula) {
    state.mnemonics.push({ id: Date.now(), title, text: formula });
    saveState();
    renderMnemonics();
    closeModal('addMnemonicModal');
  }
}

function deleteMnemonic(id) {
  state.mnemonics = state.mnemonics.filter(m => m.id !== id);
  saveState();
  renderMnemonics();
}

function updateMarkdownPreview() {
  const text = document.getElementById('markdownEditor').value;
  const preview = document.getElementById('markdownPreview');
  preview.innerHTML = marked.parse(text);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.getElementById('wordCount').textContent = words + ' words';
  document.getElementById('charCount').textContent = text.length + ' chars';
}

function saveMarkdownNote() {
  const title = document.getElementById('noteTitleInput').value || 'Untitled Note';
  const content = document.getElementById('markdownEditor').value;
  if (content) {
    addXP(15);
    alert(`Note "${title}" saved cleanly.`);
  }
}

function exportMarkdownNote() {
  const title = document.getElementById('noteTitleInput').value || 'vault-note';
  const content = document.getElementById('markdownEditor').value;
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.toLowerCase().replace(/\s+/g, '-')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
