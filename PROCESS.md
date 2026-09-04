# Development Process — FTTH Field Inventory API

Reference for setting up, running, and extending this repo.

---

## 1. Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js (developed on v24) |
| Framework | Express 4 |
| Database | PostgreSQL (tested against psql 18) |
| DB driver | `pg` (connection pool) |
| Config | `dotenv` via `.env` |
| Package manager | **npm** (`package-lock.json` is the lockfile — do not add `yarn.lock`) |
| Module system | CommonJS (`"type": "commonjs"`) |

---

## 2. Local setup

### Prerequisites

- Node.js 18+
- A reachable PostgreSQL server, with the `psql` client on `PATH`

### Steps

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL
```

`.env` keys:

| Key | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgres://user:pass@localhost:5432/ftth_inventory` |
| `PORT` | API listen port (defaults to 4000) | `4000` |

### Create the database and apply the schema

`db/schema.sql` creates types and tables but does **not** create the database
itself, and it is **not idempotent** (`CREATE TYPE` fails on a second run).
Apply it to a fresh, empty database.

```bash
createdb ftth_inventory
psql "postgres://user:pass@localhost:5432/ftth_inventory" -f db/schema.sql
```

> **Windows note:** the `migrate` script in `package.json` is written as
> `psql "$DATABASE_URL" -f db/schema.sql`. That depends on POSIX shell variable
> expansion *and* on `DATABASE_URL` already being exported in the shell —
> neither holds under PowerShell or cmd.exe, and `.env` is not loaded into the
> shell environment. On Windows, pass the connection string to `psql`
> explicitly as shown above, or run from Git Bash after
> `export DATABASE_URL=...`.

### Seed sample data

```bash
npm run seed
```

`db/seed.js` inserts users, a warehouse, a tech van, an item catalog, two
in-stock ONTs, bulk stock, one customer premises, and one already-active
installation. It prints the reference IDs needed for smoke tests:

```
van_location_id, premises_id, john_kamau_user_id, new_ont_instance_id
```

Seeding assumes empty tables. To re-seed, drop and recreate the database.

---

## 3. Running

```bash
npm run dev     # node --watch, restarts on file change
npm start       # plain node
```

Health check — works with no database attached:

```bash
curl http://localhost:4000/api/health
# {"status":"ok"}
```

---

## 4. Testing

There is **no automated test suite in this repo yet** — `package.json` declares
no `test` script. Verification today is manual.

Parse check every file:

```bash
for f in $(find src db -name '*.js'); do node --check "$f"; done
```

Boot and route smoke test, no database required:

```bash
curl http://localhost:4000/api/health          # -> {"status":"ok"}
curl http://localhost:4000/api/nope            # -> {"error":"Not found"}
curl http://localhost:4000/api/stock           # -> {"error":"location_id is required"}
```

For end-to-end checks against a seeded database, follow the walkthrough in
[TUTORIAL.md](TUTORIAL.md).

When a test suite is added, prefer a runner that needs no build step
(`node:test` or Jest), add a `test` script, and run it after every change.

---

## 5. Architecture

```
Client (mobile web / mockup)
        |
        v
src/server.js          Express app: cors, json body parser, route mounting,
        |              /api/health, 404 fallback
        v
src/routes/*.js        One router per domain area. Owns its own SQL.
        |
        v
src/lib/db.js          Single pg Pool. Exports { query, pool }.
        |
        v
PostgreSQL             Schema + constraints in db/schema.sql
```

### Design decisions worth preserving

- **Invariants live in the database, not only in JS.** Two examples:
  - `installations.removal_reason_required_if_removed` — a removal cannot be
    recorded without a reason.
  - `uq_active_installation_per_premises` — a partial unique index on
    `(customer_premises_id) WHERE removed_at IS NULL`, so a premises can never
    hold two active routers.

  The application-layer checks in the routes are a fast, friendly path to a 4xx
  response; the constraints are the actual guarantee. Keep both.

- **Multi-step writes run in one transaction.** Any handler touching more than
  one table checks out a client from the pool and wraps the work in
  `BEGIN`/`COMMIT`, with `ROLLBACK` in `catch` and `client.release()` in
  `finally`. `POST /api/installations/:premisesId/replace` is the reference
  implementation: it closes the old installation, updates both instance
  statuses, creates the new installation, and writes two audit rows — all or
  nothing.

- **Serialized vs bulk is a first-class split.** `items.tracking_type` decides
  which storage model applies:
  - `serialized` → one `item_instances` row per physical unit, carrying
    `serial_number`, `mac_address`, `status`, and current location/holder.
  - `bulk` → a `stock_levels` quantity per `(item_id, location_id)` pair.

  Endpoints accepting either take `item_instance_id` **or** `item_id` +
  `quantity`, never both.

- **Work orders are optional everywhere.** Every `work_order_id` foreign key is
  nullable, so installs and stock movements work whether or not job tracking is
  in use for a given workflow. Do not make it required.

- **`transactions` is append-only.** Every stock movement writes a row. Nothing
  in the codebase updates or deletes from that table, and nothing should.

---

## 6. Folder structure

```
.
├── db/
│   ├── schema.sql              Types, tables, indexes, constraints (v1)
│   └── seed.js                 Sample data + prints smoke-test IDs
├── mockups/
│   └── mobile_screens.html     Static 3-screen field-tech UI mockup
│                               (My Stock / Find premises / Premises detail).
│                               Standalone HTML — calls no API.
├── src/
│   ├── lib/
│   │   └── db.js               pg Pool wrapper
│   ├── routes/
│   │   ├── catalog.js          /api/items, /api/locations, /api/work-orders
│   │   ├── installations.js    install + atomic replace
│   │   ├── premises.js         search, current router, history
│   │   ├── stock.js            stock at a location
│   │   └── transactions.js     generic stock movement + audit query
│   └── server.js               App entrypoint
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── PROCESS.md                  This file
├── README.md                   API + data-model reference
└── TUTORIAL.md                 Hands-on walkthrough
```

---

## 7. Conventions

**Routes**

- One router file per domain area; mount it in `src/server.js`.
- Response bodies are always a named-key object, never a bare array:
  `{ items: [...] }`, `{ transaction: {...} }`, `{ current: null }`.
- Validate required fields first; return `400` with a message naming what is
  missing.
- `201` for creates, `404` for a missing referenced row, `409` for a conflicting
  state, `500` for unexpected failures.
- `catch` blocks `console.error(err)` the real error and return a generic
  message — never leak driver internals to the client.

**SQL**

- Always parameterized (`$1`, `$2`, …). Never string-interpolate user input.
- Dynamic filters are built by pushing onto a `params` array and referencing
  `$${params.length}` — see `src/routes/transactions.js` and
  `src/routes/catalog.js`.
- Set `updated_at = now()` explicitly on any `UPDATE` of a table that has it;
  there are no triggers.

**Schema changes**

- Edit `db/schema.sql` for the canonical v1 shape. Once this is deployed
  anywhere real, add numbered migrations alongside it — do not expect existing
  databases to be recreated from `schema.sql`.
- New enum values go on the existing `*_enum` types rather than becoming free
  text.

**Style**

- Match the surrounding file: 2-space indent, single quotes, semicolons.
- Comment the *why*, not the *what*. The block comments above each handler
  documenting the expected request body are the pattern to follow.

---

## 8. Known gaps

Recorded here so they are not rediscovered:

- No authentication or authorization. `performed_by` / `installed_by` are
  supplied by the client and trusted. `users.role` exists but is unenforced.
- No automated tests and no CI.
- `npm run migrate` does not work on Windows (see §2).
- `db/schema.sql` is not re-runnable, and there is no migration tool.
- `POST /api/transactions` does not verify that `item_id` is present for a bulk
  move, that `quantity` is positive, or that a bulk decrement leaves stock
  non-negative.
- `POST /api/installations` does not verify that the instance being installed is
  actually `in_stock` rather than already installed elsewhere.
- `GET /api/stock` computes `is_low_stock` as `quantity <= reorder_threshold`,
  which yields `NULL` rather than `false` for an item with no threshold set.
- The GIN full-text index on `customer_premises.address` is unused —
  `/api/premises/search` uses `ILIKE '%q%'`, which cannot use it.
