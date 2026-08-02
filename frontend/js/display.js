const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : 'https://digital-clinic-queue.onrender.com/api';

// ════════════════════════════════════════════════════════
// SOCKET
// ════════════════════════════════════════════════════════
const BACKEND = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000'
  : 'https://digital-clinic-queue.onrender.com';

let socket;
try {
  socket = io(BACKEND, { 
    transports: ['polling', 'websocket'], // polling needed for initial handshake
    upgrade: true,                          // then upgrades to websocket
    reconnection: true,
    reconnectionDelay: 2000,
    timeout: 10000,
  });
  socket.on('token-updated',   onNewToken);
  socket.on('queue-refreshed', refreshAll);
  socket.on('connect',    () => setLive(true));
  socket.on('disconnect', () => setLive(false));
} catch(e) { console.warn('Socket unavailable'); }

function setLive(on) {
  const dot = document.getElementById('liveDot');
  if (dot) dot.style.background = on ? '#22c55e' : '#ef4444';
}

// ════════════════════════════════════════════════════════
// VOICE STATE
// ════════════════════════════════════════════════════════
let voiceEnabled = false;
let voiceReady   = false;     // voices actually loaded
let voiceQueue   = [];
let voiceBusy    = false;
let cachedVoice  = null;      // the best English voice, cached after first load

// ── Load voices eagerly — Chrome loads them async ────────
function loadVoices() {
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) {
    pickVoice(voices);
  } else {
    speechSynthesis.onvoiceschanged = () => {
      pickVoice(speechSynthesis.getVoices());
    };
  }
}

function pickVoice(voices) {
  cachedVoice =
    voices.find(v => v.lang === 'en-US' && v.name.includes('Google')) ||
    voices.find(v => v.lang === 'en-US') ||
    voices.find(v => v.lang === 'en-GB') ||
    voices.find(v => v.lang.startsWith('en')) ||
    voices[0] || null;
  voiceReady = true;
  console.log('Voice ready:', cachedVoice?.name || 'default');
}

// ── User clicks Enable button ─────────────────────────────
function enableVoice() {
  voiceEnabled = true;

  // Cancel anything stuck
  speechSynthesis.cancel();

  // Warm-up: speak a silent utterance to unlock audio context
  const warm    = new SpeechSynthesisUtterance('please'); // non-breaking space
  warm.volume   = 1;
  warm.rate   = 0.85;
  warm.lang     = 'en-US';
  if (cachedVoice) warm.voice = cachedVoice;
  warm.onend    = () => {
    console.log('Voice warm-up done ✓');
    // Process any queued announcements
    if (!voiceBusy){

      console.log('Processing queued voice announcements:', voiceQueue.length);
        processVoiceQueue();

    } 
  };
    speechSynthesis.speak(warm);

  
  // setTimeout(() => speechSynthesis.speak(warm), 50);
  console.log('Voice enabled by user');

  const btn  = document.getElementById('voiceEnableBtn');
  const wrap = document.getElementById('voiceEnableWrap');
  if (btn) { btn.textContent = '🔊 Voice Active ✓'; btn.style.background = '#16a34a'; }
  setTimeout(() => { if (wrap) wrap.style.display = 'none'; }, 2000);
}

// Manual test — called by Test Voice button
function testVoice() {
  if (!voiceEnabled) {
    // Auto-enable if they click test directly
    voiceEnabled = true;
    const btn = document.getElementById('voiceEnableBtn');
    if (btn) { btn.textContent = '🔊 Voice Active ✓'; btn.style.background = '#16a34a'; }
  }
  speechSynthesis.cancel();
  const utt  = new SpeechSynthesisUtterance('Token number 1. Please proceed to 000000 1.');
  utt.lang   = 'en-US';
  utt.rate   = 0.85;
  utt.volume = 1;
  if (cachedVoice) utt.voice = cachedVoice;
  const labelEl = document.getElementById('voiceText');
  if (labelEl) labelEl.textContent = '🔊 Testing voice...';
  utt.onend   = () => { if (labelEl) labelEl.textContent = 'Voice test done ✓ — Voice is working!'; };
  utt.onerror = (e) => { if (labelEl) labelEl.textContent = '❌ Voice error: ' + e.error; };
  setTimeout(() => speechSynthesis.speak(utt), 50);
}

// ════════════════════════════════════════════════════════
// VOICE QUEUE
// ════════════════════════════════════════════════════════
function queueVoice(token, counter) {
  voiceQueue.push({ token, counter });
  if (voiceEnabled && !voiceBusy) processVoiceQueue();

}

function processVoiceQueue() {
  if (!voiceEnabled || !voiceQueue.length || voiceBusy) return;
  console.log('Processing voice queue, items left:', voiceQueue.length);

  // Chrome bug: speechSynthesis can get stuck — reset if needed
  if (speechSynthesis.speaking && !speechSynthesis.pending) {
    speechSynthesis.cancel();
  }

console.log('Speaking next token from queue...');
  voiceBusy = true;
  const { token, counter } = voiceQueue.shift();

  const labelEl = document.getElementById('voiceText');
  if (labelEl) labelEl.textContent =
    `🔊 Token ${String(token).padStart(3,'0')} → Counter ${String(counter).padStart(2,'0')}`;

  const text = `Token number ${token}. Please go to Counter ${counter}.`;
  console.log('Queueing voice announcement:', text);
  const utt  = new SpeechSynthesisUtterance(text);
  utt.lang   = 'en-US';
  utt.rate   = 0.85;
  utt.pitch  = 1;
  utt.volume = 1;

  // Use cached voice if available
  if (cachedVoice) utt.voice = cachedVoice;

  utt.onstart = () => console.log(`Speaking: ${text}`);

  utt.onend = () => {
    voiceBusy = false;
    if (labelEl) labelEl.textContent = 'Voice announcement ready';
    // Small gap between announcements
    setTimeout(processVoiceQueue, 800);
  };

  utt.onerror = (e) => {
    console.error('Speech error:', e.error);
    voiceBusy = false;
    if (labelEl) labelEl.textContent = 'Voice announcement ready';
    setTimeout(processVoiceQueue, 1000);
  };

  // Chrome sometimes needs a tiny delay after cancel()
  setTimeout(() => {
    try { speechSynthesis.speak(utt); }
    catch(e) { console.error('speak() failed:', e); voiceBusy = false; }
  }, 50);
}

// ════════════════════════════════════════════════════════
// SOCKET EVENT
// ════════════════════════════════════════════════════════
function onNewToken(data) {
  if (data.token && data.counter) queueVoice(data.token, data.counter);
  refreshAll();
}

// ════════════════════════════════════════════════════════
// SERVING TOKENS
// ════════════════════════════════════════════════════════
let servingList = [];
let rotateIndex = 0;
let rotateTimer = null;

async function loadServingTokens() {
  try {
    const [servRes, cRes] = await Promise.all([
      fetch(`${API}/queue/serving`),
      fetch(`${API}/tokens/counters`)
    ]);
    const serving  = await servRes.json();
    const counters = await cRes.json();

    const cMap = {};
    counters.forEach(c => { cMap[c.counter_number] = c; });

    for (let i = 1; i <= 4; i++) {
      const info = cMap[i] || {};
      resetCounterBox(i, info.doctor_name || '', info.department || '');
    }

    serving.forEach(item => {
      const cnum  = item.counter_number;
      const cInfo = cMap[cnum] || {};
      updateCounterBox(cnum, item.token_number,
        cInfo.doctor_name || `Counter ${cnum}`, item.department);
    });

    servingList = serving.map(item => ({
      token_number:   item.token_number,
      counter_number: item.counter_number,
      department:     item.department,
      doctor_name:    (cMap[item.counter_number] || {}).doctor_name || '',
    })).sort((a, b) => a.counter_number - b.counter_number);

    startRotator();
  } catch(e) { console.error('loadServingTokens:', e); }
}

// ════════════════════════════════════════════════════════
// ROTATOR
// ════════════════════════════════════════════════════════
function startRotator() {
  if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }

  if (!servingList.length) {
    const tokenEl = document.getElementById('currentToken');
    const infoEl  = document.getElementById('counterInfo');
    if (tokenEl) {
      tokenEl.style.fontFamily = 'Inter, sans-serif';
      tokenEl.style.fontSize   = '80px';
      tokenEl.textContent      = '—';
      tokenEl.style.opacity    = '1';
    }
    if (infoEl) infoEl.textContent = 'Waiting for patients...';
    updateIndicators(null);
    return;
  }

  rotateIndex = 0;
  showSlide(rotateIndex);
  if (servingList.length > 1) {
    rotateTimer = setInterval(() => {
      rotateIndex = (rotateIndex + 1) % servingList.length;
      showSlide(rotateIndex);
    }, 4000);
  }
}

function showSlide(idx) {
  const item    = servingList[idx];
  if (!item) return;
  const tokenEl = document.getElementById('currentToken');
  const infoEl  = document.getElementById('counterInfo');

  if (tokenEl) { tokenEl.style.opacity = '0'; tokenEl.style.transform = 'scale(0.85)'; }

  setTimeout(() => {
    if (tokenEl) {
      tokenEl.style.fontFamily = '';
      tokenEl.style.fontSize   = '';
      tokenEl.textContent      = String(item.token_number).padStart(3, '0');
      tokenEl.style.opacity    = '1';
      tokenEl.style.transform  = 'scale(1)';
      tokenEl.style.transition = 'opacity .35s ease, transform .35s ease';
    }
    if (infoEl) {
      infoEl.textContent =
        `Counter ${String(item.counter_number).padStart(2,'0')}` +
        (item.doctor_name ? ` — ${item.doctor_name}` : '') +
        (item.department  ? ` — ${item.department}`  : '');
    }
    updateIndicators(item.counter_number);
  }, 200);
}

function updateIndicators(activeCounter) {
  for (let i = 1; i <= 4; i++) {
    const dot = document.getElementById(`indicator-${i}`);
    if (!dot) continue;
    const isServing = servingList.some(s => s.counter_number === i);
    dot.className =
      `counter-indicator ${isServing ? 'serving' : 'idle'} ${i === activeCounter ? 'current' : ''}`;
  }
}

// ════════════════════════════════════════════════════════
// COUNTER BOXES
// ════════════════════════════════════════════════════════
function resetCounterBox(num, doctorName, dept) {
  const box      = document.getElementById(`box-${num}`);
  const tokenEl  = document.getElementById(`c${num}-token`);
  const statusEl = document.getElementById(`c${num}-status`);
  const doctorEl = document.getElementById(`c${num}-doctor`);
  const deptEl   = document.getElementById(`c${num}-dept`);
  if (!box) return;
  box.classList.remove('active');
  if (tokenEl)  tokenEl.textContent  = '---';
  if (statusEl) { statusEl.className = 'c-status idle'; statusEl.textContent = 'Idle'; }
  if (doctorEl) doctorEl.textContent = doctorName || '';
  if (deptEl)   deptEl.textContent   = dept       || '';
}

function updateCounterBox(num, token, doctor, dept) {
  const box      = document.getElementById(`box-${num}`);
  const tokenEl  = document.getElementById(`c${num}-token`);
  const statusEl = document.getElementById(`c${num}-status`);
  const doctorEl = document.getElementById(`c${num}-doctor`);
  const deptEl   = document.getElementById(`c${num}-dept`);
  if (!box) return;
  box.classList.add('active');
  if (tokenEl)  tokenEl.textContent  = String(token).padStart(3, '0');
  if (doctorEl) doctorEl.textContent = doctor || '';
  if (deptEl)   deptEl.textContent   = dept   || '';
  if (statusEl) { statusEl.className = 'c-status serving'; statusEl.textContent = '● Serving'; }
}

// ════════════════════════════════════════════════════════
// QUEUE LIST & STATS
// ════════════════════════════════════════════════════════
async function loadQueueList() {
  try {
    const res   = await fetch(`${API}/queue/waiting`);
    const queue = await res.json();
    const el    = document.getElementById('queueList');
    if (!el) return;
    if (!queue.length) { el.innerHTML = '<p class="queue-empty">Queue is empty</p>'; return; }
    el.innerHTML = '';
    const makeSpan = (cls, text) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = String(text);
      return s;
    };
    queue.slice(0, 10).forEach((item, i) => {
      const div     = document.createElement('div');
      div.className = `q-token-box${i === 0 ? ' next-token' : ''}`;
      div.appendChild(makeSpan('q-num', String(item.token_number).padStart(3,'0')));
      div.appendChild(makeSpan('q-pos', i === 0 ? 'NEXT' : `#${i+1}`));
      div.appendChild(makeSpan('q-dept', (item.department||'').split(' ')[0]));
      div.appendChild(makeSpan('q-ctr', 'C' + String(item.counter_number||'?').padStart(2,'0')));
      el.appendChild(div);
    });
  } catch(e) { console.error('loadQueueList:', e); }
}

async function loadStats() {
  try {
    const res  = await fetch(`${API}/queue/stats`);
    const data = await res.json();
    const set  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('statQueue',   data.inQueue     || 0);
    set('statServing', data.serving     || 0);
    set('statServed',  data.servedToday || 0);
    set('statWait',    `${data.avgWait  || 0}m`);
  } catch(e) { console.error('Stats:', e); }
}

function refreshAll() {
  loadServingTokens();
  loadQueueList();
  loadStats();
}

// ════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════
loadVoices();   // start loading voices immediately on page open
refreshAll();

setInterval(loadServingTokens, 15000);
setInterval(loadQueueList,     10000);
setInterval(loadStats,         20000);