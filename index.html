```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Garage's Study Vault v3.0</title>
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Font Awesome Icons -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');

    * {
      font-family: 'Plus Jakarta Sans', sans-serif;
      box-sizing: border-box;
    }

    body {
      background-color: #050816;
      color: #e2e8f0;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Canvas background */
    #cellCanvas {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 0;
      pointer-events: auto;
    }

    /* Glassmorphism Styles */
    .glass-panel {
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(56, 189, 248, 0.2);
      box-shadow: 0 12px 40px 0 rgba(0, 0, 0, 0.5), inset 0 0 15px 0 rgba(0, 240, 255, 0.05);
      border-radius: 1.25rem;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .glass-panel:hover {
      border-color: rgba(0, 240, 255, 0.4);
      box-shadow: 0 16px 48px 0 rgba(0, 0, 0, 0.6), inset 0 0 20px 0 rgba(0, 240, 255, 0.08);
    }

    .glass-input {
      background: rgba(5, 8, 22, 0.7);
      border: 1px solid rgba(148, 163, 184, 0.2);
      color: #f8fafc;
      transition: all 0.2s ease;
    }

    .glass-input:focus {
      border-color: #00f0ff;
      box-shadow: 0 0 12px rgba(0, 240, 255, 0.3);
      outline: none;
    }

    /* Neon Gradient Texts & Glows */
    .neon-text-cyan {
      background: linear-gradient(135deg, #00f0ff 0%, #38bdf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .neon-text-violet {
      background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .neon-button {
      background: linear-gradient(135deg, rgba(0, 240, 255, 0.2) 0%, rgba(139, 92, 246, 0.25) 100%);
      border: 1px solid rgba(0, 240, 255, 0.4);
      color: #ffffff;
      transition: all 0.2s ease;
    }

    .neon-button:hover {
      background: linear-gradient(135deg, rgba(0, 240, 255, 0.35) 0%, rgba(139, 92, 246, 0.4) 100%);
      border-color: #00f0ff;
      box-shadow: 0 0 18px rgba(0, 240, 255, 0.4);
      transform: translateY(-1px);
    }

    .neon-button:active {
      transform: translateY(1px);
    }

    /* Custom Scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: rgba(5, 8, 22, 0.5);
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(56, 189, 248, 0.3);
      border-radius: 999px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 240, 255, 0.6);
    }

    /* Level Card active outline */
    .level-card.active {
      border-color: #00f0ff !important;
      background: rgba(0, 240, 255, 0.08) !important;
      box-shadow: 0 0 20px rgba(0, 240, 255, 0.25);
    }

    /* Keyframe Animations */
    @keyframes pulseGlow {
      0%, 100% { opacity: 0.6; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.03); }
    }
    .pulse-effect {
      animation: pulseGlow 3s infinite ease-in-out;
    }
  </style>
</head>
<body class="relative">

  <!-- Interactive Cellular Canvas Background -->
  <canvas id="cellCanvas"></canvas>

  <!-- Notification Toast Container -->
  <div id="toastContainer" class="fixed top-5 right-5 z-50 flex flex-col gap-3 pointer-events-none"></div>

  <!-- App Main Content Container -->
  <div class="relative z-10 max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 flex flex-col gap-6">

    <!-- Top Header Bar -->
    <header class="glass-panel p-5 flex flex-col md:flex-row justify-between items-center gap-4">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-violet-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
          <i class="fa-solid fa-atom text-2xl text-white"></i>
        </div>
        <div>
          <h1 class="text-2xl font-extrabold tracking-tight neon-text-cyan">Garage's Study Vault</h1>
          <p class="text-xs text-slate-400 flex items-center gap-2">
            <span class="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
            Version 3.0 • Interactive Cellular Ecosystem
          </p>
        </div>
      </div>

      <!-- Stats & Quick Actions -->
      <div class="flex flex-wrap items-center gap-3">
        <div class="px-4 py-2 rounded-xl bg-violet-950/60 border border-violet-500/40 flex items-center gap-2">
          <i class="fa-solid fa-bolt text-yellow-400 text-sm"></i>
          <span id="xpDisplay" class="text-sm font-bold text-violet-200">0 XP</span>
          <span class="text-xs text-violet-400">|</span>
          <span id="rankBadge" class="text-xs font-semibold text-cyan-300">Level 1 Novice</span>
        </div>

        <button onclick="exportBackupJSON()" class="neon-button px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2" title="Export entire vault state to JSON file">
          <i class="fa-solid fa-download text-cyan-400"></i> Export Backup
        </button>

        <label for="importFile" class="neon-button px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer flex items-center gap-2" title="Import vault backup JSON">
          <i class="fa-solid fa-upload text-violet-400"></i> Import
        </label>
        <input type="file" id="importFile" accept=".json" class="hidden" onchange="importBackupJSON(event)" />

        <button onclick="resetVaultPrompt()" class="px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition">
          <i class="fa-solid fa-rotate-left"></i>
        </button>
      </div>
    </header>

    <!-- Main Grid Dashboard -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">

      <!-- Column 1: Pomodoro Arena & Study Map (Left 6 cols) -->
      <div class="lg:col-span-6 flex flex-col gap-6">

        <!-- Pomodoro Focus Arena -->
        <section class="glass-panel p-6 flex flex-col gap-5 relative overflow-hidden">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-stopwatch text-cyan-400 text-lg"></i>
              <h2 class="text-lg font-bold text-slate-100">Focus Arena</h2>
            </div>
            <div class="text-xs text-slate-400 bg-slate-900/60 px-3 py-1 rounded-full border border-slate-700/50">
              Tracking: <span id="activeLevelTrack" class="text-cyan-300 font-semibold">Level 01</span>
            </div>
          </div>

          <!-- Digital Clock Display -->
          <div class="flex flex-col items-center justify-center py-4 rounded-2xl bg-slate-950/40 border border-cyan-500/20 relative">
            <div id="timerDisplay" class="text-6xl sm:text-7xl font-extrabold tracking-widest text-cyan-300 drop-shadow-[0_0_25px_rgba(0,240,255,0.4)] font-mono">
              25:00
            </div>
            <div id="timerModeLabel" class="text-xs font-semibold tracking-wider uppercase text-slate-400 mt-2">
              Focus Session
            </div>
          </div>

          <!-- Timer Preset Controls -->
          <div class="grid grid-cols-4 gap-2">
            <button onclick="setTimerPreset(25, 'Focus Session')" class="glass-input py-2 rounded-xl text-xs font-semibold hover:border-cyan-400 transition">25m</button>
            <button onclick="setTimerPreset(50, 'Deep Work')" class="glass-input py-2 rounded-xl text-xs font-semibold hover:border-cyan-400 transition">50m</button>
            <button onclick="setTimerPreset(5, 'Short Break')" class="glass-input py-2 rounded-xl text-xs font-semibold hover:border-violet-400 transition">5m Break</button>
            <button onclick="setTimerPreset(15, 'Long Break')" class="glass-input py-2 rounded-xl text-xs font-semibold hover:border-violet-400 transition">15m Break</button>
          </div>

          <!-- Timer Actions & Ambient Audio Toggle -->
          <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div class="flex items-center gap-2">
              <button id="startTimerBtn" onclick="toggleTimer()" class="neon-button px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2">
                <i class="fa-solid fa-play"></i> Start Focus
              </button>
              <button onclick="resetTimer()" class="glass-input px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/50">
                <i class="fa-solid fa-rotate-right"></i> Reset
              </button>
            </div>

            <button id="soundToggleBtn" onclick="toggleAmbientDrone()" class="glass-input px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 text-slate-300 hover:border-violet-400 transition">
              <i id="soundIcon" class="fa-solid fa-volume-xmark text-slate-400"></i>
              <span id="soundText">Drone: OFF</span>
            </button>
          </div>
        </section>

        <!-- Gamified Study Map -->
        <section class="glass-panel p-6 flex flex-col gap-4">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-map-location-dot text-violet-400 text-lg"></i>
              <h2 class="text-lg font-bold text-slate-100">Study Map Levels</h2>
            </div>
            <button onclick="openAddLevelModal()" class="neon-button px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5">
              <i class="fa-solid fa-plus"></i> New Level
            </button>
          </div>

          <!-- Levels Container List -->
          <div id="levelsContainer" class="flex flex-col gap-3 max-h-[320px] overflow-y-auto pr-1">
            <!-- Dynamic Level cards render here -->
          </div>
        </section>

      </div>

      <!-- Column 2: Drive & File Vault + Scratchpad Notes (Right 6 cols) -->
      <div class="lg:col-span-6 flex flex-col gap-6">

        <!-- Drive, Photos & File Vault -->
        <section class="glass-panel p-6 flex flex-col gap-4">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-folder-closed text-cyan-400 text-lg"></i>
              <h2 class="text-lg font-bold text-slate-100">Drive & Resource Vault</h2>
            </div>
            <span class="text-xs text-slate-400">Cloud & Local Storage</span>
          </div>

          <!-- Input Controls to Add Resource -->
          <div class="flex flex-col gap-3 bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
            <input type="text" id="resTitleInput" placeholder="Resource Title (e.g. Anatomy Chapter 4 PDF)" class="glass-input px-3.5 py-2 rounded-xl text-xs w-full" />
            
            <div class="flex flex-col sm:flex-row gap-2">
              <input type="url" id="resUrlInput" placeholder="Paste Google Drive / Photos link here..." class="glass-input px-3.5 py-2 rounded-xl text-xs flex-1" />
              <button onclick="addUrlResource()" class="neon-button px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap">
                <i class="fa-solid fa-link"></i> Add Link
              </button>
            </div>

            <div class="flex items-center justify-between pt-1 border-t border-slate-800/60">
              <span class="text-[11px] text-slate-400">Or attach local study file / screenshot:</span>
              <label for="localFileInput" class="glass-input px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer hover:border-cyan-400 flex items-center gap-1.5">
                <i class="fa-solid fa-paperclip text-cyan-400"></i> Upload Local File
              </label>
              <input type="file" id="localFileInput" accept="image/*,.pdf,.txt" class="hidden" onchange="addLocalFileResource(event)" />
            </div>
          </div>

          <!-- Saved Resources List -->
          <div id="resourceList" class="flex flex-col gap-2 max-h-[180px] overflow-y-auto pr-1">
            <!-- Dynamic Resources render here -->
          </div>

          <!-- Embedded Inline Preview Box -->
          <div id="previewContainer" class="hidden flex-col gap-2 mt-2 p-3 rounded-xl bg-slate-950/80 border border-cyan-500/30">
            <div class="flex justify-between items-center">
              <span id="previewTitle" class="text-xs font-bold text-cyan-300 truncate">Preview</span>
              <button onclick="closePreview()" class="text-slate-400 hover:text-rose-400 text-xs px-2 py-0.5">
                <i class="fa-solid fa-xmark"></i> Close Preview
              </button>
            </div>
            <div id="previewBody" class="w-full rounded-lg overflow-hidden max-h-[260px] flex items-center justify-center bg-black/40">
              <!-- Dynamic iframe or img -->
            </div>
          </div>
        </section>

        <!-- Quick Notes Scratchpad -->
        <section class="glass-panel p-6 flex flex-col gap-3 flex-1">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-pen-to-square text-violet-400 text-lg"></i>
              <h2 class="text-lg font-bold text-slate-100">Translucent Scratchpad</h2>
            </div>
            <div class="flex items-center gap-2">
              <span id="noteStats" class="text-[11px] text-slate-400">0 words</span>
              <button onclick="exportMarkdownNotes()" class="neon-button px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5" title="Download notes as .md file">
                <i class="fa-solid fa-file-arrow-down text-violet-300"></i> Export .md
              </button>
            </div>
          </div>

          <textarea id="scratchpad" rows="7" placeholder="Type quick formulas, study summaries, key terms, or thoughts here... (Auto-saved automatically)" class="glass-input w-full p-3.5 rounded-xl text-xs leading-relaxed resize-none flex-1 focus:border-violet-400"></textarea>
        </section>

      </div>

    </div>
  </div>

  <!-- Modal for Adding New Level -->
  <div id="addLevelModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm hidden">
    <div class="glass-panel p-6 w-full max-w-md flex flex-col gap-4">
      <div class="flex justify-between items-center">
        <h3 class="text-lg font-bold text-cyan-300">Create Study Level</h3>
        <button onclick="closeAddLevelModal()" class="text-slate-400 hover:text-white"><i class="fa-solid fa-xmark"></i></button>
      </div>
      
      <div class="flex flex-col gap-3">
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Level Title</label>
          <input type="text" id="newLevelTitle" placeholder="e.g. Level 03: Quantum Mechanics" class="glass-input px-3.5 py-2 rounded-xl text-xs w-full" />
        </div>
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Target Focus Sessions</label>
          <input type="number" id="newLevelTarget" value="4" min="1" max="50" class="glass-input px-3.5 py-2 rounded-xl text-xs w-full" />
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <button onclick="closeAddLevelModal()" class="glass-input px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white">Cancel</button>
        <button onclick="saveNewLevel()" class="neon-button px-5 py-2 rounded-xl text-xs font-bold">Save Level</button>
      </div>
    </div>
  </div>

  <!-- APP JAVASCRIPT LOGIC -->
  <script>
    /* ==========================================================================
       1. INTERACTIVE CELLULAR CANVAS BACKGROUND PHYSICS
       ========================================================================== */
    const canvas = document.getElementById('cellCanvas');
    const ctx = canvas.getContext('2d');

    let cells = [];
    const NUM_CELLS = 28;

    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Initialize cells
    function initCells() {
      cells = [];
      for (let i = 0; i < NUM_CELLS; i++) {
        cells.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: 16 + Math.random() * 26,
          vx: (Math.random() - 0.5) * 0.9,
          vy: (Math.random() - 0.5) * 0.9,
          hue: Math.random() > 0.4 ? 185 : 265, // Cyan or Violet hue accent
          phase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.015 + Math.random() * 0.02
        });
      }
    }
    initCells();

    // Trigger impulse scatter force from point (cx, cy)
    function scatterCells(cx, cy) {
      const blastRadius = 240;
      cells.forEach(c => {
        const dx = c.x - cx;
        const dy = c.y - cy;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < blastRadius) {
          const force = ((blastRadius - dist) / blastRadius) * 14;
          c.vx += (dx / dist) * force;
          c.vy += (dy / dist) * force;
        }
      });
    }

    // Pointer event interactions
    window.addEventListener('click', (e) => {
      // Ignore click if user is clicking on interactive glass panel forms/buttons
      if (e.target.closest('.glass-panel') || e.target.closest('#addLevelModal')) return;
      scatterCells(e.clientX, e.clientY);
    });

    window.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0 && !e.target.closest('.glass-panel')) {
        scatterCells(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    // Main animation rendering loop
    function renderCells() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      cells.forEach(c => {
        // Move with physics velocity & dampening
        c.x += c.vx;
        c.y += c.vy;
        c.vx *= 0.988;
        c.vy *= 0.988;

        // Ensure minimum organic ambient motion
        c.phase += c.pulseSpeed;
        if (Math.abs(c.vx) < 0.25) c.vx += (Math.random() - 0.5) * 0.08;
        if (Math.abs(c.vy) < 0.25) c.vy += (Math.random() - 0.5) * 0.08;

        // Wall collisions / bounces
        if (c.x < c.radius) { c.x = c.radius; c.vx *= -1; }
        if (c.x > canvas.width - c.radius) { c.x = canvas.width - c.radius; c.vx *= -1; }
        if (c.y < c.radius) { c.y = c.radius; c.vy *= -1; }
        if (c.y > canvas.height - c.radius) { c.y = canvas.height - c.radius; c.vy *= -1; }

        const currentRadius = c.radius + Math.sin(c.phase) * 3;

        // 1. Draw Cytoplasm Outer Membrane (Radial Gradient Glow)
        const radGrad = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, currentRadius * 1.4);
        radGrad.addColorStop(0, `hsla(${c.hue}, 100%, 75%, 0.25)`);
        radGrad.addColorStop(0.6, `hsla(${c.hue}, 90%, 55%, 0.1)`);
        radGrad.addColorStop(1, `hsla(${c.hue}, 90%, 50%, 0)`);

        ctx.beginPath();
        ctx.arc(c.x, c.y, currentRadius * 1.4, 0, Math.PI * 2);
        ctx.fillStyle = radGrad;
        ctx.fill();

        // 2. Cell Wall double ring
        ctx.beginPath();
        ctx.arc(c.x, c.y, currentRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${c.hue}, 100%, 70%, 0.4)`;
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // 3. Nucleus & Internal Organelles
        const
