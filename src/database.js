'use strict';
/**
 * Banking Management System - data access layer.
 *
 * The SQL stored programs of the report (sp_deposit, sp_withdraw, sp_transfer,
 * sp_apply_interest) are reproduced here as server-side routines that wrap the
 * same statements in an explicit transaction (BEGIN IMMEDIATE / COMMIT /
 * ROLLBACK). This is the documented equivalent for a database engine that does
 * not ship a stored-program language, and it keeps the same behaviour:
 *   validate -> lock -> update balances -> write the audit rows -> commit,
 *   or roll back completely when any step fails.
 * The returned status strings are identical to the ones used in the report.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const SEED_SQL = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');

const ACCOUNT_START = 1000100001;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const parseAmount = (value) => {
  if (value === null || value === undefined || value === '') return NaN;
  return Number(value);
};

/**
 * Roll back the open transaction, tolerating the case where the engine has
 * already discarded it (a failed COMMIT, for example). Never masks the error
 * that caused the rollback in the first place.
 */
const rollback = (db) => {
  try {
    db.exec('ROLLBACK');
  } catch {
    /* no active transaction - nothing to undo */
  }
};

// ---------------------------------------------------------------------------
// Connection handling
// ---------------------------------------------------------------------------

function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');

  // Application-level function, the equivalent of fn_get_balance.
  db.function('fn_get_balance', { deterministic: true }, (accountNo) => {
    const row = db.prepare('SELECT balance FROM accounts WHERE account_no = ?').get(accountNo);
    return row ? row.balance : null;
  });

  if (!tableExists(db, 'branches')) createSchema(db);
  return db;
}

function tableExists(db, name) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return Boolean(row);
}

function createSchema(db) {
  db.exec(SCHEMA_SQL);
}

function isEmpty(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM branches').get().c === 0;
}

/**
 * Create the schema and load the sample data.
 * `openingOperations` replays A1.6 (deposit / withdraw / transfer) so that the
 * demo starts from the state documented in Table 10 of the report. The test
 * suite turns it off and drives every operation itself.
 */
function initialiseDatabase(db, { openingOperations = true } = {}) {
  if (!tableExists(db, 'branches')) createSchema(db);
  if (!isEmpty(db)) return;
  db.exec(SEED_SQL);
  if (!openingOperations) return;
  deposit(db, 1000100001, 50000);
  deposit(db, 1000100002, 30000);
  deposit(db, 1000100003, 20000);
  deposit(db, 1000100004, 75000);
  withdraw(db, 1000100001, 10000);
  transfer(db, 1000100001, 1000100002, 5000);
}

/** Drop everything and rebuild the demo data set from scratch. */
function resetDatabase(db) {
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const name of ['transactions', 'accounts', 'employees', 'customers', 'branches']) {
    db.exec(`DROP TABLE IF EXISTS ${name};`);
  }
  db.exec('DROP VIEW IF EXISTS vw_account_summary;');
  db.exec('DROP VIEW IF EXISTS vw_transaction_history;');
  db.exec('PRAGMA foreign_keys = ON;');
  initialiseDatabase(db);
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

const listBranches = (db) => db.prepare('SELECT * FROM branches ORDER BY branch_id').all();

const listEmployees = (db) =>
  db
    .prepare(
      `SELECT e.employee_id, e.emp_name, e.designation, e.email, e.hire_date,
              b.branch_name
       FROM employees e JOIN branches b ON b.branch_id = e.branch_id
       ORDER BY e.employee_id`
    )
    .all();

const listCustomers = (db) =>
  db
    .prepare(
      `SELECT c.*, COUNT(a.account_no) AS account_count
       FROM customers c LEFT JOIN accounts a ON a.customer_id = c.customer_id
       GROUP BY c.customer_id
       ORDER BY c.customer_id`
    )
    .all();

// Reads through the view, exactly like the report's "vw_account_summary".
const listAccounts = (db) =>
  db.prepare('SELECT * FROM vw_account_summary ORDER BY account_no').all();

const findCustomerDuplicates = (db, { phone, email, id_proof_no }) =>
  db
    .prepare(
      `SELECT customer_id, first_name, last_name, phone, email, id_proof_no
       FROM customers
       WHERE phone = ? OR email = ? OR id_proof_no = ?`
    )
    .get(phone, email, id_proof_no) || null;

/** fn_get_balance(p_account) -> balance, or NULL when it does not exist. */
function getBalance(db, accountNo) {
  const row = db.prepare('SELECT balance FROM accounts WHERE account_no = ?').get(accountNo);
  return row ? row.balance : null;
}

function getAccount(db, accountNo) {
  return (
    db.prepare('SELECT * FROM vw_account_summary WHERE account_no = ?').get(accountNo) || null
  );
}

// ---------------------------------------------------------------------------
// Customer management (DML)
// ---------------------------------------------------------------------------

function registerCustomer(db, data) {
  const dup = findCustomerDuplicates(db, data);
  if (dup) {
    const field = ['phone', 'email', 'id_proof_no'].find((f) => dup[f] === data[f]);
    return {
      ok: false,
      code: '1062',
      message: `ERROR 1062 (23000): Duplicate entry '${data[field]}' for key 'customers.${field}'`,
      field,
      conflictWith: dup.customer_id,
    };
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO customers
           (first_name, last_name, date_of_birth, gender, phone, email, id_proof_no, address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.first_name,
        data.last_name,
        data.date_of_birth,
        data.gender,
        data.phone,
        data.email,
        data.id_proof_no,
        data.address
      );
    return { ok: true, customer_id: Number(info.lastInsertRowid) };
  } catch (err) {
    return { ok: false, code: 'CONSTRAINT', message: `ERROR: ${err.message}` };
  }
}

function updateCustomer(db, customerId, data) {
  try {
    const info = db
      .prepare('UPDATE customers SET phone = ?, address = ? WHERE customer_id = ?')
      .run(data.phone, data.address, customerId);
    if (info.changes === 0) return { ok: false, message: 'ERROR: Customer not found' };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `ERROR: ${err.message}` };
  }
}

function deleteCustomerByEmail(db, email) {
  try {
    const info = db.prepare('DELETE FROM customers WHERE email = ?').run(email);
    return { ok: true, changes: info.changes };
  } catch (err) {
    return { ok: false, message: `ERROR: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

function openAccount(db, customerId, branchId, accountType) {
  try {
    const customer = db
      .prepare('SELECT customer_id FROM customers WHERE customer_id = ?')
      .get(customerId);
    if (!customer) return { ok: false, message: 'ERROR: Customer does not exist' };
    const branch = db.prepare('SELECT branch_id FROM branches WHERE branch_id = ?').get(branchId);
    if (!branch) return { ok: false, message: 'ERROR: Branch does not exist' };

    const maxNo = db.prepare('SELECT MAX(account_no) AS m FROM accounts').get().m || 0;
    const accountNo = Math.max(ACCOUNT_START, maxNo + 1);
    db.prepare(
      'INSERT INTO accounts (account_no, customer_id, branch_id, account_type) VALUES (?, ?, ?, ?)'
    ).run(accountNo, customerId, branchId, accountType);
    return { ok: true, account: getAccount(db, accountNo) };
  } catch (err) {
    return { ok: false, message: `ERROR: ${err.message}` };
  }
}

function setAccountStatus(db, accountNo, status) {
  try {
    const info = db
      .prepare('UPDATE accounts SET status = ? WHERE account_no = ?')
      .run(status, accountNo);
    if (info.changes === 0) return { ok: false, message: 'ERROR: Invalid account number' };
    return { ok: true, account: getAccount(db, accountNo) };
  } catch (err) {
    return { ok: false, message: `ERROR: ${err.message}` };
  }
}

/** Physical delete - the trigger blocks it when a balance remains. */
function deleteAccount(db, accountNo) {
  try {
    const info = db.prepare('DELETE FROM accounts WHERE account_no = ?').run(accountNo);
    if (info.changes === 0) return { ok: false, message: 'ERROR: Invalid account number' };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: '1644',
      sqlstate: '45000',
      message: `ERROR 1644 (45000): ${err.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// sp_deposit
// ---------------------------------------------------------------------------

function deposit(db, accountNo, amount, remarks = 'Cash deposit') {
  const amt = parseAmount(amount);
  if (Number.isNaN(amt) || amt <= 0) {
    return { ok: false, status: 'ERROR: Amount must be greater than zero' };
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const acc = db
      .prepare('SELECT balance, status FROM accounts WHERE account_no = ?')
      .get(accountNo);
    if (!acc) {
      rollback(db);
      return { ok: false, status: 'ERROR: Invalid account number' };
    }
    if (acc.status !== 'ACTIVE') {
      rollback(db);
      return { ok: false, status: 'ERROR: Account is not active' };
    }
    const newBalance = round2(acc.balance + amt);
    db.prepare('UPDATE accounts SET balance = ? WHERE account_no = ?').run(newBalance, accountNo);
    db.prepare(
      `INSERT INTO transactions (account_no, txn_type, amount, balance_after, remarks)
       VALUES (?, 'DEPOSIT', ?, ?, ?)`
    ).run(accountNo, round2(amt), newBalance, remarks);
    db.exec('COMMIT');
    return { ok: true, status: 'SUCCESS: Deposit completed', balance: newBalance };
  } catch (err) {
    rollback(db);
    return { ok: false, status: 'ERROR: Deposit failed', detail: err.message };
  }
}

// ---------------------------------------------------------------------------
// sp_withdraw
// ---------------------------------------------------------------------------

function withdraw(db, accountNo, amount, remarks = 'Cash withdrawal') {
  const amt = parseAmount(amount);
  if (Number.isNaN(amt) || amt <= 0) {
    return { ok: false, status: 'ERROR: Amount must be greater than zero' };
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const acc = db
      .prepare('SELECT balance, status FROM accounts WHERE account_no = ?')
      .get(accountNo);
    if (!acc) {
      rollback(db);
      return { ok: false, status: 'ERROR: Invalid account number' };
    }
    if (acc.status !== 'ACTIVE') {
      rollback(db);
      return { ok: false, status: 'ERROR: Account is not active' };
    }
    if (acc.balance < amt) {
      rollback(db);
      return { ok: false, status: 'ERROR: Insufficient balance' };
    }
    const newBalance = round2(acc.balance - amt);
    db.prepare('UPDATE accounts SET balance = ? WHERE account_no = ?').run(newBalance, accountNo);
    db.prepare(
      `INSERT INTO transactions (account_no, txn_type, amount, balance_after, remarks)
       VALUES (?, 'WITHDRAWAL', ?, ?, ?)`
    ).run(accountNo, round2(amt), newBalance, remarks);
    db.exec('COMMIT');
    return { ok: true, status: 'SUCCESS: Withdrawal completed', balance: newBalance };
  } catch (err) {
    rollback(db);
    return { ok: false, status: 'ERROR: Withdrawal failed', detail: err.message };
  }
}

// ---------------------------------------------------------------------------
// sp_transfer - atomic, rows touched in ascending account order (deadlock-safe)
// ---------------------------------------------------------------------------

function transfer(db, fromAccount, toAccount, amount) {
  const amt = parseAmount(amount);
  if (Number.isNaN(amt) || amt <= 0) {
    return { ok: false, status: 'ERROR: Amount must be greater than zero' };
  }
  if (String(fromAccount) === String(toAccount)) {
    return { ok: false, status: 'ERROR: Source and destination accounts are the same' };
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    // Both rows are locked in ascending account-number order.
    const first = Number(fromAccount) < Number(toAccount) ? fromAccount : toAccount;
    const second = Number(fromAccount) < Number(toAccount) ? toAccount : fromAccount;
    const readOne = db.prepare('SELECT account_no, balance, status FROM accounts WHERE account_no = ?');
    const rowA = readOne.get(first);
    const rowB = readOne.get(second);
    const fromRow = rowA && String(rowA.account_no) === String(fromAccount) ? rowA : rowB;
    const toRow = rowA && String(rowA.account_no) === String(fromAccount) ? rowB : rowA;

    if (!fromRow || !toRow) {
      rollback(db);
      return { ok: false, status: 'ERROR: Invalid account number' };
    }
    if (fromRow.status !== 'ACTIVE' || toRow.status !== 'ACTIVE') {
      rollback(db);
      return { ok: false, status: 'ERROR: Both accounts must be active' };
    }
    if (fromRow.balance < amt) {
      rollback(db);
      return { ok: false, status: 'ERROR: Insufficient balance' };
    }

    const fromBalance = round2(fromRow.balance - amt);
    const toBalance = round2(toRow.balance + amt);
    db.prepare('UPDATE accounts SET balance = ? WHERE account_no = ?').run(
      fromBalance,
      fromAccount
    );
    db.prepare('UPDATE accounts SET balance = ? WHERE account_no = ?').run(toBalance, toAccount);

    const ins = db.prepare(
      `INSERT INTO transactions
         (account_no, txn_type, amount, balance_after, related_account_no, remarks)
       VALUES (?, ?, ?, ?, ?, 'Fund transfer')`
    );
    ins.run(fromAccount, 'TRANSFER_OUT', round2(amt), fromBalance, toAccount);
    ins.run(toAccount, 'TRANSFER_IN', round2(amt), toBalance, fromAccount);

    db.exec('COMMIT');
    return {
      ok: true,
      status: 'SUCCESS: Transfer completed',
      fromBalance,
      toBalance,
      from: fromAccount,
      to: toAccount,
    };
  } catch (err) {
    rollback(db);
    return { ok: false, status: 'ERROR: Transfer failed and was rolled back', detail: err.message };
  }
}

// ---------------------------------------------------------------------------
// sp_apply_interest - cursor based batch operation
// ---------------------------------------------------------------------------

function applyInterest(db, ratePercent) {
  const rate = Number(ratePercent);
  if (Number.isNaN(rate) || rate <= 0) {
    return { ok: false, message: 'ERROR: Interest rate must be greater than zero' };
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    // Cursor equivalent: the result set is opened once and read row by row.
    const cursor = db
      .prepare(
        `SELECT account_no, balance FROM accounts
         WHERE account_type = 'SAVINGS' AND status = 'ACTIVE'
         ORDER BY account_no`
      )
      .all();

    const affected = [];
    let total = 0;
    for (const row of cursor) {
      const interest = round2((row.balance * rate) / 100);
      if (interest <= 0) continue;
      const newBalance = round2(row.balance + interest);
      db.prepare('UPDATE accounts SET balance = ? WHERE account_no = ?').run(
        newBalance,
        row.account_no
      );
      db.prepare(
        `INSERT INTO transactions (account_no, txn_type, amount, balance_after, remarks)
         VALUES (?, 'DEPOSIT', ?, ?, 'Interest credit')`
      ).run(row.account_no, interest, newBalance);
      total = round2(total + interest);
      affected.push({ account_no: row.account_no, interest, balance: newBalance });
    }
    db.exec('COMMIT');
    return { ok: true, rate, credited: affected.length, total, affected };
  } catch (err) {
    rollback(db);
    return { ok: false, message: `ERROR: Interest run rolled back - ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// History and statements
// ---------------------------------------------------------------------------

function transactionHistory(db, accountNo, { limit, from, to } = {}) {
  const params = [accountNo];
  let sql = `
    SELECT t.txn_id, t.txn_time, t.txn_type, t.amount, t.balance_after,
           t.related_account_no, t.remarks,
           (c.first_name || ' ' || c.last_name) AS holder
    FROM transactions t
    JOIN accounts  a ON a.account_no  = t.account_no
    JOIN customers c ON c.customer_id = a.customer_id
    WHERE t.account_no = ?`;
  if (from) {
    sql += ' AND t.txn_time >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND t.txn_time <= ?';
    params.push(to);
  }
  sql += ' ORDER BY t.txn_time DESC, t.txn_id DESC';
  if (limit) {
    sql += ' LIMIT ?';
    params.push(Number(limit));
  }
  return db.prepare(sql).all(...params);
}

const accountOwners = (db) =>
  db
    .prepare(
      `SELECT c.customer_id, c.first_name,
              a.account_no, a.account_type, a.balance
       FROM customers c LEFT JOIN accounts a ON a.customer_id = c.customer_id
       ORDER BY c.customer_id, a.account_no`
    )
    .all();

const holdersOfBothTypes = (db) =>
  db
    .prepare(
      `SELECT customer_id FROM accounts WHERE account_type = 'SAVINGS'
       INTERSECT
       SELECT customer_id FROM accounts WHERE account_type = 'CURRENT'`
    )
    .all();

// ---------------------------------------------------------------------------
// Query catalogue - the SQL features of section 4.13 / A1.7
// ---------------------------------------------------------------------------

function reportQueries(db) {
  const run = (sql, params = []) => {
    const rows = db.prepare(sql).all(...params);
    return { columns: rows.length ? Object.keys(rows[0]) : [], rows };
  };

  return [
    {
      id: 'txn-summary',
      title: 'Transaction type summary',
      concept: 'Aggregate functions + GROUP BY (COUNT, SUM, AVG)',
      sql: `SELECT txn_type, COUNT(*) AS no_of_txns, SUM(amount) AS total_amount,
       AVG(amount) AS avg_amount
FROM transactions GROUP BY txn_type ORDER BY total_amount DESC`,
      ...run(`SELECT txn_type, COUNT(*) AS no_of_txns, SUM(amount) AS total_amount,
                     ROUND(AVG(amount),2) AS avg_amount
              FROM transactions GROUP BY txn_type ORDER BY total_amount DESC`),
    },
    {
      id: 'branch-totals',
      title: 'Branch-wise totals',
      concept: 'GROUP BY with HAVING, join',
      sql: `SELECT b.branch_name, COUNT(a.account_no) AS accounts,
       SUM(a.balance) AS total_balance, AVG(a.balance) AS avg_balance
FROM branches b JOIN accounts a ON a.branch_id = b.branch_id
GROUP BY b.branch_id, b.branch_name
HAVING SUM(a.balance) > 0
ORDER BY total_balance DESC`,
      ...run(`SELECT b.branch_name, COUNT(a.account_no) AS accounts,
                     SUM(a.balance) AS total_balance,
                     ROUND(AVG(a.balance),2) AS avg_balance
              FROM branches b JOIN accounts a ON a.branch_id = b.branch_id
              GROUP BY b.branch_id, b.branch_name
              HAVING SUM(a.balance) > 0
              ORDER BY total_balance DESC`),
    },
    {
      id: 'min-max',
      title: 'Highest and lowest balances',
      concept: 'MAX, MIN',
      sql: `SELECT MAX(balance) AS highest_balance, MIN(balance) AS lowest_balance FROM accounts`,
      ...run('SELECT MAX(balance) AS highest_balance, MIN(balance) AS lowest_balance FROM accounts'),
    },
    {
      id: 'customers-accounts',
      title: 'Customers with their accounts',
      concept: 'LEFT JOIN (keeps customers without an account)',
      sql: `SELECT c.customer_id, c.first_name, a.account_no, a.account_type, a.balance
FROM customers c LEFT JOIN accounts a ON a.customer_id = c.customer_id
ORDER BY c.customer_id, a.account_no`,
      ...run(`SELECT c.customer_id, c.first_name, a.account_no, a.account_type, a.balance
              FROM customers c LEFT JOIN accounts a ON a.customer_id = c.customer_id
              ORDER BY c.customer_id, a.account_no`),
    },
    {
      id: 'like',
      title: "Pattern search - names starting with 'A'",
      concept: 'LIKE operator',
      sql: `SELECT * FROM customers WHERE first_name LIKE 'A%'`,
      ...run("SELECT customer_id, first_name, last_name, phone, email FROM customers WHERE first_name LIKE 'A%'"),
    },
    {
      id: 'in-between',
      title: 'Savings accounts between 10000 and 100000',
      concept: 'IN + BETWEEN + AND',
      sql: `SELECT * FROM accounts
WHERE account_type IN ('SAVINGS') AND balance BETWEEN 10000 AND 100000`,
      ...run(`SELECT account_no, account_type, balance, status FROM accounts
              WHERE account_type IN ('SAVINGS') AND balance BETWEEN 10000 AND 100000`),
    },
    {
      id: 'intersect',
      title: 'Customers holding both SAVINGS and CURRENT accounts',
      concept: 'Set operation INTERSECT',
      sql: `SELECT customer_id FROM accounts WHERE account_type = 'SAVINGS'
INTERSECT
SELECT customer_id FROM accounts WHERE account_type = 'CURRENT'`,
      ...run(`SELECT customer_id FROM accounts WHERE account_type = 'SAVINGS'
              INTERSECT
              SELECT customer_id FROM accounts WHERE account_type = 'CURRENT'`),
    },
    {
      id: 'view-summary',
      title: 'vw_account_summary (view: accounts + customers + branches)',
      concept: 'View over a three-table join',
      sql: 'SELECT * FROM vw_account_summary ORDER BY account_no',
      ...run('SELECT * FROM vw_account_summary ORDER BY account_no'),
    },
    {
      id: 'view-history',
      title: 'vw_transaction_history (reusable statement view)',
      concept: 'View over the audit log',
      sql: 'SELECT * FROM vw_transaction_history ORDER BY txn_time DESC, txn_id DESC',
      ...run('SELECT * FROM vw_transaction_history ORDER BY txn_time DESC, txn_id DESC'),
    },
    {
      id: 'consistency',
      title: 'Consistency check - balances versus net external flow',
      concept: 'Correlated sub-queries with CASE',
      sql: `SELECT (SELECT IFNULL(SUM(balance),0) FROM accounts) AS total_balances,
       (SELECT IFNULL(SUM(CASE WHEN txn_type = 'DEPOSIT' THEN amount
                               WHEN txn_type = 'WITHDRAWAL' THEN -amount ELSE 0 END),0)
        FROM transactions) AS net_external_flow`,
      ...run(`SELECT (SELECT IFNULL(SUM(balance),0) FROM accounts) AS total_balances,
                     (SELECT IFNULL(SUM(CASE WHEN txn_type = 'DEPOSIT' THEN amount
                                             WHEN txn_type = 'WITHDRAWAL' THEN -amount
                                             ELSE 0 END),0)
                      FROM transactions) AS net_external_flow`),
    },
  ];
}

/** EXPLAIN QUERY PLAN for the statement history -- shows the index being used. */
function explainHistoryQuery(db, accountNo) {
  return db
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT * FROM transactions WHERE account_no = ? ORDER BY txn_time DESC`
    )
    .all(accountNo);
}

/** EXPLAIN QUERY PLAN without the index, to compare scan versus seek. */
function explainScanQuery(db) {
  return db
    .prepare('EXPLAIN QUERY PLAN SELECT * FROM transactions WHERE remarks = ?')
    .all('Cash deposit');
}

// ---------------------------------------------------------------------------
// Schema introspection - powers the "Database Design" panel
// ---------------------------------------------------------------------------

function schemaInfo(db) {
  const objects = db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' ORDER BY CASE type
         WHEN 'table' THEN 1 WHEN 'view' THEN 2 WHEN 'index' THEN 3 ELSE 4 END, name`
    )
    .all();

  const describe = (name) =>
    db
      .prepare(`PRAGMA table_info(${name})`)
      .all()
      .map((c) => ({
        name: c.name,
        type: c.type,
        notnull: Boolean(c.notnull),
        pk: Boolean(c.pk),
        dflt: c.dflt_value,
      }));

  return {
    tables: objects
      .filter((o) => o.type === 'table')
      .map((o) => ({ name: o.name, ddl: o.sql, columns: describe(o.name) })),
    views: objects.filter((o) => o.type === 'view').map((o) => ({ name: o.name, ddl: o.sql })),
    indexes: objects
      .filter((o) => o.type === 'index')
      .map((o) => ({ name: o.name, table: o.tbl_name, ddl: o.sql })),
    triggers: objects.filter((o) => o.type === 'trigger').map((o) => ({ name: o.name, ddl: o.sql })),
  };
}

/** Row counts, balances and the aggregate banner shown on the dashboard. */
function overview(db) {
  const scalar = (sql) => db.prepare(sql).get();
  const counts = scalar(`SELECT
      (SELECT COUNT(*) FROM branches)     AS branches,
      (SELECT COUNT(*) FROM employees)    AS employees,
      (SELECT COUNT(*) FROM customers)    AS customers,
      (SELECT COUNT(*) FROM accounts)     AS accounts,
      (SELECT COUNT(*) FROM transactions) AS transactions`);
  const money = scalar(`SELECT
      ROUND(IFNULL(SUM(balance),0),2) AS total_balance,
      ROUND(IFNULL(AVG(balance),0),2) AS avg_balance,
      IFNULL(MAX(balance),0)          AS max_balance,
      IFNULL(MIN(balance),0)          AS min_balance
    FROM accounts`);
  const flow = scalar(`SELECT
      (SELECT IFNULL(SUM(CASE WHEN txn_type='DEPOSIT' THEN amount
                              WHEN txn_type='WITHDRAWAL' THEN -amount ELSE 0 END),0)
       FROM transactions) AS net_external_flow`);
  return { counts, money, netExternalFlow: flow.net_external_flow };
}

module.exports = {
  ACCOUNT_START,
  openDatabase,
  createSchema,
  initialiseDatabase,
  resetDatabase,
  tableExists,
  round2,
  // reads
  listBranches,
  listEmployees,
  listCustomers,
  listAccounts,
  getBalance,
  getAccount,
  accountOwners,
  holdersOfBothTypes,
  transactionHistory,
  reportQueries,
  explainHistoryQuery,
  explainScanQuery,
  schemaInfo,
  overview,
  // writes
  registerCustomer,
  updateCustomer,
  deleteCustomerByEmail,
  openAccount,
  setAccountStatus,
  deleteAccount,
  deposit,
  withdraw,
  transfer,
  applyInterest,
};
