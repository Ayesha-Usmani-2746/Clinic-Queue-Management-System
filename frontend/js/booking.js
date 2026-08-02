const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : 'https://digital-clinic-queue.onrender.com/api';

// ── Set min date for appointment ─────────────────────────
const today = new Date().toISOString().split('T')[0];
const aDateInput = document.getElementById('aDate');
if (aDateInput) aDateInput.min = today;

// ── Tab switching ────────────────────────────────────────
function switchTab(tab) {
  const walkinForm  = document.getElementById('walkinForm');
  const appointForm = document.getElementById('appointForm');
  const tabWalkin   = document.getElementById('tabWalkin');
  const tabAppoint  = document.getElementById('tabAppoint');
  const tokenResult = document.getElementById('tokenResult');

  tokenResult.style.display = 'none';

  if (tab === 'walkin') {
    walkinForm.style.display  = 'block';
    appointForm.style.display = 'none';
    tabWalkin.classList.add('active');
    tabAppoint.classList.remove('active');
  } else {
    walkinForm.style.display  = 'none';
    appointForm.style.display = 'block';
    tabWalkin.classList.remove('active');
    tabAppoint.classList.add('active');
  }
}

// ── Validation helpers ───────────────────────────────────
function validatePhone(phone) {
  const clean = phone.replace(/[\s\-\(\)]/g, '');
  // International: +923001234567 or 923001234567
  // Local: 03001234567
  // Any 10-15 digits
  return /^\+?[0-9]{10,15}$/.test(clean) || /^0[0-9]{10}$/.test(clean);
}

function validateEmail(email) {
  if (!email || email.trim() === '') return true; // optional field
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ── Show field error ─────────────────────────────────────
function showErr(inputId, errId, msg) {
  const input = document.getElementById(inputId);
  const err   = document.getElementById(errId);
  if (err)   err.textContent = msg;
  if (input) {
    if (msg) input.style.borderColor = '#dc2626';
    else     input.style.borderColor = '#e5e7eb';
  }
}

// ── Clear all field errors ───────────────────────────────
function clearErrs(inputIds, errIds) {
  inputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.borderColor = '#e5e7eb';
  });
  errIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
}

// ── Show token result ────────────────────────────────────
function showTokenResult(data, isAppointment) {
  document.getElementById('walkinForm').style.display  = 'none';
  document.getElementById('appointForm').style.display = 'none';

  const result = document.getElementById('tokenResult');
  result.style.display = 'block';

  document.getElementById('resultIcon').textContent =
    isAppointment ? '📅' : '🎫';
  document.getElementById('resultLabel').textContent =
    isAppointment ? 'APPOINTMENT CONFIRMED' : 'YOUR TOKEN NUMBER';
  document.getElementById('tokenNum').textContent =
    String(data.token || data.appointment_id || 1).padStart(3, '0');
  document.getElementById('resultName').textContent =
    `👤 Patient: ${data.name}`;
  document.getElementById('resultDept').textContent =
    `🏥 Department: ${data.department}`;
  document.getElementById('resultWait').textContent =
    isAppointment
      ? `📅 Date: ${data.date} at ${data.time}`
      : `⏱ Est. Wait: ~${data.waitTime || 0} minutes`;
  document.getElementById('resultExtra').textContent =
    isAppointment ? `✅ Status: Scheduled` : `📋 Queue Position: #${data.position || 1}`;
  document.getElementById('resultNote').textContent =
    isAppointment
      ? 'Please arrive 10 minutes before your appointment'
      : 'Show this screen at the reception counter';
}

// ════════════════════════════════════════════════════════
// WALK-IN TOKEN BOOKING
// ════════════════════════════════════════════════════════
document.getElementById('walkinBtn').addEventListener('click', async () => {

  // Read ALL values first before any validation
  const name    = document.getElementById('wName').value.trim();
  const phone   = document.getElementById('wPhone').value.trim();
  const email   = document.getElementById('wEmail').value.trim();
  const age     = document.getElementById('wAge').value.trim();
  const gender  = document.getElementById('wGender').value;
  const dept    = document.getElementById('wDept').value;
  const address = document.getElementById('wAddress').value.trim();
  const notes   = document.getElementById('wNotes').value.trim();

  // Debug log — check what's being read
  console.log('dept selected:', dept);
  console.log('gender selected:', gender);

  // Clear previous errors
  clearErrs(
    ['wName','wPhone','wEmail','wAge','wDept'],
    ['wNameErr','wPhoneErr','wEmailErr','wAgeErr','wDeptErr']
  );
  document.getElementById('walkinError').textContent = '';

  // Validate
  let valid = true;

  if (!name || name.length < 2) {
    showErr('wName','wNameErr','Name must be at least 2 characters');
    valid = false;
  }

  if (!phone) {
    showErr('wPhone','wPhoneErr','Phone number is required');
    valid = false;
  } else if (!validatePhone(phone)) {
    showErr('wPhone','wPhoneErr',
      'Enter a valid phone number (e.g. 03001234567 or +923001234567)');
    valid = false;
  }

  if (email && !validateEmail(email)) {
    showErr('wEmail','wEmailErr','Enter a valid email address');
    valid = false;
  }

  if (age && (isNaN(parseInt(age)) || parseInt(age) < 1 || parseInt(age) > 120)) {
    showErr('wAge','wAgeErr','Age must be between 1 and 120');
    valid = false;
  }

  // Department check — read value again directly
  const deptCheck = document.getElementById('wDept').value;
  console.log('dept at check time:', deptCheck);

  if (!deptCheck || deptCheck === '' || deptCheck === 'undefined') {
    showErr('wDept','wDeptErr','Please select a department');
    valid = false;
  }

  if (!valid) return;

  // Loading state
  const btn = document.getElementById('walkinBtn');
  btn.textContent = '⏳ Booking...';
  btn.disabled    = true;

  try {
    const response = await fetch(`${API}/queue/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        phone,
        email:      email   || null,
        age:        age     ? parseInt(age) : null,
        gender:     gender  || null,
        department: deptCheck,
        address:    address || null,
        notes:      notes   || null
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Booking failed. Please try again.');
    }

    showTokenResult({ ...data, name, department: deptCheck }, false);

  } catch (err) {
    document.getElementById('walkinError').textContent =
      err.message || 'Something went wrong. Try again.';
    console.error('Booking error:', err);
  }

  btn.textContent = '🎫 Get Token Now';
  btn.disabled    = false;
});

// ════════════════════════════════════════════════════════
// APPOINTMENT BOOKING
// ════════════════════════════════════════════════════════
document.getElementById('appointBtn').addEventListener('click', async () => {

  // Read ALL values first
  const name   = document.getElementById('aName').value.trim();
  const phone  = document.getElementById('aPhone').value.trim();
  const email  = document.getElementById('aEmail').value.trim();
  const age    = document.getElementById('aAge').value.trim();
  const gender = document.getElementById('aGender').value;
  const dept   = document.getElementById('aDept').value;
  const date   = document.getElementById('aDate').value;
  const time   = document.getElementById('aTime').value;
  const notes  = document.getElementById('aNotes').value.trim();

  console.log('appt dept:', dept, 'time:', time, 'date:', date);

  // Clear errors
  clearErrs(
    ['aName','aPhone','aEmail','aDept','aDate','aTime'],
    ['aNameErr','aPhoneErr','aEmailErr','aDeptErr','aDateErr','aTimeErr']
  );
  document.getElementById('appointError').textContent = '';

  // Validate
  let valid = true;

  if (!name || name.length < 2) {
    showErr('aName','aNameErr','Name must be at least 2 characters');
    valid = false;
  }

  if (!phone) {
    showErr('aPhone','aPhoneErr','Phone number is required');
    valid = false;
  } else if (!validatePhone(phone)) {
    showErr('aPhone','aPhoneErr',
      'Enter a valid phone number (e.g. 03001234567 or +923001234567)');
    valid = false;
  }

  if (email && !validateEmail(email)) {
    showErr('aEmail','aEmailErr','Enter a valid email address');
    valid = false;
  }

  if (!dept || dept === '') {
    showErr('aDept','aDeptErr','Please select a department');
    valid = false;
  }

  if (!date) {
    showErr('aDate','aDateErr','Please select a date');
    valid = false;
  } else if (date < today) {
    showErr('aDate','aDateErr','Date cannot be in the past');
    valid = false;
  }

  if (!time || time === '') {
    showErr('aTime','aTimeErr','Please select a preferred time');
    valid = false;
  }

  if (!valid) return;

  const btn = document.getElementById('appointBtn');
  btn.textContent = '⏳ Booking...';
  btn.disabled    = true;

  try {
    const response = await fetch(`${API}/appointments/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        phone,
        email:      email  || null,
        age:        age    ? parseInt(age) : null,
        gender:     gender || null,
        department: dept,
        date,
        time,
        notes:      notes  || null
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Appointment booking failed.');
    }

    showTokenResult({ ...data, name, department: dept, date, time }, true);

  } catch (err) {
    document.getElementById('appointError').textContent =
      err.message || 'Something went wrong. Try again.';
    console.error('Appointment error:', err);
  }

  btn.textContent = '📅 Book Appointment';
  btn.disabled    = false;
});

// ── Book Another ─────────────────────────────────────────
document.getElementById('bookAnotherBtn').addEventListener('click', () => {
  document.getElementById('tokenResult').style.display = 'none';

  // Reset walkin fields
  ['wName','wPhone','wEmail','wAge','wAddress','wNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('wGender').selectedIndex = 0;
  document.getElementById('wDept').selectedIndex   = 0;

  // Reset appointment fields
  ['aName','aPhone','aEmail','aAge','aNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('aGender').selectedIndex = 0;
  document.getElementById('aDept').selectedIndex   = 0;
  document.getElementById('aTime').selectedIndex   = 0;
  const aDate = document.getElementById('aDate');
  if (aDate) aDate.value = '';

  // Go back to walkin tab
  switchTab('walkin');
});