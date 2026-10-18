// Keep these two lines if you added the DNS fix earlier
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

require('dotenv').config();
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require('path');

const { connectDB } = require('./db');
const { registerUser, loginUser, authenticateToken } = require('./auth');
const { getMe, deposit, lookupRecipient, transfer, history, complain } = require('./wallet');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Auth routes
app.post('/api/auth/register', registerUser);
app.post('/api/auth/login', loginUser);

// Protected wallet routes
app.get('/api/me', authenticateToken, getMe);
app.post('/api/deposit', authenticateToken, deposit);
app.get('/api/lookup/:phone', authenticateToken, lookupRecipient);
app.post('/api/transfer', authenticateToken, transfer);
app.get('/api/history', authenticateToken, history);
app.post('/api/complain', authenticateToken, complain);

// Serve the front-end (HTML/CSS/JS) from the same server.
// Uses src/main/webapp if it exists (your Eclipse project),
// otherwise the same folder as server.js (flat GitHub/Render layout).
const nestedRoot = path.join(__dirname, 'src', 'main', 'webapp');
const webRoot = fs.existsSync(nestedRoot) ? nestedRoot : __dirname;

// Keep backend and config files from being downloaded as web pages
app.use((req, res, next) => {
  let p;
  try {
    p = path.posix.normalize(decodeURIComponent(req.path)).toLowerCase();
  } catch (e) {
    return res.status(400).send('Bad request');
  }
  const blocked = ['/server.js', '/auth.js', '/db.js', '/wallet.js',
                   '/package.json', '/package-lock.json', '/readme.md'];
  if (blocked.includes(p) || p.startsWith('/node_modules') || p.startsWith('/.')) {
    return res.status(404).send('Not found');
  }
  next();
});

app.use(express.static(webRoot));
app.get('/', (req, res) => res.sendFile(path.join(webRoot, 'index.html')));

// Start server after connecting to DB
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server due to DB connection error:', err);
  });