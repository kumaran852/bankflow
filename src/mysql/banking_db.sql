-- ============================================================================
-- BANKING MANAGEMENT SYSTEM - COMPLETE MySQL 8.0 SOURCE CODE
-- DBMS Mini Project (U25CSG18) - Experiment 13 : Integrated Mini Project
-- This is the Appendix I script documented in the project report.
-- The runnable web prototype in this repository uses the SQLite equivalent
-- (src/schema.sql) so that no MySQL server installation is required.
-- Run the parts below in the order shown.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A1.1  Database creation
-- ---------------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS banking_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE banking_db;

-- ---------------------------------------------------------------------------
-- A1.2  Table and index creation  (DDL + constraints)
-- ---------------------------------------------------------------------------
CREATE TABLE branches (
  branch_id    INT AUTO_INCREMENT PRIMARY KEY,
  branch_name  VARCHAR(60)  NOT NULL,
  ifsc_code    VARCHAR(11)  NOT NULL UNIQUE,
  city         VARCHAR(50)  NOT NULL,
  phone        VARCHAR(15)
) ENGINE=InnoDB;

CREATE TABLE employees (
  employee_id  INT AUTO_INCREMENT PRIMARY KEY,
  branch_id    INT          NOT NULL,
  emp_name     VARCHAR(80)  NOT NULL,
  designation  VARCHAR(40)  NOT NULL,
  email        VARCHAR(100) NOT NULL UNIQUE,
  hire_date    DATE         NOT NULL,
  CONSTRAINT fk_emp_branch FOREIGN KEY (branch_id)
    REFERENCES branches(branch_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE customers (
  customer_id    INT AUTO_INCREMENT PRIMARY KEY,
  first_name     VARCHAR(50)  NOT NULL,
  last_name      VARCHAR(50)  NOT NULL,
  date_of_birth  DATE         NOT NULL,
  gender         CHAR(1)      NOT NULL,
  phone          VARCHAR(15)  NOT NULL UNIQUE,
  email          VARCHAR(100) NOT NULL UNIQUE,
  id_proof_no    VARCHAR(20)  NOT NULL UNIQUE,
  address        VARCHAR(200) NOT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_cust_gender CHECK (gender IN ('M','F','O')),
  CONSTRAINT chk_cust_phone  CHECK (phone REGEXP '^[0-9]{10,15}$')
) ENGINE=InnoDB;

CREATE TABLE accounts (
  account_no    BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_id   INT           NOT NULL,
  branch_id     INT           NOT NULL,
  account_type  ENUM('SAVINGS','CURRENT') NOT NULL DEFAULT 'SAVINGS',
  balance       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  status        ENUM('ACTIVE','CLOSED','FROZEN') NOT NULL DEFAULT 'ACTIVE',
  opened_on     DATE          NOT NULL DEFAULT (CURRENT_DATE),
  CONSTRAINT chk_acc_balance CHECK (balance >= 0),
  CONSTRAINT fk_acc_customer FOREIGN KEY (customer_id)
    REFERENCES customers(customer_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_acc_branch FOREIGN KEY (branch_id)
    REFERENCES branches(branch_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=1000100001;

CREATE TABLE transactions (
  txn_id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  account_no          BIGINT        NOT NULL,
  txn_type            ENUM('DEPOSIT','WITHDRAWAL','TRANSFER_OUT','TRANSFER_IN') NOT NULL,
  amount              DECIMAL(15,2) NOT NULL,
  balance_after       DECIMAL(15,2) NOT NULL,
  txn_time            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  related_account_no  BIGINT        NULL,
  remarks             VARCHAR(100)  NULL,
  CONSTRAINT chk_txn_amount CHECK (amount > 0),
  CONSTRAINT fk_txn_account FOREIGN KEY (account_no)
    REFERENCES accounts(account_no)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_txn_related FOREIGN KEY (related_account_no)
    REFERENCES accounts(account_no)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_txn_account_time ON transactions (account_no, txn_time);
CREATE INDEX idx_acc_customer     ON accounts (customer_id);

-- ---------------------------------------------------------------------------
-- A1.3  Sample data
-- ---------------------------------------------------------------------------
INSERT INTO branches (branch_name, ifsc_code, city, phone) VALUES
 ('Coimbatore Main', 'SAMP0000001', 'Coimbatore', '0422000001'),
 ('Arasur Branch',   'SAMP0000002', 'Coimbatore', '0422000002');

INSERT INTO employees (branch_id, emp_name, designation, email, hire_date) VALUES
 (1, 'Sample Employee One', 'Manager',    'emp1@example.com', '2020-06-01'),
 (2, 'Sample Employee Two', 'Bank Clerk', 'emp2@example.com', '2022-01-10');

INSERT INTO customers
 (first_name, last_name, date_of_birth, gender, phone, email, id_proof_no, address) VALUES
 ('Asha',  'Kumar',  '1998-04-12', 'F', '9000000001', 'asha@example.com',  'ID-0001', 'Sample Address 1, Coimbatore'),
 ('Ravi',  'Shankar','1995-09-30', 'M', '9000000002', 'ravi@example.com',  'ID-0002', 'Sample Address 2, Coimbatore'),
 ('Meena', 'Devi',   '2000-01-25', 'F', '9000000003', 'meena@example.com', 'ID-0003', 'Sample Address 3, Arasur'),
 ('Karthik','Raj',   '1992-11-05', 'M', '9000000004', 'karthik@example.com','ID-0004', 'Sample Address 4, Arasur');

-- Account numbers start at 1000100001 (AUTO_INCREMENT)
INSERT INTO accounts (customer_id, branch_id, account_type) VALUES
 (1, 1, 'SAVINGS'),   -- 1000100001
 (2, 1, 'SAVINGS'),   -- 1000100002
 (3, 2, 'SAVINGS'),   -- 1000100003
 (4, 2, 'CURRENT'),   -- 1000100004
 (1, 2, 'CURRENT');   -- 1000100005 (second account of customer 1)

-- ---------------------------------------------------------------------------
-- A1.4  Function, stored procedures and trigger
-- ---------------------------------------------------------------------------
DELIMITER $$

-- Function: balance enquiry (returns NULL if the account does not exist)
CREATE FUNCTION fn_get_balance(p_account BIGINT)
RETURNS DECIMAL(15,2)
READS SQL DATA
BEGIN
  DECLARE v_bal DECIMAL(15,2);
  SELECT balance INTO v_bal FROM accounts WHERE account_no = p_account;
  RETURN v_bal;
END$$

-- Procedure: deposit
CREATE PROCEDURE sp_deposit(IN p_account BIGINT, IN p_amount DECIMAL(15,2),
                            OUT p_status VARCHAR(100))
BEGIN
  DECLARE v_bal DECIMAL(15,2);
  DECLARE v_state VARCHAR(10) DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET p_status = 'ERROR: Deposit failed';
  END;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    SET p_status = 'ERROR: Amount must be greater than zero';
  ELSE
    START TRANSACTION;
    SELECT balance, status INTO v_bal, v_state
      FROM accounts WHERE account_no = p_account FOR UPDATE;
    IF v_state IS NULL THEN
      ROLLBACK;
      SET p_status = 'ERROR: Invalid account number';
    ELSEIF v_state <> 'ACTIVE' THEN
      ROLLBACK;
      SET p_status = 'ERROR: Account is not active';
    ELSE
      UPDATE accounts SET balance = balance + p_amount WHERE account_no = p_account;
      INSERT INTO transactions (account_no, txn_type, amount, balance_after, remarks)
        VALUES (p_account, 'DEPOSIT', p_amount, v_bal + p_amount, 'Cash deposit');
      COMMIT;
      SET p_status = 'SUCCESS: Deposit completed';
    END IF;
  END IF;
END$$

-- Procedure: withdrawal
CREATE PROCEDURE sp_withdraw(IN p_account BIGINT, IN p_amount DECIMAL(15,2),
                             OUT p_status VARCHAR(100))
BEGIN
  DECLARE v_bal DECIMAL(15,2);
  DECLARE v_state VARCHAR(10) DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET p_status = 'ERROR: Withdrawal failed';
  END;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    SET p_status = 'ERROR: Amount must be greater than zero';
  ELSE
    START TRANSACTION;
    SELECT balance, status INTO v_bal, v_state
      FROM accounts WHERE account_no = p_account FOR UPDATE;
    IF v_state IS NULL THEN
      ROLLBACK;
      SET p_status = 'ERROR: Invalid account number';
    ELSEIF v_state <> 'ACTIVE' THEN
      ROLLBACK;
      SET p_status = 'ERROR: Account is not active';
    ELSEIF v_bal < p_amount THEN
      ROLLBACK;
      SET p_status = 'ERROR: Insufficient balance';
    ELSE
      UPDATE accounts SET balance = balance - p_amount WHERE account_no = p_account;
      INSERT INTO transactions (account_no, txn_type, amount, balance_after, remarks)
        VALUES (p_account, 'WITHDRAWAL', p_amount, v_bal - p_amount, 'Cash withdrawal');
      COMMIT;
      SET p_status = 'SUCCESS: Withdrawal completed';
    END IF;
  END IF;
END$$

-- Procedure: fund transfer (atomic; rows locked in ascending account order)
CREATE PROCEDURE sp_transfer(IN p_from BIGINT, IN p_to BIGINT,
                             IN p_amount DECIMAL(15,2), OUT p_status VARCHAR(100))
BEGIN
  DECLARE v_fb DECIMAL(15,2);
  DECLARE v_tb DECIMAL(15,2);
  DECLARE v_fs VARCHAR(10) DEFAULT NULL;
  DECLARE v_ts VARCHAR(10) DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET p_status = 'ERROR: Transfer failed and was rolled back';
  END;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    SET p_status = 'ERROR: Amount must be greater than zero';
  ELSEIF p_from = p_to THEN
    SET p_status = 'ERROR: Source and destination accounts are the same';
  ELSE
    START TRANSACTION;
    IF p_from < p_to THEN
      SELECT balance, status INTO v_fb, v_fs FROM accounts WHERE account_no = p_from FOR UPDATE;
      SELECT balance, status INTO v_tb, v_ts FROM accounts WHERE account_no = p_to   FOR UPDATE;
    ELSE
      SELECT balance, status INTO v_tb, v_ts FROM accounts WHERE account_no = p_to   FOR UPDATE;
      SELECT balance, status INTO v_fb, v_fs FROM accounts WHERE account_no = p_from FOR UPDATE;
    END IF;

    IF v_fs IS NULL OR v_ts IS NULL THEN
      ROLLBACK;
      SET p_status = 'ERROR: Invalid account number';
    ELSEIF v_fs <> 'ACTIVE' OR v_ts <> 'ACTIVE' THEN
      ROLLBACK;
      SET p_status = 'ERROR: Both accounts must be active';
    ELSEIF v_fb < p_amount THEN
      ROLLBACK;
      SET p_status = 'ERROR: Insufficient balance';
    ELSE
      UPDATE accounts SET balance = balance - p_amount WHERE account_no = p_from;
      UPDATE accounts SET balance = balance + p_amount WHERE account_no = p_to;
      INSERT INTO transactions
        (account_no, txn_type, amount, balance_after, related_account_no, remarks)
        VALUES (p_from, 'TRANSFER_OUT', p_amount, v_fb - p_amount, p_to, 'Fund transfer');
      INSERT INTO transactions
        (account_no, txn_type, amount, balance_after, related_account_no, remarks)
        VALUES (p_to, 'TRANSFER_IN', p_amount, v_tb + p_amount, p_from, 'Fund transfer');
      COMMIT;
      SET p_status = 'SUCCESS: Transfer completed';
    END IF;
  END IF;
END$$

-- Procedure with cursor: credit interest to active savings accounts
CREATE PROCEDURE sp_apply_interest(IN p_rate_percent DECIMAL(5,2))
BEGIN
  DECLARE v_acc  BIGINT;
  DECLARE v_bal  DECIMAL(15,2);
  DECLARE v_int  DECIMAL(15,2);
  DECLARE v_done INT DEFAULT 0;
  DECLARE cur CURSOR FOR
    SELECT account_no, balance FROM accounts
    WHERE account_type = 'SAVINGS' AND status = 'ACTIVE';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;
  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_acc, v_bal;
    IF v_done = 1 THEN LEAVE read_loop; END IF;
    SET v_int = ROUND(v_bal * p_rate_percent / 100, 2);
    IF v_int > 0 THEN
      UPDATE accounts SET balance = balance + v_int WHERE account_no = v_acc;
      INSERT INTO transactions (account_no, txn_type, amount, balance_after, remarks)
        VALUES (v_acc, 'DEPOSIT', v_int, v_bal + v_int, 'Interest credit');
    END IF;
  END LOOP;
  CLOSE cur;
  COMMIT;
END$$

-- Trigger: an account holding a balance cannot be deleted
CREATE TRIGGER trg_accounts_before_delete
BEFORE DELETE ON accounts
FOR EACH ROW
BEGIN
  IF OLD.balance > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot delete an account with a non-zero balance';
  END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- A1.5  Views
-- ---------------------------------------------------------------------------
CREATE VIEW vw_account_summary AS
SELECT a.account_no, CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
       a.account_type, a.balance, a.status, b.branch_name
FROM accounts a
JOIN customers c ON c.customer_id = a.customer_id
JOIN branches  b ON b.branch_id   = a.branch_id;

CREATE VIEW vw_transaction_history AS
SELECT t.txn_id, t.account_no, t.txn_type, t.amount, t.balance_after,
       t.related_account_no, t.txn_time, t.remarks
FROM transactions t;

-- ---------------------------------------------------------------------------
-- A1.6  Banking operations (deposit, withdrawal, transfer)
-- ---------------------------------------------------------------------------
CALL sp_deposit (1000100001, 50000.00, @msg); SELECT @msg;
CALL sp_deposit (1000100002, 30000.00, @msg); SELECT @msg;
CALL sp_deposit (1000100003, 20000.00, @msg); SELECT @msg;
CALL sp_deposit (1000100004, 75000.00, @msg); SELECT @msg;
CALL sp_withdraw(1000100001, 10000.00, @msg); SELECT @msg;
CALL sp_transfer(1000100001, 1000100002, 5000.00, @msg); SELECT @msg;

-- Negative cases
CALL sp_withdraw(1000100003, 99999.00, @msg); SELECT @msg;  -- insufficient balance
CALL sp_deposit (1999999999, 1000.00,  @msg); SELECT @msg;  -- invalid account

-- ---------------------------------------------------------------------------
-- A1.7  Queries
-- ---------------------------------------------------------------------------
-- Balance enquiry
SELECT fn_get_balance(1000100001) AS current_balance;
SELECT account_no, account_type, balance, status
FROM accounts WHERE account_no = 1000100001;

-- Duplicate customer check before registration
SELECT customer_id, first_name, last_name FROM customers
WHERE phone = '9000000001' OR email = 'asha@example.com' OR id_proof_no = 'ID-0001';

-- Transaction history of one account (latest first) with JOIN
SELECT t.txn_id, t.txn_time, t.txn_type, t.amount, t.balance_after,
       t.related_account_no, CONCAT(c.first_name, ' ', c.last_name) AS holder
FROM transactions t
JOIN accounts  a ON a.account_no  = t.account_no
JOIN customers c ON c.customer_id = a.customer_id
WHERE t.account_no = 1000100001
ORDER BY t.txn_time DESC, t.txn_id DESC;

-- Mini statement: last five transactions
SELECT txn_id, txn_time, txn_type, amount, balance_after
FROM transactions WHERE account_no = 1000100001
ORDER BY txn_id DESC LIMIT 5;

-- Transactions in a date range
SELECT * FROM transactions
WHERE account_no = 1000100001
  AND txn_time BETWEEN '2026-01-01 00:00:00' AND '2026-12-31 23:59:59';

-- Customers with their accounts (LEFT JOIN keeps customers without accounts)
SELECT c.customer_id, c.first_name, a.account_no, a.account_type, a.balance
FROM customers c LEFT JOIN accounts a ON a.customer_id = c.customer_id
ORDER BY c.customer_id, a.account_no;

-- Aggregates: count and total by transaction type
SELECT txn_type, COUNT(*) AS no_of_txns, SUM(amount) AS total_amount, AVG(amount) AS avg_amount
FROM transactions GROUP BY txn_type ORDER BY total_amount DESC;

-- Branch-wise totals (GROUP BY with HAVING)
SELECT b.branch_name, COUNT(a.account_no) AS accounts,
       SUM(a.balance) AS total_balance, AVG(a.balance) AS avg_balance
FROM branches b JOIN accounts a ON a.branch_id = b.branch_id
GROUP BY b.branch_id, b.branch_name
HAVING SUM(a.balance) > 0
ORDER BY total_balance DESC;

-- Highest and lowest balances
SELECT MAX(balance) AS highest_balance, MIN(balance) AS lowest_balance FROM accounts;

-- Pattern search (LIKE) and IN
SELECT * FROM customers WHERE first_name LIKE 'A%';
SELECT * FROM accounts  WHERE account_type IN ('SAVINGS') AND balance BETWEEN 10000 AND 100000;

-- Set operation: customers who hold both a SAVINGS and a CURRENT account
SELECT customer_id FROM accounts WHERE account_type = 'SAVINGS'
INTERSECT
SELECT customer_id FROM accounts WHERE account_type = 'CURRENT';   -- MySQL 8.0.31+

-- ---------------------------------------------------------------------------
-- A1.8  Update and delete statements
-- ---------------------------------------------------------------------------
UPDATE customers SET phone = '9000000011', address = 'New Sample Address, Coimbatore'
WHERE customer_id = 2;

UPDATE accounts SET status = 'FROZEN' WHERE account_no = 1000100003;
UPDATE accounts SET status = 'ACTIVE' WHERE account_no = 1000100003;

UPDATE accounts SET status = 'CLOSED' WHERE account_no = 1000100005 AND balance = 0;

INSERT INTO customers (first_name,last_name,date_of_birth,gender,phone,email,id_proof_no,address)
VALUES ('Temp','User','1999-01-01','O','9000000099','temp@example.com','ID-9999','Temp address');
DELETE FROM customers WHERE email = 'temp@example.com';

-- ---------------------------------------------------------------------------
-- A1.9  Access control (DCL)
-- ---------------------------------------------------------------------------
CREATE USER 'bank_teller'@'localhost' IDENTIFIED BY '<set-a-strong-password>';
GRANT SELECT ON banking_db.customers TO 'bank_teller'@'localhost';
GRANT SELECT ON banking_db.accounts  TO 'bank_teller'@'localhost';
GRANT SELECT ON banking_db.transactions TO 'bank_teller'@'localhost';
GRANT EXECUTE ON PROCEDURE banking_db.sp_deposit  TO 'bank_teller'@'localhost';
GRANT EXECUTE ON PROCEDURE banking_db.sp_withdraw TO 'bank_teller'@'localhost';
GRANT EXECUTE ON PROCEDURE banking_db.sp_transfer TO 'bank_teller'@'localhost';
GRANT EXECUTE ON FUNCTION  banking_db.fn_get_balance TO 'bank_teller'@'localhost';

-- ---------------------------------------------------------------------------
-- A1.10  Interest credit (cursor) - optional run
-- ---------------------------------------------------------------------------
CALL sp_apply_interest(4.00);   -- credits 4% to every ACTIVE savings account

-- ---------------------------------------------------------------------------
-- A1.11  Query optimisation demo
-- ---------------------------------------------------------------------------
EXPLAIN SELECT * FROM transactions
WHERE account_no = 1000100001 ORDER BY txn_time DESC;
