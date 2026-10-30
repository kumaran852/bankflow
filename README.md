# Banking Management System

A DBMS mini project (course **U25CSG18**, **Experiment 13**) implementing a banking
management system end to end: a normalised relational schema, constraints, views,
indexes, a trigger, stored-program-equivalent banking logic, security/privileges, a
document-store (NoSQL) module and a B+ tree demonstration — all wrapped in a small
runnable web prototype.

The primary deliverable is the **MySQL 8.0 script** (`src/mysql/banking_db.sql`),
reproduced verbatim from Appendix I of the project report. The runnable prototype
uses the SQL engine built into **Node.js** (SQLite dialect) so the demonstration
needs **zero installation** and **no third-party npm packages**.

## Requirements

- **Node.js >= 22.5.0** (uses the built-in `node:sqlite` module and `node --run`).
- No database server and no `npm install` required.

## Getting started

```bash
npm start
```

Then open <http://localhost:3000>.

To run the Appendix II test cases (TC01–TC16) on a fresh in-memory database:

```bash
npm run tests
```

## What the prototype demonstrates

| Area | Where |
| --- | --- |
| ER model, normalisation to 3NF, relational tables | *Database Design* tab |
| PRIMARY KEY, FOREIGN KEY, NOT NULL, UNIQUE, CHECK | `src/schema.sql` |
| Views (`vw_account_summary`, `vw_transaction_history`) | `src/schema.sql`, *Database Design* |
| Indexes (`idx_txn_account_time`, `idx_acc_customer`) and `EXPLAIN QUERY PLAN` | *Queries & Reports* |
| Trigger `trg_accounts_before_delete` (delete guard) | `src/schema.sql`, test **TC16** |
| Stored programs: `fn_get_balance`, `sp_deposit`, `sp_withdraw`, `sp_transfer`, `sp_apply_interest` (cursor) | `src/database.js`, *Banking Operations* |
| ACID transactions and rollback | `src/database.js` |
| Security: roles, privileges, `GRANT`/`REVOKE` | *Database Design* (privilege matrix) |
| MongoDB-style document store (`insertOne`, `find`, `updateOne`, `deleteOne`) | *MongoDB & B+ Tree* |
| B+ tree (order 4, linked leaves) | `src/btree.js`, *MongoDB & B+ Tree* |

## Project layout

```
.
├── server.js              # zero-dependency HTTP server + REST API
├── package.json
├── public/                # single-page web UI (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── src/
    ├── database.js        # data-access layer (procedures, reports, EXPLAIN, schema)
    ├── schema.sql         # SQLite physical schema
    ├── seed.sql           # sample data
    ├── btree.js           # B+ tree implementation
    ├── docstore.js        # JSON-backed document store
    ├── tests.js           # Appendix II test runner (TC01–TC16)
    ├── mysql/
    │   └── banking_db.sql # full MySQL 8.0 script (primary deliverable)
    └── data/
        └── documents.json # document-store data (generated at runtime)
```

Runtime artefacts (`data/`, `src/data/documents.json`) are git-ignored and are
recreated automatically on first start or via the *Reset demo data* action.

## REST API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/overview` | Dashboard totals & recent activity |
| GET | `/api/schema` | Schema introspection (tables, views, indexes, triggers) |
| GET/POST/PUT/DELETE | `/api/customers` | Customer CRUD (+ `/customers/duplicate-check`) |
| GET/POST | `/api/accounts` | List / open accounts |
| PATCH | `/api/accounts/:id/status` | Freeze / activate an account |
| GET | `/api/balance/:id` | Balance via `fn_get_balance` |
| POST | `/api/operations/{deposit\|withdraw\|transfer\|interest}` | Banking operations |
| GET | `/api/transactions/:id` | Account statement |
| GET | `/api/reports` | The ten report queries |
| GET | `/api/explain/:id` | `EXPLAIN QUERY PLAN` for query optimisation |
| GET | `/api/sql/{mysql\|schema}` | Serve the MySQL / schema script |
| GET | `/api/tests/run` | Run TC01–TC16 |
| POST | `/api/admin/reset` | Rebuild the demo data set |
| GET/POST/PATCH/DELETE | `/api/mongo/:collection` | Document-store CRUD |
| GET/POST/DELETE | `/api/btree` | B+ tree build / search |

## Sample data

Five branches, employees, five customers and five accounts
(`1000100001`–`1000100005`). After the A1.6 opening operations the balances are:

```
1000100001: 35000.00 | 1000100002: 35000.00 | 1000100003: 20000.00
1000100004: 75000.00 | 1000100005:     0.00
```

## Notes on the runtime engine

Because MySQL is not required to run the demo, the report's stored programs are
reproduced as server-side routines in `src/database.js` that wrap the same
statements in `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`. The status strings
returned (for example `SUCCESS: Deposit completed`, `ERROR: Insufficient balance`)
are identical to those used in the report. The MySQL script remains the primary
deliverable and is shown in full under the *SQL Source* tab.

## License

Provided for academic use as part of the U25CSG18 course project.
