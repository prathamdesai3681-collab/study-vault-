// --- CACHED THEME COLOURS FOR ALL CANVASES (NO PER-FRAME getComputedStyle) ---
const canvasThemeColors = {
  accent: '#4d8b6e',
  secondary: '#d2b77b',
  link: 'rgba(242, 243, 245, 0.16)',
  label: '#f2f3f5',
  rod: '#8b93a3',
  pivot: '#39404d'
};

function refreshCanvasThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  canvasThemeColors.accent = styles.getPropertyValue('--accent').trim() || '#4d8b6e';
  canvasThemeColors.secondary = styles.getPropertyValue('--accent-secondary').trim() || '#d2b77b';
  canvasThemeColors.link = styles.getPropertyValue('--canvas-link').trim() || 'rgba(242, 243, 245, 0.16)';
  canvasThemeColors.label = styles.getPropertyValue('--canvas-label').trim() || '#f2f3f5';
  canvasThemeColors.rod = styles.getPropertyValue('--canvas-rod').trim() || '#8b93a3';
  canvasThemeColors.pivot = styles.getPropertyValue('--canvas-pivot').trim() || '#39404d';
}

window.refreshCanvasThemeColors = refreshCanvasThemeColors;

// --- CANVAS 1: SUBTLE BACKGROUND CANVAS ---
function initCellularCanvas() {
  refreshCanvasThemeColors();
  const canvas = document.getElementById('cellCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const numCells = 35;
  const cells = Array.from({ length: numCells }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 2 + 1
  }));

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = canvasThemeColors.accent;
    ctx.strokeStyle = canvasThemeColors.accent;

    cells.forEach((c, i) => {
      c.x += c.vx; c.y += c.vy;
      if (c.x < 0 || c.x > width) c.vx *= -1;
      if (c.y < 0 || c.y > height) c.vy *= -1;

      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();

      for (let j = i + 1; j < cells.length; j++) {
        const c2 = cells[j];
        const dist = Math.hypot(c.x - c2.x, c.y - c2.y);
        if (dist < 120) {
          ctx.lineWidth = (1 - dist / 120) * 0.8;
          ctx.globalAlpha = (1 - dist / 120) * 0.25;
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(c2.x, c2.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1.0;
    });

    requestAnimationFrame(draw);
  }
  draw();
}

// --- CANVAS 2: AUDIO FREQUENCY VISUALIZER ---
function initAudioVisualizer() {
  refreshCanvasThemeColors();
  const canvas = document.getElementById('audioVisualizerCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function renderWave() {
    const w = (canvas.width = canvas.clientWidth);
    const h = (canvas.height = canvas.clientHeight);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = canvasThemeColors.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();

    const time = Date.now() * 0.003;
    for (let x = 0; x < w; x++) {
      const y = h / 2 + Math.sin(x * 0.05 + time) * 12 + Math.sin(x * 0.02 + time * 1.5) * 8;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    requestAnimationFrame(renderWave);
  }
  renderWave();
}

// --- CANVAS 3: KNOWLEDGE GRAPH CANVAS (#26) ---
function initKnowledgeGraph() {
  refreshCanvasThemeColors();
  const canvas = document.getElementById('knowledgeGraphCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const nodes = [
    { id: 1, label: 'Core Concepts', rx: 0.25, ry: 0.38, x: 0, y: 0 },
    { id: 2, label: 'Active Recall', rx: 0.62, ry: 0.28, x: 0, y: 0 },
    { id: 3, label: 'Case Studies', rx: 0.38, ry: 0.72, x: 0, y: 0 },
    { id: 4, label: 'Exam Review', rx: 0.76, ry: 0.68, x: 0, y: 0 }
  ];

  const links = [[0, 1], [0, 2], [1, 3], [2, 3]];

  function renderGraph() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    nodes.forEach(n => {
      n.x = w * n.rx;
      n.y = h * n.ry;
    });

    // Draw Links
    ctx.strokeStyle = canvasThemeColors.link;
    ctx.lineWidth = 2;
    links.forEach(([i, j]) => {
      ctx.beginPath();
      ctx.moveTo(nodes[i].x, nodes[i].y);
      ctx.lineTo(nodes[j].x, nodes[j].y);
      ctx.stroke();
    });

    // Draw Nodes
    nodes.forEach((n, idx) => {
      ctx.fillStyle = idx === 3 ? canvasThemeColors.secondary : canvasThemeColors.accent;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = canvasThemeColors.label;
      ctx.font = '10px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + 28);
    });
  }

  renderGraph();
  window.addEventListener('resize', renderGraph);
  window.resetGraphView = renderGraph;
}

// --- CANVAS 4: INTERACTIVE MOTION SANDBOX (#24) ---
let simRunning = true;
let simParams = { gravity: 9.8, length: 1.2, damping: 0.005 };
let pendAngle = Math.PI / 4;
let pendVel = 0;
let pendAcc = 0;

function initPhysicsSim() {
  refreshCanvasThemeColors();
  const canvas = document.getElementById('virtualLabCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function animateSim() {
    const w = (canvas.width = canvas.clientWidth);
    const h = (canvas.height = canvas.clientHeight);
    ctx.clearRect(0, 0, w, h);

    const originX = w / 2;
    const originY = 40;
    const pixelLength = simParams.length * 100;

    if (simRunning) {
      pendAcc = (-1 * simParams.gravity / pixelLength) * Math.sin(pendAngle);
      pendVel += pendAcc;
      pendVel *= (1 - simParams.damping);
      pendAngle += pendVel;
    }

    const bobX = originX + pixelLength * Math.sin(pendAngle);
    const bobY = originY + pixelLength * Math.cos(pendAngle);

    // Rod
    ctx.strokeStyle = canvasThemeColors.rod;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(bobX, bobY);
    ctx.stroke();

    // Pivot point
    ctx.fillStyle = canvasThemeColors.pivot;
    ctx.beginPath();
    ctx.arc(originX, originY, 6, 0, Math.PI * 2);
    ctx.fill();

    // Bob
    ctx.fillStyle = canvasThemeColors.accent;
    ctx.beginPath();
    ctx.arc(bobX, bobY, 18, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(animateSim);
  }
  animateSim();
}

function toggleSimPlay() {
  simRunning = !simRunning;
  document.getElementById('simPlayBtn').textContent = simRunning ? 'Pause' : 'Play';
}

function resetSim() {
  pendAngle = Math.PI / 4;
  pendVel = 0;
}

function updateSimParam(param, value) {
  simParams[param] = parseFloat(value);
  if (param === 'gravity') document.getElementById('valGravity').textContent = value + ' m/s²';
  if (param === 'length') document.getElementById('valLength').textContent = value + ' m';
  if (param === 'damping') document.getElementById('valDamping').textContent = value;
}
