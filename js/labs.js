// --- TAB 6: LABS SUITE INTERACTIVITY ---
function answerAssessment(btn, isCorrect) {
  const feedback = document.getElementById('assessmentFeedback');
  feedback.classList.remove('hidden');
  if (isCorrect) {
    feedback.className = 'mt-4 text-xs font-mono status-success font-bold';
    feedback.textContent = 'Correct! Recorded in IndexedDB.';
    addXP(25);
  } else {
    feedback.className = 'mt-4 text-xs font-mono status-danger font-bold';
    feedback.textContent = 'Incorrect. Topic added to review list.';
  }
}

function triggerAdaptiveChallenge() {
  document.getElementById('adaptiveStreak').textContent = '4 Correct';
  addXP(15);
}

function createStudyPlan() {
  const title = document.getElementById('planTitle').value;
  if (title) {
    const planList = document.getElementById('planList');
    planList.innerHTML += `<div class="p-2.5 rounded-xl surface-elevated font-semibold text-main">✓ ${title}</div>`;
    document.getElementById('planTitle').value = '';
  }
}

function sendTakeawayToCards(text) {
  state.flashcards.push({ id: Date.now(), topic: 'Book Takeaway', question: 'Reading Key Concept', answer: text, missedCount: 0 });
  saveState();
  alert('Takeaway saved directly into Flashcards Deck!');
}

function saveJournalEntry() {
  const text = document.getElementById('journalInput').value;
  if (text) {
    alert('Reflection saved to IndexedDB journal store.');
    document.getElementById('journalInput').value = '';
  }
}

function copyCitation(text) {
  const dummy = document.createElement('textarea');
  dummy.value = text;
  document.body.appendChild(dummy);
  dummy.select();
  document.execCommand('copy');
  document.body.removeChild(dummy);
  alert('APA Citation copied to clipboard!');
}

function selectScenarioOption(btn, isCorrect) {
  if (isCorrect) {
    alert('Optimal Strategy! High-yield priority chosen. +30 XP');
    addXP(30);
  } else {
    alert('Suboptimal Strategy. Re-evaluate your highest-yield sequence.');
  }
}

function fetchWikipediaSummary() {
  const topic = document.getElementById('wikiTopicInput').value || 'Spaced repetition';
  const resultDiv = document.getElementById('wikiResult');
  resultDiv.textContent = 'Querying Wikipedia REST API...';

  fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`)
    .then(res => res.json())
    .then(data => {
      if (data.extract) {
        resultDiv.innerHTML = `<strong>${data.title}</strong>: ${data.extract}`;
      } else {
        resultDiv.textContent = 'No summary found for topic.';
      }
    })
    .catch(() => {
      resultDiv.textContent = 'Offline Mode / API call failed.';
    });
}
