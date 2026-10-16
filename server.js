// Keep these two lines if you added the DNS fix earlier
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { connectDB } = require('./db');
const { registerUser, loginUser, authenticateToken } = require('./auth');
const { getMe, deposit, transfer, history, complain } = require('./wallet');

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
app.post('/api/transfer', authenticateToken, transfer);
app.get('/api/history', authenticateToken, history);
app.post('/api/complain', authenticateToken, complain);

// Serve the front-end (HTML/CSS/JS) from the same server
const webRoot = path.join(__dirname, 'src', 'main', 'webapp');
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