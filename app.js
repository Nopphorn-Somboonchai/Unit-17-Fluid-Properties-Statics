// Utility Functions (Performance Optimization)
function throttle(func, limit) {
    let inThrottle;
    return function () {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

function debounce(func, delay) {
    let debounceTimer;
    return function () {
        const context = this;
        const args = arguments;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(context, args), delay);
    }
}

let mathJaxQueue = Promise.resolve();
function queueTypeset(element) {
    if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        mathJaxQueue = mathJaxQueue.then(() => {
            MathJax.typesetClear([element]);
            return MathJax.typesetPromise([element]).catch(err => console.log(err));
        });
    }
}

// ==========================================
// RANDOM UTILITY FUNCTIONS (Seeded RNG)
// ==========================================

class SeededRNG {
    constructor(seedStr) {
        let hash = 0;
        for (let i = 0; i < seedStr.length; i++) hash = (hash * 31 + seedStr.charCodeAt(i)) | 0;
        this.seed = hash || 1;
    }
    random() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    shuffle(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
}

function pureShuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function formatChoiceExplanation(template, shuffledChoices) {
    if (!template || !template.choiceExplanations || !Array.isArray(shuffledChoices)) {
        return '';
    }
    return shuffledChoices.map((c, i) => {
        const origIdx = template.choices.indexOf(c);
        if (origIdx !== -1 && template.choiceExplanations[origIdx]) {
            const exp = template.choiceExplanations[origIdx];
            const statusTag = exp.isCorrect ? 'ถูก' : 'ผิด';
            return `- **ข้อ ${i + 1} ${statusTag}:** ${exp.text}`;
        }
        return '';
    }).filter(Boolean).join('<br>');
}

// Function to generate a seeded random number
function getSeededRandomBase(questionId, seed, min, max, step = 1) {
    const seedStr = `${questionId}_${seed}`;
    const rng = new SeededRNG(seedStr);
    const steps = Math.floor((max - min) / step);
    return min + Math.floor(rng.random() * (steps + 1)) * step;
}

function getOffsetFromR(r) {
    if (!r) return 0;
    if (typeof r === 'string') {
        if (r.includes('_')) {
            const studentNum = parseInt(r.split('_')[0], 10);
            return Number.isFinite(studentNum) ? studentNum : 0;
        }
        const parsed = parseInt(r, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof r === 'number') {
        return (r % 9) + 1; // offset 1-9 to keep calculations clean
    }
    return 0;
}

function normalizeStudentNumber(n) {
    const parsed = parseInt(n, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

// ==========================================
// SYSTEM STATE & STORAGE UTILITIES
// ==========================================

const HISTORY_KEY = 'fluids_question_history';

function getHistory() {
    if (typeof window === 'undefined') return [];
    try {
        const data = localStorage.getItem(HISTORY_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('Failed to read from localStorage', e);
        return [];
    }
}

function addToHistory(uniqueKey) {
    if (typeof window === 'undefined') return;
    try {
        let history = getHistory();
        history = history.filter(key => key !== uniqueKey);
        history.push(uniqueKey);
        if (history.length > 100) {
            history = history.slice(history.length - 100);
        }
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.error('Failed to write to localStorage', e);
    }
}

function getActiveParamValues(params) {
    const values = [];
    for (const key in params) {
        if (key !== 'r' && key !== 'offset' && !key.endsWith('_base') && typeof params[key] === 'number') {
            values.push(params[key]);
        }
    }
    return values;
}

function hasDuplicateVariables(params) {
    const vals = getActiveParamValues(params);
    const set = new Set(vals);
    return set.size !== vals.length;
}

function generateUniqueKey(templateId, params) {
    const vals = [];
    const keys = Object.keys(params).filter(k => k !== 'r' && k !== 'offset' && !k.endsWith('_base'));
    keys.sort();
    keys.forEach(k => {
        if (typeof params[k] === 'number') {
            vals.push(`${k}:${Number(params[k].toFixed(4))}`);
        } else {
            vals.push(`${k}:${params[k]}`);
        }
    });
    return `${templateId}[${vals.join(',')}]`;
}

// Global constant for gravity
const g = 10;

// System State Variables
let currentSection = 'home';
let currentPracticeTopic = '17-2-1';
let currentPracticeQuestion = null;
let practiceHistory = {}; // Store { 'topic_name': [template_id_1, template_id_2] }

// Exam State
let currentExamQuestions = [];
let examTimerInterval = null;
let examTimeRemaining = 900; // 15 mins
let examDurationSeconds = 900;
const EXAM_STATE_KEY = 'exam_session_fluids_17_2';
let examStartTimestamp = null;
let examDeadlineTimestamp = null;
let examIsActive = false;
let examSubmissionInProgress = false;
let examStudentInfo = {};
let examSeed = null;
let examExitGuardEnabled = false;

// --- Helper Math / Format Functions ---
function cleanAndParseNumber(str) {
    let clean = str.trim().toLowerCase().replace(/\\times/g, 'e').replace(/x/g, 'e').replace(/\*/g, 'e').replace(/10\^/g, '').replace(/\{/g, '').replace(/\}/g, '').replace(/\s+/g, '');
    if (clean.includes('e')) {
        const parts = clean.split('e');
        return parseFloat(parts[0]) * Math.pow(10, parseFloat(parts[1]));
    }
    return parseFloat(clean);
}

function isNumericAnswerCorrect(userStr, targetNumOrArr) {
    if (!userStr) return false;
    const parsedUser = cleanAndParseNumber(userStr);
    if (isNaN(parsedUser)) return false;
    const targets = Array.isArray(targetNumOrArr) ? targetNumOrArr : [targetNumOrArr];
    return targets.some(targetNum => {
        if (Math.abs(targetNum) < 1e-9) return Math.abs(parsedUser) < 1e-9;
        return Math.abs(parsedUser - targetNum) / Math.abs(targetNum) < 0.05; // 5% tolerance
    });
}

function formatExamTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function formatScientificLaTeX(num, precision = 2, forceScientific = false) {
    if (num === null || num === undefined || isNaN(num)) return '';
    const absVal = Math.abs(num);
    if (absVal === 0) return '0';
    if (forceScientific || absVal >= 1e4 || absVal < 1e-3) {
        const str = num.toExponential(precision);
        const parts = str.split('e');
        const base = parts[0];
        const exp = parseInt(parts[1], 10);
        return `${base} \\times 10^{${exp}}`;
    }
    if (Number.isInteger(num)) return num.toString();
    return num.toFixed(precision);
}

// --- Navigation & Core UI ---
function showSection(sectionId) {
    let norm = sectionId.startsWith('sec-') ? sectionId.slice(4) : sectionId;
    if (examIsActive && !['exam-live', 'exam-result'].includes(norm)) {
        triggerAlert("กำลังสอบ", "กรุณาส่งข้อสอบก่อนออกจากหน้าสอบครับ", "fa-lock", "bg-red-100 text-red-600");
        norm = 'exam-live';
    }
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) mobileMenu.classList.add('hidden');

    ['home', 'review', 'practice', 'exam-start', 'exam-live', 'exam-result'].forEach(s => {
        const sec = document.getElementById('sec-' + s);
        if (sec) sec.classList.toggle('hidden', s !== norm);
    });

    if (norm !== 'exam-live' && !examIsActive) clearInterval(examTimerInterval);
    currentSection = norm;
    window.scrollTo(0, 0);

    // Initializations for simulators
    stopSimulations();
    if (norm === 'review') {
        const btnT = document.getElementById('btn-tab-17-2-tension');
        const btnV = document.getElementById('btn-tab-17-2-viscosity');
        const activeTab = (btnT && btnT.classList.contains('bg-white'))
            ? '17-2-tension'
            : ((btnV && btnV.classList.contains('bg-white')) ? '17-2-viscosity' : '17-3-buoyancy');

        if (activeTab === '17-2-tension') initTensionSim();
        else if (activeTab === '17-2-viscosity') initViscositySim();
        else initBuoyancySim();
    }

    renderMath();
}

function toggleMobileMenu() {
    const mm = document.getElementById('mobile-menu');
    if (mm) mm.classList.toggle('hidden');
}

function triggerAlert(title, message, iconClass = 'fa-info', colorClass = 'bg-slate-100 text-slate-800') {
    const m = document.getElementById('modal-alert'), c = document.getElementById('modal-alert-card'), i = document.getElementById('modal-alert-icon');
    document.getElementById('modal-alert-title').innerText = title;
    document.getElementById('modal-alert-msg').innerText = message;
    i.className = `w-16 h-16 rounded-full mx-auto flex items-center justify-center text-3xl ${colorClass}`;
    i.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    m.classList.remove('hidden');
    setTimeout(() => { c.classList.remove('scale-95', 'opacity-0'); }, 10);
}

function closeAlertModal() {
    const m = document.getElementById('modal-alert'), c = document.getElementById('modal-alert-card');
    c.classList.add('scale-95', 'opacity-0');
    setTimeout(() => { m.classList.add('hidden'); }, 200);
}

function renderMath() {
    if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        MathJax.typesetPromise().catch(err => console.log(err));
    }
}

// --- Review Tabs Logic ---
function switchReviewTab(tabName) {
    ['17-2-tension', '17-2-viscosity', '17-3-buoyancy'].forEach(t => {
        const btn = document.getElementById(`btn-tab-${t}`), tab = document.getElementById(`review-tab-${t}`);
        if (btn && tab) {
            if (t === tabName) {
                btn.className = "flex-1 min-w-[140px] text-center py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-200 bg-white text-cyan-800 shadow-sm border border-slate-200/50";
                tab.classList.remove('hidden');
            } else {
                btn.className = "flex-1 min-w-[140px] text-center py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-200 text-slate-500 hover:text-slate-800 hover:bg-slate-200/50";
                tab.classList.add('hidden');
            }
        }
    });
    stopSimulations();
    if (tabName === '17-2-tension') initTensionSim();
    if (tabName === '17-2-viscosity') initViscositySim();
    if (tabName === '17-3-buoyancy') initBuoyancySim();
}

let activeAnimFrame = null;
function stopSimulations() {
    if (activeAnimFrame) {
        cancelAnimationFrame(activeAnimFrame);
        activeAnimFrame = null;
    }
}

// ==========================================
// SIMULATOR 1: Viscosity & Stokes' Law
// ==========================================

let vParams = {
    fluidViscosity: 1.5, // Pa.s
    fluidDensity: 1420,  // Honey density
    sphereR: 0.004,      // 4mm
    sphereDensity: 7800, // Steel density
    
    // Dynamic state
    sphereY: 30,         // pixel height
    sphereV: 0,          // m/s
    sphereA: 0,          // m/s^2
    simTime: 0,          // s
    isFalling: false,
    graphData: []        // history for v-t plot
};

function initViscositySim() {
    stopSimulations();
    const selectFluid = document.getElementById('viscosity-fluid-select');
    const sR = document.getElementById('viscosity-r-slider');
    const lblR = document.getElementById('lbl-r-val');

    const updateParams = () => {
        vParams.fluidViscosity = parseFloat(selectFluid.value);
        if (vParams.fluidViscosity === 1.50) vParams.fluidDensity = 1420;
        else if (vParams.fluidViscosity === 0.29) vParams.fluidDensity = 800;
        else vParams.fluidDensity = 1000;

        vParams.sphereR = parseFloat(sR.value) / 1000;
        lblR.innerText = (vParams.sphereR * 1000).toFixed(1) + ' mm';

        // Calculate theoretical terminal velocity
        // vt = 2/9 * r^2 * g * (p_s - p_f) / eta
        const gConst = 9.8;
        let vt = (2 / 9) * (Math.pow(vParams.sphereR, 2) * gConst * (vParams.sphereDensity - vParams.fluidDensity)) / vParams.fluidViscosity;
        if (vParams.fluidViscosity === 0.001) vt = 4.2; // visual capping

        document.getElementById('val-viscosity-vt').innerText = vt.toFixed(2) + ' m/s';

        if (!vParams.isFalling) {
            document.getElementById('val-viscosity-v').innerText = '0.00 m/s';
            document.getElementById('val-viscosity-fd').innerText = '0.00 N';
            document.getElementById('val-viscosity-time').innerText = '0.00 s';
        }
    };

    selectFluid.onchange = updateParams;
    sR.oninput = updateParams;

    updateParams();
    renderViscosityLoop();
}

function dropSphere() {
    vParams.sphereY = 30;
    vParams.sphereV = 0;
    vParams.simTime = 0;
    vParams.graphData = [];
    vParams.isFalling = true;

    const state = document.getElementById('lbl-viscosity-state');
    if (state) {
        state.innerText = 'กำลังตก';
        state.className = 'text-xs px-2 py-0.5 bg-cyan-100 text-cyan-800 font-bold rounded';
    }

    const btn = document.getElementById('btn-drop-sphere');
    if (btn) {
        btn.disabled = true;
        btn.className = 'flex-1 py-3 bg-slate-300 text-slate-500 font-bold rounded-xl cursor-not-allowed transition flex items-center justify-center gap-2';
    }
}

function resetViscositySim() {
    vParams.sphereY = 30;
    vParams.sphereV = 0;
    vParams.simTime = 0;
    vParams.isFalling = false;
    vParams.graphData = [];

    const state = document.getElementById('lbl-viscosity-state');
    if (state) {
        state.innerText = 'พร้อมปล่อย';
        state.className = 'text-xs px-2 py-0.5 bg-teal-100 text-teal-800 font-bold rounded';
    }

    const btn = document.getElementById('btn-drop-sphere');
    if (btn) {
        btn.disabled = false;
        btn.className = 'flex-1 py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2';
    }

    // Reset displayed dynamic values
    const valV = document.getElementById('val-viscosity-v');
    const valFd = document.getElementById('val-viscosity-fd');
    const valTime = document.getElementById('val-viscosity-time');
    if (valV) valV.innerText = '0.00 m/s';
    if (valFd) valFd.innerText = '0.00 N';
    if (valTime) valTime.innerText = '0.00 s';

    updateViscosityParams();
}

function updateViscosityParams() {
    const selectFluid = document.getElementById('viscosity-fluid-select');
    const sR = document.getElementById('viscosity-r-slider');
    if (selectFluid && sR) {
        vParams.fluidViscosity = parseFloat(selectFluid.value);
        if (vParams.fluidViscosity === 1.50) vParams.fluidDensity = 1420;
        else if (vParams.fluidViscosity === 0.29) vParams.fluidDensity = 800;
        else vParams.fluidDensity = 1000;

        vParams.sphereR = parseFloat(sR.value) / 1000;
        document.getElementById('lbl-r-val').innerText = (vParams.sphereR * 1000).toFixed(1) + ' mm';
        let vt = (2 / 9) * (Math.pow(vParams.sphereR, 2) * 9.8 * (vParams.sphereDensity - vParams.fluidDensity)) / vParams.fluidViscosity;
        if (vParams.fluidViscosity === 0.001) vt = 4.2;
        document.getElementById('val-viscosity-vt').innerText = vt.toFixed(2) + ' m/s';
    }
}

function renderViscosityLoop() {
    const tubeCanvas = document.getElementById('viscosityCanvas');
    const graphCanvas = document.getElementById('viscosityGraphCanvas');
    if (!tubeCanvas || !graphCanvas) return;

    const tCtx = tubeCanvas.getContext('2d');
    const gCtx = graphCanvas.getContext('2d');
    const tw = tubeCanvas.width;
    const th = tubeCanvas.height;
    const gw = graphCanvas.width;
    const gh = graphCanvas.height;

    tCtx.clearRect(0, 0, tw, th);

    // Tube Dimensions
    const tubeX = tw / 2 - 20;
    const tubeY = 15;
    const tubeW = 40;
    const tubeH = th - 30;

    // Liquid fill colors
    tCtx.fillStyle = vParams.fluidViscosity === 1.50 
        ? 'rgba(245, 158, 11, 0.25)' 
        : vParams.fluidViscosity === 0.29
            ? 'rgba(249, 115, 22, 0.18)' 
            : 'rgba(6, 182, 212, 0.15)';
    tCtx.fillRect(tubeX + 2, tubeY + 2, tubeW - 4, tubeH - 4);

    // Tube contour
    tCtx.strokeStyle = '#94a3b8';
    tCtx.lineWidth = 2.5;
    tCtx.beginPath();
    tCtx.moveTo(tubeX, tubeY);
    tCtx.lineTo(tubeX, tubeY + tubeH);
    tCtx.lineTo(tubeX + tubeW, tubeY + tubeH);
    tCtx.lineTo(tubeX + tubeW, tubeY);
    tCtx.stroke();

    // Physics step calculations
    const gConst = 9.8;
    const sphereVol = (4 / 3) * Math.PI * Math.pow(vParams.sphereR, 3);
    const sphereMass = sphereVol * vParams.sphereDensity;
    const Fg = sphereMass * gConst;
    const Fb = sphereVol * vParams.fluidDensity * gConst;
    let dragF = 0;

    let theoreticalVt = (2 / 9) * (Math.pow(vParams.sphereR, 2) * gConst * (vParams.sphereDensity - vParams.fluidDensity)) / vParams.fluidViscosity;
    if (vParams.fluidViscosity === 0.001) theoreticalVt = 4.2;

    if (vParams.isFalling) {
        const dt = 0.016;
        vParams.simTime += dt;

        dragF = 6 * Math.PI * vParams.fluidViscosity * vParams.sphereR * vParams.sphereV;
        const netDownForce = Fg - Fb;
        if (dragF > netDownForce) dragF = netDownForce;

        const netF = Fg - Fb - dragF;
        vParams.sphereA = netF / sphereMass;
        vParams.sphereV += vParams.sphereA * dt;

        const scaleMtoPx = (tubeH - 30) / 0.14;
        vParams.sphereY += (vParams.sphereV * dt) * scaleMtoPx;

        vParams.graphData.push({ t: vParams.simTime, v: vParams.sphereV });

        const bottomLimit = tubeY + tubeH - 12;
        if (vParams.sphereY >= bottomLimit) {
            vParams.sphereY = bottomLimit;
            vParams.sphereV = 0;
            vParams.sphereA = 0;
            vParams.isFalling = false;

            const state = document.getElementById('lbl-viscosity-state');
            if (state) {
                state.innerText = 'ตกถึงก้น';
                state.className = 'text-xs px-2 py-0.5 bg-slate-200 text-slate-800 font-bold rounded';
            }

            const btn = document.getElementById('btn-drop-sphere');
            if (btn) {
                btn.disabled = false;
                btn.className = 'flex-1 py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2';
            }
        }

        document.getElementById('val-viscosity-v').innerText = vParams.sphereV.toFixed(2) + ' m/s';
        document.getElementById('val-viscosity-fd').innerText = dragF.toExponential(2) + ' N';
        document.getElementById('val-viscosity-time').innerText = vParams.simTime.toFixed(2) + ' s';
    }

    // Draw sphere
    const sphereRadiusPx = Math.max(3, vParams.sphereR * 1000);
    tCtx.fillStyle = '#334155';
    tCtx.strokeStyle = '#ffffff';
    tCtx.lineWidth = 1;
    tCtx.beginPath();
    tCtx.arc(tw / 2, vParams.sphereY, sphereRadiusPx, 0, Math.PI * 2);
    tCtx.fill();
    tCtx.stroke();

    // Visualizing forces
    if (vParams.isFalling && vParams.sphereV > 0.01) {
        const midX = tw / 2;
        const midY = vParams.sphereY;

        tCtx.strokeStyle = '#ef4444';
        tCtx.lineWidth = 1.5;
        tCtx.beginPath();
        tCtx.moveTo(midX, midY);
        tCtx.lineTo(midX, midY + 25);
        tCtx.stroke();

        tCtx.strokeStyle = '#10b981';
        tCtx.beginPath();
        tCtx.moveTo(midX, midY);
        tCtx.lineTo(midX, midY - 10);
        tCtx.stroke();

        tCtx.strokeStyle = '#f97316';
        tCtx.beginPath();
        tCtx.moveTo(midX, midY - 10);
        const dragLength = Math.min(25, (dragF / (Fg - Fb)) * 25);
        tCtx.lineTo(midX, midY - 10 - dragLength);
        tCtx.stroke();
    }

    // 2. GRAPH PLOTTING
    gCtx.clearRect(0, 0, gw, gh);

    const ox = 25;
    const oy = gh - 20;
    const graphW = gw - 45;
    const graphH = gh - 35;

    gCtx.strokeStyle = '#cbd5e1';
    gCtx.lineWidth = 1;
    gCtx.beginPath();
    gCtx.moveTo(ox, oy - graphH);
    gCtx.lineTo(ox, oy);
    gCtx.lineTo(ox + graphW, oy);
    gCtx.stroke();

    gCtx.strokeStyle = '#f97316';
    gCtx.lineWidth = 0.8;
    gCtx.setLineDash([3, 3]);
    const maxYVal = theoreticalVt * 1.25;
    const vtYPx = oy - (theoreticalVt / maxYVal) * graphH;
    gCtx.beginPath();
    gCtx.moveTo(ox, vtYPx);
    gCtx.lineTo(ox + graphW, vtYPx);
    gCtx.stroke();
    gCtx.setLineDash([]);

    gCtx.fillStyle = '#64748b';
    gCtx.font = '7px Sarabun';
    gCtx.textAlign = 'right';
    gCtx.fillText('v (m/s)', ox - 4, oy - graphH + 5);
    gCtx.textAlign = 'center';
    gCtx.fillText('เวลา t (s)', ox + graphW - 10, oy + 12);
    gCtx.textAlign = 'right';
    gCtx.fillText(theoreticalVt.toFixed(2), ox - 4, vtYPx + 3);

    if (vParams.graphData.length > 0) {
        gCtx.strokeStyle = '#0891b2';
        gCtx.lineWidth = 2;
        gCtx.beginPath();
        const maxTimePlotted = Math.max(2.5, vParams.simTime);
        for (let i = 0; i < vParams.graphData.length; i++) {
            const pt = vParams.graphData[i];
            const pxX = ox + (pt.t / maxTimePlotted) * graphW;
            const pxY = oy - (pt.v / maxYVal) * graphH;
            if (i === 0) gCtx.moveTo(pxX, pxY);
            else gCtx.lineTo(pxX, pxY);
        }
        gCtx.stroke();

        const lastPt = vParams.graphData[vParams.graphData.length - 1];
        const dotX = ox + (lastPt.t / maxTimePlotted) * graphW;
        const dotY = oy - (lastPt.v / maxYVal) * graphH;
        gCtx.fillStyle = '#ef4444';
        gCtx.beginPath();
        gCtx.arc(dotX, dotY, 3.5, 0, Math.PI * 2);
        gCtx.fill();
    }

    activeAnimFrame = requestAnimationFrame(renderViscosityLoop);
}

// ==========================================
// SIMULATOR 2: Buoyancy & Archimedes
// ==========================================

let bParams = {
    fluidDensity: 1000,
    blockDensity: 600,
    blockVolume: 2.5,
    isFreePhysics: true,
    manualDepthFraction: 0,

    blockY: 20,
    blockVy: 0,
    equilibriumFraction: 0
};

function initBuoyancySim() {
    stopSimulations();
    updateBuoyancyParams();
    renderBuoyancyLoop();
}

function toggleFreePhysics() {
    const chk = document.getElementById('chk-free-physics');
    bParams.isFreePhysics = chk ? chk.checked : true;
    const manualCont = document.getElementById('manual-submersion-container');
    if (bParams.isFreePhysics) {
        if (manualCont) manualCont.classList.add('hidden');
        bParams.blockY = 20;
        bParams.blockVy = 0;
    } else {
        if (manualCont) manualCont.classList.remove('hidden');
        const depthSlider = document.getElementById('buoyancy-depth-slider');
        bParams.manualDepthFraction = depthSlider ? parseFloat(depthSlider.value) / 100 : 0;
    }
}

function bobBlock() {
    if (!bParams.isFreePhysics) return;
    bParams.blockVy = 3.5;
}

function resetBuoyancySim() {
    bParams.blockDensity = 600;
    bParams.blockVolume = 2.5;
    bParams.fluidDensity = 1000;
    bParams.blockY = 20;
    bParams.blockVy = 0;

    const rhoSlider = document.getElementById('buoyancy-rho-slider');
    const volSlider = document.getElementById('buoyancy-vol-slider');
    const fluidSelect = document.getElementById('buoyancy-fluid-select');
    const chk = document.getElementById('chk-free-physics');
    const manualCont = document.getElementById('manual-submersion-container');

    if (rhoSlider) rhoSlider.value = 600;
    if (volSlider) volSlider.value = 2.5;
    if (fluidSelect) fluidSelect.value = '1000';
    if (chk) chk.checked = true;
    if (manualCont) manualCont.classList.add('hidden');
    bParams.isFreePhysics = true;

    updateBuoyancyParams();
}

function updateBuoyancyParams() {
    const selectFluid = document.getElementById('buoyancy-fluid-select');
    const sRho = document.getElementById('buoyancy-rho-slider');
    const sVol = document.getElementById('buoyancy-vol-slider');
    const sDepth = document.getElementById('buoyancy-depth-slider');

    if (selectFluid) bParams.fluidDensity = parseFloat(selectFluid.value);
    if (sRho) bParams.blockDensity = parseFloat(sRho.value);
    if (sVol) bParams.blockVolume = parseFloat(sVol.value);

    const lblRho = document.getElementById('lbl-rho-val');
    const lblVol = document.getElementById('lbl-vol-val');
    if (lblRho) lblRho.innerText = bParams.blockDensity;
    if (lblVol) lblVol.innerText = bParams.blockVolume.toFixed(1) + ' L';

    if (!bParams.isFreePhysics && sDepth) {
        bParams.manualDepthFraction = parseFloat(sDepth.value) / 100;
        const lblDepth = document.getElementById('lbl-depth-val');
        if (lblDepth) lblDepth.innerText = sDepth.value + '%';
    }
}

function renderBuoyancyLoop() {
    const canvas = document.getElementById('buoyancyCanvas');
    if (!canvas) return;

    // Auto-fit canvas dimensions to parent container
    if (canvas.parentElement) {
        const parentW = canvas.parentElement.clientWidth;
        const parentH = canvas.parentElement.clientHeight;
        if (parentW > 0 && Math.abs(canvas.width - parentW) > 2) {
            canvas.width = parentW;
        }
        if (parentH > 0 && Math.abs(canvas.height - parentH) > 2) {
            canvas.height = parentH;
        }
    }

    const ctx = canvas.getContext('2d');
    const cw = canvas.width || 340;
    const ch = canvas.height || 280;

    ctx.clearRect(0, 0, cw, ch);

    // Dynamic Beaker & Overflow Jar coordinates
    const beakerW = Math.min(170, cw * 0.44);
    const beakerH = Math.min(150, ch * 0.55);
    const beakerX = Math.max(15, cw * 0.08);
    const beakerY = Math.max(30, ch * 0.18);
    const spoutY = beakerY + 30;

    const jarW = Math.min(65, cw * 0.18);
    const jarH = beakerH - 40;
    const jarX = Math.min(cw - jarW - 15, beakerX + beakerW + Math.max(20, cw * 0.08));
    const jarY = beakerY + 40;

    const gConst = 9.8;
    const blockMass = (bParams.blockDensity * bParams.blockVolume) / 1000;
    const gravityForce = blockMass * gConst;

    let blockW = Math.min(beakerW * 0.45, 36 + bParams.blockVolume * 5);
    let blockH = Math.min(beakerH * 0.45, 36 + bParams.blockVolume * 5);

    const waterSurfaceY = spoutY;
    let visualY = 0;
    let fractionSubmerged = 0;

    if (bParams.isFreePhysics) {
        const dt = 0.016;
        let forceNet = gravityForce;

        const blockBottomY = bParams.blockY + blockH;
        let subFraction = 0;

        if (blockBottomY > waterSurfaceY) {
            const submergedH = Math.min(blockH, blockBottomY - waterSurfaceY);
            subFraction = submergedH / blockH;
        }

        const displacedVol = bParams.blockVolume * subFraction;
        const buoyantForce = (bParams.fluidDensity * displacedVol * gConst) / 1000;
        forceNet -= buoyantForce;

        if (blockBottomY > waterSurfaceY) {
            const damping = 3.5 * bParams.blockVy * subFraction;
            forceNet -= damping;
        }

        const acceleration = forceNet / blockMass;
        bParams.blockVy += acceleration * dt;
        bParams.blockY += bParams.blockVy * 60 * dt;

        const bottomLimitY = beakerY + beakerH - blockH - 4;
        if (bParams.blockY > bottomLimitY) {
            bParams.blockY = bottomLimitY;
            bParams.blockVy = -0.35 * bParams.blockVy;
            if (Math.abs(bParams.blockVy) < 0.2) bParams.blockVy = 0;
        }

        if (bParams.blockY < 10) {
            bParams.blockY = 10;
            bParams.blockVy = 0;
        }

        visualY = bParams.blockY;
        fractionSubmerged = subFraction;
    } else {
        const startY = waterSurfaceY - blockH;
        const endY = beakerY + beakerH - blockH - 4;
        visualY = startY + bParams.manualDepthFraction * (endY - startY);

        const blockBottomY = visualY + blockH;
        let subFraction = 0;
        if (blockBottomY > waterSurfaceY) {
            const submergedH = Math.min(blockH, blockBottomY - waterSurfaceY);
            subFraction = submergedH / blockH;
        }
        fractionSubmerged = subFraction;
        bParams.blockVy = 0;
    }

    const finalVolumeSubmerged = bParams.blockVolume * fractionSubmerged;
    const finalBuoyantForce = (bParams.fluidDensity * finalVolumeSubmerged * gConst) / 1000;

    // RENDER OVERFLOW JAR WATER
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(jarX, jarY);
    ctx.lineTo(jarX, jarY + jarH);
    ctx.lineTo(jarX + jarW, jarY + jarH);
    ctx.lineTo(jarX + jarW, jarY);
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '9px monospace';
    for (let mark = 1; mark <= 5; mark++) {
        const markY = jarY + jarH - (mark / 5) * (jarH - 10);
        ctx.beginPath();
        ctx.moveTo(jarX + jarW - 8, markY);
        ctx.lineTo(jarX + jarW, markY);
        ctx.stroke();
        ctx.fillText(mark + 'L', jarX + jarW + 3, markY + 3);
    }

    const fillHeightInJar = (finalVolumeSubmerged / 5.0) * (jarH - 10);
    if (fillHeightInJar > 0) {
        ctx.fillStyle = bParams.fluidDensity === 1000 
            ? 'rgba(6, 182, 212, 0.45)' 
            : bParams.fluidDensity === 800 
                ? 'rgba(249, 115, 22, 0.35)' 
                : 'rgba(245, 158, 11, 0.45)';
        ctx.fillRect(jarX + 1.5, jarY + jarH - fillHeightInJar, jarW - 3, fillHeightInJar);

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 9px Prompt';
        ctx.fillText('ล้น: ' + finalVolumeSubmerged.toFixed(1) + ' L', jarX + 4, jarY + jarH - fillHeightInJar - 5);
    }

    // BEAKER WATER FILLING
    ctx.fillStyle = bParams.fluidDensity === 1000 
        ? 'rgba(6, 182, 212, 0.30)' 
        : bParams.fluidDensity === 800 
            ? 'rgba(249, 115, 22, 0.22)' 
            : 'rgba(245, 158, 11, 0.30)';
    ctx.fillRect(beakerX + 2, waterSurfaceY, beakerW - 4, beakerY + beakerH - waterSurfaceY - 2);

    if (fractionSubmerged > 0.05 && bParams.blockVy !== 0) {
        ctx.strokeStyle = bParams.fluidDensity === 1000 ? 'rgba(6, 182, 212, 0.7)' : bParams.fluidDensity === 800 ? 'rgba(249, 115, 22, 0.6)' : 'rgba(245, 158, 11, 0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(beakerX + beakerW - 3, spoutY + 1.5);
        ctx.quadraticCurveTo(beakerX + beakerW + (jarX - (beakerX + beakerW)) / 2, spoutY - 4, jarX + 5, jarY + 8);
        ctx.stroke();
    }

    // BEAKER CONTOUR
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(beakerX, beakerY);
    ctx.lineTo(beakerX, beakerY + beakerH);
    ctx.lineTo(beakerX + beakerW, beakerY + beakerH);
    ctx.lineTo(beakerX + beakerW, spoutY + 4);
    ctx.lineTo(beakerX + beakerW + 12, spoutY + 8);
    ctx.lineTo(beakerX + beakerW + 12, spoutY + 11);
    ctx.lineTo(beakerX + beakerW, spoutY + 8);
    ctx.lineTo(beakerX + beakerW, beakerY);
    ctx.stroke();

    // RENDER SOLID BLOCK
    const blockX = beakerX + beakerW / 2 - blockW / 2;
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.fillRect(blockX, visualY, blockW, blockH);
    ctx.strokeRect(blockX, visualY, blockW, blockH);

    if (fractionSubmerged > 0) {
        const subTopY = Math.max(visualY, waterSurfaceY);
        const subH = (visualY + blockH) - subTopY;
        ctx.fillStyle = bParams.fluidDensity === 1000 
            ? 'rgba(6, 182, 212, 0.25)' 
            : bParams.fluidDensity === 800 
                ? 'rgba(249, 115, 22, 0.20)' 
                : 'rgba(245, 158, 11, 0.25)';
        ctx.fillRect(blockX, subTopY, blockW, subH);
    }

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 9px Prompt';
    ctx.textAlign = 'center';
    ctx.fillText(blockMass.toFixed(2) + ' kg', blockX + blockW / 2, visualY + blockH / 2 + 3);

    const arrowStartX = blockX + blockW / 2;
    const arrowStartY = visualY + blockH / 2;
    const scaleN = 4.0;

    // Gravity vector (Red arrow W)
    if (gravityForce > 0.1) {
        ctx.strokeStyle = '#ef4444';
        ctx.fillStyle = '#ef4444';
        ctx.lineWidth = 2.5;
        const arrowH = Math.min(ch - 15 - arrowStartY, gravityForce * scaleN);
        ctx.beginPath();
        ctx.moveTo(arrowStartX, arrowStartY);
        ctx.lineTo(arrowStartX, arrowStartY + arrowH);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(arrowStartX, arrowStartY + arrowH);
        ctx.lineTo(arrowStartX - 4, arrowStartY + arrowH - 5);
        ctx.lineTo(arrowStartX + 4, arrowStartY + arrowH - 5);
        ctx.fill();

        ctx.font = 'bold 9px Prompt';
        ctx.textAlign = 'left';
        ctx.fillText('W = ' + gravityForce.toFixed(1) + ' N', arrowStartX + 8, arrowStartY + arrowH / 2 + 3);
    }

    // Buoyancy vector (Green arrow B)
    if (finalBuoyantForce > 0.1) {
        ctx.strokeStyle = '#10b981';
        ctx.fillStyle = '#10b981';
        ctx.lineWidth = 2.5;
        const arrowH = Math.min(arrowStartY - 10, finalBuoyantForce * scaleN);
        ctx.beginPath();
        ctx.moveTo(arrowStartX, arrowStartY);
        ctx.lineTo(arrowStartX, arrowStartY - arrowH);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(arrowStartX, arrowStartY - arrowH);
        ctx.lineTo(arrowStartX - 4, arrowStartY - arrowH + 5);
        ctx.lineTo(arrowStartX + 4, arrowStartY - arrowH + 5);
        ctx.fill();

        ctx.font = 'bold 9px Prompt';
        ctx.textAlign = 'left';
        ctx.fillText('B = ' + finalBuoyantForce.toFixed(1) + ' N', arrowStartX + 8, arrowStartY - arrowH / 2 + 3);
    }

    document.getElementById('val-buoyancy-w').innerText = gravityForce.toFixed(1) + ' N';
    document.getElementById('val-buoyancy-b').innerText = finalBuoyantForce.toFixed(1) + ' N';
    document.getElementById('val-buoyancy-vsub').innerText = finalVolumeSubmerged.toFixed(2) + ' L';

    const netState = document.getElementById('val-buoyancy-net');
    if (bParams.blockDensity > bParams.fluidDensity) {
        if (visualY >= beakerY + beakerH - blockH - 5) {
            netState.innerText = 'จมก้นบีกเกอร์';
            netState.className = 'text-red-500 font-bold';
        } else {
            netState.innerText = 'กำลังจมดิ่ง';
            netState.className = 'text-orange-500 font-bold';
        }
    } else {
        if (bParams.blockVy === 0 || Math.abs(bParams.blockVy) < 0.05) {
            netState.innerText = 'สมดุลลอยนิ่ง';
            netState.className = 'text-teal-500 font-bold';
        } else {
            netState.innerText = 'แกว่งลอย/จม';
            netState.className = 'text-cyan-500 font-bold';
        }
    }

    activeAnimFrame = requestAnimationFrame(renderBuoyancyLoop);
}

// ==========================================
// SIMULATOR 3: Liquid Surface Tension
// ==========================================

let tParams = {
    fluidType: 'water',     // 'water', 'glycerin', 'soap', 'ethanol', 'custom'
    fluidTension: 0.0728,   // N/m
    ringR: 2.0,            // cm
    ringMass: 10.0,        // grams
    leftMass: 10.0,        // grams
    leftX: 15.0,           // cm
    rightY: 15.0,          // cm

    // Dynamic state
    beamAngle: 0.0,        // radians
    beamOmega: 0.0,        // rad/s
    filmRuptured: false,

    // Auto action states
    isAutoSlidingX: false,
    isAutoIncreasingW: false,

    // Record of rupture
    ruptureMass: 0,
    ruptureX: 0,
    ruptureY: 0,
    ruptureR: 0,
    ruptureGammaExp: 0,
    hasRupturedRecord: false
};

function initTensionSim() {
    stopSimulations();
    
    tParams.beamAngle = 0.0;
    tParams.beamOmega = 0.0;
    tParams.filmRuptured = false;
    tParams.isAutoSlidingX = false;
    tParams.isAutoIncreasingW = false;
    tParams.hasRupturedRecord = false;
    
    // Hide experimental results display initially
    const expContainer = document.getElementById('val-tension-exp-container');
    if (expContainer) expContainer.classList.add('hidden');
    
    // Set auto buttons back to original label
    const btnX = document.getElementById('btn-tension-auto-x');
    if (btnX) btnX.innerHTML = '<i class="fa-solid fa-forward-step"></i> ค่อยๆ เลื่อนตุ้ม x';
    const btnW = document.getElementById('btn-tension-auto-w');
    if (btnW) btnW.innerHTML = '<i class="fa-solid fa-plus"></i> ค่อยๆ เพิ่มมวล W';

    const selectFluid = document.getElementById('tension-fluid-select');
    const sM = document.getElementById('tension-m-slider');
    const sX = document.getElementById('tension-x-slider');
    const sR = document.getElementById('tension-r-slider');
    const sMring = document.getElementById('tension-mring-slider');
    const sY = document.getElementById('tension-y-slider');

    if (selectFluid && sM && sX && sR && sMring && sY) {
        updateTensionParams();
    }
    
    const state = document.getElementById('lbl-tension-state');
    if (state) {
        state.innerText = 'พร้อมทดลอง (ห่วงสัมผัสผิว)';
        state.className = 'text-xs px-2 py-0.5 bg-teal-100 text-teal-800 font-bold rounded';
    }

    activeAnimFrame = requestAnimationFrame(renderTensionLoop);
}

function updateTensionParams() {
    const selectFluid = document.getElementById('tension-fluid-select');
    const sM = document.getElementById('tension-m-slider');
    const sX = document.getElementById('tension-x-slider');
    const sR = document.getElementById('tension-r-slider');
    const sMring = document.getElementById('tension-mring-slider');
    const sY = document.getElementById('tension-y-slider');
    const sCustom = document.getElementById('tension-custom-slider');
    const customContainer = document.getElementById('tension-custom-fluid-container');

    if (!selectFluid) return;

    if (selectFluid.value === 'custom') {
        if (customContainer) customContainer.classList.remove('hidden');
        tParams.fluidTension = parseFloat(sCustom.value);
        document.getElementById('lbl-tension-custom-val').innerText = tParams.fluidTension.toFixed(4) + ' N/m';
    } else {
        if (customContainer) customContainer.classList.add('hidden');
        tParams.fluidTension = parseFloat(selectFluid.value);
    }

    tParams.leftMass = parseFloat(sM.value);
    tParams.leftX = parseFloat(sX.value);
    tParams.ringR = parseFloat(sR.value);
    tParams.ringMass = parseFloat(sMring.value);
    tParams.rightY = parseFloat(sY.value);

    document.getElementById('lbl-tension-m-val').innerText = tParams.leftMass.toFixed(1) + ' g';
    document.getElementById('lbl-tension-x-val').innerText = tParams.leftX.toFixed(1) + ' cm';
    document.getElementById('lbl-tension-r-val').innerText = tParams.ringR.toFixed(1) + ' cm';
    document.getElementById('lbl-tension-mring-val').innerText = tParams.ringMass.toFixed(1) + ' g';
    document.getElementById('lbl-tension-y-val').innerText = tParams.rightY.toFixed(1) + ' cm';

    // Show theoretical values on dashboard
    const r_m = tParams.ringR / 100;
    const L = 4 * Math.PI * r_m; // 2 sides contact
    const fmax = L * tParams.fluidTension;
    document.getElementById('val-tension-fmax').innerText = fmax.toFixed(4) + ' N';

    // Ensure tension simulation loop is running if tension tab is active
    const btnT = document.getElementById('btn-tab-17-2-tension');
    if (currentSection === 'review' && btnT && btnT.classList.contains('bg-white') && !activeAnimFrame) {
        activeAnimFrame = requestAnimationFrame(renderTensionLoop);
    }
}

function adjustTensionMass(amount) {
    const sM = document.getElementById('tension-m-slider');
    if (sM) {
        let val = parseFloat(sM.value) + amount;
        val = Math.max(0.0, Math.min(100.0, val));
        sM.value = val.toFixed(1);
        updateTensionParams();
    }
}

function zeroBalanceTension() {
    if (tParams.leftX === 0) return;
    const balancedMass = (tParams.ringMass * tParams.rightY) / tParams.leftX;
    
    const sM = document.getElementById('tension-m-slider');
    if (sM) {
        sM.value = Math.min(100.0, balancedMass).toFixed(1);
        updateTensionParams();
    }
    
    tParams.filmRuptured = false;
    tParams.beamAngle = 0.0;
    tParams.beamOmega = 0.0;
    
    const state = document.getElementById('lbl-tension-state');
    if (state) {
        state.innerText = 'พร้อมทดลอง (ห่วงสัมผัสผิว)';
        state.className = 'text-xs px-2 py-0.5 bg-teal-100 text-teal-800 font-bold rounded';
    }
    
    const expContainer = document.getElementById('val-tension-exp-container');
    if (expContainer) expContainer.classList.add('hidden');
}

function touchLiquidTension() {
    tParams.filmRuptured = false;
    tParams.beamAngle = 0.0;
    tParams.beamOmega = 0.0;
    tParams.isAutoSlidingX = false;
    tParams.isAutoIncreasingW = false;
    
    const btnX = document.getElementById('btn-tension-auto-x');
    if (btnX) btnX.innerHTML = '<i class="fa-solid fa-forward-step"></i> ค่อยๆ เลื่อนตุ้ม x';
    const btnW = document.getElementById('btn-tension-auto-w');
    if (btnW) btnW.innerHTML = '<i class="fa-solid fa-plus"></i> ค่อยๆ เพิ่มมวล W';

    const state = document.getElementById('lbl-tension-state');
    if (state) {
        state.innerText = 'พร้อมทดลอง (ห่วงสัมผัสผิว)';
        state.className = 'text-xs px-2 py-0.5 bg-teal-100 text-teal-800 font-bold rounded';
    }

    const expContainer = document.getElementById('val-tension-exp-container');
    if (expContainer) expContainer.classList.add('hidden');
}

function startAutoSlideX() {
    if (tParams.filmRuptured) {
        touchLiquidTension();
    }
    tParams.isAutoSlidingX = !tParams.isAutoSlidingX;
    tParams.isAutoIncreasingW = false;
    
    const btnX = document.getElementById('btn-tension-auto-x');
    if (btnX) {
        btnX.innerHTML = tParams.isAutoSlidingX 
            ? '<i class="fa-solid fa-pause"></i> หยุดเลื่อน' 
            : '<i class="fa-solid fa-forward-step"></i> ค่อยๆ เลื่อนตุ้ม x';
    }
    const btnW = document.getElementById('btn-tension-auto-w');
    if (btnW) btnW.innerHTML = '<i class="fa-solid fa-plus"></i> ค่อยๆ เพิ่มมวล W';
}

function startAutoIncreaseW() {
    if (tParams.filmRuptured) {
        touchLiquidTension();
    }
    tParams.isAutoIncreasingW = !tParams.isAutoIncreasingW;
    tParams.isAutoSlidingX = false;
    
    const btnW = document.getElementById('btn-tension-auto-w');
    if (btnW) {
        btnW.innerHTML = tParams.isAutoIncreasingW 
            ? '<i class="fa-solid fa-pause"></i> หยุดเพิ่ม' 
            : '<i class="fa-solid fa-plus"></i> ค่อยๆ เพิ่มมวล W';
    }
    const btnX = document.getElementById('btn-tension-auto-x');
    if (btnX) btnX.innerHTML = '<i class="fa-solid fa-forward-step"></i> ค่อยๆ เลื่อนตุ้ม x';
}

function renderTensionLoop() {
    const canvas = document.getElementById('tensionCanvas');
    if (!canvas) {
        // Canvas not ready yet — retry next frame instead of dying permanently
        activeAnimFrame = requestAnimationFrame(renderTensionLoop);
        return;
    }

    // Auto-fit canvas dimensions to parent container
    if (canvas.parentElement) {
        const parentW = canvas.parentElement.clientWidth;
        const parentH = canvas.parentElement.clientHeight;
        if (parentW > 0 && Math.abs(canvas.width - parentW) > 2) {
            canvas.width = parentW;
        }
        if (parentH > 0 && Math.abs(canvas.height - parentH) > 2) {
            canvas.height = parentH;
        }
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width || 340;
    const h = canvas.height || 280;

    // Apply auto modifications
    if (tParams.isAutoSlidingX && !tParams.filmRuptured) {
        tParams.leftX += 0.05; // cm per frame
        if (tParams.leftX >= 30.0) {
            tParams.leftX = 30.0;
            tParams.isAutoSlidingX = false;
            const btnX = document.getElementById('btn-tension-auto-x');
            if (btnX) btnX.innerHTML = '<i class="fa-solid fa-forward-step"></i> ค่อยๆ เลื่อนตุ้ม x';
        }
        const sX = document.getElementById('tension-x-slider');
        if (sX) sX.value = tParams.leftX.toFixed(1);
        document.getElementById('lbl-tension-x-val').innerText = tParams.leftX.toFixed(1) + ' cm';
    }

    if (tParams.isAutoIncreasingW && !tParams.filmRuptured) {
        tParams.leftMass += 0.05; // g per frame
        if (tParams.leftMass >= 100.0) {
            tParams.leftMass = 100.0;
            tParams.isAutoIncreasingW = false;
            const btnW = document.getElementById('btn-tension-auto-w');
            if (btnW) btnW.innerHTML = '<i class="fa-solid fa-plus"></i> ค่อยๆ เพิ่มมวล W';
        }
        const sM = document.getElementById('tension-m-slider');
        if (sM) sM.value = tParams.leftMass.toFixed(1);
        document.getElementById('lbl-tension-m-val').innerText = tParams.leftMass.toFixed(1) + ' g';
    }

    // --- PHYSICS ENGINE ---
    const dt = 0.016; 
    const g = 9.8;
    
    const M_kg = tParams.leftMass / 1000;
    const m_kg = tParams.ringMass / 1000;
    const x_m = tParams.leftX / 100;
    const y_m = tParams.rightY / 100;
    const r_m = tParams.ringR / 100;

    // Torques
    const tauL = M_kg * g * x_m * Math.cos(tParams.beamAngle);

    const ringHeightDisplacement = y_m * Math.sin(tParams.beamAngle); // meters
    let Fs = 0.0;
    let maxFs = 4 * Math.PI * r_m * tParams.fluidTension;
    let z_max = 0.005 + 0.03 * tParams.fluidTension; // limit of stretching

    if (!tParams.filmRuptured) {
        if (ringHeightDisplacement <= 0) {
            Fs = 80.0 * ringHeightDisplacement; // N, pushes up
        } else {
            Fs = maxFs * (ringHeightDisplacement / z_max);
            if (Fs > maxFs) Fs = maxFs;

            // Rupture check
            if (ringHeightDisplacement > z_max) {
                tParams.filmRuptured = true;
                tParams.isAutoSlidingX = false;
                tParams.isAutoIncreasingW = false;

                const btnX = document.getElementById('btn-tension-auto-x');
                if (btnX) btnX.innerHTML = '<i class="fa-solid fa-forward-step"></i> ค่อยๆ เลื่อนตุ้ม x';
                const btnW = document.getElementById('btn-tension-auto-w');
                if (btnW) btnW.innerHTML = '<i class="fa-solid fa-plus"></i> ค่อยๆ เพิ่มมวล W';

                const state = document.getElementById('lbl-tension-state');
                if (state) {
                    state.innerText = 'ฟิล์มขาดแล้ว! (Ruptured)';
                    state.className = 'text-xs px-2 py-0.5 bg-red-100 text-red-800 font-bold rounded';
                }

                // Record rupture parameters
                tParams.ruptureMass = tParams.leftMass;
                tParams.ruptureX = tParams.leftX;
                tParams.ruptureY = tParams.rightY;
                tParams.ruptureR = tParams.ringR;
                
                const balancedM = (tParams.ringMass * tParams.rightY) / tParams.leftX;
                const deltaM_g = tParams.leftMass - balancedM;
                let gammaExp = 0.0;
                if (deltaM_g > 0) {
                    const deltaM_kg = deltaM_g / 1000;
                    const f_rupture = deltaM_kg * g * (tParams.leftX / tParams.rightY);
                    gammaExp = f_rupture / (4 * Math.PI * r_m);
                }
                tParams.ruptureGammaExp = gammaExp;
                tParams.hasRupturedRecord = true;

                const expContainer = document.getElementById('val-tension-exp-container');
                if (expContainer) expContainer.classList.remove('hidden');
                document.getElementById('val-tension-gammanet').innerText = gammaExp.toFixed(4) + ' N/m';
            }
        }
    } else {
        // Auto re-attach film when ring touches/enters liquid surface again
        if (ringHeightDisplacement <= 0) {
            tParams.filmRuptured = false;
            const state = document.getElementById('lbl-tension-state');
            if (state) {
                state.innerText = 'พร้อมทดลอง (ห่วงสัมผัสผิว)';
                state.className = 'text-xs px-2 py-0.5 bg-teal-100 text-teal-800 font-bold rounded';
            }
            Fs = 80.0 * ringHeightDisplacement;
        }
    }

    const F_right = Math.max(0, m_kg * g + Fs);
    const tauR = F_right * y_m * Math.cos(tParams.beamAngle);

    const I_rod = 0.001; 
    const I_total = I_rod + M_kg * x_m * x_m + m_kg * y_m * y_m;

    const alpha = (tauL - tauR) / I_total;
    tParams.beamOmega += alpha * dt;
    tParams.beamOmega *= 0.92; // angular damping
    tParams.beamAngle += tParams.beamOmega * dt;

    const angleLimit = 0.15; // rad
    if (tParams.beamAngle > angleLimit) {
        tParams.beamAngle = angleLimit;
        tParams.beamOmega = 0.0;
    } else if (tParams.beamAngle < -angleLimit) {
        tParams.beamAngle = -angleLimit;
        tParams.beamOmega = 0.0;
    }

    // Update dashboard text fields
    document.getElementById('val-tension-taul').innerText = tauL.toFixed(4) + ' N·m';
    document.getElementById('val-tension-taur').innerText = tauR.toFixed(4) + ' N·m';
    
    const pullingForceOnRing = M_kg * g * (x_m / y_m); 
    document.getElementById('val-tension-fpull').innerText = pullingForceOnRing.toFixed(3) + ' N';
    document.getElementById('val-tension-fs').innerText = (Fs > 0 ? Fs : 0.0).toFixed(4) + ' N';

    // --- CANVAS RENDERING ---
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h * 0.32; // Elevated pivot position to ensure space below

    // 1. Draw Stand
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, h - 20);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cx - 40, h - 20, 80, 8);

    // 2. Draw Beam (Dynamic scale based on width)
    const beamHalfLen = Math.min(w * 0.38, 220);
    const xL = cx - beamHalfLen * Math.cos(tParams.beamAngle);
    const yL = cy + beamHalfLen * Math.sin(tParams.beamAngle);
    const xR = cx + beamHalfLen * Math.cos(tParams.beamAngle);
    const yR = cy - beamHalfLen * Math.sin(tParams.beamAngle);

    ctx.strokeStyle = '#65a30d'; // Bright olive green
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(xL, yL);
    ctx.lineTo(xR, yR);
    ctx.stroke();

    // 3. Draw Pivot Pin
    ctx.fillStyle = '#eab308';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Prompt';
    ctx.fillText('P', cx - 4, cy - 9);

    // 4. Draw Left Weight Hanger
    const dx_px = (tParams.leftX / 30) * beamHalfLen;
    const hangerXL = cx - dx_px * Math.cos(tParams.beamAngle);
    const hangerYL = cy + dx_px * Math.sin(tParams.beamAngle);

    const hangerLen = Math.min(42, h * 0.15);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hangerXL, hangerYL);
    ctx.lineTo(hangerXL, hangerYL + hangerLen);
    ctx.stroke();

    const r_weight = 7 + Math.sqrt(tParams.leftMass) * 1.1;
    const weightCenterY = hangerYL + hangerLen + r_weight;
    const weightBottomY = weightCenterY + r_weight;

    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(hangerXL, weightCenterY, r_weight, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('W', hangerXL, weightCenterY + 3);

    // Left force vector (Red arrow - dynamically clamped to canvas bottom)
    if (tParams.leftMass > 0) {
        const availableSpace = h - 14 - weightBottomY;
        const desiredLen = 10 + M_kg * g * 250;
        const arrowLen = Math.max(6, Math.min(availableSpace, desiredLen));

        if (arrowLen >= 6 && availableSpace > 5) {
            ctx.strokeStyle = '#ef4444';
            ctx.fillStyle = '#ef4444';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(hangerXL, weightBottomY);
            ctx.lineTo(hangerXL, weightBottomY + arrowLen);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(hangerXL, weightBottomY + arrowLen);
            ctx.lineTo(hangerXL - 4, weightBottomY + arrowLen - 6);
            ctx.lineTo(hangerXL + 4, weightBottomY + arrowLen - 6);
            ctx.fill();
        }
    }

    // Label Left Distance "x"
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 20);
    ctx.lineTo(hangerXL, cy - 20);
    ctx.stroke();
    ctx.font = '10px Prompt';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`x = ${tParams.leftX.toFixed(1)} cm`, (cx + hangerXL) / 2, cy - 24);

    // 5. Draw Right Hanger & Ring
    const dy_px = (tParams.rightY / 30) * beamHalfLen;
    const hangerXR = cx + dy_px * Math.cos(tParams.beamAngle);
    const hangerYR = cy - dy_px * Math.sin(tParams.beamAngle);

    const stringLen = Math.min(48, h * 0.17);
    const ringY_px = hangerYR + stringLen;

    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hangerXR, hangerYR);
    ctx.lineTo(hangerXR, ringY_px);
    ctx.stroke();

    const beakerW = Math.min(110, w * 0.22);
    const beakerH = Math.min(60, h * 0.20);
    const beakerY = cy + stringLen - 10;
    const liquidSurfaceY = cy + stringLen; 
    
    let fluidColor = 'rgba(6, 182, 212, 0.30)'; 
    if (tParams.fluidTension === 0.0640) fluidColor = 'rgba(249, 115, 22, 0.25)'; 
    else if (tParams.fluidTension === 0.0250) fluidColor = 'rgba(20, 184, 166, 0.30)'; 
    else if (tParams.fluidTension === 0.0223) fluidColor = 'rgba(139, 92, 246, 0.20)'; 
    else if (tParams.fluidTension < 0.0350) fluidColor = 'rgba(148, 163, 184, 0.30)'; 
    else if (tParams.fluidTension > 0.0350) fluidColor = 'rgba(6, 182, 212, 0.30)'; 

    ctx.fillStyle = fluidColor;
    ctx.fillRect(hangerXR - beakerW / 2 + 2, liquidSurfaceY, beakerW - 4, beakerH - 2);

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(hangerXR - beakerW / 2, beakerY);
    ctx.lineTo(hangerXR - beakerW / 2, beakerY + beakerH);
    ctx.lineTo(hangerXR + beakerW / 2, beakerY + beakerH);
    ctx.lineTo(hangerXR + beakerW / 2, beakerY);
    ctx.stroke();

    const ringR_px = 7 + tParams.ringR * 6; 
    if (!tParams.filmRuptured) {
        if (ringY_px < liquidSurfaceY) {
            const stretch_px = liquidSurfaceY - ringY_px;
            const stretch_ratio = Math.min(1.0, stretch_px / (z_max * 100 * 3.5)); 

            ctx.fillStyle = fluidColor.replace('0.30', '0.65').replace('0.25', '0.60').replace('0.20', '0.50');
            ctx.beginPath();
            
            const neck = ringR_px * (1.0 - stretch_ratio * 0.4);
            ctx.moveTo(hangerXR - ringR_px, ringY_px);
            ctx.quadraticCurveTo(hangerXR - neck, (ringY_px + liquidSurfaceY) / 2, hangerXR - ringR_px, liquidSurfaceY);
            ctx.lineTo(hangerXR + ringR_px, liquidSurfaceY);
            ctx.quadraticCurveTo(hangerXR + neck, (ringY_px + liquidSurfaceY) / 2, hangerXR + ringR_px, ringY_px);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(hangerXR - ringR_px, ringY_px);
            ctx.quadraticCurveTo(hangerXR - neck, (ringY_px + liquidSurfaceY) / 2, hangerXR - ringR_px, liquidSurfaceY);
            ctx.moveTo(hangerXR + ringR_px, ringY_px);
            ctx.quadraticCurveTo(hangerXR + neck, (ringY_px + liquidSurfaceY) / 2, hangerXR + ringR_px, liquidSurfaceY);
            ctx.stroke();
        }
    }

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2.5;
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.ellipse(hangerXR, ringY_px, ringR_px, 5, 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    // Ring mass arrow (Yellow)
    if (tParams.ringMass > 0) {
        ctx.strokeStyle = '#eab308';
        ctx.fillStyle = '#eab308';
        ctx.lineWidth = 2;
        const arRing = Math.min(35, 6 + m_kg * g * 100);
        ctx.beginPath();
        ctx.moveTo(hangerXR, ringY_px + 5);
        ctx.lineTo(hangerXR, ringY_px + 5 + arRing);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(hangerXR, ringY_px + 5 + arRing);
        ctx.lineTo(hangerXR - 3, ringY_px + 5 + arRing - 5);
        ctx.lineTo(hangerXR + 3, ringY_px + 5 + arRing - 5);
        ctx.fill();
    }

    // Surface tension force arrow (Cyan Blue #38bdf8 to match legend!)
    if (Fs > 0 && !tParams.filmRuptured) {
        ctx.strokeStyle = '#38bdf8';
        ctx.fillStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        const arFs = Math.min(50, 6 + Fs * 300);
        ctx.beginPath();
        ctx.moveTo(hangerXR, ringY_px + 5);
        ctx.lineTo(hangerXR, ringY_px + 5 + arFs);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(hangerXR, ringY_px + 5 + arFs);
        ctx.lineTo(hangerXR - 4, ringY_px + 5 + arFs - 6);
        ctx.lineTo(hangerXR + 4, ringY_px + 5 + arFs - 6);
        ctx.fill();
    }

    // Label Right Distance "y"
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(hangerXR, cy - 12);
    ctx.stroke();
    ctx.font = '10px Prompt';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`y = ${tParams.rightY.toFixed(1)} cm`, (cx + hangerXR) / 2, cy - 16);

    activeAnimFrame = requestAnimationFrame(renderTensionLoop);
}

// ==========================================
// CANVAS INITIALIZATION
// ==========================================

function initCanvases() {
    requestAnimationFrame(() => {
        const bCanvas = document.getElementById('buoyancyCanvas');
        const vCanvas = document.getElementById('viscosityCanvas');
        const vgCanvas = document.getElementById('viscosityGraphCanvas');
        const tCanvas = document.getElementById('tensionCanvas');

        // Resize each canvas independently to fill parent container
        if (bCanvas && bCanvas.parentElement) {
            bCanvas.width = bCanvas.parentElement.clientWidth || 340;
            bCanvas.height = Math.max(280, bCanvas.parentElement.clientHeight || 300);
        }
        if (vCanvas && vCanvas.parentElement) {
            vCanvas.width = vCanvas.parentElement.clientWidth || 110;
            vCanvas.height = Math.max(240, vCanvas.parentElement.clientHeight || 260);
        }
        if (vgCanvas && vgCanvas.parentElement) {
            vgCanvas.width = vgCanvas.parentElement.clientWidth || 220;
            vgCanvas.height = Math.max(220, vgCanvas.parentElement.clientHeight || 240);
        }
        if (tCanvas && tCanvas.parentElement) {
            tCanvas.width = tCanvas.parentElement.clientWidth || 400;
            tCanvas.height = Math.max(300, tCanvas.parentElement.clientHeight || 320);
        }

        stopSimulations();

        if (currentSection === 'review') {
            const btnT = document.getElementById('btn-tab-17-2-tension');
            const btnV = document.getElementById('btn-tab-17-2-viscosity');
            const activeTab = (btnT && btnT.classList.contains('bg-white'))
                ? '17-2-tension'
                : ((btnV && btnV.classList.contains('bg-white')) ? '17-2-viscosity' : '17-3-buoyancy');

            if (activeTab === '17-2-tension') initTensionSim();
            else if (activeTab === '17-2-viscosity') initViscositySim();
            else initBuoyancySim();
        }
    });
}

// ==========================================
// DYNAMIC QUESTION TEMPLATES (17.2 & 17.3 Fluids)
// ==========================================

const QUESTION_TEMPLATES = [
    // 17.2.1 ความตึงผิว (Surface Tension)
    {
        id: '17_2_1_ring_tension', topic: '17.2.1', type: 'numeric_single',
        title: 'ความตึงผิวของห่วงโลหะวงกลมสัมผัส 2 ด้าน',
        inputs: [{ label: 'สัมประสิทธิ์ความตึงผิว \\( (\\text{N/m}) \\):' }],
        text: (p) => `ดึงห่วงวงแหวนบางรัศมี \\( ${p.r_cm} \\text{ cm} \\) ขึ้นจากผิวของของเหลวชนิดหนึ่ง พบว่าต้องออกแรงดึงมากกว่าน้ำหนักห่วงทรานสวิสเป็นปริมาณ \\( ${p.r ? `(${p.f_base} + \\ ${p.r * 0.005})` : p.f} \\text{ N} \\) พอดีตอนที่ห่วงหลุดพ้นผิว จงหาค่าสัมประสิทธิ์ความตึงผิวของของเหลวนี้`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const r_cm = seed ? getSeededRandomBase('17_2_1_ring_r', seed, 5.0, 15.0, 1.0) : 10.0;
            const f_base = seed ? getSeededRandomBase('17_2_1_ring_f', seed, 0.08, 0.20, 0.01) : 0.12;
            const f = seed ? f_base + offset * 0.005 : 0.12;

            const radius_m = r_cm / 100;
            const L_total = 2 * (2 * Math.PI * radius_m);
            const gamma = f / L_total;

            return {
                params: { r_cm, f: parseFloat(f.toFixed(4)), f_base, r: offset },
                answers: [`\\( ${formatScientificLaTeX(gamma, 3)} \\)`, gamma.toFixed(4), gamma.toFixed(3)],
                answersRaw: [gamma],
                explanation: () => `
          จากสูตรสัมประสิทธิ์ความตึงผิวของห่วงโลหะบาง (สัมผัสของเหลว 2 ด้าน ทั้งวงในและวงนอก):<br>
          \\( \\gamma = \\frac{F}{L} = \\frac{F}{2 \\cdot (2\\pi r)} = \\frac{F}{4\\pi r} \\)<br>
          - แรงตึงผิว \\( F = ${offset ? `(${f_base.toFixed(2)} + ${(offset * 0.005).toFixed(3)}) = ` : ''}${f.toFixed(4)} \\text{ N} \\)<br>
          - รัศมี \\( r = ${r_cm} \\text{ cm} = ${radius_m.toFixed(3)} \\text{ m} \\)<br>
          แทนค่าคำนวณ:<br>
          \\( \\gamma = \\frac{${f.toFixed(4)}}{4 \\cdot \\pi \\cdot ${radius_m.toFixed(3)}} \\approx ${gamma.toFixed(4)} \\text{ N/m} \\)
        `
            };
        }
    },
    {
        id: '17_2_1_plate_tension', topic: '17.2.1', type: 'numeric_single',
        title: 'ความตึงผิวของแผ่นกระจกบางสัมผัส 2 ด้าน',
        inputs: [{ label: 'สัมประสิทธิ์ความตึงผิว \\( (\\text{N/m}) \\):' }],
        text: (p) => `นำแผ่นกระจกแบนหน้ากว้าง \\( ${p.w_cm} \\text{ cm} \\) ไปแตะผิวของเหลวชนิดหนึ่งและดึงขึ้นตรงๆ ช้าๆ โดยต้องออกแรงต้านเนื่องจากความตึงผิวมากกว่าน้ำหนักของแผ่นกระจกเป็นปริมาณ \\( ${p.r ? `(${p.f_base} + \\ ${p.r * 0.01})` : p.f} \\text{ N} \\) จงคำนวณหาสัมประสิทธิ์ความตึงผิวของเหลว`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const w_cm = seed ? getSeededRandomBase('17_2_1_plate_w', seed, 8.0, 20.0, 1.0) : 10.0;
            const f_base = seed ? getSeededRandomBase('17_2_1_plate_f', seed, 0.10, 0.30, 0.02) : 0.15;
            const f = seed ? f_base + offset * 0.01 : 0.15;

            const w_m = w_cm / 100;
            const L_total = 2 * w_m;
            const gamma = f / L_total;

            return {
                params: { w_cm, f: parseFloat(f.toFixed(4)), f_base, r: offset },
                answers: [`\\( ${formatScientificLaTeX(gamma, 3)} \\)`, gamma.toFixed(4), gamma.toFixed(3)],
                answersRaw: [gamma],
                explanation: () => `
          จากสูตรสัมประสิทธิ์ความตึงผิวของแผ่นกระจกบางสัมผัสของเหลว 2 ด้านยาว:<br>
          \\( \\gamma = \\frac{F}{L} = \\frac{F}{2w} \\)<br>
          - แรงดึงผิวสัมบูรณ์ \\( F = ${offset ? `(${f_base.toFixed(2)} + ${(offset * 0.01).toFixed(2)}) = ` : ''}${f.toFixed(4)} \\text{ N} \\)<br>
          - ความยาวหน้าสัมผัส \\( w = ${w_cm} \\text{ cm} = ${w_m.toFixed(2)} \\text{ m} \\)<br>
          แทนค่าคำนวณ:<br>
          \\( \\gamma = \\frac{${f.toFixed(4)}}{2 \\cdot ${w_m.toFixed(2)}} = ${gamma.toFixed(4)} \\text{ N/m} \\)
        `
            };
        }
    },
    {
        id: '17_2_1_concept_tension', topic: '17.2.1', type: 'choice',
        title: 'ทฤษฎีแนวคิดความตึงผิวของของเหลว',
        choices: [
            'แรงดึงเนื่องจากความตึงผิวจะมีทิศขนานกับผิวของของเหลวและตั้งฉากกับเส้นขอบที่สัมผัส',
            'ความตึงผิวมีหน่วยเป็นนิวตันต่อตารางเมตร (N/m²) เหมือนกับหน่วยวัดความดัน',
            'แมลงสามารถเดินทรงตัวบนผิวน้ำได้เนื่องจากความหนาแน่นของตัวแมลงน้อยกว่าความหนาแน่นของน้ำ',
            'การเติมสบู่หรือสารลดแรงตึงผิวลงในน้ำช่วยเพิ่มค่าสัมประสิทธิ์ความตึงผิวของน้ำให้สูงขึ้น'
        ],
        choiceExplanations: [
            { isCorrect: true, text: 'ทิศของแรงตึงผิวแผ่ตามแนวขนานกับผิวน้ำและกระทำตั้งฉากกับขอบแกนวัตถุสัมผัส' },
            { isCorrect: false, text: 'ความตึงผิวมีหน่วยเป็น นิวตันต่อเมตร (N/m)' },
            { isCorrect: false, text: 'แมลงยืนบนผิวน้ำได้จากแรงดึงผิวพยุงขาแมลงไว้ ไม่ใช่เพราะตัวแมลงเบากว่าน้ำ' },
            { isCorrect: false, text: 'สารลดแรงตึงผิว (เช่น สบู่) จะลดความตึงผิวเพื่อกระจายโมเลกุลน้ำ' }
        ],
        text: () => `ข้อความใดต่อไปนี้ระบุคุณสมบัติเชิงฟิสิกส์เรื่องความตึงผิว (Surface Tension) ได้ถูกต้องที่สุด`,
        generate: (seed) => ({
            params: {},
            answers: ['แรงดึงเนื่องจากความตึงผิวจะมีทิศขนานกับผิวของของเหลวและตั้งฉากกับเส้นขอบที่สัมผัส'],
            answersRaw: [0],
            explanation: (shuffled) => formatChoiceExplanation(QUESTION_TEMPLATES.find(q => q.id === '17_2_1_concept_tension'), shuffled)
        })
    },

    // 17.2.2 ความหนืดของของเหลว (Viscosity & Viscous Force) - รวมในหมวด 17.2.1
    {
        id: '17_2_2_viscosity_definition', topic: '17.2.1', type: 'choice',
        title: 'นิยามและความเข้าใจคลาดเคลื่อนเกี่ยวกับความหนืดและแรงหนืด',
        choices: [
            'ความหนืดเป็นสมบัติของของเหลวทุกชนิดที่ต้านการไหล และแรงหนืดคือแรงที่ของเหลวต้านการเคลื่อนที่ของวัตถุในของเหลวนั้น',
            'ความหนืดเป็นสมบัติเฉพาะตัวที่มีอยู่เฉพาะในของเหลวที่มีความเข้มข้นหรือเหนียวข้นมากเท่านั้น',
            'แรงหนืดจะมีทิศทางเดียวกับการเคลื่อนที่ของวัตถุเสมอเพื่อช่วยส่งเสริมการตกให้เร็วขึ้น',
            'แรงหนืดจะเกิดขึ้นเฉพาะเมื่อวัตถุหยุดนิ่งลอยอยู่กลางของเหลวเท่านั้น'
        ],
        choiceExplanations: [
            { isCorrect: true, text: 'ความหนืดเป็นสมบัติของของเหลวทุกชนิดในการต้านการไหลหรือต้านการเคลื่อนที่ และแรงหนืดคือแรงที่ของเหลวต้านการเคลื่อนที่ของวัตถุผ่านของเหลว' },
            { isCorrect: false, text: 'สสวท. ระบุว่าความคิดคลาดเคลื่อนคือคิดว่าความหนืดมีเฉพาะในของเหลวเข้มข้น แต่แนวคิดที่ถูกต้องคือความหนืดเป็นสมบัติของของเหลวทุกชนิด' },
            { isCorrect: false, text: 'แรงหนืดมีทิศทางตรงข้ามกับการเคลื่อนที่ของวัตถุเสมอเพื่อต้านการเคลื่อนที่' },
            { isCorrect: false, text: 'แรงหนืดเกิดขึ้นขณะวัตถุกำลังเคลื่อนที่ผ่านของเหลว' }
        ],
        text: () => `เมื่อพิจารณาสมบัติความหนืด (Viscosity) และแรงหนืด (Viscous Force) ของของเหลวตามหลักการ สสวท. ข้อความใดถูกต้องที่สุด`,
        generate: (seed) => ({
            params: {},
            answers: ['ความหนืดเป็นสมบัติของของเหลวทุกชนิดที่ต้านการไหล และแรงหนืดคือแรงที่ของเหลวต้านการเคลื่อนที่ของวัตถุในของเหลวนั้น'],
            answersRaw: [0],
            explanation: (shuffled) => formatChoiceExplanation(QUESTION_TEMPLATES.find(q => q.id === '17_2_2_viscosity_definition'), shuffled)
        })
    },
    {
        id: '17_2_2_motion_in_fluid', topic: '17.2.1', type: 'choice',
        title: 'พฤติกรรมการเคลื่อนที่ของลูกกลมเหล็กเมื่อปล่อยในของเหลวหนืด',
        choices: [
            'ช่วงแรกอัตราเร็วจะเพิ่มขึ้น (มีความเร่ง) เมื่อถึงจุดหนึ่งอัตราเร็วจะสม่ำเสมอคงตัว (ความเร่งเป็นศูนย์)',
            'ลูกกลมเหล็กจะเคลื่อนที่ด้วยอัตราเร็วคงตัวสม่ำเสมอตลอดการตกตั้งแต่วินาทีแรกที่ปล่อย',
            'ลูกกลมเหล็กจะเคลื่อนที่ด้วยความเร่งคงที่สม่ำเสมอตลอดความลึกของกระบอกตวง',
            'ช่วงแรกอัตราเร็วจะลดลงเรื่อยๆ จนกระทั่งวัตถุหยุดนิ่งอยู่กลางของเหลว'
        ],
        choiceExplanations: [
            { isCorrect: true, text: 'ตาม สสวท. เมื่อปล่อยลูกกลมเหล็ก ช่วงแรกแรงลัพธ์ไม่เป็นศูนย์ วัตถุจะมีความเร่งและอัตราเร็วเพิ่มขึ้น จนเมื่อแรงหนืดร่วมกับแรงพยุงสมดุลกับน้ำหนัก (W = B + Fv) แรงลัพธ์เป็น 0 อัตราเร็วจะสม่ำเสมอคงตัว (อัตราเร็วปลาย vt)' },
            { isCorrect: false, text: 'ช่วงแรกความเร่งไม่เป็นศูนย์ อัตราเร็วต้องเพิ่มขึ้นก่อน' },
            { isCorrect: false, text: 'ความเร่งจะลดลงเรื่อยๆ จนกลายเป็นศูนย์เมื่อเข้าสู่สมดุล ไม่ได้คงที่ตลอดการตก' },
            { isCorrect: false, text: 'ลูกกลมเหล็กที่มีความหนาแน่นมากกว่าของเหลวจะจมต่อจนถึงก้นภาชนะด้วยอัตราเร็วคงตัว' }
        ],
        text: () => `จากการทดลองปล่อยลูกกลมเหล็กให้จมลงในแนวดิ่งใต้ของเหลวที่มีความหนืด การเปลี่ยนแปลงอัตราเร็วและความเร่งของลูกกลมเหล็กเป็นอย่างไร`,
        generate: (seed) => ({
            params: {},
            answers: ['ช่วงแรกอัตราเร็วจะเพิ่มขึ้น (มีความเร่ง) เมื่อถึงจุดหนึ่งอัตราเร็วจะสม่ำเสมอคงตัว (ความเร่งเป็นศูนย์)'],
            answersRaw: [0],
            explanation: (shuffled) => formatChoiceExplanation(QUESTION_TEMPLATES.find(q => q.id === '17_2_2_motion_in_fluid'), shuffled)
        })
    },
    {
        id: '17_2_2_viscosity_time', topic: '17.2.1', type: 'choice',
        title: 'ผลของความหนืดต่อเวลาในการเคลื่อนที่ของวัตถุ (กิจกรรม 17.4)',
        choices: [
            'ลูกกลมเหล็กจะใช้เวลาตกถึงก้นภาชนะต่างกัน โดยในของเหลวที่มีความหนืดมาก วัตถุจะใช้เวลาเคลื่อนที่มากกว่า (ตกได้ช้ากว่า)',
            'ลูกกลมเหล็กจะใช้เวลาตกถึงก้นภาชนะเท่ากันพอดี เนื่องจากลูกกลมเหล็กมีขนาดและน้ำหนักเท่ากัน',
            'ในของเหลวที่มีความหนืดมาก ลูกกลมเหล็กจะตกถึงก้นภาชนะได้รวดเร็วกว่าของเหลวที่มีความหนืดน้อย',
            'ความหนืดของของเหลวไม่มีผลต่อเวลาในการตก ขึ้นอยู่กับมวลของลูกกลมเหล็กเพียงอย่างเดียว'
        ],
        choiceExplanations: [
            { isCorrect: true, text: 'จากกิจกรรม 17.4 ของ สสวท. เมื่อปล่อยลูกกลมเหล็กในของเหลวต่างชนิดกันที่ลึกเท่ากัน จะใช้เวลาต่างกัน โดยในของเหลวหนืดมากจะใช้เวลาเคลื่อนที่มากกว่า (ตกช้ากว่า)' },
            { isCorrect: false, text: 'เวลาในการตกไม่เท่ากัน ขึ้นอยู่กับความหนืดของของเหลว' },
            { isCorrect: false, text: 'ของเหลวที่มีความหนืดมากจะต้านทานการเคลื่อนที่มากกว่า ทำให้วัตถุเคลื่อนที่ได้ช้ากว่า' },
            { isCorrect: false, text: 'ความหนืดของของเหลวมีผลโดยตรงต่อแรงต้านทานการตกและระยะเวลาในการจม' }
        ],
        text: () => `เมื่อปล่อยลูกกลมเหล็กขนาดเท่ากันลงในของเหลวต่างชนิดกันที่มีความลึกเท่ากัน (ตามกิจกรรม 17.4 ของ สสวท.) ข้อใดสรุปผลได้ถูกต้อง`,
        generate: (seed) => ({
            params: {},
            answers: ['ลูกกลมเหล็กจะใช้เวลาตกถึงก้นภาชนะต่างกัน โดยในของเหลวที่มีความหนืดมาก วัตถุจะใช้เวลาเคลื่อนที่มากกว่า (ตกได้ช้ากว่า)'],
            answersRaw: [0],
            explanation: (shuffled) => formatChoiceExplanation(QUESTION_TEMPLATES.find(q => q.id === '17_2_2_viscosity_time'), shuffled)
        })
    },

    // 17.3.1 ความดันในของไหล (Fluid Pressure)
    {
        id: '17_3_1_pressure_depth', topic: '17.3.1', type: 'numeric_double',
        title: 'ความดันเกจและความดันสัมบูรณ์ใต้น้ำ',
        inputs: [{ label: '1. ความดันเกจ \\( (\\text{Pa}) \\):' }, { label: '2. ความดันสัมบูรณ์ \\( (\\text{Pa}) \\):' }],
        text: (p) => `นักสำรวจเรือดำน้ำวัดค่าความลึกตรงจุดก้นน้ำทะเลลึกได้เป็นระยะทาง \\( ${p.r ? `(${p.h_base} + \\ ${p.r * 2})` : p.h} \\text{ m} \\) ถ้าน้ำทะเลความหนาแน่นเฉลี่ย \\( 1.02 \\times 10^3 \\text{ kg/m}^3 \\) จงคำนวณหา (1) ความดันเกจ และ (2) ความดันสัมบูรณ์ ณ ความลึกนี้ (กำหนดความดันบรรยากาศ \\( P_0 = 1.0 \\times 10^5 \\text{ Pa} \\) และ \\( g = 10 \\text{ m/s}^2 \\))`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const h_base = seed ? getSeededRandomBase('17_3_1_press_h', seed, 40, 100, 10) : 80;
            const h = seed ? h_base + offset * 2 : 100;

            const rho = 1020;
            const pg = rho * 10 * h;
            const p0 = 1.0e5;
            const pAbs = p0 + pg;

            return {
                params: { h, h_base, r: offset },
                answers: [`${pg.toExponential(2)}, ${pAbs.toExponential(2)}`, `${pg}, ${pAbs}`],
                answersRaw: [pg, pAbs],
                explanation: () => `
          1. สูตรความดันเกจเนื่องจากระดับของเหลว: \\( P_g = \\rho g h \\)<br>
          \\( P_g = (1020 \\text{ kg/m}^3) \\cdot (10 \\text{ m/s}^2) \\cdot (${h} \\text{ m}) = ${pg.toLocaleString()} \\text{ Pa} \\) (หรือ \\( ${formatScientificLaTeX(pg, 2)} \\text{ Pa} \\))<br>
          2. สูตรความดันสัมบูรณ์สะสมรวม: \\( P = P_0 + P_g \\)<br>
          \\( P = (1.0 \\times 10^5) + ${pg.toLocaleString()} = ${pAbs.toLocaleString()} \\text{ Pa} \\) (หรือ \\( ${formatScientificLaTeX(pAbs, 2)} \\text{ Pa} \\))
        `
            };
        }
    },
    {
        id: '17_3_1_submarine_force', topic: '17.3.1', type: 'numeric_single',
        title: 'แรงดันสัมบูรณ์กระทำต่อฝาเรือดำน้ำ',
        inputs: [{ label: 'แรงดึงดันที่กระทำทั้งหมด \\( (\\text{N}) \\):' }],
        text: (p) => `หน้าต่างทรงกลมสำหรับชมทัศนียภาพของเรือดำน้ำมีพื้นที่ผิว \\( ${p.area} \\text{ m}^2 \\) ดำลงไปลึกใต้ทะเล \\( ${p.r ? `(${p.h_base} + \\ ${p.r})` : p.h} \\text{ m} \\) จงหาแรงลัพธ์สัมบูรณ์ทั้งหมดที่กระทำบนฝาหน้าต่างนี้ภายนอก (กำหนดความหนาแน่นน้ำทะเล \\( 1.03 \\times 10^3 \\text{ kg/m}^3 \\), \\( P_0 = 1.0 \\times 10^5 \\text{ Pa} \\) และ \\( g = 10 \\text{ m/s}^2 \\))`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const area = seed ? getSeededRandomBase('17_3_1_sub_a', seed, 0.2, 0.8, 0.1) : 0.5;
            const h_base = seed ? getSeededRandomBase('17_3_1_sub_h', seed, 30, 70, 5) : 40;
            const h = seed ? h_base + offset : 50;

            const rho = 1030;
            const pg = rho * 10 * h;
            const pAbs = 1.0e5 + pg;
            const force = pAbs * area;

            return {
                params: { area: parseFloat(area.toFixed(2)), h, h_base, r: offset },
                answers: [`\\( ${formatScientificLaTeX(force, 2)} \\)`, force.toExponential(2), force.toFixed(0)],
                answersRaw: [force],
                explanation: () => `
          1. คำนวณความดันสัมบูรณ์ ณ ความลึกทะเลก่อน:<br>
          \\( P = P_0 + \\rho g h = 10^5 + (1030 \\cdot 10 \\cdot ${h}) = ${pAbs.toLocaleString()} \\text{ Pa} \\)<br>
          2. หาแรงลัพธ์จากความสัมพันธ์ความดัน: \\( F = P \\cdot A \\)<br>
          \\( F = (${pAbs.toLocaleString()} \\text{ Pa}) \\cdot (${area} \\text{ m}^2) = ${force.toLocaleString()} \\text{ N} \\) (หรือ \\( ${formatScientificLaTeX(force, 2)} \\text{ N} \\))
        `
            };
        }
    },
    {
        id: '17_3_1_concept_pressure', topic: '17.3.1', type: 'choice',
        title: 'แนวคิดเรื่องความดันของของเหลว',
        choices: [
            'ความดันในของเหลว ณ จุดใดๆ ที่ความลึกเดียวกันจะมีขนาดเท่ากันในทุกทิศทาง',
            'ความดันสัมบูรณ์ในของเหลวมีค่าน้อยกว่าความดันเกจเสมอเมื่อลงไปใต้ผิวหน้าน้ำ',
            'ความดันเกจเนื่องจากน้ำหนักของเหลวจะแปรผกผันกับระดับความหนาแน่นของของไหล',
            'ความดันเนื่องจากน้ำหนักของเหลวที่ก้นภาชนะแปรตามขนาดพื้นที่หน้าตัดรูปทรงของภาชนะ'
        ],
        choiceExplanations: [
            { isCorrect: true, text: 'ที่ระดับความลึกเดียวกันความดันของเหลวส่งผ่านสมดุลสถิตเท่ากันทุกทิศทาง' },
            { isCorrect: false, text: 'ความดันสัมบูรณ์ (P = P0 + Pg) มีค่ามากกว่าความดันเกจ (Pg) เสมอ' },
            { isCorrect: false, text: 'ความดันเกจแปรผันตรงกับความหนาแน่น (Pg ∝ ρ)' },
            { isCorrect: false, text: 'ความดันของของเหลว P = ρgh ไม่ขึ้นกับหน้าตัดหรือรูปร่างถังบรรจุ' }
        ],
        text: () => `ตามทฤษฎีกลศาสตร์เรื่องความดันสถิตของของเหลว ข้อความใดระบุสมบัติหลักได้ถูกต้องที่สุด`,
        generate: (seed) => ({
            params: {},
            answers: ['ความดันในของเหลว ณ จุดใดๆ ที่ความลึกเดียวกันจะมีขนาดเท่ากันในทุกทิศทาง'],
            answersRaw: [0],
            explanation: (shuffled) => formatChoiceExplanation(QUESTION_TEMPLATES.find(q => q.id === '17_3_1_concept_pressure'), shuffled)
        })
    },

    // 17.3.2 เครื่องอัดไฮดรอลิก (Hydraulic Press)
    {
        id: '17_3_2_piston_force', topic: '17.3.2', type: 'numeric_single',
        title: 'แรงกดขั้นต่ำในเครื่องอัดไฮดรอลิก',
        inputs: [{ label: 'แรงกดบนลูกสูบเล็ก \\( (\\text{N}) \\):' }],
        text: (p) => `เครื่องอัดไฮดรอลิกท่อปิดลูกสูบเล็กมีรัศมี \\( ${p.r} \\text{ cm} \\) และลูกสูบยกฝั่งใหญ่มีรัศมี \\( ${p.R} \\text{ cm} \\) ถ้าต้องการชูยกรถยนต์บรรทุกหนัก \\( ${p.r ? `(${p.m_base} + \\ ${p.r * 20})` : p.m} \\text{ kg} \\) ฝั่งลูกสูบใหญ่ จงหาแรงกดขั้นต่ำที่จำเป็นต้องมีที่ลูกสูบเล็กฝั่งนี้ (กำหนดให้ \\( g = 10 \\text{ m/s}^2 \\))`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const r = seed ? getSeededRandomBase('17_3_2_press_r', seed, 2, 5, 1) : 3;
            const R = seed ? getSeededRandomBase('17_3_2_press_R', seed, 20, 50, 5) : 30;
            const m_base = seed ? getSeededRandomBase('17_3_2_press_m', seed, 800, 1600, 100) : 1200;
            const m = seed ? m_base + offset * 20 : 1200;

            const forceLarge = m * 10;
            const areaRatio = Math.pow(r / R, 2);
            const forceSmall = forceLarge * areaRatio;

            return {
                params: { r, R, m, m_base, r_offset: offset },
                answers: [forceSmall.toFixed(1), forceSmall.toFixed(0), forceSmall.toFixed(2)],
                answersRaw: [forceSmall],
                explanation: () => `
          จากทฤษฎีการส่งผ่านความดันของพาสคัล (Pascal's Principle): \\( \\frac{f}{a} = \\frac{F}{A} \\)<br>
          เมื่อท่อสูบเป็นวงกลม: \\( a = \\pi r^2 \\) และ \\( A = \\pi R^2 \\)<br>
          จัดรูปสมการหาแรงกดขนาดเล็ก: \\( f = F \\cdot \\left(\\frac{r}{R}\\right)^2 \\)<br>
          - แรงต้านขนาดใหญ่: \\( F = mg = ${m} \\cdot 10 = ${forceLarge.toLocaleString()} \\text{ N} \\)<br>
          - อัตราส่วนรัศมี: \\( r/R = ${r}/${R} \\)<br>
          แทนค่าคำนวณหาแรงกด:<br>
          \\( f = (${forceLarge.toLocaleString()}) \\cdot \\left(\\frac{${r}}{${R}}\\right)^2 = ${forceSmall.toFixed(2)} \\text{ N} \\)
        `
            };
        }
    },
    {
        id: '17_3_2_large_diameter', topic: '17.3.2', type: 'numeric_single',
        title: 'หารัศมีของลูกสูบฝั่งยกวัตถุหนัก',
        inputs: [{ label: 'รัศมีลูกสูบฝั่งยกวัตถุ \\( (\\text{cm}) \\):' }],
        text: (p) => `กระบอกสูบไฮดรอลิกผ่อนแรงมีลูกสูบกดรัศมีฝั่งเล็ก \\( ${p.r} \\text{ cm} \\) โดยออกแรงกดลงไป \\( ${p.f} \\text{ N} \\) แล้วส่งผ่านความดันสามารถยกรับน้ำหนักสิ่งของฝั่งใหญ่ได้สูงสุดหนัก \\( ${p.r_offset ? `(${p.F_base.toLocaleString()} + \\ ${p.F_add.toLocaleString()})` : p.F.toLocaleString()} \\text{ N} \\) จงหาขนาดของรัศมีของลูกสูบฝั่งใหญ่ตัวนี้`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const r = seed ? getSeededRandomBase('17_3_2_large_r', seed, 2, 5, 1) : 3;
            const f = seed ? getSeededRandomBase('17_3_2_large_f', seed, 50, 100, 50) : 100;
            
            const M_base = seed ? getSeededRandomBase('17_3_2_large_M', seed, 4, 7, 1) : 5;
            const M = seed ? M_base + (offset % 8) + 1 : 10;
            const ratioSq = M * M;
            
            const F = ratioSq * f;
            const F_base = M_base * M_base * f;
            const F_add = F - F_base;
            
            const R = r * M;

            return {
                params: { r, f, F, F_base, F_add, M, ratioSq, r_offset: offset },
                answers: [R.toFixed(0), R.toFixed(1), R.toFixed(2)],
                answersRaw: [R],
                explanation: () => `
          จากกฎพาสคัลขยายพื้นที่หน้าตัดของกระบอกสูบไฮดรอลิก:<br>
          \\( \\frac{f}{r^2} = \\frac{F}{R^2} \\Rightarrow R = r \\cdot \\sqrt{\\frac{F}{f}} \\)<br>
          - รัศมีสูบเล็ก \\( r = ${r} \\text{ cm} \\)<br>
          - แรงกดสูบเล็ก \\( f = ${f} \\text{ N} \\)<br>
          - แรงต้านยกของฝั่งใหญ่ \\( F = ${F.toLocaleString()} \\text{ N} \\)<br>
          แทนค่าคำนวณ:<br>
          \\( R = ${r} \\cdot \\sqrt{\\frac{${F.toLocaleString()}}{${f}}} = ${r} \\cdot \\sqrt{${ratioSq}} = ${r} \\cdot ${M} = ${R} \\text{ cm} \\)
        `
            };
        }
    },
    {
        id: '17_3_2_small_radius', topic: '17.3.2', type: 'numeric_single',
        title: 'หารัศมีของลูกสูบกดฝั่งเล็กในเครื่องอัดไฮดรอลิก',
        inputs: [{ label: 'รัศมีลูกสูบฝั่งเล็ก \\( (\\text{cm}) \\):' }],
        text: (p) => `กระบอกสูบไฮดรอลิกมีลูกสูบยกฝั่งใหญ่รัศมี \\( ${p.R} \\text{ cm} \\) ต้องชูยกรถยนต์หนัก \\( ${p.r_offset ? `(${p.F_base.toLocaleString()} + \\ ${p.F_add.toLocaleString()})` : p.F.toLocaleString()} \\text{ N} \\) โดยออกแรงกดฝั่งเล็กเพียง \\( ${p.f} \\text{ N} \\) จงคำนวณหาขนาดของรัศมีของลูกสูบกดฝั่งเล็กตัวนี้`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const f = seed ? getSeededRandomBase('17_3_2_small_f', seed, 50, 100, 50) : 100;
            
            const M_base = seed ? getSeededRandomBase('17_3_2_small_M', seed, 4, 7, 1) : 4;
            const M = seed ? M_base + (offset % 5) + 1 : 5;
            const ratioSq = M * M;
            
            const F = ratioSq * f;
            const F_base = M_base * M_base * f;
            const F_add = F - F_base;
            
            const k = seed ? getSeededRandomBase('17_3_2_small_k', seed, 3, 6, 1) : 4;
            const R = M * k;
            const r = k;

            return {
                params: { R, f, F, F_base, F_add, M, ratioSq, r_offset: offset },
                answers: [r.toFixed(0), r.toFixed(1), r.toFixed(2)],
                answersRaw: [r],
                explanation: () => `
          จากกฎพาสคัลขยายพื้นที่หน้าตัดของกระบอกสูบไฮดรอลิก:<br>
          \\( \\frac{f}{r^2} = \\frac{F}{R^2} \\Rightarrow r = \\frac{R}{\\sqrt{\\frac{F}{f}}} \\)<br>
          - รัศมีสูบใหญ่ \\( R = ${R} \\text{ cm} \\)<br>
          - แรงกดสูบเล็ก \\( f = ${f} \\text{ N} \\)<br>
          - แรงต้านยกของฝั่งใหญ่ \\( F = ${F.toLocaleString()} \\text{ N} \\)<br>
          แทนค่าคำนวณ:<br>
          \\( r = \\frac{${R}}{\\sqrt{\\frac{${F.toLocaleString()}}{${f}}}} = \\frac{${R}}{\\sqrt{${ratioSq}}} = \\frac{${R}}{${M}} = ${r} \\text{ cm} \\)
        `
            };
        }
    },
    {
        id: '17_3_2_piston_radius_from_mass', topic: '17.3.2', type: 'numeric_single',
        title: 'หารัศมีของลูกสูบใหญ่จากมวลรถยนต์ที่ยก',
        inputs: [{ label: 'รัศมีลูกสูบฝั่งใหญ่ \\( (\\text{cm}) \\):' }],
        text: (p) => `แม่แรงไฮดรอลิกมีลูกสูบกดรัศมีฝั่งเล็ก \\( ${p.r} \\text{ cm} \\) ออกแรงกดลงไป \\( ${p.f} \\text{ N} \\) สามารถยกรับมวลรถยนต์ฝั่งใหญ่ได้หนัก \\( ${p.r_offset ? `(${p.m_base.toLocaleString()} + \\ ${p.m_add.toLocaleString()})` : p.m.toLocaleString()} \\text{ kg} \\) จงหารัศมีของลูกสูบฝั่งใหญ่ตัวนี้ (กำหนดให้ \\( g = 10 \\text{ m/s}^2 \\))`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const r = seed ? getSeededRandomBase('17_3_2_mass_r', seed, 2, 5, 1) : 2;
            const f = seed ? getSeededRandomBase('17_3_2_mass_f', seed, 50, 100, 50) : 100;
            
            const M_base = seed ? getSeededRandomBase('17_3_2_mass_M', seed, 4, 7, 1) : 5;
            const M = seed ? M_base + (offset % 8) + 1 : 7;
            const ratioSq = M * M;
            
            const F = ratioSq * f;
            const m = F / 10;
            const m_base = (M_base * M_base * f) / 10;
            const m_add = m - m_base;
            
            const R = r * M;

            return {
                params: { r, f, m, m_base, m_add, F, M, ratioSq, r_offset: offset },
                answers: [R.toFixed(0), R.toFixed(1), R.toFixed(2)],
                answersRaw: [R],
                explanation: () => `
          1. หาน้ำหนักแรงต้านยกของฝั่งใหญ่ก่อน: \\( F = m \\cdot g = ${m.toLocaleString()} \\cdot 10 = ${F.toLocaleString()} \\text{ N} \\)<br>
          2. จากกฎพาสคัลคำนวณหารัศมีลูกสูบฝั่งใหญ่:<br>
          \\( \\frac{f}{r^2} = \\frac{F}{R^2} \\Rightarrow R = r \\cdot \\sqrt{\\frac{F}{f}} \\)<br>
          - รัศมีสูบเล็ก \\( r = ${r} \\text{ cm} \\)<br>
          - แรงกดสูบเล็ก \\( f = ${f} \\text{ N} \\)<br>
          แทนค่าคำนวณ:<br>
          \\( R = ${r} \\cdot \\sqrt{\\frac{${F.toLocaleString()}}{${f}}} = ${r} \\cdot \\sqrt{${ratioSq}} = ${r} \\cdot ${M} = ${R} \\text{ cm} \\)
        `
            };
        }
    },
    {
        id: '17_3_2_hydraulic_ratio', topic: '17.3.2', type: 'numeric_single',
        title: 'หาอัตราส่วนรัศมีลูกสูบไฮดรอลิกผ่อนแรง',
        inputs: [{ label: 'อัตราส่วนรัศมีสูบใหญ่ต่อสูบเล็ก \\( (R/r) \\) (เท่า):' }],
        text: (p) => `เครื่องอัดไฮดรอลิกผ่อนแรงออกแรงกดฝั่งเล็กเพียง \\( ${p.f} \\text{ N} \\) สามารถยกรถยนต์หนัก \\( ${p.r_offset ? `(${p.F_base.toLocaleString()} + \\ ${p.F_add.toLocaleString()})` : p.F.toLocaleString()} \\text{ N} \\) จงหาว่าขนาดรัศมีของลูกสูบฝั่งใหญ่เป็นกี่เท่าของรัศมีลูกสูบฝั่งเล็ก`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const f = seed ? getSeededRandomBase('17_3_2_ratio_f', seed, 50, 100, 50) : 50;
            
            const M_base = seed ? getSeededRandomBase('17_3_2_ratio_M', seed, 6, 10, 2) : 8;
            const M = seed ? M_base + (offset % 8) + 1 : 10;
            const ratioSq = M * M;
            
            const F = ratioSq * f;
            const F_base = M_base * M_base * f;
            const F_add = F - F_base;

            return {
                params: { f, F, F_base, F_add, M, ratioSq, r_offset: offset },
                answers: [M.toFixed(0), M.toFixed(1)],
                answersRaw: [M],
                explanation: () => `
          จากกฎพาสคัลเปรียบเทียบรัศมีลูกสูบขยายพื้นที่:<br>
          \\( \\frac{f}{r^2} = \\frac{F}{R^2} \\Rightarrow \\left(\\frac{R}{r}\\right)^2 = \\frac{F}{f} \\Rightarrow \\frac{R}{r} = \\sqrt{\\frac{F}{f}} \\)<br>
          - แรงกดสูบเล็ก \\( f = ${f} \\text{ N} \\)<br>
          - แรงต้านยกของฝั่งใหญ่ \\( F = ${F.toLocaleString()} \\text{ N} \\)<br>
          แทนค่าคำนวณหาอัตราส่วนรัศมี:<br>
          \\( \\frac{R}{r} = \\sqrt{\\frac{${F.toLocaleString()}}{${f}}} = \\sqrt{${ratioSq}} = ${M} \\text{ เท่า} \\)
        `
            };
        }
    },
    {
        id: '17_3_2_concept_pascal', topic: '17.3.2', type: 'choice',
        title: 'แนวคิดทฤษฎีการผ่อนแรงไฮดรอลิก',
        choices: [
            'การเพิ่มความดันให้ของเหลวที่อยู่นิ่งปิดภาชนะ ความดันจะส่งต่อแรงกระจายเท่ากันไปยังทุกบริเวณของของเหลว',
            'เครื่องอัดไฮดรอลิกช่วยลดทอนแรงงานกลในการเคลื่อนที่ ยกวัตถุประหยัดพลังงานงานรวมที่ทำจริง',
            'หลักการทำงานของพาสคัลจะใช้การไม่ได้โดยสิ้นเชิงในน้ำมันอัดที่มีค่าระดับความหนืดสูงมาก',
            'ขนาดแรงดันลัพธ์ที่ได้จากการขยายพื้นที่ลูกสูบใหญ่จะแปรผกผันกับปริมาตรรวมของของเหลวในระบบ'
        ],
        choiceExplanations: [
            { isCorrect: true, text: 'เป็นนิยามพื้นฐานของกฎพาสคัล (Pressure transmitted equally)' },
            { isCorrect: false, text: 'ระบบช่วยผ่อนแรงจริงแต่ไม่ได้ช่วยลดงาน (พลังงานคงที่ตามกฎทรงพลังงาน W_in = W_out)' },
            { isCorrect: false, text: 'ความหนืดยังคงส่งผ่านความดันสถิตได้เหมือนเดิม เพียงแต่อาจช้าขึ้นเล็กน้อย' },
            { isCorrect: false, text: 'แรงยกชึ้นอยู่กับอัตราส่วนของพื้นที่หน้าตัดสูบใหญ่ต่อสูบเล็ก ไม่เกี่ยวกับปริมาณน้ำมัน' }
        ],
        text: () => `ข้อความสรุปเกี่ยวกับเครื่องอัดไฮดรอลิกและกลศาสตร์กฎของพาสคัล (Pascal's Law) ข้อใดถูกต้องที่สุด`,
        generate: (seed) => ({
            params: {},
            answers: ['การเพิ่มความดันให้ของเหลวที่อยู่นิ่งปิดภาชนะ ความดันจะส่งต่อแรงกระจายเท่ากันไปยังทุกบริเวณของของเหลว'],
            answersRaw: [0],
            explanation: (shuffled) => formatChoiceExplanation(QUESTION_TEMPLATES.find(q => q.id === '17_3_2_concept_pascal'), shuffled)
        })
    },

    // 17.3.3 แรงพยุงของไหล (Buoyant Force & Archimedes)
    {
        id: '17_3_3_submerged_ratio', topic: '17.3.3', type: 'numeric_single',
        title: 'เศษส่วนลอยน้ำจมน้ำของไม้สถิต',
        inputs: [{ label: 'เปอร์เซ็นต์ปริมาตรส่วนที่จมใต้ระดับผิวน้ำ (%):' }],
        text: (p) => `ท่อนไม้เนื้อแน่นที่มีระดับความหนาแน่น \\( ${p.r ? `(${p.rho_w_base} + \\ ${p.r * 5})` : p.rho_w} \\text{ kg/m}^3 \\) นำไปลอยอย่างอิสระนิ่งในทะเลสาบน้ำจืด (ความหนาแน่นน้ำจืดเท่ากับ \\( 1000 \\text{ kg/m}^3 \\)) จงหาว่าปริมาตรของท่อนไม้ในส่วนที่จมใต้น้ำคิดเป็นร้อยละเท่าใดของปริมาตรรวมไม้ท่อนนี้`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const rho_w_base = seed ? getSeededRandomBase('17_3_3_sub_rho', seed, 500, 700, 20) : 600;
            const rho_w = seed ? rho_w_base + offset * 5 : 700;

            const fraction = (rho_w / 1000) * 100;

            return {
                params: { rho_w, rho_w_base, r: offset },
                answers: [fraction.toFixed(1), fraction.toFixed(0), fraction.toFixed(2)],
                answersRaw: [fraction],
                explanation: () => `
          จากเงื่อนไขสมดุลของเทหวัตถุจมลอยในน้ำ (ลอยตัวนิ่ง):<br>
          แรงลอยตัวพยุง เท่ากับ น้ำหนักท่อนไม้ทั้งหมด: \\( B = W \\)<br>
          \\( \\rho_{\\text{water}} \\cdot V_{\\text{sub}} \\cdot g = \\rho_{\\text{wood}} \\cdot V_{\\text{total}} \\cdot g \\)<br>
          หาเศษส่วนการจมใต้ผิวของเหลว:<br>
          \\( \\frac{V_{\\text{sub}}}{V_{\\text{total}}} = \\frac{\\rho_{\\text{wood}}}{\\rho_{\\text{water}}} = \\frac{${rho_w}}{1000} \\)<br>
          คิดเป็นเปอร์เซ็นต์ส่วนจมลงใต้น้ำ:<br>
          \\( \\text{Percentage} = \\frac{${rho_w}}{1000} \\cdot 100\\% = ${fraction.toFixed(1)}\\% \\)
        `
            };
        }
    },
    {
        id: '17_3_3_apparent_weight', topic: '17.3.3', type: 'numeric_single',
        title: 'น้ำหนักปรากฏก้อนหินเมื่อแช่อยู่ใต้น้ำ',
        inputs: [{ label: 'น้ำหนักปรากฏบนสปริง \\( (\\text{N}) \\):' }],
        text: (p) => `ก้อนวัตถุแกนหินก้อนหนึ่งมีปริมาตรปริซึม \\( ${p.r ? `(${p.vol_L_base} + \\ ${p.r * 0.1})` : p.vol_L} \\text{ L} \\) และมีความหนาแน่นเฉลี่ย \\( 2.8 \\times 10^3 \\text{ kg/m}^3 \\) แขวนติดตาชั่งสปริงอ่านแรงดึงยื่นลงไปแช่ในอ่างน้ำจนมิดตัว จงหาค่าน้ำหนักแรงดึงที่อ่านได้จากตราชั่งสปริงขวดนี้ (กำหนดให้น้ำความหนาแน่น \\( 1000 \\text{ kg/m}^3 \\) และ \\( g = 10 \\text{ m/s}^2 \\))`,
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const vol_L_base = seed ? getSeededRandomBase('17_3_3_app_v', seed, 1.0, 3.0, 0.2) : 2.0;
            const vol_L = seed ? parseFloat((vol_L_base + offset * 0.1).toFixed(1)) : 3.0;

            const vol_m3 = vol_L / 1000;
            const rho_stone = 2800;
            const rho_water = 1000;
            const weight_air = rho_stone * vol_m3 * 10;
            const buoyant = rho_water * vol_m3 * 10;
            const weight_apparent = weight_air - buoyant;

            return {
                params: { vol_L, vol_L_base, r: offset },
                answers: [weight_apparent.toFixed(1), weight_apparent.toFixed(0), weight_apparent.toFixed(2)],
                answersRaw: [weight_apparent],
                explanation: () => `
          1. แปลงหน่วยปริมาตรจากลิตร (L) เป็นลูกบาศก์เมตร (\\(\\text{m}^3\\)):<br>
          \\( V = ${vol_L.toFixed(1)} \\text{ L} = \\frac{${vol_L.toFixed(1)}}{1000} \\text{ m}^3 = ${vol_m3.toFixed(4)} \\text{ m}^3 \\)<br>
          2. หาน้ำหนักจริงในอากาศของก้อนหิน:<br>
          \\( W = m \\cdot g = (\\rho_{\\text{obj}} \\cdot V) \\cdot g = (2800 \\text{ kg/m}^3 \\cdot ${vol_m3.toFixed(4)} \\text{ m}^3) \\cdot 10 \\text{ m/s}^2 = ${weight_air.toFixed(1)} \\text{ N} \\)<br>
          3. หาแรงลอยตัวพยุง (ตามหลักของอาร์คิมีดีส):<br>
          \\( B = \\rho_{\\text{fluid}} \\cdot V_{\\text{sub}} \\cdot g = (1000 \\text{ kg/m}^3 \\cdot ${vol_m3.toFixed(4)} \\text{ m}^3) \\cdot 10 \\text{ m/s}^2 = ${buoyant.toFixed(1)} \\text{ N} \\)<br>
          4. น้ำหนักที่ตาชั่งสปริงอ่านได้ (น้ำหนักปรากฏ):<br>
          \\( T = W - B = ${weight_air.toFixed(1)} - ${buoyant.toFixed(1)} = ${weight_apparent.toFixed(1)} \\text{ N} \\)
        `
            };
        }
    },
    {
        id: '17_3_3_concept_buoyancy', topic: '17.3.3', type: 'choice',
        title: 'หลักแรงลอยตัวอาร์คิมีดีส',
        choices: [
            'แรงพยุงของของไหลมีขนาดเท่ากับน้ำหนักของของไหลที่ถูกแทนที่โดยวัตถุนั้น',
            'วัตถุจะลอยปริ่มน้ำพอดีหากว่าค่าความหนาแน่นวัตถุมีค่ามากกว่าของของเหลว',
            'ขนาดแรงพยุงจะมีค่าเพิ่มสูงขึ้นเป็นทวีคูณเมื่อดึงหรือกดวัตถุลงใต้ผิวน้ำทะเลลึกขึ้นไปอีก',
            'แผ่นเหล็กแบนกว้างทรงสี่เหลี่ยมสามารถลอยตัวได้ง่ายกว่าก้อนกลมเพราะมีแรงดึงผิวมากกว่า'
        ],
        choiceExplanations: [
            { isCorrect: true, text: 'เป็นนิยามพื้นฐานของหลักการอาร์คิมีดีส (Buoyancy force equals weight of displaced fluid)' },
            { isCorrect: false, text: 'วัตถุจะจมถาวรหากความหนาแน่นของมันมากกว่าของเหลว (ρ_obj > ρ_fluid)' },
            { isCorrect: false, text: 'เมื่อจมมิดวัตถุแล้ว ปริมาตรแทนที่ (V_sub) จะคงที่ แรงลอยตัวจึงคงเดิมไม่ขึ้นกับระดับความลึก' },
            { isCorrect: false, text: 'แผ่นเหล็กลอยได้หรือไม่ได้ชี้วัดที่ความหนาแน่นเฉลี่ยของเรือหรือการออกแบบปริมาตรฟองอากาศพยุง' }
        ],
        text: () => `ตามหลักกลศาสตร์ของแรงลอยตัว (Buoyancy) และอาร์คิมีดีส ข้อความใดกล่าวได้ถูกต้องตามหลักวิทยาศาสตร์ที่สุด`,
        generate: (seed) => ({
            params: {},
            answers: ['แรงพยุงของของไหลมีขนาดเท่ากับน้ำหนักของของไหลที่ถูกแทนที่โดยวัตถุนั้น'],
            answersRaw: [0],
            explanation: (shuffled) => formatChoiceExplanation(QUESTION_TEMPLATES.find(q => q.id === '17_3_3_concept_buoyancy'), shuffled)
        })
    }
];

// Dynamically generate other intermediate questions to populate the questions bank
for (let i = 1; i <= 10; i++) {
    if (i % 2 === 0) {
        QUESTION_TEMPLATES.push({
            id: `17_3_1_gen_pressure_${i}`, topic: '17.3.1', type: 'numeric_single',
            title: `คำนวณความดันเกจ ณ จุดลึกใต้แม่น้ำ (ชุดที่ ${i})`,
            inputs: [{ label: 'ความดันเกจ \\( (\\text{Pa}) \\):' }],
            text: (p) => `แทงค์คอนกรีตเก็บน้ำขนาดใหญ่สำหรับโรงงานผลิตน้ำประปามีน้ำบรรจุอยู่สูงกักเก็บ \\( ${p.r ? `(${p.h_base} + \\ ${p.r})` : p.h} \\text{ m} \\) จงหาความดันเกจที่ก้นบ่อเก็บ (กำหนดให้ความหนาแน่นน้ำน้ำจืด \\( 1000 \\text{ kg/m}^3 \\) และ \\( g = 10 \\text{ m/s}^2 \\))`,
            generate: (seed) => {
                const offset = getOffsetFromR(seed);
                const h_base = seed ? getSeededRandomBase(`17_3_1_gen_h_${i}`, seed, 5, 20, 1) : 10;
                const h = seed ? h_base + offset : 12;

                const pg = 1000 * 10 * h;

                return {
                    params: { h, h_base, r: offset },
                    answers: [`\\( ${formatScientificLaTeX(pg, 2)} \\)`, pg.toString(), pg.toExponential(2)],
                    answersRaw: [pg],
                    explanation: () => `
            คำนวณความดันเกจจากสูตรตรงตัว: \\( P_g = \\rho g h \\)<br>
            - ความลึกน้ำ \\( h = ${h} \\text{ m} \\)<br>
            แทนค่าในสูตร:<br>
            \\( P_g = 1000 \\cdot 10 \\cdot ${h} = ${pg.toLocaleString()} \\text{ Pa} \\)
          `
                };
            }
        });
    } else {
        QUESTION_TEMPLATES.push({
            id: `17_3_2_gen_hydraulic_${i}`, topic: '17.3.2', type: 'numeric_single',
            title: `การขยายแรงอัดลูกสูบผ่อนแรง (ชุดที่ ${i})`,
            inputs: [{ label: 'แรงกดฝั่งลูกสูบเล็ก \\( (\\text{N}) \\):' }],
            text: (p) => `แม่แรงไฮดรอลิกมีสัดส่วนของพื้นที่หน้าตัดลูกสูบเล็กต่อสูบใหญ่เป็นอัตราส่วน \\( 1 : ${p.ratio} \\) หากยกรถยนต์หนัก \\( ${p.r ? `(${p.F_base} + \\ ${p.r * 100})` : p.F} \\text{ N} \\) จงหาขนาดแรงกดบนฝั่งลูกสูบเล็ก`,
            generate: (seed) => {
                const offset = getOffsetFromR(seed);
                const ratio = seed ? getSeededRandomBase(`17_3_2_gen_r_${i}`, seed, 50, 150, 10) : 100;
                const F_base = seed ? getSeededRandomBase(`17_3_2_gen_F_${i}`, seed, 10000, 20000, 1000) : 12000;
                const F = seed ? F_base + offset * 100 : 12000;

                const f = F / ratio;

                return {
                    params: { ratio, F, F_base, r: offset },
                    answers: [f.toFixed(1), f.toFixed(0), f.toFixed(2)],
                    answersRaw: [f],
                    explanation: () => `
            จากอัตราการส่งทอดความดัน: \\( \\frac{f}{a} = \\frac{F}{A} \\Rightarrow f = F \\cdot \\left( \\frac{a}{A} \\right) \\)<br>
            - สัดส่วนพื้นที่หน้าตัด \\( a/A = 1/${ratio} \\)<br>
            - แรงดึงฝั่งยก \\( F = ${F.toLocaleString()} \\text{ N} \\)<br>
            แทนค่าในสูตร:<br>
            \\( f = \\frac{${F.toLocaleString()}}{${ratio}} = ${f.toFixed(2)} \\text{ N} \\)
          `
                };
            }
        });
    }
}

// --- Practice Engine ---
function startPracticeMode(topic) {
    currentPracticeTopic = topic;
    const practiceArena = document.getElementById('practice-arena');
    if (practiceArena) practiceArena.classList.remove('hidden');

    ['17-2-1', '17-2-2', '17-3-1', '17-3-2', '17-3-3'].forEach(t => {
        const btn = document.getElementById(`btn-prac-${t}`);
        if (btn) btn.className = t === topic
            ? "p-4 bg-slate-100 border-2 border-cyan-500 text-slate-900 rounded-xl flex items-center gap-3 transition text-left shadow-sm"
            : "p-4 bg-white hover:bg-slate-50 text-slate-800 rounded-xl border border-slate-200 flex items-center gap-3 transition text-left shadow-sm hover:shadow";
    });

    const feedback = document.getElementById('prac-feedback');
    const explBox = document.getElementById('prac-explanation-box');
    if (feedback) feedback.classList.add('hidden');
    if (explBox) explBox.classList.add('hidden');

    regeneratePractice();
}

function regeneratePractice() {
    const modeSelect = document.getElementById('prac-type-select');
    const mode = modeSelect ? modeSelect.value : 'standard';
    const isRandom = mode === 'random';

    const formattedTopic = currentPracticeTopic.replace('17-2-', '17.2.').replace('17-3-', '17.3.');
    let filtered = QUESTION_TEMPLATES.filter(q => q.topic === formattedTopic);
    if (!filtered.length && (formattedTopic === '17.2.2' || formattedTopic === '17.2.1')) {
        filtered = QUESTION_TEMPLATES.filter(q => q.topic === '17.2.1');
    }

    if (!filtered.length) return;

    if (!practiceHistory[formattedTopic]) {
        practiceHistory[formattedTopic] = [];
    }

    let available = filtered.filter(q => !practiceHistory[formattedTopic].includes(q.id));

    if (available.length === 0) {
        const lastShown = practiceHistory[formattedTopic][practiceHistory[formattedTopic].length - 1];
        practiceHistory[formattedTopic] = lastShown ? [lastShown] : [];
        available = filtered.filter(q => !practiceHistory[formattedTopic].includes(q.id));
    }

    if (available.length === 0) {
        available = filtered;
    }

    const template = available[Math.floor(Math.random() * available.length)];
    practiceHistory[formattedTopic].push(template.id);

    if (practiceHistory[formattedTopic].length > Math.max(1, filtered.length - 1)) {
        practiceHistory[formattedTopic].shift();
    }

    let instance = null;
    let attempts = 0;
    const history = getHistory();

    while (attempts < 100) {
        attempts++;
        let R;
        if (isRandom) {
            R = Math.floor(Math.random() * 1000000) + 1;
        } else {
            R = "standard_" + Math.floor(Math.random() * 1000000);
        }

        instance = template.generate(R);
        const vals = getActiveParamValues(instance.params);
        if (vals.length > 0) {
            if (hasDuplicateVariables(instance.params)) {
                continue;
            }
            const key = generateUniqueKey(template.id, instance.params);
            if (history.includes(key)) {
                continue;
            }
            addToHistory(key);
        }
        break;
    }

    currentPracticeQuestion = { template, instance, shuffledChoices: [] };
    document.getElementById('prac-badge-mode').innerText = `หมวดหมู่โจทย์: ${template.topic} • ${isRandom ? 'โหมดสุ่มตัวเลข' : 'โจทย์ปกติ'}`;
    document.getElementById('prac-question-title').innerText = `📋 โจทย์: ${template.title}`;
    document.getElementById('prac-question-text').innerHTML = template.text(instance.params);

    const cz = document.getElementById('prac-choice-zone'), nz = document.getElementById('prac-numeric-zone');
    document.getElementById('prac-input-val1').value = '';
    document.getElementById('prac-input-val2').value = '';
    document.getElementById('prac-input-zone-2').classList.add('hidden');
    document.getElementById('prac-feedback').classList.add('hidden');
    document.getElementById('prac-explanation-box').classList.add('hidden');

    if (template.type === 'choice') {
        cz.classList.remove('hidden');
        nz.classList.add('hidden');
        const shuffledChoices = pureShuffle(template.choices);
        currentPracticeQuestion.shuffledChoices = shuffledChoices;
        cz.innerHTML = shuffledChoices.map(c => {
            const escaped = c.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            return `<button onclick="checkPracticeChoice(this.getAttribute('data-choice'))" data-choice="${escaped}" class="w-full text-left px-5 py-3 bg-white hover:bg-cyan-50 text-slate-800 font-medium rounded-xl border border-slate-200 hover:border-cyan-300 transition">${c}</button>`;
        }).join('');
    } else {
        cz.classList.add('hidden');
        nz.classList.remove('hidden');
        document.getElementById('lbl-prac-input-1').innerHTML = template.inputs[0].label;
        if (template.type === 'numeric_double') {
            document.getElementById('prac-input-zone-2').classList.remove('hidden');
            document.getElementById('lbl-prac-input-2').innerHTML = template.inputs[1].label;
        }
    }
    queueTypeset(document.getElementById('practice-arena'));
}

function checkPracticeAnswer() {
    if (!currentPracticeQuestion) return;
    const { template, instance } = currentPracticeQuestion;
    if (template.type === 'choice') return;

    const v1 = document.getElementById('prac-input-val1').value.trim();
    const v2 = document.getElementById('prac-input-val2').value.trim();

    if (!v1 || (template.type === 'numeric_double' && !v2)) {
        triggerAlert("กรอกข้อมูลไม่ครบ", "ระบุคำตอบให้ครบก่อนกดตรวจเฉลยครับ", "fa-circle-question", "bg-cyan-100 text-cyan-600");
        return;
    }

    const c1 = isNumericAnswerCorrect(v1, instance.answersRaw[0]);
    const c2 = template.type === 'numeric_double' ? isNumericAnswerCorrect(v2, instance.answersRaw[1]) : true;
    showPracticeFeedback(c1 && c2, instance.explanation());
}

function checkPracticeChoice(choice) {
    if (!currentPracticeQuestion) return;
    const { template, instance, shuffledChoices } = currentPracticeQuestion;
    const isCorrect = choice === instance.answers[0];
    const explanationText = template.type === 'choice'
        ? formatChoiceExplanation(template, shuffledChoices)
        : instance.explanation();
    showPracticeFeedback(isCorrect, explanationText);
}

function showPracticeFeedback(isCorrect, explainText) {
    const fb = document.getElementById('prac-feedback');
    fb.className = `p-5 rounded-2xl border block ${isCorrect ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`;
    fb.innerHTML = isCorrect
        ? `<div class="font-bold flex items-center gap-2"><i class="fa-solid fa-circle-check text-emerald-500 text-lg"></i> ยอดเยี่ยม! คำตอบของคุณถูกต้องครบถ้วน</div>`
        : `<div class="font-bold flex items-center gap-2"><i class="fa-solid fa-circle-xmark text-red-500 text-lg"></i> คำตอบไม่ตรงเฉลย ศึกษาขั้นตอนด้านล่างกันครับ</div>`;
    document.getElementById('prac-explanation-text').innerHTML = explainText;
    document.getElementById('prac-explanation-box').classList.remove('hidden');
    queueTypeset(document.getElementById('practice-arena'));
}

// --- Exam Engine ---
function startExamProcess() {
    const name = document.getElementById('exam-student-name').value.trim();
    const cls = document.getElementById('exam-student-class').value;
    const num = document.getElementById('exam-student-no').value.trim();
    const R_parsed = parseInt(num);
    if (!name || !cls || isNaN(R_parsed) || R_parsed < 1 || R_parsed > 40) {
        triggerAlert("ข้อมูลไม่ครบถ้วน", "กรุณาระบุ ชื่อ ชั้นเรียน และเลขที่ (1-40) ให้ถูกต้องก่อนเริ่มสอบครับ", "fa-user", "bg-cyan-100 text-cyan-600");
        return;
    }

    const timestamp = Date.now();
    examSeed = `${num}_${timestamp}`;
    examDurationSeconds = 15 * 60;
    examStudentInfo = { name, class: cls, number: num, seed: examSeed };

    // 4 Subtopics for calculation (Numeric Input): 17.2.1, 17.3.1, 17.3.2, 17.3.3
    const numericSubtopics = ['17.2.1', '17.3.1', '17.3.2', '17.3.3'];
    let selectedTemplates = [];

    // Select 1 numeric question from each of the 4 subtopics (Total = 4 numeric questions)
    numericSubtopics.forEach((topic) => {
        const numericQs = QUESTION_TEMPLATES.filter(q => q.topic === topic && q.type !== 'choice');
        if (numericQs.length > 0) {
            selectedTemplates.push(pureShuffle(numericQs)[0]);
        }
    });

    // Select exactly 1 choice question randomly from all choice templates (Total = 1 choice question)
    const allChoiceQs = QUESTION_TEMPLATES.filter(q => q.type === 'choice');
    if (allChoiceQs.length > 0) {
        selectedTemplates.push(pureShuffle(allChoiceQs)[0]);
    }

    selectedTemplates = pureShuffle(selectedTemplates);

    currentExamQuestions = selectedTemplates.map((template, index) => {
        let instance = null;
        let attempts = 0;
        const history = getHistory();
        
        while (attempts < 100) {
            attempts++;
            const seed = `${num}_${timestamp}_${template.id}_${attempts}`;
            instance = template.generate(seed);
            
            const vals = getActiveParamValues(instance.params);
            if (vals.length > 0) {
                if (hasDuplicateVariables(instance.params)) {
                    continue;
                }
                const key = generateUniqueKey(template.id, instance.params);
                if (history.includes(key)) {
                    continue;
                }
                addToHistory(key);
            }
            break;
        }

        const choices = template.type === 'choice' ? pureShuffle(template.choices) : [];
        const explanationText = template.type === 'choice'
            ? formatChoiceExplanation(template, choices)
            : instance.explanation();
        return {
            id: template.id, topic: template.topic, type: template.type, title: template.title,
            text: template.text(instance.params), inputs: template.inputs || [], choices: choices,
            answers: instance.answers,
            answersRaw: instance.answersRaw,
            explanationText: explanationText
        };
    });

    document.getElementById('lbl-exam-user-info').innerHTML = `${name} (ม.6/${cls} เลขที่ ${num})`;

    renderExamLiveDOM();

    examStartTimestamp = Date.now();
    examDeadlineTimestamp = examStartTimestamp + (examDurationSeconds * 1000);
    examTimeRemaining = examDurationSeconds;
    examIsActive = true;
    examSubmissionInProgress = false;

    sessionStorage.setItem(EXAM_STATE_KEY, JSON.stringify({
        examQuestions: currentExamQuestions, studentInfo: examStudentInfo, examStartTimestamp, examDeadlineTimestamp, examDurationSeconds
    }));

    setupExamLocks();
    showSection('exam-live');
    startExamTimer();
}

function setupExamLocks() {
    examExitGuardEnabled = true;
    document.body.classList.add('exam-locked');
    window.addEventListener('beforeunload', handleExamBeforeUnload);
}
function releaseExamLocks() {
    examExitGuardEnabled = false;
    document.body.classList.remove('exam-locked');
    window.removeEventListener('beforeunload', handleExamBeforeUnload);
}
function handleExamBeforeUnload(e) { if (examIsActive) { e.preventDefault(); e.returnValue = ''; } }

function renderExamLiveDOM() {
    const container = document.getElementById('exam-questions-container');
    container.innerHTML = '';
    currentExamQuestions.forEach((q, idx) => {
        let inputHTML = '';
        if (q.type === 'choice') {
            inputHTML += `<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">`;
            q.choices.forEach((c, cIdx) => {
                inputHTML += `<label class="flex items-center gap-3 bg-slate-50 border border-slate-200 hover:bg-slate-100 p-4 rounded-xl cursor-pointer transition">
              <input type="radio" name="exam-q${idx}" value="${c}" class="w-4 h-4 text-cyan-600 focus:ring-cyan-500">
              <span class="text-sm text-slate-800">${c}</span>
            </label>`;
            });
            inputHTML += `</div>`;
        } else if (q.type === 'numeric_single') {
            inputHTML += `<div class="mt-4"><label class="block text-xs font-bold text-slate-500 mb-1">${q.inputs[0].label}</label>
            <input type="text" id="exam-q${idx}-val1" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-cyan-500 outline-none font-mono text-sm"></div>`;
        } else if (q.type === 'numeric_double') {
            inputHTML += `<div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-bold text-slate-500 mb-1">${q.inputs[0].label}</label>
              <input type="text" id="exam-q${idx}-val1" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-cyan-500 outline-none font-mono text-sm">
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-500 mb-1">${q.inputs[1].label}</label>
              <input type="text" id="exam-q${idx}-val2" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-cyan-500 outline-none font-mono text-sm">
            </div>
          </div>`;
        }
        container.innerHTML += `<div class="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <span class="font-bold text-slate-800">ข้อที่ ${idx + 1}: ${q.title}</span>
            <span class="bg-cyan-100 text-cyan-800 px-2.5 py-1 rounded-md text-xs font-bold">2 คะแนน</span>
          </div>
          <p class="text-sm md:text-base text-slate-700 leading-relaxed font-medium math-font">${q.text}</p>
          ${inputHTML}
        </div>`;
    });
    queueTypeset(container);
}

function startExamTimer() {
    clearInterval(examTimerInterval);
    examTimerInterval = setInterval(() => {
        if (!examIsActive) return;
        examTimeRemaining = Math.max(0, Math.ceil((examDeadlineTimestamp - Date.now()) / 1000));
        document.getElementById('exam-timer-display').innerText = formatExamTime(examTimeRemaining);
        if (examTimeRemaining < 60) document.getElementById('exam-timer-display').classList.add('text-red-400');

        if (examTimeRemaining <= 0) {
            clearInterval(examTimerInterval);
            triggerAlert("หมดเวลาการสอบ", "ระบบได้ส่งผลข้อสอบของท่านอัตโนมัติเรียบร้อยแล้ว", "fa-clock", "bg-red-100 text-red-600");
            submitExam(true);
        }
    }, 500);
}

function getExamAnswers() {
    return currentExamQuestions.map((q, idx) => {
        if (q.type === 'choice') {
            const chk = document.querySelector(`input[name="exam-q${idx}"]:checked`);
            return chk ? chk.value : null;
        } else if (q.type === 'numeric_single') {
            const val1 = document.getElementById(`exam-q${idx}-val1`);
            return val1 ? [val1.value] : null;
        } else if (q.type === 'numeric_double') {
            const val1 = document.getElementById(`exam-q${idx}-val1`);
            const val2 = document.getElementById(`exam-q${idx}-val2`);
            return (val1 && val2) ? [val1.value, val2.value] : null;
        }
        return null;
    });
}

function confirmSubmitExam() {
    const answers = getExamAnswers();
    const uncomplete = answers.some(a => !a || (Array.isArray(a) && (a.some(val => !val.trim()))));
    const msg = uncomplete ? "คุณยังกรอกข้อสอบไม่ครบถ้วน ยืนยันต้องการส่งข้อสอบทันทีเลยหรือไม่?" : "คุณกรอกข้อสอบเรียบร้อยครบทุกข้อ ยืนยันความถูกต้องและต้องการส่งเลยหรือไม่?";

    const m = document.getElementById('modal-confirm');
    const c = document.getElementById('modal-confirm-card');
    document.getElementById('modal-confirm-msg').innerText = msg;

    m.classList.remove('hidden');
    setTimeout(() => { c.classList.remove('scale-95', 'opacity-0'); }, 10);
}

function closeConfirmModal() {
    const m = document.getElementById('modal-confirm');
    const c = document.getElementById('modal-confirm-card');
    c.classList.add('scale-95', 'opacity-0');
    setTimeout(() => { m.classList.add('hidden'); }, 200);
}

function executeSubmitExam() {
    closeConfirmModal();
    setTimeout(() => submitExam(), 200);
}

function submitExam(timeExpired = false) {
    if (examSubmissionInProgress) return;
    examSubmissionInProgress = true;
    examIsActive = false;
    clearInterval(examTimerInterval);
    releaseExamLocks();

    const answers = getExamAnswers();
    let total_score = 0;
    const gradedResults = [];

    currentExamQuestions.forEach((q, idx) => {
        const userAns = answers[idx];

        let isCorrect = false;
        if (q.type === 'choice') {
            isCorrect = userAns === q.answers[0];
        } else if (q.type === 'numeric_single') {
            isCorrect = userAns && isNumericAnswerCorrect(userAns[0], q.answersRaw[0]);
        } else if (q.type === 'numeric_double') {
            isCorrect = userAns &&
                isNumericAnswerCorrect(userAns[0], q.answersRaw[0]) &&
                isNumericAnswerCorrect(userAns[1], q.answersRaw[1]);
        }

        const score = isCorrect ? 2.0 : 0.0;
        total_score += score;
        gradedResults.push({
            idx, isCorrect, score, userAns,
            expectedAnswers: q.answers,
            explanationText: q.explanationText
        });
    });

    const elapsed = timeExpired ? examDurationSeconds : (examDurationSeconds - examTimeRemaining);
    const timeStr = `${Math.floor(elapsed / 60)} นาที ${elapsed % 60} วินาที`;

    const payload = {
        score: total_score, timeTaken: timeStr, studentInfo: examStudentInfo,
        gradedResults, examQuestions: currentExamQuestions, date: new Date().toLocaleDateString('th-TH')
    };
    localStorage.setItem('last_exam_results_17_2', JSON.stringify(payload));
    sessionStorage.removeItem(EXAM_STATE_KEY);

    updateLatestScore();
    showSection('exam-result');
    renderExamResults(payload);
}

function renderExamResults(data) {
    document.getElementById('lbl-res-student-name').innerText = data.studentInfo.name;
    document.getElementById('lbl-res-student-meta').innerHTML = `(ม.6/${data.studentInfo.class} เลขที่ ${data.studentInfo.number})`;
    document.getElementById('lbl-res-time-elapsed').innerText = data.timeTaken;
    document.getElementById('lbl-res-finished-at').innerText = data.date;

    document.getElementById('lbl-res-total-score').innerText = data.score;
    const circle = document.getElementById('res-circle-progress');
    if (circle) circle.style.strokeDashoffset = 439.8 - (data.score / 10) * 439.8;

    const fb = document.getElementById('lbl-res-badge-feedback');
    if (data.score >= 8) fb.innerHTML = `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-star"></i> ยอดเยี่ยม! คุณเข้าใจทฤษฎีกลศาสตร์ของไหลและสูตรคำนวณได้เป็นอย่างดี</span>`;
    else if (data.score >= 5) fb.innerHTML = `<span class="text-cyan-600 font-bold"><i class="fa-solid fa-thumbs-up"></i> ดี! ผ่านเกณฑ์ความเข้าใจระดับหนึ่ง ลองทบทวนสูตรความหนืดและความตึงผิวเพิ่มความแม่นยำนะครับ</span>`;
    else fb.innerHTML = `<span class="text-red-600 font-bold"><i class="fa-solid fa-book"></i> ยังไม่ผ่านเกณฑ์ แนะนำให้ทบทวนสูตรแรงพยุง กฎพาสคัล และการตกภายใต้แรงหนืดเพิ่มเติม</span>`;

    const tbody = document.getElementById('exam-result-tbody');
    const sols = document.getElementById('exam-solutions-container');
    tbody.innerHTML = ''; sols.innerHTML = '';

    data.gradedResults.forEach((grad, i) => {
        const q = data.examQuestions[i];
        const status = grad.isCorrect
            ? `<span class="text-emerald-500 font-bold"><i class="fa-solid fa-check"></i> 2.0</span>`
            : `<span class="text-red-500 font-bold"><i class="fa-solid fa-xmark"></i> 0.0</span>`;

        tbody.innerHTML += `<tr class="bg-white">
          <td class="px-5 py-3 font-medium text-center">${i + 1}</td>
          <td class="px-5 py-3 text-slate-700">${q.title}</td>
          <td class="px-5 py-3 text-center">2.0</td>
          <td class="px-5 py-3 text-center">${status}</td>
        </tr>`;

        let uAns = 'ไม่ได้ระบุคำตอบ';
        if (q.type === 'choice') uAns = grad.userAns || uAns;
        else if (grad.userAns && grad.userAns[0]) uAns = grad.userAns[0] + (q.type === 'numeric_double' ? ` และ ${grad.userAns[1]}` : '');

        sols.innerHTML += `<div class="bg-white p-5 rounded-xl border border-slate-200">
          <h5 class="font-bold text-slate-800 mb-2">ข้อ ${i + 1}: ${q.title}</h5>
          <p class="text-sm text-slate-600 mb-3 math-font">${q.text}</p>
          <div class="text-xs bg-slate-50 p-3 rounded-lg border border-slate-100 mb-3 font-mono">
            <p>คำตอบของคุณ: <span class="font-bold ${grad.isCorrect ? 'text-emerald-600' : 'text-red-600'}">${uAns}</span></p>
            <p>เฉลยที่ถูกต้อง: <span class="font-bold text-slate-800">${grad.expectedAnswers.join(' หรือ ')}</span></p>
          </div>
          <div class="text-xs text-slate-700 bg-cyan-50/50 p-3 rounded-lg math-font border border-cyan-100">${grad.explanationText}</div>
        </div>`;
    });
    queueTypeset(document.getElementById('sec-exam-result'));
}

function toggleExamSolutionBox() {
    const box = document.getElementById('exam-solution-box');
    const icon = document.getElementById('icon-toggle-sol');
    if (box && icon) {
        box.classList.toggle('hidden');
        icon.className = box.classList.contains('hidden') ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up";
    }
}

function updateLatestScore() {
    if (typeof window === 'undefined') return;
    try {
        const saved = localStorage.getItem('last_exam_results_17_2');
        const badge = document.getElementById('latest-score-badge');
        if (saved && badge) {
            const data = JSON.parse(saved);
            const scoreLbl = document.getElementById('lbl-last-score');
            if (scoreLbl) {
                scoreLbl.innerHTML = `${data.score}/10 \\( (\\text{${data.studentInfo.name}}) \\)`;
                badge.classList.remove('hidden');
                queueTypeset(scoreLbl);
            }
        }
    } catch (e) {
        console.error('Failed to update latest score badge', e);
    }
}

function showLatestResultModal() {
    if (typeof window === 'undefined') return;
    try {
        const saved = localStorage.getItem('last_exam_results_17_2');
        if (saved) {
            showSection('exam-result');
            renderExamResults(JSON.parse(saved));
        }
    } catch (e) {
        console.error('Failed to show latest result modal', e);
    }
}

// --- On Load Init ---
window.onload = () => {
    updateLatestScore();
    switchReviewTab('17-2-tension');
    queueTypeset(document.body);

    const activeSession = sessionStorage.getItem(EXAM_STATE_KEY);
    if (activeSession) {
        try {
            const s = JSON.parse(activeSession);
            if (s.examDeadlineTimestamp > Date.now()) {
                currentExamQuestions = s.examQuestions;
                examStudentInfo = s.studentInfo;
                examSeed = s.studentInfo.seed || null;
                examDeadlineTimestamp = s.examDeadlineTimestamp;
                examDurationSeconds = s.examDurationSeconds;
                examIsActive = true;
                document.getElementById('lbl-exam-user-info').innerHTML = `${s.studentInfo.name} (ม.6/${s.studentInfo.class} เลขที่ ${s.studentInfo.number})`;
                renderExamLiveDOM();
                setupExamLocks();
                showSection('exam-live');
                startExamTimer();
            } else {
                sessionStorage.removeItem(EXAM_STATE_KEY);
            }
        } catch (e) { sessionStorage.removeItem(EXAM_STATE_KEY); }
    }

    const totalQuestions = QUESTION_TEMPLATES.length;
    const totalCount = document.getElementById('total-count');
    if (totalCount) totalCount.innerText = totalQuestions;
};

let resizeTimer;
window.onresize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (currentSection === 'review') initCanvases();
    }, 150);
};
