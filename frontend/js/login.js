const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : 'https://digital-clinic-queue.onrender.com/api';

const loginBtn   = document.getElementById('loginBtn');
const emailInput = document.getElementById('loginEmail');
const passInput  = document.getElementById('loginPassword');
const emailError = document.getElementById('emailError');
const passError  = document.getElementById('passError');
const errorBox   = document.getElementById('errorBox');
const eyeBtn     = document.getElementById('eyeBtn');

// ── Toggle password visibility ───────────────────────────
eyeBtn.addEventListener('click', () => {
  if (passInput.type === 'password') {
    passInput.type     = 'text';
    eyeBtn.textContent = '🙈';
  } else {
    passInput.type     = 'password';
    eyeBtn.textContent = '👁';
  }
});

// ── Validate helpers ─────────────────────────────────────
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validatePassword(pass) {
  return pass.length >= 6;
}
function clearErrors() {
  emailError.textContent = '';
  passError.textContent  = '';
  errorBox.textContent   = '';
  errorBox.classList.remove('show');
  emailInput.classList.remove('error');
  passInput.classList.remove('error');
}

// ── Login ────────────────────────────────────────────────
loginBtn.addEventListener('click', async () => {
  clearErrors();

  const email    = emailInput.value.trim();
  const password = passInput.value.trim();
  let valid      = true;

  if (!email) {
    emailError.textContent = 'Email is required';
    emailInput.classList.add('error');
    valid = false;
  } else if (!validateEmail(email)) {
    emailError.textContent = 'Enter a valid email address';
    emailInput.classList.add('error');
    valid = false;
  }

  if (!password) {
    passError.textContent = 'Password is required';
    passInput.classList.add('error');
    valid = false;
  } else if (!validatePassword(password)) {
    passError.textContent = 'Password must be at least 6 characters';
    passInput.classList.add('error');
    valid = false;
  }

  if (!valid) return;

  loginBtn.textContent = 'Signing in...';
  loginBtn.disabled    = true;

  try {
    const res  = await fetch(`${API}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      errorBox.textContent = data.error || 'Invalid email or password';
      errorBox.classList.add('show');
    } else {
      // ── Store JWT token + session info ────────────────
      localStorage.setItem('adminLoggedIn', 'true');
      localStorage.setItem('adminName',     data.name);
      localStorage.setItem('adminEmail',    data.email);
      localStorage.setItem('adminToken',    data.token);   // JWT
      localStorage.setItem('tokenExpiry',
        String(Date.now() + data.expires * 3600 * 1000));  // expiry timestamp

      window.location.href = 'admin.html';
    }

  } catch (err) {
    errorBox.textContent = 'Cannot connect to server. Make sure Flask is running.';
    errorBox.classList.add('show');
  }

  loginBtn.textContent = 'Sign In';
  loginBtn.disabled    = false;
});

// ── Enter key ────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

// ── Already logged in? Verify JWT still valid ─────────────
(async function checkExisting() {
  const token  = localStorage.getItem('adminToken');
  const expiry = parseInt(localStorage.getItem('tokenExpiry') || '0');

  if (!token) return;

  // Check client-side expiry first
  if (Date.now() > expiry) {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminLoggedIn');
  localStorage.removeItem('adminName');
  localStorage.removeItem('adminEmail');
  localStorage.removeItem('tokenExpiry');
  return;
}

  // Verify with server
  try {
    const res = await fetch(`${API}/auth/verify`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      window.location.href = 'admin.html';
    } else {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminLoggedIn');
        localStorage.removeItem('adminName');
        localStorage.removeItem('adminEmail');
        localStorage.removeItem('tokenExpiry');
}
  } catch(e) {
    // Server unreachable — don't redirect, stay on login
  }
})();