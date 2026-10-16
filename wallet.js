const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { getDB } = require('./db');

const USERS = 'TeleMo';

function isHashed(value) {
  return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

// Works with hashed pins and old plain-text ones
async function pinMatches(plain, stored) {
  if (!stored) return false;
  return isHashed(stored) ? bcrypt.compare(String(plain), stored) : String(plain) === String(stored);
}

// GET /api/me
async function getMe(req, res) {
  try {
    const user = await getDB().collection(USERS).findOne(
      { _id: new ObjectId(req.user.userId) },
      { projection: { Password: 0, Pin: 0 } }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });

    const name = user.CommonName || user.FirstName || '';
    res.json({
      id: user._id,
      username: name,
      name,
      FirstName: user.FirstName,
      LastName: user.LastName,
      Country: user.Country,
      TeleMo: user.TeleMo,
      email: user.TeleMo,
      balance: user.Balance || 0
    });
  } catch (err) {
    res.status(500).json({ message: 'Could not load profile' });
  }
}

// POST /api/deposit  { option, amount }
async function deposit(req, res) {
  try {
    const { option } = req.body;
    const amount = Number(req.body.amount);
    if (!option || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid deposit details' });
    }

    const db = getDB();
    const userId = new ObjectId(req.user.userId);
    await db.collection(USERS).updateOne({ _id: userId }, { $inc: { Balance: amount } });
    await db.collection('transactions').insertOne({
      userId, type: 'Deposit', provider: option, amount, timestamp: new Date()
    });
    res.json({ message: 'Deposit successful' });
  } catch (err) {
    res.status(500).json({ message: 'Deposit failed' });
  }
}

// POST /api/transfer  { option, recipient, amount, pin }
async function transfer(req, res) {
  try {
    const { option, pin } = req.body;
    const recipient = String(req.body.recipient || '').trim();
    const amount = Number(req.body.amount);
    if (!option || !recipient || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid transfer details' });
    }

    const db = getDB();
    const users = db.collection(USERS);
    const userId = new ObjectId(req.user.userId);

    const sender = await users.findOne({ _id: userId });
    if (!sender) return res.status(404).json({ message: 'User not found' });

    if (!(await pinMatches(pin, sender.Pin))) {
      return res.status(400).json({ message: 'Incorrect pin' });
    }
    if (sender.TeleMo === recipient) {
      return res.status(400).json({ message: 'You cannot transfer to yourself' });
    }

    // Deduct only if enough balance (atomic, prevents overdraw)
    const debit = await users.updateOne(
      { _id: userId, Balance: { $gte: amount } },
      { $inc: { Balance: -amount } }
    );
    if (debit.modifiedCount !== 1) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // If the recipient is a Camel Wallet user, credit them too
    const recipientUser = await users.findOne({ TeleMo: recipient });
    if (recipientUser) {
      await users.updateOne({ _id: recipientUser._id }, { $inc: { Balance: amount } });
    }

    const now = new Date();
    await db.collection('transactions').insertOne({
      userId, type: 'Transfer', provider: option, recipient, amount, timestamp: now
    });
    if (recipientUser) {
      await db.collection('transactions').insertOne({
        userId: recipientUser._id, type: 'Deposit', provider: 'Wallet transfer', amount, timestamp: now
      });
    }
    res.json({ message: 'Transfer successful' });
  } catch (err) {
    res.status(500).json({ message: 'Transfer failed' });
  }
}

// GET /api/history
async function history(req, res) {
  try {
    const rows = await getDB().collection('transactions')
      .find({ userId: new ObjectId(req.user.userId) })
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Could not load history' });
  }
}

// POST /api/complain  { subject, message }
async function complain(req, res) {
  try {
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    if (!message) {
      return res.status(400).json({ message: 'Complaint message is required' });
    }
    await getDB().collection('complaints').insertOne({
      userId: new ObjectId(req.user.userId),
      subject,
      message,
      status: 'Open',
      timestamp: new Date()
    });
    res.json({ message: 'Complaint submitted' });
  } catch (err) {
    res.status(500).json({ message: 'Could not submit complaint' });
  }
}

module.exports = { getMe, deposit, transfer, history, complain };