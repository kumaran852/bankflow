'use strict';
/**
 * Banking Management System - prototype web server.
 *
 * Zero external dependencies: the HTTP server, the JSON API and the SQLite
 * database engine all come from Node.js itself.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DB = require('./src/database');
const tests = require('./src/tests');
const btree = require('./src/btree');
const docstore = require('./src/docstore');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(__dirname, 'data', 'banking.db');
const MYSQL_SCRIPT = path.join(__dirname, 'src', 'mysql', 'banking_db.sql');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Live database
// ---------------------------------------------------------------------------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const appDb = DB.openDatabase(DB_FILE);
DB.initialiseDatabase(appDb);

let tree = null;
const rebuildTree = () => {
  tree = btree.build(
    appDb.prepare('SELECT account_no FROM accounts ORDER BY account_no').all().map((r) => r.account_no)
  );
};
rebuildTree();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const send = (res, status, body, headers = {}) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });

const serveStatic = (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
};

// ---------------------------------------------------------------------------
// API routing
// ---------------------------------------------------------------------------
async function handleApi(req, res, url) {
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [resource, id, action] = segments;
  const method = req.method;
  const query = Object.fromEntries(url.searchParams.entries());
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readBody(req) : {};

  // --- dashboard -----------------------------------------------------------
  if (resource === 'overview' && method === 'GET') {
    return send(res, 200, DB.overview(appDb));
  }

  if (resource === 'schema' && method === 'GET') {
    return send(res, 200, DB.schemaInfo(appDb));
  }

  // --- master data ---------------------------------------------------------
  if (resource === 'branches' && method === 'GET') return send(res, 200, DB.listBranches(appDb));
  if (resource === 'employees' && method === 'GET') return send(res, 200, DB.listEmployees(appDb));

  // --- customers -----------------------------------------------------------
  if (resource === 'customers') {
    if (method === 'GET' && id === 'duplicate-check') {
      const dup = DB.listCustomers(appDb).find(
        (c) =>
          (query.phone && c.phone === query.phone) ||
          (query.email && c.email === query.email) ||
          (query.id_proof_no && c.id_proof_no === query.id_proof_no)
      );
      return send(res, 200, { duplicate: Boolean(dup), customer: dup || null });
    }
    if (method === 'GET') return send(res, 200, DB.listCustomers(appDb));
    if (method === 'POST') {
      const result = DB.registerCustomer(appDb, body);
      return send(res, result.ok ? 201 : 409, result);
    }
    if (method === 'PUT' && id) {
      const result = DB.updateCustomer(appDb, Number(id), body);
      return send(res, result.ok ? 200 : 404, result);
    }
    if (method === 'DELETE' && id) {
      const result = DB.deleteCustomerByEmail(appDb, id);
      return send(res, result.ok ? 200 : 409, result);
    }
  }

  // --- accounts ------------------------------------------------------------
  if (resource === 'accounts') {
    if (method === 'GET') return send(res, 200, DB.listAccounts(appDb));
    if (method === 'POST') {
      const result = DB.openAccount(appDb, Number(body.customer_id), Number(body.branch_id), body.account_type || 'SAVINGS');
      if (result.ok) rebuildTree();
      return send(res, result.ok ? 201 : 400, result);
    }
    if (method === 'PATCH' && id && action === 'status') {
      const result = DB.setAccountStatus(appDb, Number(id), body.status);
      return send(res, result.ok ? 200 : 400, result);
    }
    if (method === 'DELETE' && id) {
      const result = DB.deleteAccount(appDb, Number(id));
      return send(res, result.ok ? 200 : 409, result);
    }
  }

  // --- balance enquiry -----------------------------------------------------
  if (resource === 'balance' && method === 'GET' && id) {
    const accountNo = Number(id);
    const balance = DB.getBalance(appDb, accountNo);
    return send(res, 200, {
      account_no: accountNo,
      balance,
      found: balance !== null,
      account: DB.getAccount(appDb, accountNo),
      sql: `SELECT fn_get_balance(${accountNo});`,
    });
  }

  // --- banking operations --------------------------------------------------
  if (resource === 'operations' && method === 'POST') {
    if (id === 'deposit') {
      const result = DB.deposit(appDb, Number(body.account_no), body.amount);
      return send(res, 200, { ...result, balance: DB.getBalance(appDb, Number(body.account_no)) });
    }
    if (id === 'withdraw') {
      const result = DB.withdraw(appDb, Number(body.account_no), body.amount);
      return send(res, 200, { ...result, balance: DB.getBalance(appDb, Number(body.account_no)) });
    }
    if (id === 'transfer') {
      const result = DB.transfer(appDb, Number(body.from), Number(body.to), body.amount);
      return send(res, 200, {
        ...result,
        balances: {
          [body.from]: DB.getBalance(appDb, Number(body.from)),
          [body.to]: DB.getBalance(appDb, Number(body.to)),
        },
      });
    }
    if (id === 'interest') {
      const result = DB.applyInterest(appDb, body.rate);
      return send(res, 200, result);
    }
  }

  // --- transactions --------------------------------------------------------
  if (resource === 'transactions' && method === 'GET' && id) {
    return send(
      res,
      200,
      DB.transactionHistory(appDb, Number(id), {
        limit: query.limit ? Number(query.limit) : undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      })
    );
  }

  // --- reports and optimiser ----------------------------------------------
  if (resource === 'reports' && method === 'GET') return send(res, 200, DB.reportQueries(appDb));
  if (resource === 'explain' && method === 'GET') {
    const accountNo = Number(id || 1000100001);
    return send(res, 200, {
      indexed: {
        sql: `EXPLAIN QUERY PLAN\nSELECT * FROM transactions WHERE account_no = ${accountNo} ORDER BY txn_time DESC;`,
        plan: DB.explainHistoryQuery(appDb, accountNo),
      },
      unindexed: {
        sql: "EXPLAIN QUERY PLAN\nSELECT * FROM transactions WHERE remarks = 'Cash deposit';",
        plan: DB.explainScanQuery(appDb),
      },
    });
  }

  // --- source scripts ------------------------------------------------------
  if (resource === 'sql' && method === 'GET') {
    if (id === 'mysql') return send(res, 200, { text: fs.readFileSync(MYSQL_SCRIPT, 'utf8') });
    if (id === 'schema') {
      return send(res, 200, { text: fs.readFileSync(path.join(__dirname, 'src', 'schema.sql'), 'utf8') });
    }
  }

  // --- test cases ----------------------------------------------------------
  if (resource === 'tests' && method === 'POST' && id === 'run') {
    return send(res, 200, tests.runAllTestCases());
  }

  // --- reset ---------------------------------------------------------------
  if (resource === 'admin' && method === 'POST' && id === 'reset') {
    DB.resetDatabase(appDb);
    docstore.resetAll();
    rebuildTree();
    return send(res, 200, { ok: true, message: 'Demo data restored to the state documented in the report.' });
  }

  // --- MongoDB-style document store ---------------------------------------
  if (resource === 'mongo') {
    if (method === 'GET' && id) {
      const col = docstore.collection(id);
      return send(res, 200, {
        collection: id,
        documents: col.find(),
        collections: docstore.collections(),
      });
    }
    if (method === 'POST' && id) {
      const doc = { ...body };
      delete doc.command;
      const result = docstore.collection(id).insertOne(doc);
      return send(res, result.acknowledged ? 201 : 409, {
        ...result,
        shell: `db.${id}.insertOne(${JSON.stringify(doc)})`,
      });
    }
    if (method === 'PATCH' && id && action) {
      const result = docstore.collection(id).updateOne({ _id: action }, body);
      return send(res, 200, { ...result, shell: `db.${id}.updateOne({_id:"${action}"}, {"$set":${JSON.stringify(body)}})` });
    }
    if (method === 'DELETE' && id && action) {
      const result = docstore.collection(id).deleteOne({ _id: action });
      return send(res, 200, { ...result, shell: `db.${id}.deleteOne({_id:"${action}"})` });
    }
  }

  // --- B+ tree simulation --------------------------------------------------
  if (resource === 'btree') {
    if (method === 'GET') {
      return send(res, 200, { ...tree.levels(), stats: tree.stats(), leaves: tree.leaves() });
    }
    if (method === 'POST') {
      if (body.insert !== undefined && body.insert !== '') {
        const key = Number(body.insert);
        if (Number.isNaN(key)) return send(res, 400, { ok: false, message: 'Key must be a number' });
        btree.insert(tree, key);
      }
      if (body.search !== undefined && body.search !== '') {
        const key = Number(body.search);
        const result = tree.search(key);
        return send(res, 200, {
          ok: true,
          search: { key, ...result },
          ...tree.levels(),
          stats: tree.stats(),
          leaves: tree.leaves(),
        });
      }
      return send(res, 200, { ok: true, ...tree.levels(), stats: tree.stats(), leaves: tree.leaves() });
    }
    if (method === 'DELETE') {
      rebuildTree();
      return send(res, 200, { ok: true, ...tree.levels(), stats: tree.stats(), leaves: tree.leaves() });
    }
  }

  return send(res, 404, { error: `No API route for ${method} ${url.pathname}` });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
  try {
    await handleApi(req, res, url);
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Banking Management System prototype running at http://localhost:${PORT}`);
  console.log(`Database file: ${DB_FILE}`);
});
