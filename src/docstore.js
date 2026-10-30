'use strict';
/**
 * MongoDB-style document store (Experiment 12).
 *
 * A real MongoDB server is not required for the demo: the same CRUD operations
 * are provided over a small JSON document store so that the document model can
 * be compared side by side with the relational tables. Every operation also
 * reports the equivalent mongosh command.
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'documents.json');

const SEED = {
  kyc_documents: [
    {
      _id: 'KYC0001',
      customer_id: 1,
      customer_name: 'Asha Kumar',
      doc_type: 'Aadhaar',
      doc_number: 'ID-0001',
      address: 'Sample Address 1, Coimbatore',
      verified: true,
      branches: ['Coimbatore Main', 'Arasur Branch'],
      uploaded_at: '2026-01-05 10:12:00',
    },
    {
      _id: 'KYC0002',
      customer_id: 4,
      customer_name: 'Karthik Raj',
      doc_type: 'PAN',
      doc_number: 'ID-0004',
      address: 'Sample Address 4, Arasur',
      verified: false,
      branches: ['Arasur Branch'],
      uploaded_at: '2026-01-07 09:30:00',
    },
  ],
  audit_log: [
    { _id: 'AUD0001', action: 'OPEN_ACCOUNT', account_no: 1000100001, at: '2026-01-05 10:20:00' },
  ],
};

function load() {
  if (!fs.existsSync(FILE)) return structuredClone(SEED);
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return structuredClone(SEED);
  }
}

function save(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

const matches = (doc, filter) =>
  Object.entries(filter || {}).every(([key, value]) => doc[key] === value);

function collection(name) {
  const store = load();
  if (!store[name]) store[name] = [];

  const flush = () => save(store);

  return {
    name,
    countDocuments(filter = {}) {
      return store[name].filter((d) => matches(d, filter)).length;
    },
    find(filter = {}, { limit } = {}) {
      let rows = store[name].filter((d) => matches(d, filter));
      if (limit) rows = rows.slice(0, limit);
      return structured(rows);
    },
    insertOne(doc) {
      const _id = doc._id || `${name.slice(0, 3).toUpperCase()}${String(store[name].length + 1).padStart(4, '0')}`;
      if (store[name].some((d) => d._id === _id)) {
        return { acknowledged: false, error: `E11000 duplicate key error: _id '${_id}' already exists` };
      }
      store[name].push({ _id, ...doc });
      flush();
      return { acknowledged: true, insertedId: _id };
    },
    updateOne(filter, update) {
      const doc = store[name].find((d) => matches(d, filter));
      if (!doc) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set || update);
      flush();
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
    deleteOne(filter) {
      const i = store[name].findIndex((d) => matches(d, filter));
      if (i === -1) return { acknowledged: true, deletedCount: 0 };
      store[name].splice(i, 1);
      flush();
      return { acknowledged: true, deletedCount: 1 };
    },
    drop() {
      store[name] = [];
      flush();
      return { ok: 1 };
    },
  };
}

/** Keep the object shape stable for JSON transport. */
function structured(rows) {
  return rows.map((r) => ({ ...r }));
}

function resetAll() {
  save(structuredClone(SEED));
}

function collections() {
  return Object.keys(load());
}

module.exports = { collection, collections, resetAll, SEED };
