-- ============================================================================
-- Banking Management System - physical schema
-- Dialect : SQLite (engine built into Node.js) used for the runnable prototype
-- The MySQL 8.0 equivalent of this schema is kept in src/mysql/banking_db.sql
-- and is what the project report (Appendix I) documents.
-- ============================================================================

CREATE TABLE branches (
  branch_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_name  TEXT NOT NULL,
  ifsc_code    TEXT NOT NULL UNIQUE,
  city         TEXT NOT NULL,
  phone        TEXT
);

CREATE TABLE employees (
  employee_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id    INTEGER NOT NULL,
  emp_name     TEXT NOT NULL,
  designation  TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  hire_date    TEXT NOT NULL,
  CONSTRAINT fk_emp_branch FOREIGN KEY (branch_id) REFERENCES branches(branch_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE customers (
  customer_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  date_of_birth  TEXT NOT NULL,
  gender         TEXT NOT NULL,
  phone          TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL UNIQUE,
  id_proof_no    TEXT NOT NULL UNIQUE,
  address        TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CONSTRAINT chk_cust_gender CHECK (gender IN ('M','F','O')),
  CONSTRAINT chk_cust_phone  CHECK (phone GLOB '[0-9]*' AND length(phone) BETWEEN 10 AND 15)
);

CREATE TABLE accounts (
  account_no    INTEGER PRIMARY KEY,
  customer_id   INTEGER NOT NULL,
  branch_id     INTEGER NOT NULL,
  account_type  TEXT NOT NULL DEFAULT 'SAVINGS',
  balance       REAL NOT NULL DEFAULT 0.00,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  opened_on     TEXT NOT NULL DEFAULT (date('now','localtime')),
  CONSTRAINT chk_acc_type    CHECK (account_type IN ('SAVINGS','CURRENT')),
  CONSTRAINT chk_acc_status  CHECK (status IN ('ACTIVE','CLOSED','FROZEN')),
  CONSTRAINT chk_acc_balance CHECK (balance >= 0),
  CONSTRAINT fk_acc_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_acc_branch   FOREIGN KEY (branch_id) REFERENCES branches(branch_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE transactions (
  txn_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_no          INTEGER NOT NULL,
  txn_type            TEXT NOT NULL,
  amount              REAL NOT NULL,
  balance_after       REAL NOT NULL,
  txn_time            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  related_account_no  INTEGER,
  remarks             TEXT,
  CONSTRAINT chk_txn_type   CHECK (txn_type IN ('DEPOSIT','WITHDRAWAL','TRANSFER_OUT','TRANSFER_IN')),
  CONSTRAINT chk_txn_amount CHECK (amount > 0),
  CONSTRAINT fk_txn_account FOREIGN KEY (account_no) REFERENCES accounts(account_no)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_txn_related FOREIGN KEY (related_account_no) REFERENCES accounts(account_no)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_txn_account_time ON transactions (account_no, txn_time);
CREATE INDEX idx_acc_customer     ON accounts (customer_id);

CREATE VIEW vw_account_summary AS
SELECT a.account_no,
       (c.first_name || ' ' || c.last_name) AS customer_name,
       a.customer_id,
       a.branch_id,
       a.account_type,
       a.balance,
       a.status,
       a.opened_on,
       b.branch_name
FROM accounts a
JOIN customers c ON c.customer_id = a.customer_id
JOIN branches  b ON b.branch_id   = a.branch_id;

CREATE VIEW vw_transaction_history AS
SELECT txn_id, account_no, txn_type, amount, balance_after,
       related_account_no, txn_time, remarks
FROM transactions;

-- Integrity trigger: an account that still holds money cannot be deleted.
CREATE TRIGGER trg_accounts_before_delete
BEFORE DELETE ON accounts
FOR EACH ROW
WHEN OLD.balance > 0
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete an account with a non-zero balance');
END;
