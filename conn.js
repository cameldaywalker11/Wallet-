function getToken() {
  return localStorage.getItem('token');
}

function requireLogin() {
  if (!getToken()) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

async function api(path, method, body) {
  const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

function sessionExpired(r) {
  return r.status === 401 || r.status === 403;
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = 'login.html';
}

// ---------- Login ----------
async function handleLogin(e) {
  e.preventDefault();
  const phone = document.getElementById('phone').value.trim();
  const password = document.getElementById('password').value;
  try {
    const r = await api('/api/auth/login', 'POST', { phone, password });
    if (!r.ok) return alert(r.data.message || 'Login failed');
    localStorage.setItem('token', r.data.token);
    localStorage.setItem('user', JSON.stringify(r.data.user));
    window.location.href = 'dashboard.html';
  } catch (err) {
    alert('Cannot reach the server. Is node server.js running?');
  }
}

// ---------- Sign up ----------
async function handleSignUp(e) {
  e.preventDefault();
  const commonName = document.getElementById('commonName').value.trim();
  const country = document.getElementById('country').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const pin = document.getElementById('pin').value;
  const confirmPin = document.getElementById('confirmPin').value;

  if (password !== confirmPassword) return alert('Passwords do not match');
  if (!/^\d{4}$/.test(pin)) return alert('Pin must be 4 digits');
  if (pin !== confirmPin) return alert('Pins do not match');

  try {
    const r = await api('/api/auth/register', 'POST', { commonName, country, phone, password, pin });
    if (!r.ok) return alert(r.data.message || 'Sign up failed');
    alert('Account created. Please log in.');
    window.location.href = 'login.html';
  } catch (err) {
    alert('Cannot reach the server. Is node server.js running?');
  }
}

// ---------- Dashboard ----------
async function loadDashboard() {
  if (!requireLogin()) return;
  try {
    const r = await api('/api/me');
    if (sessionExpired(r)) return logout();
    if (!r.ok) return alert(r.data.message || 'Could not load your account');
    document.getElementById('welcomeUser').textContent = r.data.name || r.data.username || 'User';
    document.getElementById('userBalance').textContent = 'GHS ' + Number(r.data.balance || 0).toFixed(2);
  } catch (err) {
    alert('Could not load your account.');
  }
}

// ---------- Deposit ----------
async function handleDeposit(e) {
  e.preventDefault();
  const option = document.getElementById('option').value;
  const amount = Number(document.getElementById('amount').value);
  if (!option) return alert('Choose a deposit option');
  if (!(amount > 0)) return alert('Enter a valid amount');
  try {
    const r = await api('/api/deposit', 'POST', { option, amount });
    if (sessionExpired(r)) return logout();
    if (!r.ok) return alert(r.data.message || 'Deposit failed');
    alert('Deposit successful');
    window.location.href = 'dashboard.html';
  } catch (err) {
    alert('Cannot reach the server.');
  }
}

// ---------- Transfer ----------
async function handleTransfer(e) {
  e.preventDefault();
  const option = document.getElementById('option').value;
  const recipient = document.getElementById('recipient').value.trim();
  const amount = Number(document.getElementById('amount').value);
  const pin = document.getElementById('pin').value;
  if (!option) return alert('Choose a transfer option');
  if (!recipient) return alert('Enter the recipient phone number');
  if (!(amount > 0)) return alert('Enter a valid amount');
  if (!/^\d{4}$/.test(pin)) return alert('Enter your 4-digit pin');
  try {
    const r = await api('/api/transfer', 'POST', { option, recipient, amount, pin });
    if (sessionExpired(r)) return logout();
    if (!r.ok) return alert(r.data.message || 'Transfer failed');
    alert('Transfer successful');
    window.location.href = 'dashboard.html';
  } catch (err) {
    alert('Cannot reach the server.');
  }
}

// ---------- History ----------
function addCell(tr, text) {
  const td = document.createElement('td');
  td.textContent = text;
  tr.appendChild(td);
}

async function loadHistory() {
  if (!requireLogin()) return;
  const body = document.getElementById('historyBody');
  try {
    const r = await api('/api/history');
    if (sessionExpired(r)) return logout();
    body.innerHTML = '';
    const rows = Array.isArray(r.data) ? r.data : [];
    if (!r.ok || rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.style.textAlign = 'center';
      td.textContent = r.ok ? 'No transactions yet' : 'Could not load history';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    rows.forEach((t) => {
      const tr = document.createElement('tr');
      const sign = t.type === 'Transfer' ? '-' : '+';
      addCell(tr, new Date(t.timestamp).toLocaleString());
      addCell(tr, t.type);
      addCell(tr, t.type === 'Transfer' ? 'To ' + t.recipient : (t.provider || ''));
      addCell(tr, sign + 'GHS ' + Number(t.amount).toFixed(2));
      body.appendChild(tr);
    });
  } catch (err) {
    alert('Could not load history.');
  }
}

// ---------- Complain ----------
async function handleComplain(e) {
  e.preventDefault();
  const subject = document.getElementById('subject').value.trim();
  const message = document.getElementById('message').value.trim();
  if (!message) return alert('Please type your complaint');
  try {
    const r = await api('/api/complain', 'POST', { subject, message });
    if (sessionExpired(r)) return logout();
    if (!r.ok) return alert(r.data.message || 'Could not send complaint');
    alert('Complaint submitted. Thank you.');
    window.location.href = 'dashboard.html';
  } catch (err) {
    alert('Cannot reach the server.');
  }
}