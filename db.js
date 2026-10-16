const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);

let db;

async function connectDB() {
  if (db) return db;
  try {
    await client.connect();
    db = client.db('CamelWalletDB');
    console.log('MongoDB connected successfully');
    return db;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return db;
}

// Your users live in the "TeleMo" collection
function getUsers() {
  return getDB().collection('TeleMo');
}

module.exports = { connectDB, getDB, getUsers };