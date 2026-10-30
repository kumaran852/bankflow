/* Banking Management System - prototype front end */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  customers: [],
  accounts: [],
  branches: [],
  reports: [],
  scripts: {},
  activeReport: null,
  activeScript: 'mysql',
  mongoCollection: 'kyc_documents',
  search: null,
  logs: [],
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const moneyFormat = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (n) => (n === null || n === undefined ? '&mdash;' : moneyFormat.format(Number(n)));

const esc = (value) =>
  String(value === null || value === undefined ? '' : value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.style.background = kind === 'err' ? '#b3261e' : kind === 'ok' ? '#157a4b' : '#101828';
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 3600);
}

/**
 * columns: [{ key, label, className, render(row) }]
 */
function buildTable(container, columns, rows, emptyText = 'No rows.') {
  if (!rows || !rows.length) {
    container.innerHTML = `<div class="empty">${esc(emptyText)}</div>`;
    return;
  }
  const head = columns.map((c) => `<th class="${c.className || ''}">${esc(c.label)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => {
            const html = c.render ? c.render(row) : esc(row[c.key]);
            return `<td class="${c.className || ''}">${html}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');
  container.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------
const TITLES = {
  dashboard: ['Dashboard', 'Integrated view of the banking database'],
  customers: ['Customers', 'Registration with duplicate detection and contact updates'],
  accounts: ['Accounts', 'Opening, status control and delete protection'],
  operations: ['Banking Operations', 'Deposit, withdrawal, transfer and balance enquiry'],
  history: ['Statements', 'Transaction history, mini statement and date ranges'],
  reports: ['Queries & Reports', 'Clauses, aggregates, joins, views and query optimisation'],
  design: ['Database Design', 'Schema, keys, normalization and access control'],
  tests: ['Test Cases', 'Appendix II - normal, invalid and edge inputs'],
  sql: ['SQL Source', 'The complete MySQL script and the prototype schema'],
  extras: ['MongoDB & B+ Tree', 'Document CRUD and the index tree simulation'],
};

function show(view) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === `view-${view}`));
  const [title, subtitle] = TITLES[view];
  $('#view-title').textContent = title;
  $('#view-subtitle').textContent = subtitle;
  loaders[view]?.();
}

const loaders = {};

// ---------------------------------------------------------------------------
// form helpers
// ---------------------------------------------------------------------------
const formValues = (form) => Object.fromEntries(new FormData(form).entries());

// ---------------------------------------------------------------------------
// 1. dashboard
// ---------------------------------------------------------------------------
loaders.dashboard = async () => {
  const { data } = await api('/overview');
  const { counts, money: m, netExternalFlow } = data;

  $('#stat-grid').innerHTML = [
    ['Branches', counts.branches, 'branches'],
    ['Employees', counts.employees, 'employees'],
    ['Customers', counts.customers, 'customers'],
    ['Accounts', counts.accounts, 'savings + current'],
    ['Transactions', counts.transactions, 'audit log rows'],
    ['Total balance', money(m.total_balance), 'across all accounts', true],
    ['Average balance', money(m.avg_balance), 'per account'],
    ['Highest / lowest', `${money(m.max_balance)} / ${money(m.min_balance)}`, 'MAX / MIN'],
  ]
    .map(
      ([label, value, foot, accent]) => `
      <div class="stat${accent ? ' accent' : ''}">
        <div class="label">${esc(label)}</div>
        <div class="value">${value}</div>
        <div class="foot">${esc(foot)}</div>
      </div>`
    )
    .join('');

  const balanced = Number(m.total_balance) === Number(netExternalFlow);
  $('#consistency').innerHTML = `
    <div class="result ${balanced ? 'ok' : 'err'}">
      <div><div class="hint">Sum of account balances</div><div class="value">${money(m.total_balance)}</div></div>
      <div><div class="hint">Deposits minus withdrawals</div><div class="value">${money(netExternalFlow)}</div></div>
      <div>${balanced ? badge('Balanced', 'ok') : badge('Mismatch', 'err')}</div>
    </div>
    <div class="query-note">SELECT (SELECT IFNULL(SUM(balance),0) FROM accounts) AS total_balances,
       (SELECT IFNULL(SUM(CASE WHEN txn_type = 'DEPOSIT' THEN amount
                               WHEN txn_type = 'WITHDRAWAL' THEN -amount ELSE 0 END),0)
        FROM transactions) AS net_external_flow</div>`;

  const { data: accounts } = await api('/accounts');
  buildTable($('#dashboard-accounts'), accountColumns(false), accounts);
};

// ---------------------------------------------------------------------------
// 2. customers
// ---------------------------------------------------------------------------
loaders.customers = async () => {
  const { data } = await api('/customers');
  state.customers = data;
  $('#customers-count').textContent = `${data.length} registered`;
  buildTable($('#customers-table'), [
    { key: 'customer_id', label: 'ID', className: 'num' },
    { key: 'first_name', label: 'First name' },
    { key: 'last_name', label: 'Last name' },
    { key: 'date_of_birth', label: 'Date of birth' },
    { key: 'gender', label: 'Gender' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'E-mail' },
    { key: 'id_proof_no', label: 'ID proof' },
    { key: 'address', label: 'Address' },
    { key: 'account_count', label: 'Accounts', className: 'num' },
    { key: 'created_at', label: 'Registered at' },
  ], data);
};

$('#customer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formValues(e.target);
  const { data } = await api('/customers', { method: 'POST', body });
  if (data.ok) {
    toast(`Customer registered with customer_id ${data.customer_id}.`, 'ok');
    addLog('ok', 'Customer registration', `SUCCESS: customer_id ${data.customer_id} generated`,
      `INSERT INTO customers (first_name,last_name,date_of_birth,gender,phone,email,id_proof_no,address)\nVALUES ('${body.first_name}','${body.last_name}','${body.date_of_birth}','${body.gender}','${body.phone}','${body.email}','${body.id_proof_no}','${body.address}');`);
    loaders.customers();
  } else {
    toast(data.message, 'err');
    addLog('err', 'Customer registration', data.message,
      `INSERT INTO customers (...) VALUES (...,'${body.phone}','${body.email}','${body.id_proof_no}',...);`);
  }
});

$('#customer-reset').addEventListener('click', () => {
  const f = $('#customer-form');
  f.reset();
  f.first_name.value = 'Divya';
  f.last_name.value = 'Menon';
  f.date_of_birth.value = '1999-02-14';
  f.phone.value = '9000000021';
  f.email.value = 'divya@example.com';
  f.id_proof_no.value = 'ID-0021';
  f.address.value = 'Sample Address 21, Coimbatore';
});

$('#customer-update-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formValues(e.target);
  const { data } = await api(`/customers/${body.customer_id}`, { method: 'PUT', body });
  toast(data.ok ? 'Customer updated.' : data.message, data.ok ? 'ok' : 'err');
  loaders.customers();
});

$('#duplicate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = formValues(e.target);
  const qs = new URLSearchParams({
    phone: v.phone || '',
    email: v.email || '',
    id_proof_no: v.id_proof_no || '',
  });
  const { data } = await api(`/customers/duplicate-check?${qs}`);
  toast(
    data.duplicate
      ? `Duplicate found - matches customer_id ${data.customer.customer_id} (${data.customer.first_name} ${data.customer.last_name}).`
      : 'No duplicate customer. Registration may proceed.',
    data.duplicate ? 'err' : 'ok'
  );
});

// ---------------------------------------------------------------------------
// 3. accounts
// ---------------------------------------------------------------------------
function accountColumns(withActions) {
  const columns = [
    { key: 'account_no', label: 'Account no.', className: 'num' },
    { key: 'customer_name', label: 'Holder' },
    { key: 'account_type', label: 'Type' },
    { key: 'branch_name', label: 'Branch' },
    {
      key: 'balance',
      label: 'Balance',
      className: 'num',
      render: (r) => money(r.balance),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        badge(r.status, r.status === 'ACTIVE' ? 'ok' : r.status === 'FROZEN' ? 'warn' : ''),
    },
    { key: 'opened_on', label: 'Opened on' },
  ];
  if (withActions) {
    columns.push({
      key: 'actions',
      label: 'Actions',
      render: (r) => `
        <button class="btn tiny" data-status="FROZEN" data-account="${r.account_no}">Freeze</button>
        <button class="btn tiny" data-status="ACTIVE" data-account="${r.account_no}">Activate</button>
        <button class="btn tiny" data-status="CLOSED" data-account="${r.account_no}">Close</button>
        <button class="btn tiny danger" data-delete="${r.account_no}">Delete</button>`,
    });
  }
  return columns;
}

loaders.accounts = async () => {
  const [{ data: accounts }, { data: customers }, { data: branches }] = await Promise.all([
    api('/accounts'),
    api('/customers'),
    api('/branches'),
  ]);
  state.accounts = accounts;
  state.branches = branches;

  $('#account-customer').innerHTML = customers
    .map((c) => `<option value="${c.customer_id}">${esc(`${c.customer_id} - ${c.first_name} ${c.last_name}`)}</option>`)
    .join('');
  $('#account-branch').innerHTML = branches
    .map((b) => `<option value="${b.branch_id}">${esc(`${b.branch_id} - ${b.branch_name}`)}</option>`)
    .join('');

  buildTable($('#accounts-table'), accountColumns(true), accounts);

  $('#accounts-table')
    .querySelectorAll('[data-status]')
    .forEach((btn) =>
      btn.addEventListener('click', async () => {
        const accountNo = btn.dataset.account;
        const status = btn.dataset.status;
        const { data } = await api(`/accounts/${accountNo}/status`, { method: 'PATCH', body: { status } });
        toast(data.ok ? `Account ${accountNo} set to ${status}.` : data.message, data.ok ? 'ok' : 'err');
        addLog(data.ok ? 'ok' : 'err', `Account status -> ${status}`, data.ok ? `SUCCESS: status is now ${status}` : data.message,
          `UPDATE accounts SET status = '${status}' WHERE account_no = ${accountNo};`);
        loaders.accounts();
      })
    );

  $('#accounts-table')
    .querySelectorAll('[data-delete]')
    .forEach((btn) =>
      btn.addEventListener('click', async () => {
        const accountNo = btn.dataset.delete;
        const { data } = await api(`/accounts/${accountNo}`, { method: 'DELETE' });
        toast(data.ok ? `Account ${accountNo} deleted.` : data.message, data.ok ? 'ok' : 'err');
        addLog(data.ok ? 'ok' : 'err', 'Delete account',
          data.ok ? 'SUCCESS: account removed' : data.message,
          `DELETE FROM accounts WHERE account_no = ${accountNo};`);
        loaders.accounts();
      })
    );
};

$('#account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formValues(e.target);
  const { data } = await api('/accounts', { method: 'POST', body });
  if (data.ok) {
    toast(`Account ${data.account.account_no} opened (balance 0.00, ACTIVE).`, 'ok');
    addLog('ok', 'Account opening', `SUCCESS: account_no ${data.account.account_no} created`,
      `INSERT INTO accounts (customer_id, branch_id, account_type)\nVALUES (${body.customer_id}, ${body.branch_id}, '${body.account_type}');`);
  } else {
    toast(data.message, 'err');
  }
  loaders.accounts();
});

// ---------------------------------------------------------------------------
// 4. operations
// ---------------------------------------------------------------------------
function addLog(kind, title, message, sql) {
  state.logs.unshift({
    kind,
    title,
    message,
    sql,
    time: new Date().toLocaleTimeString('en-IN', { hour12: false }),
  });
  state.logs = state.logs.slice(0, 25);
  const container = $('#operation-log');
  if (!container) return;
  container.innerHTML = state.logs
    .map(
      (l) => `
      <div class="log-entry ${l.kind}">
        <div class="head"><strong>${esc(l.title)}</strong><span class="time">${esc(l.time)}</span></div>
        <div>${esc(l.message)}</div>
        ${l.sql ? `<div class="sql">${esc(l.sql)}</div>` : ''}
      </div>`
    )
    .join('');
}

loaders.operations = () => {
  const container = $('#operation-log');
  if (container && !state.logs.length) {
    container.innerHTML = '<div class="empty">No operations yet - run a deposit, withdrawal or transfer.</div>';
  }
};

const operationHandler = (formSel, path, sqlFor) => {
  $(formSel).addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = formValues(e.target);
    const { data } = await api(`/operations/${path}`, { method: 'POST', body });
    const ok = Boolean(data.ok);
    toast(data.status + (data.balance !== undefined ? ` New balance ${moneyFormat.format(data.balance)}.` : ''), ok ? 'ok' : 'err');
    addLog(ok ? 'ok' : 'err', path === 'deposit' ? 'Deposit' : path === 'withdraw' ? 'Withdrawal' : 'Fund transfer',
      data.status + (data.detail ? ` (${data.detail})` : ''), sqlFor(body));
    if (['dashboard', 'accounts'].includes(currentView())) loaders[currentView()]();
  });
};

const currentView = () => document.querySelector('.nav-item.active')?.dataset.view;

operationHandler('#deposit-form', 'deposit',
  (b) => `CALL sp_deposit(${b.account_no}, ${Number(b.amount).toFixed(2)}, @msg);`);
operationHandler('#withdraw-form', 'withdraw',
  (b) => `CALL sp_withdraw(${b.account_no}, ${Number(b.amount).toFixed(2)}, @msg);`);
operationHandler('#transfer-form', 'transfer',
  (b) => `CALL sp_transfer(${b.from}, ${b.to}, ${Number(b.amount).toFixed(2)}, @msg);`);

$('#balance-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { account_no } = formValues(e.target);
  const { data } = await api(`/balance/${account_no}`);
  $('#balance-result').innerHTML = data.found
    ? `<div class="result ok">
         <div><div class="hint">Account</div><div class="value">${esc(data.account_no)}</div></div>
         <div><div class="hint">Holder</div><div class="value" style="font-size:15px">${esc(data.account.customer_name)}</div></div>
         <div><div class="hint">Current balance</div><div class="value">${money(data.balance)}</div></div>
         <div>${badge(data.account.status, data.account.status === 'ACTIVE' ? 'ok' : 'warn')}</div>
       </div>
       <div class="query-note">${esc(data.sql)}</div>`
    : `<div class="result err"><strong>Unknown account number</strong> &mdash; fn_get_balance returns NULL.
       <div class="query-note">${esc(data.sql)}</div></div>`;
});

// ---------------------------------------------------------------------------
// 5. history
// ---------------------------------------------------------------------------
loaders.history = async () => {
  if (!state.accounts.length) state.accounts = (await api('/accounts')).data;
  const select = $('#history-account');
  if (!select.options.length) {
    select.innerHTML = state.accounts
      .map((a) => `<option value="${a.account_no}">${esc(`${a.account_no} - ${a.customer_name}`)}</option>`)
      .join('');
  }
  runHistory();
};

async function runHistory() {
  const form = $('#history-form');
  const v = formValues(form);
  const qs = new URLSearchParams();
  if (v.limit) qs.set('limit', v.limit);
  if (v.from) qs.set('from', `${v.from} 00:00:00`);
  if (v.to) qs.set('to', `${v.to} 23:59:59`);
  const { data } = await api(`/transactions/${v.account_no}?${qs}`);

  $('#history-sql').textContent =
    `SELECT t.txn_id, t.txn_time, t.txn_type, t.amount, t.balance_after, t.related_account_no\n` +
    `FROM transactions t\nJOIN accounts a ON a.account_no = t.account_no\n` +
    `WHERE t.account_no = ${v.account_no}` +
    (v.from ? `\n  AND t.txn_time >= '${v.from} 00:00:00'` : '') +
    (v.to ? `\n  AND t.txn_time <= '${v.to} 23:59:59'` : '') +
    `\nORDER BY t.txn_time DESC, t.txn_id DESC` +
    (v.limit ? `\nLIMIT ${v.limit};` : ';');

  buildTable($('#history-table'), [
    { key: 'txn_id', label: 'Txn id', className: 'num' },
    { key: 'txn_time', label: 'Time' },
    {
      key: 'txn_type',
      label: 'Type',
      render: (r) =>
        badge(r.txn_type, r.txn_type === 'DEPOSIT' ? 'ok' : r.txn_type === 'WITHDRAWAL' ? 'warn' : ''),
    },
    { key: 'amount', label: 'Amount', className: 'num', render: (r) => money(r.amount) },
    { key: 'balance_after', label: 'Balance after', className: 'num', render: (r) => money(r.balance_after) },
    { key: 'related_account_no', label: 'Counterpart account', className: 'num' },
    { key: 'holder', label: 'Holder' },
    { key: 'remarks', label: 'Remarks' },
  ], data, 'No transactions for this account.');
}

$('#history-form').addEventListener('submit', (e) => {
  e.preventDefault();
  runHistory();
});

// ---------------------------------------------------------------------------
// 6. reports
// ---------------------------------------------------------------------------
loaders.reports = async () => {
  const { data } = await api('/reports');
  state.reports = data;
  if (!state.activeReport) state.activeReport = data[0].id;

  $('#report-chips').innerHTML = data
    .map((r) => `<button class="chip${r.id === state.activeReport ? ' active' : ''}" data-report="${r.id}">${esc(r.title)}</button>`)
    .join('');
  $('#report-chips')
    .querySelectorAll('[data-report]')
    .forEach((chip) =>
      chip.addEventListener('click', () => {
        state.activeReport = chip.dataset.report;
        loaders.reports();
      })
    );

  const report = data.find((r) => r.id === state.activeReport) || data[0];
  const rows = report.rows.map((row) => {
    const out = {};
    for (const [k, val] of Object.entries(row)) {
      out[k] = /balance|amount|total|avg/i.test(k) && typeof val === 'number' ? money(val) : esc(val);
    }
    return out;
  });
  const numeric = /balance|amount|total|avg/i;
  $('#report-output').innerHTML = `
    <div class="card-head sub"><h2>${esc(report.title)}</h2><span class="tag">${esc(report.concept)}</span></div>
    <div class="query-note">${esc(report.sql)}</div>
    <div class="table-wrap" id="report-table"></div>`;
  buildTable(
    $('#report-table'),
    report.columns.map((c) => ({ key: c, label: c, className: numeric.test(c) ? 'num' : '' })),
    rows,
    'No rows returned.'
  );

  const { data: plan } = await api('/explain/1000100001');
  $('#explain-indexed-sql').textContent = plan.indexed.sql;
  $('#explain-scan-sql').textContent = plan.unindexed.sql;
  buildTable($('#explain-indexed'),
    [{ key: 'id', label: 'id', className: 'num' }, { key: 'parent', label: 'parent', className: 'num' }, { key: 'detail', label: 'plan detail' }],
    plan.indexed.plan);
  buildTable($('#explain-scan'),
    [{ key: 'id', label: 'id', className: 'num' }, { key: 'parent', label: 'parent', className: 'num' }, { key: 'detail', label: 'plan detail' }],
    plan.unindexed.plan);
};

// ---------------------------------------------------------------------------
// 7. database design
// ---------------------------------------------------------------------------
const RELATIONAL_MODEL = `BRANCHES    (branch_id PK, branch_name, ifsc_code, city, phone)
EMPLOYEES   (employee_id PK, branch_id FK, emp_name, designation, email, hire_date)
CUSTOMERS   (customer_id PK, first_name, last_name, date_of_birth, gender, phone,
             email, id_proof_no, address, created_at)
ACCOUNTS    (account_no PK, customer_id FK, branch_id FK, account_type, balance,
             status, opened_on)
TRANSACTIONS(txn_id PK, account_no FK, related_account_no FK, txn_type, amount,
             balance_after, txn_time, remarks)`;

const RELATIONSHIPS = [
  'One branch has many accounts (1:N); every account belongs to exactly one branch.',
  'One branch employs many employees (1:N); every employee works at one branch.',
  'One customer owns many accounts (1:N); each account has exactly one owner (joint accounts are out of scope).',
  'One account records many transactions (1:N); for a transfer, related_account_no points at the counterpart account.',
  'Referential integrity uses ON DELETE RESTRICT, so a customer or branch cannot be removed while accounts refer to it.',
];

const GRANT_SCRIPT = `-- limited-privilege teller account (DCL)
CREATE USER 'bank_teller'@'localhost' IDENTIFIED BY '<set-a-strong-password>';
GRANT SELECT  ON banking_db.customers    TO 'bank_teller'@'localhost';
GRANT SELECT  ON banking_db.accounts     TO 'bank_teller'@'localhost';
GRANT SELECT  ON banking_db.transactions TO 'bank_teller'@'localhost';
GRANT EXECUTE ON PROCEDURE banking_db.sp_deposit      TO 'bank_teller'@'localhost';
GRANT EXECUTE ON PROCEDURE banking_db.sp_withdraw     TO 'bank_teller'@'localhost';
GRANT EXECUTE ON PROCEDURE banking_db.sp_transfer     TO 'bank_teller'@'localhost';
GRANT EXECUTE ON FUNCTION  banking_db.fn_get_balance  TO 'bank_teller'@'localhost';
-- note: no UPDATE on accounts, so balances can only move through the procedures`;

loaders.design = async () => {
  $('#relational-model').textContent = RELATIONAL_MODEL;
  $('#relationships').innerHTML = RELATIONSHIPS.map((r) => `<li>${esc(r)}</li>`).join('');
  $('#grant-script').textContent = GRANT_SCRIPT;

  buildTable($('#privilege-table'), [
    { key: 'obj', label: 'Object' },
    { key: 'sel', label: 'SELECT' },
    { key: 'ins', label: 'INSERT' },
    { key: 'upd', label: 'UPDATE' },
    { key: 'del', label: 'DELETE' },
    { key: 'exe', label: 'EXECUTE' },
  ], [
    { obj: 'customers', sel: badge('granted', 'ok'), ins: badge('denied'), upd: badge('denied'), del: badge('denied'), exe: badge('&ndash;', '') },
    { obj: 'accounts', sel: badge('granted', 'ok'), ins: badge('denied'), upd: badge('denied'), del: badge('denied'), exe: badge('&ndash;', '') },
    { obj: 'transactions', sel: badge('granted', 'ok'), ins: badge('denied'), upd: badge('denied'), del: badge('denied'), exe: badge('&ndash;', '') },
    { obj: 'sp_deposit / sp_withdraw / sp_transfer', sel: badge('&ndash;', ''), ins: badge('&ndash;', ''), upd: badge('&ndash;', ''), del: badge('&ndash;', ''), exe: badge('granted', 'ok') },
    { obj: 'fn_get_balance', sel: badge('&ndash;', ''), ins: badge('&ndash;', ''), upd: badge('&ndash;', ''), del: badge('&ndash;', ''), exe: badge('granted', 'ok') },
    { obj: 'branches / employees / views', sel: badge('denied'), ins: badge('denied'), upd: badge('denied'), del: badge('denied'), exe: badge('&ndash;', '') },
  ]);

  const { data } = await api('/schema');
  const block = (title, meta, ddl) => `
    <div class="schema-table">
      <div class="head"><span class="name">${esc(title)}</span><span class="meta">${esc(meta)}</span></div>
      <pre>${esc(ddl)}</pre>
    </div>`;

  const constraintList = (table) => {
    const parts = [];
    if (table.columns.some((c) => c.pk)) parts.push(`PRIMARY KEY (${table.columns.filter((c) => c.pk).map((c) => c.name).join(', ')})`);
    if (table.name === 'accounts') {
      parts.push('FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT');
      parts.push('FOREIGN KEY (branch_id) REFERENCES branches(branch_id) ON DELETE RESTRICT');
      parts.push('CHECK (balance >= 0)', "CHECK (status IN ('ACTIVE','CLOSED','FROZEN'))", "CHECK (account_type IN ('SAVINGS','CURRENT'))");
    }
    if (table.name === 'transactions') {
      parts.push('FOREIGN KEY (account_no) REFERENCES accounts(account_no) ON DELETE RESTRICT');
      parts.push('FOREIGN KEY (related_account_no) REFERENCES accounts(account_no) ON DELETE RESTRICT');
      parts.push('CHECK (amount > 0)');
    }
    if (table.name === 'customers') {
      parts.push("CHECK (gender IN ('M','F','O'))", 'CHECK (phone length 10-15 digits)');
      parts.push('UNIQUE (phone)', 'UNIQUE (email)', 'UNIQUE (id_proof_no)');
    }
    if (table.name === 'employees') {
      parts.push('FOREIGN KEY (branch_id) REFERENCES branches(branch_id) ON DELETE RESTRICT', 'UNIQUE (email)');
    }
    if (table.name === 'branches') parts.push('UNIQUE (ifsc_code)');
    const nn = table.columns.filter((c) => c.notnull && !c.pk).map((c) => c.name);
    if (nn.length) parts.push(`NOT NULL (${nn.join(', ')})`);
    return parts.join('\n  ');
  };

  $('#schema-objects').innerHTML = [
    ...data.tables.map((t) => block(t.name, 'table', `${t.ddl.trim()}\n\n-- declared constraints\n  ${constraintList(t)}`)),
    ...data.views.map((v) => block(v.name, 'view', v.ddl)),
    ...data.indexes.map((i) => block(i.name, `index on ${i.table}`, i.ddl)),
    ...data.triggers.map((t) => block(t.name, 'trigger on accounts', t.ddl)),
  ].join('');
};

// ---------------------------------------------------------------------------
// 8. test cases
// ---------------------------------------------------------------------------
$('#run-tests').addEventListener('click', async () => {
  const btn = $('#run-tests');
  btn.disabled = true;
  btn.textContent = 'Running...';
  const { data } = await api('/tests/run', { method: 'POST' });
  btn.disabled = false;
  btn.textContent = 'Run all test cases';

  const { summary } = data;
  const el = $('#test-summary');
  el.textContent = `${summary.passed}/${summary.total} passed`;
  el.className = `badge ${summary.failed ? 'err' : 'ok'}`;

  buildTable($('#tests-table'), [
    { key: 'id', label: 'Case' },
    { key: 'scenario', label: 'Scenario' },
    { key: 'input', label: 'Input' },
    { key: 'expected', label: 'Expected' },
    { key: 'actual', label: 'Actual output' },
    { key: 'status', label: 'Status', render: (r) => badge(r.status, r.status === 'PASS' ? 'ok' : 'err') },
  ], data.results);
});

// ---------------------------------------------------------------------------
// 9. SQL source
// ---------------------------------------------------------------------------
loaders.sql = async () => {
  const text = await loadScript(state.activeScript);
  $('#script-output').textContent = text;
};

async function loadScript(which) {
  if (!state.scripts[which]) {
    const { data } = await api(`/sql/${which}`);
    state.scripts[which] = data.text;
  }
  return state.scripts[which];
}

document.querySelectorAll('[data-script]').forEach((chip) =>
  chip.addEventListener('click', () => {
    state.activeScript = chip.dataset.script;
    document.querySelectorAll('[data-script]').forEach((c) => c.classList.toggle('active', c === chip));
    loaders.sql();
  })
);

$('#copy-script').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#script-output').textContent);
    toast('Script copied to the clipboard.', 'ok');
  } catch {
    toast('Clipboard is not available in this browser.', 'err');
  }
});

// ---------------------------------------------------------------------------
// 10. extras - document store and B+ tree
// ---------------------------------------------------------------------------
const MONGO_COMPARISON = [
  ['Structure', 'Fixed columns and data types declared with DDL', 'Flexible JSON documents; fields may differ per document'],
  ['Integrity', 'PRIMARY KEY, FOREIGN KEY, CHECK and UNIQUE constraints', 'No foreign keys; application must enforce the rules'],
  ['Money movement', 'Multi-row ACID transaction with rollback', 'Multi-document transactions are heavier and less common'],
  ['Reads', 'JOIN across five normalized tables; views for reuse', 'Whole document returned with embedded/nested arrays'],
  ['Best fit here', 'Customers, accounts and transactions (must stay consistent)', 'Scanned KYC forms, alerts, logs and audit payloads'],
  ['Query language', 'SQL', 'MQL (db.collection.find / insertOne / updateOne / deleteOne)'],
];

async function loadMongo() {
  const collection = $('#mongo-collection').value || state.mongoCollection;
  state.mongoCollection = collection;
  const { data } = await api(`/mongo/${collection}`);

  if (!document.querySelector('#mongo-collection option')) {
    $('#mongo-collection').innerHTML = data.collections
      .map((c) => `<option value="${c}">${esc(c)}</option>`)
      .join('');
    $('#mongo-collection').value = collection;
  }

  const documents = data.documents;
  const keys = [...new Set(documents.flatMap((d) => Object.keys(d)))];
  buildTable(
    $('#mongo-table'),
    [
      ...keys.map((k) => ({
        key: k,
        label: k,
        render: (row) =>
          Array.isArray(row[k]) ? esc(row[k].join(', ')) : typeof row[k] === 'boolean' ? badge(String(row[k])) : esc(row[k]),
      })),
      {
        key: 'actions',
        label: 'Actions',
        render: (row) => `
          <button class="btn tiny" data-toggle="${esc(row._id)}" data-verified="${row.verified}">Toggle verified</button>
          <button class="btn tiny danger" data-remove="${esc(row._id)}">deleteOne</button>`,
      },
    ],
    documents,
    'No documents in this collection.'
  );

  $('#mongo-shell').textContent = `db.${collection}.find(${collection === 'kyc_documents' ? '{ customer_id: 1 }' : '{}'})  // ${documents.length} document(s)`;

  $('#mongo-table').querySelectorAll('[data-toggle]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const id = btn.dataset.toggle;
      const next = btn.dataset.verified !== 'true';
      const { data: res } = await api(`/mongo/${collection}/${id}`, { method: 'PATCH', body: { verified: next } });
      toast(res.shell, 'ok');
      loadMongo();
    })
  );

  $('#mongo-table').querySelectorAll('[data-remove]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const { data: res } = await api(`/mongo/${collection}/${btn.dataset.remove}`, { method: 'DELETE' });
      toast(res.shell, 'ok');
      loadMongo();
    })
  );
}

$('#mongo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = formValues(e.target);
  const doc = {
    customer_id: Number(v.customer_id),
    customer_name: v.customer_name,
    doc_type: v.doc_type,
    doc_number: v.doc_number,
    verified: false,
    branches: ['Coimbatore Main'],
    uploaded_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  const { data } = await api(`/mongo/${v.collection}`, { method: 'POST', body: doc });
  toast(data.acknowledged ? `insertOne -> ${data.insertedId}` : data.error, data.acknowledged ? 'ok' : 'err');
  $('#mongo-shell').textContent = data.shell;
  loadMongo();
});

$('#mongo-collection').addEventListener('change', loadMongo);

async function loadBtree() {
  const { data } = await api('/btree');
  renderBtree(data);
}

function renderBtree(data) {
  const { levels, stats, leaves } = data;
  $('#btree-stats').innerHTML = `
    <span class="pill">order <b>${stats.order}</b></span>
    <span class="pill">height <b>${stats.height}</b></span>
    <span class="pill">nodes <b>${stats.nodes}</b></span>
    <span class="pill">keys in leaves <b>${stats.entries}</b></span>
    <span class="pill">leaf chain <b>${leaves.length}</b> nodes</span>`;

  const search = state.search;
  const pathIndices = [];
  if (search && search.path) {
    search.path.forEach((p) => pathIndices.push(p.child));
  }

  const html = levels
    .map((nodes, level) => {
      const marker = level === 0 ? 0 : pathIndices[level - 1];
      const cells = nodes
        .map((node, index) => {
          let cls = `btree-node ${node.leaf ? 'leaf' : ''}`;
          if (search && marker === index) cls += search.found ? ' hit' : ' miss';
          const keys = node.keys.length
            ? node.keys.map((k) => `<span class="btree-cell">${esc(k)}</span>`).join('')
            : '<span class="btree-cell">&empty;</span>';
          return `<div class="${cls}">${keys}</div>`;
        })
        .join('');
      const label = level === levels.length - 1 && nodes[0]?.leaf ? 'leaves' : level === 0 ? 'root' : 'internal';
      return `<div class="btree-level"><div class="btree-level-label">${label}</div>${cells}</div>`;
    })
    .join('');

  $('#btree-canvas').innerHTML = html;
}

$('#btree-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = formValues(e.target);
  const body = {};
  if (v.insert) body.insert = Number(v.insert);
  if (v.search) body.search = Number(v.search);
  if (!Object.keys(body).length) return toast('Enter a key to insert or search.', 'err');

  const { data } = await api('/btree', { method: 'POST', body });
  if (data.search) {
    state.search = data.search;
    $('#btree-search').innerHTML = data.search.found
      ? `<div class="result ok"><strong>Found</strong> key ${esc(data.search.key)} in the leaf
           [${data.search.leafKeys.map(esc).join(', ')}] after descending ${data.search.path.length} internal level(s).
         </div>`
      : `<div class="result err"><strong>Not found</strong> &mdash; key ${esc(data.search.key)} is absent; the search stopped at the leaf
           [${data.search.leafKeys.map(esc).join(', ')}]. A B+ tree always ends in a leaf, so lookups are uniform.
         </div>`;
  } else {
    state.search = null;
  }
  renderBtree(data);
  e.target.search.value = '';
  e.target.insert.value = '';
});

$('#btree-reset').addEventListener('click', async () => {
  const { data } = await api('/btree', { method: 'DELETE' });
  state.search = null;
  $('#btree-search').innerHTML = '';
  renderBtree(data);
  toast('B+ tree rebuilt from the current account numbers.', 'ok');
});

loaders.extras = async () => {
  buildTable($('#mongo-comparison'), [
    { key: 'aspect', label: 'Aspect' },
    { key: 'rel', label: 'Relational (this project)' },
    { key: 'doc', label: 'Document store' },
  ], MONGO_COMPARISON.map(([aspect, rel, doc]) => ({ aspect, rel, doc })));

  if (!$('#mongo-collection').options.length) {
    const { data } = await api('/mongo/kyc_documents');
    $('#mongo-collection').innerHTML = data.collections
      .map((c) => `<option value="${c}">${esc(c)}</option>`)
      .join('');
  }
  await loadMongo();
  await loadBtree();
};

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------
$('#reset-btn').addEventListener('click', async () => {
  const { data } = await api('/admin/reset', { method: 'POST' });
  state.logs = [];
  state.scripts = {};
  state.search = null;
  state.accounts = [];
  toast(data.message, 'ok');
  loaders[currentView() || 'dashboard']?.();
  show(currentView() || 'dashboard');
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
document.querySelectorAll('.nav-item').forEach((btn) =>
  btn.addEventListener('click', () => show(btn.dataset.view))
);

show('dashboard');
