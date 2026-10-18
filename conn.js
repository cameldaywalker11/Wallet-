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

// ---------- Transfer (Camel Wallet to Camel Wallet only) ----------
let transferLookup = null;

function resetLookup() {
  transferLookup = null;
  const nameEl = document.getElementById('recipientName');
  const sendBtn = document.getElementById('sendBtn');
  if (nameEl) {
    nameEl.textContent = '';
    nameEl.style.display = 'none';
  }
  if (sendBtn) sendBtn.disabled = true;
}

// Called by the "Search name on the account" button
async function searchRecipient() {
  const phone = document.getElementById('recipient').value.trim();
  const nameEl = document.getElementById('recipientName');
  const sendBtn = document.getElementById('sendBtn');
  const searchBtn = document.getElementById('searchBtn');

  resetLookup();
  if (!phone) return alert('Enter the recipient account number');

  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';
  try {
    const r = await api('/api/lookup/' + encodeURIComponent(phone));
    if (sessionExpired(r)) return logout();
    nameEl.style.display = 'block';
    if (r.ok) {
      transferLookup = { phone: phone, token: r.data.lookupToken, name: r.data.name };
      nameEl.style.color = '#2E7D32';
      nameEl.textContent = 'Account name: ' + r.data.name;
      sendBtn.disabled = false;
    } else {
      nameEl.style.color = '#D32F2F';
      nameEl.textContent = r.data.message || 'Account not found';
    }
  } catch (err) {
    alert('Cannot reach the server.');
  }
  searchBtn.disabled = false;
  searchBtn.textContent = 'Search name on the account';
}

// Run this when transfer.html loads
function initTransferPage() {
  if (!requireLogin()) return;
  resetLookup();
  // Changing the number clears the searched name, so it must be searched again
  document.getElementById('recipient').addEventListener('input', resetLookup);
}

async function handleTransfer(e) {
  e.preventDefault();
  const recipient = document.getElementById('recipient').value.trim();
  const amount = Number(document.getElementById('amount').value);
  const pin = document.getElementById('pin').value;

  if (!transferLookup) return alert('Search the account name first');
  if (recipient !== transferLookup.phone) {
    resetLookup();
    return alert('The number changed. Search the account name again');
  }
  if (!(amount > 0)) return alert('Enter a valid amount');
  if (!/^\d{4}$/.test(pin)) return alert('Enter your 4-digit pin');
  if (!confirm('Send GHS ' + amount.toFixed(2) + ' to ' + transferLookup.name + '?')) return;

  try {
    const r = await api('/api/transfer', 'POST', {
      recipient: recipient,
      amount: amount,
      pin: pin,
      lookupToken: transferLookup.token
    });
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
      let detail = t.provider || '';
      if (t.type === 'Transfer') {
        detail = 'To ' + (t.recipientName ? t.recipientName + ' (' + t.recipient + ')' : t.recipient);
      } else if (t.senderName || t.sender) {
        detail = 'From ' + (t.senderName ? t.senderName + ' (' + t.sender + ')' : t.sender);
      }
      addCell(tr, new Date(t.timestamp).toLocaleString());
      addCell(tr, t.type);
      addCell(tr, detail);
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