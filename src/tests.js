'use strict';
/**
 * Test-case runner for Appendix II (Table 12, TC01 - TC16).
 *
 * Every test runs against its own freshly seeded database, so the suite can be
 * re-run at any time without disturbing the demo data of the running site.
 */

const DB = require('./database');

const money = (n) => (n === null || n === undefined ? String(n) : Number(n).toFixed(2));

function freshDatabase() {
  const db = DB.openDatabase(':memory:');
  // Sample data only: the test cases drive every banking operation themselves.
  DB.initialiseDatabase(db, { openingOperations: false });
  return db;
}

function runAllTestCases() {
  const db = freshDatabase();
  const results = [];

  const record = (id, scenario, input, expected, actual, pass, sql) =>
    results.push({ id, scenario, input, expected, actual, status: pass ? 'PASS' : 'FAIL', sql });

  // TC01 -------------------------------------------------------------------
  {
    const res = DB.registerCustomer(db, {
      first_name: 'Divya',
      last_name: 'Menon',
      date_of_birth: '1999-02-14',
      gender: 'F',
      phone: '9000000021',
      email: 'divya@example.com',
      id_proof_no: 'ID-0021',
      address: 'Sample Address 21, Coimbatore',
    });
    record(
      'TC01',
      'Valid customer registration',
      'Divya Menon, phone 9000000021 (all values unique)',
      'Row inserted, customer_id 5 generated',
      res.ok ? `Row inserted, customer_id ${res.customer_id}` : res.message,
      res.ok && res.customer_id === 5,
      `INSERT INTO customers (first_name,last_name,date_of_birth,gender,phone,email,id_proof_no,address)\nVALUES ('Divya','Menon','1999-02-14','F','9000000021','divya@example.com','ID-0021','Sample Address 21');`
    );
  }

  // TC02 -------------------------------------------------------------------
  {
    const res = DB.registerCustomer(db, {
      first_name: 'Dup',
      last_name: 'Test',
      date_of_birth: '1990-01-01',
      gender: 'M',
      phone: '9000000001',
      email: 'dup@example.com',
      id_proof_no: 'ID-7777',
      address: 'Sample',
    });
    record(
      'TC02',
      'Duplicate customer (phone)',
      "New customer using phone 9000000001",
      "ERROR 1062 duplicate entry for key 'phone'; no row inserted",
      res.message,
      !res.ok && res.field === 'phone',
      `INSERT INTO customers (...) VALUES ('Dup','Test',...,'9000000001',...);`
    );
  }

  // TC03 -------------------------------------------------------------------
  {
    const res = DB.registerCustomer(db, {
      first_name: 'Dup2',
      last_name: 'Test',
      date_of_birth: '1990-01-01',
      gender: 'F',
      phone: '9000000077',
      email: 'asha@example.com',
      id_proof_no: 'ID-7778',
      address: 'Sample',
    });
    record(
      'TC03',
      'Duplicate customer (e-mail)',
      'New customer using asha@example.com',
      "ERROR 1062 duplicate entry for key 'email'; no row inserted",
      res.message,
      !res.ok && res.field === 'email',
      `INSERT INTO customers (...) VALUES (...,'asha@example.com',...);`
    );
  }

  // TC04 -------------------------------------------------------------------
  {
    const res = DB.openAccount(db, 1, 1, 'SAVINGS');
    const acc = res.account;
    record(
      'TC04',
      'Account creation',
      'customer_id 1, branch_id 1, SAVINGS',
      'Account created with the next account_no, balance 0.00, status ACTIVE',
      res.ok
        ? `account_no ${acc.account_no}, balance ${money(acc.balance)}, status ${acc.status}`
        : res.message,
      res.ok && acc.account_no === 1000100006 && acc.balance === 0 && acc.status === 'ACTIVE',
      `INSERT INTO accounts (customer_id, branch_id, account_type) VALUES (1, 1, 'SAVINGS');`
    );
  }

  // TC05 -------------------------------------------------------------------
  {
    const res = DB.deposit(db, 1000100001, 50000);
    const rows = db
      .prepare("SELECT COUNT(*) AS c FROM transactions WHERE account_no = 1000100001 AND txn_type='DEPOSIT'")
      .get().c;
    record(
      'TC05',
      'Successful deposit',
      'sp_deposit(1000100001, 50000.00)',
      "'SUCCESS: Deposit completed'; balance 50000.00; one DEPOSIT row",
      `${res.status}; balance ${money(DB.getBalance(db, 1000100001))}; DEPOSIT rows ${rows}`,
      res.ok && DB.getBalance(db, 1000100001) === 50000 && rows === 1,
      `CALL sp_deposit(1000100001, 50000.00, @msg);`
    );
  }

  // TC06 -------------------------------------------------------------------
  {
    const before = DB.getBalance(db, 1000100001);
    const res = DB.deposit(db, 1000100001, -500);
    const after = DB.getBalance(db, 1000100001);
    record(
      'TC06',
      'Deposit of invalid amount',
      'sp_deposit(1000100001, -500)',
      "'ERROR: Amount must be greater than zero'; balance unchanged",
      `${res.status}; balance ${money(before)} -> ${money(after)}`,
      !res.ok && res.status === 'ERROR: Amount must be greater than zero' && before === after,
      `CALL sp_deposit(1000100001, -500, @msg);`
    );
  }

  // TC07 -------------------------------------------------------------------
  {
    const res = DB.withdraw(db, 1000100001, 10000);
    record(
      'TC07',
      'Successful withdrawal',
      'sp_withdraw(1000100001, 10000.00) after TC05',
      "'SUCCESS: Withdrawal completed'; balance 40000.00",
      `${res.status}; balance ${money(DB.getBalance(db, 1000100001))}`,
      res.ok && DB.getBalance(db, 1000100001) === 40000,
      `CALL sp_withdraw(1000100001, 10000.00, @msg);`
    );
  }

  // TC08 -------------------------------------------------------------------
  {
    DB.deposit(db, 1000100003, 20000); // bring the account to the state used by the report
    const before = DB.getBalance(db, 1000100003);
    const res = DB.withdraw(db, 1000100003, 99999);
    const after = DB.getBalance(db, 1000100003);
    const rows = db
      .prepare('SELECT COUNT(*) AS c FROM transactions WHERE account_no = 1000100003 AND amount = 99999')
      .get().c;
    record(
      'TC08',
      'Insufficient balance during withdrawal',
      'sp_withdraw(1000100003, 99999.00) with balance 20000.00',
      "'ERROR: Insufficient balance'; balance unchanged; no transaction row",
      `${res.status}; balance ${money(before)} -> ${money(after)}; matching rows ${rows}`,
      !res.ok && res.status === 'ERROR: Insufficient balance' && before === after && rows === 0,
      `CALL sp_withdraw(1000100003, 99999.00, @msg);`
    );
  }

  // TC09 -------------------------------------------------------------------
  {
    const before = [DB.getBalance(db, 1000100001), DB.getBalance(db, 1000100002)];
    const res = DB.transfer(db, 1000100001, 1000100002, 5000);
    const after = [DB.getBalance(db, 1000100001), DB.getBalance(db, 1000100002)];
    const rows = db
      .prepare(
        `SELECT COUNT(*) AS c FROM transactions
         WHERE amount = 5000 AND txn_type IN ('TRANSFER_OUT','TRANSFER_IN')`
      )
      .get().c;
    record(
      'TC09',
      'Successful fund transfer',
      'sp_transfer(1000100001, 1000100002, 5000.00)',
      "'SUCCESS: Transfer completed'; source -5000, destination +5000; two log rows",
      `${res.status}; source ${money(before[0])} -> ${money(after[0])}; destination ${money(before[1])} -> ${money(after[1])}; log rows ${rows}`,
      res.ok && after[0] === before[0] - 5000 && after[1] === before[1] + 5000 && rows === 2,
      `CALL sp_transfer(1000100001, 1000100002, 5000.00, @msg);`
    );
  }

  // TC10 -------------------------------------------------------------------
  {
    const before = [DB.getBalance(db, 1000100003), DB.getBalance(db, 1000100004)];
    const res = DB.transfer(db, 1000100003, 1000100004, 99999);
    const after = [DB.getBalance(db, 1000100003), DB.getBalance(db, 1000100004)];
    const rows = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE amount = 99999').get().c;
    record(
      'TC10',
      'Transfer with insufficient funds',
      'sp_transfer(1000100003, 1000100004, 99999.00)',
      "'ERROR: Insufficient balance'; both balances unchanged",
      `${res.status}; ${money(before[0])}/${money(before[1])} -> ${money(after[0])}/${money(after[1])}; matching rows ${rows}`,
      !res.ok && before[0] === after[0] && before[1] === after[1] && rows === 0,
      `CALL sp_transfer(1000100003, 1000100004, 99999.00, @msg);`
    );
  }

  // TC11 -------------------------------------------------------------------
  {
    const res = DB.transfer(db, 1000100001, 1000100001, 100);
    record(
      'TC11',
      'Transfer to the same account',
      'sp_transfer(1000100001, 1000100001, 100.00)',
      "'ERROR: Source and destination accounts are the same'",
      res.status,
      !res.ok && res.status === 'ERROR: Source and destination accounts are the same',
      `CALL sp_transfer(1000100001, 1000100001, 100.00, @msg);`
    );
  }

  // TC12 -------------------------------------------------------------------
  {
    const res = DB.deposit(db, 1999999999, 1000);
    record(
      'TC12',
      'Invalid account number',
      'sp_deposit(1999999999, 1000.00)',
      "'ERROR: Invalid account number'",
      res.status,
      !res.ok && res.status === 'ERROR: Invalid account number',
      `CALL sp_deposit(1999999999, 1000.00, @msg);`
    );
  }

  // TC13 -------------------------------------------------------------------
  {
    const rows = DB.transactionHistory(db, 1000100001);
    const first = rows[0];
    record(
      'TC13',
      'Transaction history retrieval',
      'History query for account 1000100001',
      'Transactions listed latest first with balance_after',
      rows.length
        ? `${rows.length} rows; latest is ${first.txn_type} of ${money(first.amount)} (balance_after ${money(first.balance_after)})`
        : 'no rows',
      rows.length === 3 && first.txn_type === 'TRANSFER_OUT',
      `SELECT * FROM transactions WHERE account_no = 1000100001 ORDER BY txn_time DESC, txn_id DESC;`
    );
  }

  // TC14 -------------------------------------------------------------------
  {
    const balance = db.prepare('SELECT fn_get_balance(?) AS b').get(1000100001).b;
    const missing = db.prepare('SELECT fn_get_balance(?) AS b').get(9999999999).b;
    record(
      'TC14',
      'Balance enquiry',
      'fn_get_balance(1000100001)',
      'Current balance returned (NULL for an unknown account)',
      `balance ${money(balance)}; unknown account returns ${missing === null ? 'NULL' : missing}`,
      balance === 35000 && missing === null,
      `SELECT fn_get_balance(1000100001);`
    );
  }

  // TC15 -------------------------------------------------------------------
  {
    DB.setAccountStatus(db, 1000100003, 'FROZEN');
    const res = DB.deposit(db, 1000100003, 100);
    DB.setAccountStatus(db, 1000100003, 'ACTIVE');
    record(
      'TC15',
      'Deposit to a frozen account',
      'Freeze 1000100003, then sp_deposit(1000100003, 100)',
      "'ERROR: Account is not active'",
      res.status,
      !res.ok && res.status === 'ERROR: Account is not active',
      `UPDATE accounts SET status='FROZEN' WHERE account_no=1000100003;\nCALL sp_deposit(1000100003, 100.00, @msg);`
    );
  }

  // TC16 -------------------------------------------------------------------
  {
    DB.deposit(db, 1000100004, 75000); // give the account a balance, as in A1.6
    const res = DB.deleteAccount(db, 1000100004);
    record(
      'TC16',
      'Delete account holding a balance',
      'DELETE FROM accounts WHERE account_no = 1000100004 (balance 75000.00)',
      'Trigger error: cannot delete an account with a non-zero balance',
      res.message,
      !res.ok && /non-zero balance/.test(res.message),
      `DELETE FROM accounts WHERE account_no = 1000100004;`
    );
  }

  db.close();

  const passed = results.filter((r) => r.status === 'PASS').length;
  return { results, summary: { total: results.length, passed, failed: results.length - passed } };
}

module.exports = { runAllTestCases };

// Command-line mode: `npm run tests`
if (require.main === module) {
  const { results, summary } = runAllTestCases();
  for (const r of results) {
    console.log(`${r.status === 'PASS' ? '[PASS]' : '[FAIL]'} ${r.id}  ${r.scenario}`);
    console.log(`       expected: ${r.expected}`);
    console.log(`       actual  : ${r.actual}`);
  }
  console.log(`\n${summary.passed}/${summary.total} test cases passed.`);
}
