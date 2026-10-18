const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('./db');

const USERS = 'TeleMo';
const JWT_SECRET = process.env.JWT_SECRET || 'camel_wallet_secret_key';

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

// GET /api/lookup/:phone
// Checks MongoDB that the account exists and returns its name, plus a short-lived
// token that proves the name was searched (the transfer will not run without it).
async function lookupRecipient(req, res) {
  try {
    const phone = String(req.params.phone || '').trim();
    if (!phone) {
      return res.status(400).json({ message: 'Enter the recipient account number' });
    }

    const recipient = await getDB().collection(USERS).findOne(
      { TeleMo: phone },
      { projection: { CommonName: 1, FirstName: 1, LastName: 1, TeleMo: 1 } }
    );
    if (!recipient) {
      return res.status(404).json({ message: 'No Camel Wallet account found for that number' });
    }
    if (String(recipient._id) === req.user.userId) {
      return res.status(400).json({ message: 'You cannot transfer to yourself' });
    }

    const name = recipient.CommonName ||
      [recipient.FirstName, recipient.LastName].filter(Boolean).join(' ') ||
      'Unnamed account';

    const lookupToken = jwt.sign(
      { purpose: 'transfer-lookup', by: req.user.userId, to: String(recipient._id) },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    res.json({ name, phone, lookupToken });
  } catch (err) {
    res.status(500).json({ message: 'Could not search for the account' });
  }
}

// POST /api/transfer  { recipient, amount, pin, lookupToken }
// Camel Wallet to Camel Wallet only.
async function transfer(req, res) {
  try {
    const recipient = String(req.body.recipient || '').trim();
    const amount = Math.round(Number(req.body.amount) * 100) / 100;
    const { pin, lookupToken } = req.body;

    if (!recipient || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid transfer details' });
    }
    if (!lookupToken) {
      return res.status(400).json({ message: 'Search the account name before sending' });
    }

    let lookup;
    try {
      lookup = jwt.verify(lookupToken, JWT_SECRET);
    } catch (e) {
      return res.status(400).json({ message: 'Name search expired. Search the account name again' });
    }
    if (lookup.purpose !== 'transfer-lookup' || lookup.by !== req.user.userId) {
      return res.status(400).json({ message: 'Search the account name before sending' });
    }

    const db = getDB();
    const users = db.collection(USERS);
    const senderId = new ObjectId(req.user.userId);

    // The account must exist in MongoDB and match the number that was searched
    const recipientUser = await users.findOne({ _id: new ObjectId(lookup.to) });
    if (!recipientUser || recipientUser.TeleMo !== recipient) {
      return res.status(400).json({ message: 'The number does not match the searched account. Search again' });
    }
    if (recipientUser._id.equals(senderId)) {
      return res.status(400).json({ message: 'You cannot transfer to yourself' });
    }

    const sender = await users.findOne({ _id: senderId });
    if (!sender) return res.status(404).json({ message: 'User not found' });

    if (!(await pinMatches(pin, sender.Pin))) {
      return res.status(400).json({ message: 'Incorrect pin' });
    }

    // Deduct only if enough balance (atomic, prevents overdraw)
    const debit = await users.updateOne(
      { _id: senderId, Balance: { $gte: amount } },
      { $inc: { Balance: -amount } }
    );
    if (debit.modifiedCount !== 1) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    try {
      await users.updateOne({ _id: recipientUser._id }, { $inc: { Balance: amount } });
    } catch (creditErr) {
      // Give the money back if the recipient could not be credited
      await users.updateOne({ _id: senderId }, { $inc: { Balance: amount } });
      throw creditErr;
    }

    const recipientName = recipientUser.CommonName || recipientUser.FirstName || '';
    const senderName = sender.CommonName || sender.FirstName || '';
    const now = new Date();
    await db.collection('transactions').insertMany([
      {
        userId: senderId, type: 'Transfer', provider: 'Camel Wallet',
        recipient, recipientName, amount, timestamp: now
      },
      {
        userId: recipientUser._id, type: 'Deposit', provider: 'Camel Wallet',
        sender: sender.TeleMo, senderName, amount, timestamp: now
      }
    ]);

    res.json({ message: 'Transfer successful', recipientName });
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

module.exports = { getMe, deposit, lookupRecipient, transfer, history, complain };