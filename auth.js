const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'camel_wallet_secret_key';
const USERS = 'TeleMo';

function isHashed(value) {
  return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

// Works with hashed passwords and old plain-text ones
async function passwordMatches(plain, stored) {
  if (!stored) return false;
  return isHashed(stored) ? bcrypt.compare(String(plain), stored) : String(plain) === stored;
}

function displayName(user) {
  return user.CommonName || user.FirstName || '';
}

// Register User
async function registerUser(req, res) {
  try {
    const b = req.body;
    const CommonName = b.CommonName || b.commonName || b.username || b.FirstName || '';
    const FirstName = b.FirstName || b.firstName || CommonName;
    const LastName = b.LastName || b.lastName || '';
    const OtherName = b.OtherName || b.otherName || '';
    const Country = b.Country || b.country || '';
    const TeleMo = String(b.TeleMo || b.phone || b.email || '').trim();
    const password = b.Password || b.password;
    const pin = b.Pin || b.pin;

    if (!CommonName || !TeleMo || !password) {
      return res.status(400).json({ message: 'Name, phone and password are required' });
    }

    const users = getDB().collection(USERS);
    const existingUser = await users.findOne({ TeleMo });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    await users.insertOne({
      FirstName,
      LastName,
      OtherName,
      CommonName,
      Country,
      TeleMo,
      Password: await bcrypt.hash(String(password), 10),
      Pin: pin ? await bcrypt.hash(String(pin), 10) : null,
      Balance: 0,
      createdAt: new Date()
    });
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error during registration', error: err.message });
  }
}

// Login User
async function loginUser(req, res) {
  try {
    const b = req.body;
    const TeleMo = String(b.TeleMo || b.phone || b.email || '').trim();
    const password = b.Password || b.password;

    if (!TeleMo || !password) {
      return res.status(400).json({ message: 'Phone and password are required' });
    }

    const users = getDB().collection(USERS);
    const user = await users.findOne({ TeleMo });
    if (!user || !(await passwordMatches(password, user.Password))) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Upgrade an old plain-text password to a hash after a successful login
    if (!isHashed(user.Password)) {
      await users.updateOne(
        { _id: user._id },
        { $set: { Password: await bcrypt.hash(String(password), 10) } }
      );
    }

    const token = jwt.sign(
      { userId: String(user._id), TeleMo: user.TeleMo },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    res.json({
      token,
      user: {
        id: user._id,
        username: displayName(user),
        TeleMo: user.TeleMo,
        email: user.TeleMo
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error during login', error: err.message });
  }
}

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

module.exports = { registerUser, loginUser, authenticateToken };