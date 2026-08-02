const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : 'https://digital-clinic-queue.onrender.com/api';
// ── Auth check ───────────────────────────────────────────
const _token = localStorage.getItem('adminToken');
if (!_token) {
  window.location.href = 'login.html';
}
const adminNameEl = document.getElementById('adminName');
if (adminNameEl) adminNameEl.textContent =
  localStorage.getItem('adminName') || 'Admin';

// ── authFetch: always sends JWT ──────────────────────────
function authFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
      ...(options.headers || {})
    }
  });
}

const BACKEND = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000'
  : 'https://digital-clinic-queue.onrender.com';
// ── Socket ───────────────────────────────────────────────
let socket;
try {
  socket = io(BACKEND, { transports: ['polling', 'websocket'] });
  socket.on('connect',         () => console.log('Socket connected'));
  socket.on('connect_error',   (e) => console.warn('Socket error:', e.message));
  socket.on('queue-refreshed', () => { loadQueue(); loadStats(); });
  socket.on('token-updated',   () => { loadQueue(); loadStats(); });
} catch(e) { console.warn('Socket not connected:', e); }

let currentTokenId  = null;
let currentTokenNum = null;
let activeTab       = 'queue';

// ════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════
function switchAdminTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
  const tabEl = document.getElementById(`tab-${tab}`);
  const secEl = document.getElementById(`section-${tab}`);
  if (tabEl) tabEl.classList.add('active');
  if (secEl) secEl.style.display = 'block';
  if (tab === 'queue')        { loadQueue();        loadStats(); }
  if (tab === 'appointments') { loadAppointments(); }
  if (tab === 'patients')     { loadPatients();     }
  if (tab === 'doctors')      { loadDoctors();      }
}

// ════════════════════════════════════════════════════════
// LOAD COUNTER SELECT
// ════════════════════════════════════════════════════════
async function loadCounterSelect() {
  try {
    const res      = await fetch(`${API}/tokens/counters`);
    const counters = await res.json();
    const select   = document.getElementById('counterSelect');
    if (!select) return;
    select.innerHTML = '';
    counters.forEach(c => {
      const opt       = document.createElement('option');
      opt.value       = c.counter_number;
      opt.textContent = `Counter ${String(c.counter_number).padStart(2,'0')} — ${c.doctor_name || 'No Doctor'}`;
      select.appendChild(opt);
    });
  } catch(e) { console.error('Counter select error:', e); }
}

// ════════════════════════════════════════════════════════
// LOGOUT
// ════════════════════════════════════════════════════════
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminName');
  window.location.href = 'login.html';
});

// ════════════════════════════════════════════════════════
// CALL NEXT TOKEN
// ════════════════════════════════════════════════════════
document.getElementById('callNextBtn').addEventListener('click', async () => {
  const counterSelect = document.getElementById('counterSelect');
  const counter       = counterSelect ? parseInt(counterSelect.value) : 1;
  try {
    const res  = await fetch(`${API}/queue/next`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ counter })
    });
    const data = await res.json();
    if (data.empty) {
      showNotif('Queue is empty — no more tokens.', 'info');
      return;
    }
    document.getElementById('servingToken').textContent =
      String(data.token).padStart(3, '0');
    document.getElementById('servingInfo').textContent =
      `${data.name} — ${data.department} — Counter ${data.counter}`;
    currentTokenNum = data.token;
    currentTokenId  = null;
    document.querySelectorAll('#queueTableBody tr').forEach(row => {
      const tc = row.querySelector('.t-token');
      if (tc && tc.textContent.trim() === String(data.token).padStart(3,'0')) {
        currentTokenId = row.dataset.id;
      }
    });
    if (socket) socket.emit('call-next', data);
    showNotif(`Token ${String(data.token).padStart(3,'0')} called at Counter ${data.counter}`, 'success');
    loadQueue();
    loadStats();
  } catch(err) {
    showNotif('Cannot reach server. Make sure Flask is running.', 'error');
    console.error(err);
  }
});

// ════════════════════════════════════════════════════════
// MARK DONE
// ════════════════════════════════════════════════════════
document.getElementById('markDoneBtn').addEventListener('click', async () => {
  if (!currentTokenId) {
    document.querySelectorAll('#queueTableBody tr').forEach(row => {
      if (row.querySelector('.badge-serving')) currentTokenId = row.dataset.id;
    });
  }
  if (!currentTokenId) {
    showNotif('No token is currently being served.', 'info');
    return;
  }
  try {
    await fetch(`${API}/queue/done/${currentTokenId}`, { method: 'POST' });
    document.getElementById('servingToken').textContent = '---';
    document.getElementById('servingInfo').textContent  = 'No token called yet';
    currentTokenId  = null;
    currentTokenNum = null;
    if (socket) socket.emit('mark-done', {});
    showNotif('Token marked as done.', 'success');
    loadQueue();
    loadStats();
  } catch(err) { console.error('Mark done error:', err); }
});

// ════════════════════════════════════════════════════════
// RESET QUEUE
// ════════════════════════════════════════════════════════
document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Reset entire queue? This cannot be undone.')) return;
  try {
    await fetch(`${API}/tokens/reset`, { method: 'POST' });
    document.getElementById('servingToken').textContent = '---';
    document.getElementById('servingInfo').textContent  = 'No token called yet';
    currentTokenId  = null;
    currentTokenNum = null;
    showNotif('Queue reset successfully.', 'success');
    loadQueue();
    loadStats();
  } catch(err) { console.error('Reset error:', err); }
});

// ── Refresh ──────────────────────────────────────────────
document.getElementById('refreshBtn').addEventListener('click', () => {
  loadQueue(); loadStats();
});

// ════════════════════════════════════════════════════════
// LOAD QUEUE
// ════════════════════════════════════════════════════════
async function loadQueue() {
  const tbody = document.getElementById('queueTableBody');
  if (!tbody) return;
  try {
    const res    = await fetch(`${API}/queue/all`);
    const tokens = await res.json();
    if (!tokens.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Queue is empty</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    tokens.forEach(token => {
      const row    = document.createElement('tr');
      row.dataset.id = token.id;
      const time   = new Date(token.issued_at).toLocaleTimeString('en-PK', {
        hour: '2-digit', minute: '2-digit'
      });
      const badgeMap = {
        waiting:   'badge-waiting',
        serving:   'badge-serving',
        done:      'badge-done',
        cancelled: 'badge-idle'
      };
      const counter = token.counter_number
        ? `C${String(token.counter_number).padStart(2,'0')}` : '—';
      // build cells safely to avoid DOM XSS
      // token number
      const tdToken = document.createElement('td');
      const spanToken = document.createElement('span');
      spanToken.className = 't-token';
      spanToken.textContent = String(token.token_number).padStart(3, '0');
      tdToken.appendChild(spanToken);

      // name and phone
      const tdUser = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = token.name;
      const br = document.createElement('br');
      const small = document.createElement('small');
      small.style.color = '#94a3b8';
      small.textContent = token.phone;
      tdUser.appendChild(strong);
      tdUser.appendChild(br);
      tdUser.appendChild(small);

      // department
      const tdDept = document.createElement('td');
      tdDept.textContent = token.department;

      // counter
      const tdCounter = document.createElement('td');
      const strongCounter = document.createElement('strong');
      strongCounter.textContent = counter;
      tdCounter.appendChild(strongCounter);

      // time
      const tdTime = document.createElement('td');
      tdTime.textContent = time;

      // status badge
      const tdStatus = document.createElement('td');
      const spanStatus = document.createElement('span');
      spanStatus.className = 'badge ' + (badgeMap[token.status] || 'badge-waiting');
      spanStatus.textContent = token.status;
      tdStatus.appendChild(spanStatus);

      // action
      const tdAction = document.createElement('td');
      if (token.status === 'waiting') {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = 'Call';
        btn.addEventListener('click', () => callSpecific(token.id, token.token_number));
        tdAction.appendChild(btn);
      } else if (token.status === 'serving') {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = 'Done';
        btn.addEventListener('click', () => doneSpecific(token.id));
        tdAction.appendChild(btn);
      } else {
        tdAction.textContent = '—';
      }

      // append all
      row.appendChild(tdToken);
      row.appendChild(tdUser);
      row.appendChild(tdDept);
      row.appendChild(tdCounter);
      row.appendChild(tdTime);
      row.appendChild(tdStatus);
      row.appendChild(tdAction);
      tbody.appendChild(row);
    });
  } catch(err) {
    document.getElementById('queueTableBody').innerHTML =
      `<tr><td colspan="7" class="empty-cell">Cannot connect to server</td></tr>`;
  }
}

// ════════════════════════════════════════════════════════
// LOAD APPOINTMENTS
// ════════════════════════════════════════════════════════
async function loadAppointments() {
  const tbody = document.getElementById('apptTableBody');
  if (!tbody) return;
  try {
    const res   = await fetch(`${API}/appointments/all`);
    const appts = await res.json();
    if (!appts.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No appointments yet</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    appts.forEach(a => {
      const row = document.createElement('tr');

      const tdToken = document.createElement('td');
      const spanToken = document.createElement('span');
      spanToken.className = 't-token';
      spanToken.textContent = String(a.token_number || '—').padStart(3, '0');
      tdToken.appendChild(spanToken);

      const tdUser = document.createElement('td');
      const strongName = document.createElement('strong');
      strongName.textContent = a.name;
      const br = document.createElement('br');
      const small = document.createElement('small');
      small.style.color = '#94a3b8';
      small.textContent = a.phone;
      tdUser.appendChild(strongName);
      tdUser.appendChild(br);
      tdUser.appendChild(small);

      const tdDept = document.createElement('td');
      tdDept.textContent = a.department;

      const tdDate = document.createElement('td');
      tdDate.textContent = a.appt_date || a.appointment_date || '—';

      const tdTime = document.createElement('td');
      tdTime.textContent = a.appt_time || a.appointment_time || '—';

      const tdStatus = document.createElement('td');
      const spanStatus = document.createElement('span');
      spanStatus.className = 'badge ' + (a.status === 'scheduled' ? 'badge-waiting' : 'badge-done');
      spanStatus.textContent = a.status;
      tdStatus.appendChild(spanStatus);

      row.appendChild(tdToken);
      row.appendChild(tdUser);
      row.appendChild(tdDept);
      row.appendChild(tdDate);
      row.appendChild(tdTime);
      row.appendChild(tdStatus);
      tbody.appendChild(row);
    });
  } catch(err) { console.error(err); }
}

// ════════════════════════════════════════════════════════
// LOAD PATIENTS
// ════════════════════════════════════════════════════════
async function loadPatients() {
  const tbody = document.getElementById('patientTableBody');
  if (!tbody) return;
  try {
    const res      = await fetch(`${API}/queue/patients`);
    const patients = await res.json();
    if (!patients.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No patients yet</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    patients.forEach(p => {
      const row = document.createElement('tr');

      const tdName = document.createElement('td');
      const strongName = document.createElement('strong');
      strongName.textContent = p.name;
      tdName.appendChild(strongName);

      const tdPhone = document.createElement('td');
      tdPhone.textContent = p.phone;

      const tdEmail = document.createElement('td');
      tdEmail.textContent = p.email || '—';

      const tdAge = document.createElement('td');
      tdAge.textContent = p.age || '—';

      const tdGender = document.createElement('td');
      tdGender.textContent = p.gender || '—';

      const tdCreated = document.createElement('td');
      tdCreated.textContent = new Date(p.created_at).toLocaleDateString('en-PK');

      row.appendChild(tdName);
      row.appendChild(tdPhone);
      row.appendChild(tdEmail);
      row.appendChild(tdAge);
      row.appendChild(tdGender);
      row.appendChild(tdCreated);
      tbody.appendChild(row);
    });
  } catch(err) { console.error(err); }
}

// ════════════════════════════════════════════════════════
// LOAD DOCTORS
// ════════════════════════════════════════════════════════
async function loadDoctors() {
  const tbody = document.getElementById('doctorsTableBody');
  if (!tbody) return;
  try {
    const res     = await fetch(`${API}/tokens/doctors`);
    const doctors = await res.json();
    if (!doctors.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No doctors added yet</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    doctors.forEach(d => {
      const row = document.createElement('tr');

      const tdCounter = document.createElement('td');
      const strongCounter = document.createElement('strong');
      strongCounter.textContent = `Counter ${String(d.counter_number).padStart(2, '0')}`;
      tdCounter.appendChild(strongCounter);

      const tdName = document.createElement('td');
      const strongName = document.createElement('strong');
      strongName.textContent = d.name;
      tdName.appendChild(strongName);

      const tdDept = document.createElement('td');
      tdDept.textContent = d.department;

      const tdDays = document.createElement('td');
      tdDays.textContent = d.days_of_week || d.available_days || 'Mon-Sat';

      const tdShift = document.createElement('td');
      tdShift.textContent = `${(d.shift_start || d.start_time || '09:00').slice(0, 5)} – ${(d.shift_end || d.end_time || '17:00').slice(0, 5)}`;

      const tdStatus = document.createElement('td');
      const spanStatus = document.createElement('span');
      spanStatus.className = 'badge ' + (d.is_active ? 'badge-active' : 'badge-idle');
      spanStatus.textContent = d.is_active ? 'Active' : 'Inactive';
      tdStatus.appendChild(spanStatus);

      const tdActions = document.createElement('td');
      const btnToggle = document.createElement('button');
      btnToggle.className = 'action-btn';
      btnToggle.textContent = d.is_active ? 'Deactivate' : 'Activate';
      btnToggle.addEventListener('click', () => toggleDoctor(d.id, !d.is_active));

      const btnDelete = document.createElement('button');
      btnDelete.className = 'action-btn';
      btnDelete.style.cssText = 'margin-left:4px;color:#dc2626;border-color:#fca5a5';
      btnDelete.textContent = 'Remove';
      btnDelete.addEventListener('click', () => deleteDoctor(d.id));

      tdActions.appendChild(btnToggle);
      tdActions.appendChild(btnDelete);

      row.appendChild(tdCounter);
      row.appendChild(tdName);
      row.appendChild(tdDept);
      row.appendChild(tdDays);
      row.appendChild(tdShift);
      row.appendChild(tdStatus);
      row.appendChild(tdActions);
      tbody.appendChild(row);
    });
  } catch(err) { console.error(err); }
}

// ════════════════════════════════════════════════════════
// ADD DOCTOR
// ════════════════════════════════════════════════════════
document.getElementById('saveDoctorBtn').addEventListener('click', async () => {
  const name    = document.getElementById('docName').value.trim();
  const dept    = document.getElementById('docDept').value;
  const counter = document.getElementById('docCounter').value;
  const days    = document.getElementById('docDays').value.trim();
  const start   = document.getElementById('docStart').value;
  const end     = document.getElementById('docEnd').value;

  if (!name) { showNotif('Please enter doctor name.', 'error'); return; }

  try {
    const res  = await fetch(`${API}/tokens/doctors/add`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, department: dept, counter, days, start, end })
    });
    const data = await res.json();
    if (res.ok) {
      showNotif(data.message || 'Doctor saved.', 'success');
      document.getElementById('docName').value = '';
      loadDoctors();
      loadCounterSelect();
    } else {
      showNotif(data.error || 'Failed to save doctor.', 'error');
    }
  } catch(err) { console.error(err); }
});

// ── Toggle doctor ────────────────────────────────────────
async function toggleDoctor(id, isActive) {
  try {
    const res  = await fetch(`${API}/tokens/doctors/update/${id}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: isActive })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showNotif(data.error || `Server error ${res.status}`, 'error');
      return;
    }
    showNotif(`Doctor ${isActive ? 'activated' : 'deactivated'}.`, 'success');
    loadDoctors();
    loadCounterSelect();
  } catch(err) {
    showNotif('Cannot reach server.', 'error');
    console.error('toggleDoctor:', err);
  }
}

// ── Delete doctor ────────────────────────────────────────
async function deleteDoctor(id) {
  if (!confirm('Remove this doctor?')) return;
  try {
    await fetch(`${API}/tokens/doctors/delete/${id}`, { method: 'POST' });
    showNotif('Doctor removed.', 'success');
    loadDoctors();
  } catch(err) { console.error(err); }
}

// ════════════════════════════════════════════════════════
// SPECIFIC TOKEN ACTIONS
// ════════════════════════════════════════════════════════
async function callSpecific(id, tokenNum) {
  const counter = parseInt(document.getElementById('counterSelect')?.value || 1);
  try {
    const res  = await fetch(`${API}/queue/next`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ counter })
    });
    const data = await res.json();
    if (!data.empty) {
      document.getElementById('servingToken').textContent = String(data.token).padStart(3,'0');
      document.getElementById('servingInfo').textContent  =
        `${data.name} — ${data.department} — Counter ${data.counter}`;
      currentTokenId  = id;
      currentTokenNum = tokenNum;
      if (socket) socket.emit('call-next', data);
      showNotif(`Token ${String(data.token).padStart(3,'0')} called.`, 'success');
      loadQueue(); loadStats();
    }
  } catch(err) { console.error(err); }
}

async function doneSpecific(id) {
  try {
    await fetch(`${API}/queue/done/${id}`, { method: 'POST' });
    if (currentTokenId == id) {
      document.getElementById('servingToken').textContent = '---';
      document.getElementById('servingInfo').textContent  = 'No token called yet';
      currentTokenId = null; currentTokenNum = null;
    }
    loadQueue(); loadStats();
  } catch(err) { console.error(err); }
}

// ════════════════════════════════════════════════════════
// STATS BAR
// ════════════════════════════════════════════════════════
async function loadStats() {
  try {
    const res  = await fetch(`${API}/queue/stats`);
    const data = await res.json();
    const set  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('statInQueue',  data.inQueue);
    set('statServed',   data.servedToday);
    set('statWait',     `${data.avgWait}m`);
    set('statCounters', data.activeCounters);
  } catch(err) { console.error(err); }
}

// ════════════════════════════════════════════════════════
// NOTIFICATION
// ════════════════════════════════════════════════════════
function showNotif(msg, type) {
  const existing = document.getElementById('adminNotif');
  if (existing) existing.remove();
  const notif  = document.createElement('div');
  notif.id     = 'adminNotif';
  const colors = { success: '#16a34a', error: '#dc2626', info: '#2563eb' };
  notif.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:9999;
    background:${colors[type] || '#374151'};
    color:#fff;padding:12px 20px;border-radius:8px;
    font-size:14px;font-weight:500;font-family:Inter,sans-serif;
    box-shadow:0 4px 20px rgba(0,0,0,0.18);
    animation:slideIn 0.3s ease;
  `;
  document.body.appendChild(notif);
  notif.textContent = String(msg);
  setTimeout(() => { if (notif.parentNode) notif.remove(); }, 3000);
}

// ════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════
(async function init() {
  await loadCounterSelect();
  switchAdminTab('queue');
  loadAdminServing();
  loadDailyStats();
  setInterval(() => {
    if (activeTab === 'queue') { loadQueue(); loadStats(); loadAdminServing(); }
  }, 15000);
  setInterval(loadDailyStats, 300000);
})();

// ════════════════════════════════════════════════════════
// ROTATING CURRENTLY SERVING
// ════════════════════════════════════════════════════════
let adminServingList = [];
let adminRotateIdx   = 0;
let adminRotateTimer = null;

async function loadAdminServing() {
  try {
    const [servRes, cRes] = await Promise.all([
      fetch(`${API}/queue/serving`),
      fetch(`${API}/tokens/counters`),
    ]);
    const serving  = await servRes.json();
    const counters = await cRes.json();
    const cMap     = {};
    counters.forEach(c => { cMap[c.counter_number] = c; });
    adminServingList = serving.map(item => ({
      token:      item.token_number,
      counter:    item.counter_number,
      name:       item.name || 'Patient',
      department: item.department,
      doctor:     (cMap[item.counter_number] || {}).doctor_name || '',
    })).sort((a, b) => a.counter - b.counter);
    startAdminRotator();
  } catch(e) { console.error('loadAdminServing:', e); }
}

function startAdminRotator() {
  if (adminRotateTimer) { clearInterval(adminRotateTimer); adminRotateTimer = null; }
  if (!adminServingList.length) { showAdminServing(null); return; }
  adminRotateIdx = 0;
  showAdminServing(adminServingList[0]);
  if (adminServingList.length > 1) {
    adminRotateTimer = setInterval(() => {
      adminRotateIdx = (adminRotateIdx + 1) % adminServingList.length;
      showAdminServing(adminServingList[adminRotateIdx]);
    }, 3000);
  }
}

function showAdminServing(item) {
  const tokEl  = document.getElementById('servingToken');
  const infoEl = document.getElementById('servingInfo');
  for (let i = 1; i <= 4; i++) {
    const dot = document.getElementById(`adot-${i}`);
    if (!dot) continue;
    const isServing = adminServingList.some(s => s.counter === i);
    const isCurrent = item && item.counter === i;
    dot.style.background = isCurrent ? 'rgba(255,255,255,0.9)' : isServing ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)';
    dot.style.color      = isCurrent ? '#1e40af' : isServing ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)';
    dot.style.transform  = isCurrent ? 'scale(1.2)' : 'scale(1)';
    dot.style.boxShadow  = isCurrent ? '0 0 10px rgba(255,255,255,0.5)' : 'none';
  }
  if (!item) {
    if (tokEl)  tokEl.textContent  = '---';
    if (infoEl) infoEl.textContent = 'No token called yet';
    return;
  }
  if (tokEl) {
    tokEl.style.opacity = '0';
    setTimeout(() => {
      tokEl.textContent      = String(item.token).padStart(3, '0');
      tokEl.style.opacity    = '1';
      tokEl.style.transition = 'opacity 0.3s ease';
    }, 150);
  }
  if (infoEl) {
    infoEl.textContent =
      `${item.name} — ${item.department} — Counter ${String(item.counter).padStart(2,'0')}` +
      (item.doctor ? ` — ${item.doctor}` : '');
  }
}

// ════════════════════════════════════════════════════════
// DAILY STATS — date dropdown + bar chart
// ════════════════════════════════════════════════════════
let _allStatsData = [];

async function loadDailyStats() {
  const container = document.getElementById('dailyStatsContainer');
  if (!container) return;
  container.innerHTML = `<p style="color:#94a3b8;font-size:13px;padding:8px 0;">Loading...</p>`;
  try {
    const res = await fetch(`${API}/queue/daily-stats`);
    if (!res.ok) {
      container.textContent = `Server error ${res.status} — check Flask logs.`;
      container.style.color = '#ef4444';
      container.style.fontSize = '13px';
      return;
    }
    const data = await res.json();
    _allStatsData = Array.isArray(data) ? data : [];
    if (!_allStatsData.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:20px 0;">
          <p style="color:#94a3b8;font-size:13px;margin:0;">No data yet.</p>
          <p style="color:#cbd5e1;font-size:12px;margin:6px 0 0;">Stats appear once tokens are marked as done.</p>
        </div>`;
      return;
    }
    renderStatsUI(container, _allStatsData, null);
  } catch(e) {
    container.innerHTML = `<p style="color:#ef4444;font-size:13px;">Cannot reach server — make sure Flask is running.</p>`;
    console.error('Daily stats error:', e);
  }
}

function renderStatsUI(container, data, selectedDate) {
  const today    = new Date().toISOString().slice(0, 10);
  const viewDate = selectedDate || today;

  // Only dates with actual patients, newest first
  const activeDates = [...data]
    .filter(d => d.served > 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!activeDates.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:20px 0;">
        <p style="color:#94a3b8;font-size:13px;margin:0;">No served patients yet.</p>
        <p style="color:#cbd5e1;font-size:12px;margin:6px 0 0;">Mark tokens as done to see daily stats here.</p>
      </div>`;
    return;
  }

  const entry    = data.find(d => d.date === viewDate);
  const servedSafe   = Number(entry?.served) || 0;
  const totalAllSafe = Number(data.reduce((s, d) => s + (Number(d.served) || 0), 0)) || 0;
  const avgDailySafe = activeDates.length
    ? Math.round(totalAllSafe / activeDates.length)
    : 0;
  const activeDaysCountSafe = Number(activeDates.length) || 0;

  const chartData = data.slice(-30).map(d => ({
    date: String(d.date || '').replace(/[^0-9\-]/g, ''),
    served: Number(d.served) || 0
  }));
  const maxVal    = Math.max(...chartData.map(d => d.served), 1);
  const viewDateSafe = String(viewDate).replace(/[^0-9\-]/g, '');
  const todaySafe = String(today).replace(/[^0-9\-]/g, '');

  // Format date nicely: "Mon, 10 Jun"
  function fmtDate(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short'
    });
  }

  container.innerHTML = '';

  const root = document.createElement('div');
  root.style.width = '100%';

  const topRow = document.createElement('div');
  topRow.style.display = 'flex';
  topRow.style.alignItems = 'flex-start';
  topRow.style.gap = '16px';
  topRow.style.flexWrap = 'wrap';
  topRow.style.marginBottom = '20px';

  const datePicker = document.createElement('div');
  datePicker.style.flex = '1';
  datePicker.style.minWidth = '220px';
  const dateLabel = document.createElement('label');
  dateLabel.style.display = 'block';
  dateLabel.style.fontSize = '11px';
  dateLabel.style.fontWeight = '600';
  dateLabel.style.color = '#64748b';
  dateLabel.style.letterSpacing = '.6px';
  dateLabel.style.textTransform = 'uppercase';
  dateLabel.style.marginBottom = '6px';
  dateLabel.textContent = 'Select Date';
  const dateSelect = document.createElement('select');
  dateSelect.id = 'statsDateSelect';
  dateSelect.style.cssText = `width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:Inter,sans-serif;color:#1e293b;background:#fff;cursor:pointer;outline:none;appearance:none;background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%222%22><polyline points=%226 9 12 15 18 9%22/></svg>');background-repeat:no-repeat;background-position:right 10px center;`;
  dateSelect.addEventListener('change', function () {
    onStatDateChange(this.value);
  });
  datePicker.appendChild(dateLabel);
  datePicker.appendChild(dateSelect);
  topRow.appendChild(datePicker);

  const servedCard = document.createElement('div');
  servedCard.style.cssText = `background:${servedSafe > 0 ? '#eff6ff' : '#f8fafc'};border:1.5px solid ${servedSafe > 0 ? '#bfdbfe' : '#e2e8f0'};border-radius:10px;padding:12px 18px;min-width:130px;text-align:center;`;
  const servedValue = document.createElement('div');
  servedValue.id = 'statServedValue';
  servedValue.style.cssText = `font-size:28px;font-weight:800;color:${servedSafe > 0 ? '#2563eb' : '#94a3b8'};line-height:1;`;
  const servedLabel = document.createElement('div');
  servedLabel.style.cssText = 'font-size:11px;font-weight:600;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px;';
  servedLabel.textContent = 'Patients';
  const viewDateLabel = document.createElement('div');
  viewDateLabel.id = 'statViewDateLabel';
  viewDateLabel.style.cssText = 'font-size:10px;color:#94a3b8;margin-top:2px;';
  servedCard.appendChild(servedValue);
  servedCard.appendChild(servedLabel);
  servedCard.appendChild(viewDateLabel);
  topRow.appendChild(servedCard);

  const allTimeCard = document.createElement('div');
  allTimeCard.style.cssText = 'background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 18px;min-width:130px;text-align:center;';
  const totalAllValue = document.createElement('div');
  totalAllValue.id = 'statTotalAllValue';
  totalAllValue.style.cssText = 'font-size:28px;font-weight:800;color:#334155;line-height:1;';
  const totalAllLabel = document.createElement('div');
  totalAllLabel.style.cssText = 'font-size:11px;font-weight:600;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px;';
  totalAllLabel.textContent = 'All-Time';
  const activeDaysLabelEl = document.createElement('div');
  activeDaysLabelEl.id = 'statActiveDaysLabel';
  activeDaysLabelEl.style.cssText = 'font-size:10px;color:#94a3b8;margin-top:2px;';
  allTimeCard.appendChild(totalAllValue);
  allTimeCard.appendChild(totalAllLabel);
  allTimeCard.appendChild(activeDaysLabelEl);
  topRow.appendChild(allTimeCard);

  const avgCard = document.createElement('div');
  avgCard.style.cssText = 'background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 18px;min-width:130px;text-align:center;';
  const avgValue = document.createElement('div');
  avgValue.id = 'statAvgDailyValue';
  avgValue.style.cssText = 'font-size:28px;font-weight:800;color:#334155;line-height:1;';
  const avgLabel = document.createElement('div');
  avgLabel.style.cssText = 'font-size:11px;font-weight:600;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px;';
  avgLabel.textContent = 'Daily Avg';
  const avgDesc = document.createElement('div');
  avgDesc.style.cssText = 'font-size:10px;color:#94a3b8;margin-top:2px;';
  avgDesc.textContent = 'across active days';
  avgCard.appendChild(avgValue);
  avgCard.appendChild(avgLabel);
  avgCard.appendChild(avgDesc);
  topRow.appendChild(avgCard);

  root.appendChild(topRow);

  const chartSection = document.createElement('div');
  chartSection.style.cssText = 'border-top:1px solid #f1f5f9;padding-top:16px;';
  const chartTitle = document.createElement('div');
  chartTitle.style.cssText = 'font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.6px;text-transform:uppercase;margin-bottom:10px;';
  chartTitle.textContent = 'Last 30 Days';
  const statsBarChart = document.createElement('div');
  statsBarChart.id = 'statsBarChart';
  statsBarChart.style.cssText = 'display:flex;align-items:flex-end;gap:3px;height:90px;';
  const axisRow = document.createElement('div');
  axisRow.style.cssText = 'display:flex;justify-content:space-between;margin-top:5px;';
  const axisStart = document.createElement('span');
  axisStart.id = 'statsAxisStart';
  axisStart.style.cssText = 'font-size:10px;color:#94a3b8;';
  const axisMid = document.createElement('span');
  axisMid.id = 'statsAxisMid';
  axisMid.style.cssText = 'font-size:10px;color:#94a3b8;';
  const axisEnd = document.createElement('span');
  axisEnd.id = 'statsAxisEnd';
  axisEnd.style.cssText = 'font-size:10px;color:#94a3b8;';
  axisRow.appendChild(axisStart);
  axisRow.appendChild(axisMid);
  axisRow.appendChild(axisEnd);
  chartSection.appendChild(chartTitle);
  chartSection.appendChild(statsBarChart);
  chartSection.appendChild(axisRow);
  root.appendChild(chartSection);
  container.appendChild(root);

  const servedValEl = document.getElementById('statServedValue');
  if (servedValEl) servedValEl.textContent = String(servedSafe);
  const viewLabelEl = document.getElementById('statViewDateLabel');
  if (viewLabelEl) viewLabelEl.textContent = viewDateSafe === todaySafe ? 'Today' : fmtDate(viewDateSafe);
  const totalAllEl = document.getElementById('statTotalAllValue');
  if (totalAllEl) totalAllEl.textContent = String(totalAllSafe);
  const activeDaysEl = document.getElementById('statActiveDaysLabel');
  if (activeDaysEl) activeDaysEl.textContent = `${activeDaysCountSafe} active day${activeDaysCountSafe !== 1 ? 's' : ''}`;
  const avgDailyEl = document.getElementById('statAvgDailyValue');
  if (avgDailyEl) avgDailyEl.textContent = String(avgDailySafe);

  const chartEl = document.getElementById('statsBarChart');
  if (chartEl) {
    chartEl.innerHTML = '';
    chartData.forEach(d => {
      const pct        = Math.round((d.served / maxVal) * 100);
      const isToday    = d.date === todaySafe;
      const isSelected = d.date === viewDateSafe;
      const hasData    = d.served > 0;
      const barColor   = isSelected ? '#1d4ed8' : isToday ? '#3b82f6' : hasData ? '#93c5fd' : '#f1f5f9';
      const barHeight  = hasData ? Math.max(pct, 8) : 2;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;';
      wrap.title = `${fmtDate(d.date)}: ${d.served} patients`;
      wrap.addEventListener('click', () => onStatDateChange(d.date));
      const bar = document.createElement('div');
      bar.style.cssText = `width:100%;background:${barColor};height:${barHeight}%;border-radius:3px 3px 0 0;min-height:${hasData?'6px':'2px'};transition:background .15s,transform .15s;${isSelected ? 'box-shadow:0 0 0 1.5px #1d4ed8;' : ''}`;
      wrap.appendChild(bar);
      chartEl.appendChild(wrap);
    });
  }
  const axisStartEl = document.getElementById('statsAxisStart');
  if (axisStartEl) axisStartEl.textContent = chartData[0]?.date.slice(5) || '';
  const axisMidEl = document.getElementById('statsAxisMid');
  if (axisMidEl) axisMidEl.textContent = chartData[Math.floor(chartData.length/2)]?.date.slice(5) || '';
  const axisEndEl = document.getElementById('statsAxisEnd');
  if (axisEndEl) axisEndEl.textContent = chartData[chartData.length-1]?.date.slice(5) || '';

  populateStatsDropdown(activeDates, viewDateSafe, todaySafe, fmtDate);
}

function populateStatsDropdown(activeDates, viewDate, today, fmtDate) {
  const sel = document.getElementById('statsDateSelect');
  if (!sel) return;
  sel.innerHTML = '';
  activeDates.forEach(d => {
    const opt = document.createElement('option');
    opt.value = String(d.date);
    const labelText = d.date === today ? `Today — ${fmtDate(d.date)}` : fmtDate(d.date);
    const servedNum = Number(d.served) || 0;
    opt.textContent = `${labelText}   (${servedNum} patient${servedNum !== 1 ? 's' : ''})`;
    if (d.date === viewDate) opt.selected = true;
    sel.appendChild(opt);
  });
}

function onStatDateChange(date) {
  const container = document.getElementById('dailyStatsContainer');
  if (!container || !_allStatsData.length) return;
  const sel = document.getElementById('statsDateSelect');
  if (sel) sel.value = date;
  renderStatsUI(container, _allStatsData, date);
}