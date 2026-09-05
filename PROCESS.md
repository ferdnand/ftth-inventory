# Development Process — FTTH Field Inventory

Reference for setting up, running, and extending this repo.

The project is a three-app monorepo:

| App | What it is | Who uses it |
|---|---|---|
| `apps/api` | Express 4 + PostgreSQL REST API | both clients |
| `apps/web` | React + Vite dashboard | warehouse staff, project managers |
| `apps/mobile` | React Native (Expo) app | field techs |

---

## 1. Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 20+ (developed on v24) |
| API | Express 4, plain JavaScript, CommonJS |
| Database | PostgreSQL (tested against psql 18) |
| DB driver | `pg` (connection pool), no ORM |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` |
| Web | React 19, Vite 5, react-router-dom 6, TanStack Query 5, Recharts 3 |
| Mobile | Expo SDK 57, expo-router, TanStack Query 5, expo-secure-store |
| Tests | `node:test` (API only), against a real Postgres |
| Package manager | **npm workspaces** (`package-lock.json` is the lockfile — do not add `yarn.lock`) |
| Language | Plain JavaScript everywhere. No TypeScript. |

### Why plain JavaScript

The API has no OpenAPI spec, and its wire format has traps a hand-written type
would state incorrectly — `NUMERIC` columns arrive as **strings**
(`quantity: "180"`), and `/premises/:id/current` answers `{current: null}` with a
200 while `/premises/:id/history` 404s on the same missing id. A
`quantity: number` annotation would make the first of those invisible. Without a
generated spec, TypeScript here buys editor comfort and sells false confidence.
Each app can adopt it later independently; the API is the one that should not.

### Why React 19 everywhere

Expo SDK 57 pins `react@19.2.3`. The dashboard is on the same exact version so
npm hoists **one** copy to the repo root. Two React majors in one workspace makes
npm nest a second copy per app, and a nested `react` is the classic cause of
Metro resolving two copies and React's dispatcher coming back `null`. If you bump
one, bump both:

```bash
node -e "const r=require('./apps/mobile/package.json').dependencies.react;console.log('mobile react',r)"
```

---

## 2. Local setup

### Prerequisites

- Node.js 20+
- A reachable PostgreSQL server (`psql` on `PATH` is handy but no longer required)
- For the mobile app: the **Expo Go** app on a physical phone, on the same Wi-Fi
  as the dev machine

### Install

```bash
npm install          # from the repo root — installs all three workspaces
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env      # optional; the default works
```

`apps/api/.env` keys:

| Key | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | *required* |
| `PORT` | API listen port | `4000` |
| `JWT_SECRET` | Signing key for access tokens | `dev-only-insecure-secret` |
| `JWT_TTL` | Token lifetime | `12h` |
| `DB_TIMEZONE` | Session timezone for report bucketing | `UTC` |
| `CORS_ORIGINS` | Comma-separated allowlist; empty = permissive | *(empty)* |
| `TEST_DATABASE_URL` | Throwaway DB for `npm test` | *required to run tests* |

Generate a real secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`src/lib/env.js` loads `apps/api/.env` by absolute path, so scripts work
whichever directory you run them from, and it exits with a clear message if
`DATABASE_URL` is missing.

### Create the database and migrate

```bash
createdb ftth_inventory
npm run migrate
```

`npm run migrate` runs `apps/api/db/migrate.js`, a small Node runner —
**it works in PowerShell, cmd.exe and bash alike.** (The old script was
`psql "$DATABASE_URL" -f db/schema.sql`, which depended on POSIX variable
expansion and silently did nothing on Windows.)

```bash
npm run migrate                          # apply everything pending
npm run migrate -w apps/api -- status    # list applied and pending
npm run migrate -w apps/api -- baseline  # see below
```

Each migration runs in its own transaction, behind a Postgres advisory lock so
two runners cannot race. Applied migrations are recorded in `schema_migrations`
with a checksum: **editing an already-applied migration is an error**, not a
silent divergence. Add a new numbered file instead.

> **If your database predates the migration runner** — i.e. you built it by
> piping the old `db/schema.sql` through `psql` — run this once, then migrate:
>
> ```bash
> npm run migrate -w apps/api -- baseline 1
> npm run migrate
> ```
>
> `baseline 1` records `001_init.sql` as already applied without executing it.
> Skipping this makes `migrate` fail on `type "tracking_type_enum" already exists`.

### Seed sample data

```bash
npm run seed
```

Inserts users (with password hashes **and** assigned locations), a warehouse, a
tech van, an item catalog, two in-stock ONTs, warehouse and van bulk stock, one
customer premises, and one already-active installation. It prints the reference
IDs and the sign-in credentials.

Seeding assumes empty tables. To re-seed, truncate the data tables (leaving
`schema_migrations` alone) or drop and recreate the database.

---

## 3. Running

Use two or three terminals — you want the API's `console.error` output on its
own, since per §8 that is where the real errors go.

```bash
npm run dev:api      # node --watch, restarts on change, :4000
npm run dev:web      # Vite dev server, :5173, proxies /api to :4000
npm run dev:mobile   # Expo — scan the QR code with Expo Go
```

Health check — works with no database attached and needs no token:

```bash
curl http://localhost:4000/api/health
# {"status":"ok"}
```

### Running the mobile app on a physical phone

This is the one part of the setup with a sharp edge, so it is worth being
explicit: **`localhost` on the phone is the phone.** The app never uses it.

`apps/mobile/src/lib/config.js` derives the API host from the Metro host, which
in Expo Go *is* your dev machine's LAN IP. It self-heals when DHCP hands out a
new address or you switch networks — no `.env` edit, no rebuild.

If the app cannot reach the API:

1. Open the **Profile** screen. It shows the resolved API URL and where that URL
   came from. If it says `localhost`, Metro did not report a host.
2. Open `http://<that host>:4000/api/health` **in the phone's browser**. If that
   fails, the phone is not on the same network as the dev machine — or a
   firewall is blocking :4000 inbound. A tunnel is not the fix; the address is.
3. Only if the API genuinely lives elsewhere, set `EXPO_PUBLIC_API_URL` in
   `apps/mobile/.env`. Note that `EXPO_PUBLIC_*` values are **inlined into the
   JavaScript bundle** — never put a secret there.

Android also needs cleartext HTTP for a LAN dev API; `app.config.js` sets
`usesCleartextTraffic: true` for that reason.

---

## 4. Testing

```bash
npm test             # from the repo root
```

84 tests across four files, using `node:test` — zero dependencies, no build
step.

They run against a **real PostgreSQL** database, because everything worth
testing here is a database guarantee: a partial unique index, a `SELECT … FOR
UPDATE` row lock, a `CHECK` constraint. A mocked `pg` would only test the mock.

```bash
createdb ftth_inventory_test
# then add to apps/api/.env:
# TEST_DATABASE_URL=postgres://user:pass@localhost:5432/ftth_inventory_test
```

The harness **refuses to run** if `TEST_DATABASE_URL` is unset or equal to
`DATABASE_URL` — it truncates every table between tests, so pointing it at the
development database would silently delete your data. It migrates the test
database itself on first use.

What is covered, in rough order of importance:

| Area | The thing being proved |
|---|---|
| `applyMove` | Two concurrent decrements of the same row cannot drive stock negative |
| Installations | One active router per premises, enforced by the app **and** the index |
| Replace | A removal cannot be recorded without a reason (app 400 **and** DB `CHECK`) |
| Install | A unit must be `in_stock`, and in the acting tech's own van |
| Auth | No token → 401, wrong role → 403, deactivated user's live token → 401 |
| Scoping | A field tech cannot read another location's stock |
| Idempotency | The same key replayed returns the original row, and moves stock once |
| Restock | Fulfilment moves the stock atomically, and fails as a whole if it cannot |
| Reports | Low stock includes locations holding **zero** of an item |
| Migrations | `up` is idempotent; an edited applied migration fails its checksum |

The clients have no test suite. They were verified by rendering every screen
headlessly against a live seeded API — the dashboard through Vite's SSR
transform in jsdom, and the mobile app through its real `expo export --platform
web` bundle in jsdom. Neither harness is committed (both need `jsdom`, which is
not a dependency here). Reproducing that is the natural place to start if you
want client tests: `vite build` and `expo export` already catch import and
transform errors, so the gap is render-time behaviour.

---

## 5. Architecture

```
apps/web (React + Vite)          apps/mobile (Expo + expo-router)
   localStorage token                 SecureStore token (async!)
   fetch → /api via Vite proxy        fetch → LAN IP derived from Metro host
        │                                   │
        └──────────────┬────────────────────┘
                       ▼
              apps/api/src/app.js
        cors · json · /api/health · /api/auth
        ── app.use('/api', requireAuth) ──  ← everything below needs a token
        domain routers · 404 · errorHandler
                       │
                       ▼
              apps/api/src/routes/*.js      one router per domain area
                       │
                       ▼
        src/lib/stock.js   src/lib/validate.js   src/lib/errors.js
        (applyMove: the       (400s)               (ApiError → JSON)
         non-negative rule)
                       │
                       ▼
              src/lib/db.js        single pg Pool
                       │
                       ▼
                 PostgreSQL        apps/api/db/migrations/*.sql
```

### Design decisions worth preserving

- **Invariants live in the database, not only in JS.** Examples:
  - `uq_active_installation_per_premises` — a partial unique index on
    `(customer_premises_id) WHERE removed_at IS NULL`, so a premises can never
    hold two active routers.
  - `removal_reason_required_if_removed` — a removal cannot be recorded without
    a reason.
  - `stock_quantity_non_negative`, `transaction_serialized_xor_bulk`,
    `transaction_quantity_positive` — added in `005_guards.sql`.

  The application checks are a fast, friendly path to a 4xx; the constraints are
  the actual guarantee. Keep both. The tests assert both paths deliberately.

- **Stock and labour are different tables.** `items` is what you hold, move and
  count; `services` (splicing, cable runs, a PPPoE setup) is work performed and
  has no location, quantity or serial number. They were briefly one table with a
  'Service' category — `007_services.sql` separates them, because a service in
  `items` shows up in every stock report as a permanent zero and nothing stops a
  transfer of "5 splicings" into a van.

- **`services.name` is UNIQUE; `items.name` is not.** That omission is how
  'Sleeves' and 'Heat-shrink Sleeves' both reached the catalog, splitting one
  item's stock across two rows until `008_merge_sleeves.sql` folded them back
  together. Adding the constraint to `items` now would need a merge pass over
  existing duplicates first — until then, check before inserting.

- **Services are reported separately from consumption, on purpose.**
  `/api/reports/consumption` means stock that left the business; a splice never
  was stock. `/api/reports/services` is its own endpoint for that reason, and it
  never sums a quantity across units of measure — 40 m plus 1 job is 41 of
  nothing, so totals come back split by unit and the by-tech grouping reports
  counts with `quantity` explicitly NULL rather than a misleading number.

- **Labour hangs off the installation, not the address.** `installation_services`
  references `installations`, so replacing a router years later keeps each
  visit's work separate — the same premises can be spliced twice and the
  timeline shows both. It is the only `ON DELETE CASCADE` in the schema: these
  rows describe one installation and mean nothing without it. The `service_id`
  reference does *not* cascade — a service in use deactivates, it never deletes.

- **`PUT /api/installations/:id/services` takes the complete list.** Sending
  `[]` clears it and re-sending the same list twice leaves the same rows, so a
  tech on a bad connection can retry without an idempotency key. It exists
  because the warehouse dashboard never *creates* an installation — installs
  happen in the field — so without it the web UI could only read the work.

- **The auth mount is load-bearing.** `app.use('/api', requireAuth)` sits above
  the domain routers in `src/app.js`. That ordering is what makes a newly added
  router **fail closed**. A router mounted above that line is silently public.

- **`requireAuth` re-reads the user from the database on every request.** The
  token carries only `{ sub }`. That per-request lookup is the *only* revocation
  mechanism there is — it is what makes deactivating a user, changing their role,
  or reassigning their van take effect immediately instead of at token expiry.
  Do not "optimise" it away by trusting claims in the token.

- **There is exactly one implementation of the non-negative stock rule**, in
  `src/lib/stock.js`. Generic transactions, restock fulfilment and the tests all
  go through `applyMove`. It takes a `SELECT … FOR UPDATE` row lock *before*
  reading the balance, because without the lock the check is a race: two
  transactions both read 100, both decide 60 is available, and the row lands at
  −20. It also locks in ascending location-id order so two opposite transfers
  between the same pair cannot deadlock.

- **Multi-step writes run in one transaction.** Any handler touching more than
  one table checks out a client, wraps the work in `BEGIN`/`COMMIT`, `ROLLBACK`s
  in `catch`, and releases in `finally`. `POST /api/installations/:premisesId/replace`
  is the reference implementation.

- **Serialized vs bulk is a first-class split.** `items.tracking_type` decides
  which storage model applies — `item_instances` rows per physical unit, or a
  `stock_levels` quantity per `(item_id, location_id)`. Endpoints accepting
  either take `item_instance_id` **or** `item_id` + `quantity`, never both, and
  `transaction_serialized_xor_bulk` enforces it.

- **Work orders are optional everywhere.** Every `work_order_id` foreign key is
  nullable. Do not make it required.

- **`transactions` is append-only.** Every stock movement writes a row. Nothing
  updates or deletes from that table, and nothing should. This is also why
  idempotency keys had to exist before any offline queue: a replayed write has no
  cleanup path.

- **`NUMERIC` is a string on the wire, and the clients own the coercion.** `pg`
  returns `NUMERIC` as a string; the API leaves it that way rather than
  installing a global type parser for OID 1700, which would change every numeric
  column at once. Both clients coerce once at the hook boundary (`num.js`) so no
  component ever compares `'180' < '90'` (which is `true`).

- **`GET /api/stock` stays flat; `GET /api/stock/summary` aggregates.** Both
  shapes have real consumers. The mobile app needs the flat list — it gets the
  counts *and* the individual serials in one request over the flakiest network
  in the system. The dashboard's counters must not be derived client-side from a
  list that could be capped.

- **Client-side role gating is UX, not security.** `RoleRoute` and the hidden
  nav links only keep someone off a page the API would reject anyway. The API is
  what enforces authorization.

---

## 6. Folder structure

```
.
├── apps/
│   ├── api/
│   │   ├── db/
│   │   │   ├── migrate.js          Numbered migration runner (up/status/baseline)
│   │   │   ├── migrations/
│   │   │   │   ├── 001_init.sql    v1 schema (was db/schema.sql)
│   │   │   │   ├── 002_auth.sql    users.password_hash
│   │   │   │   ├── 003_idempotency.sql
│   │   │   │   ├── 004_restock_requests.sql
│   │   │   │   ├── 005_guards.sql  CHECK constraints behind the app's 409s
│   │   │   │   ├── 006_catalog_items.sql  The field SKU catalog
│   │   │   │   ├── 007_services.sql  Billable labour, split out of items
│   │   │   │   ├── 008_merge_sleeves.sql  Duplicate catalog row merged
│   │   │   │   └── 009_installation_services.sql  Labour ↔ installation
│   │   │   └── seed.js             Sample data + reference IDs + credentials
│   │   ├── src/
│   │   │   ├── app.js              Builds the Express app (auth mount lives here)
│   │   │   ├── server.js           Process entrypoint — only calls listen
│   │   │   ├── lib/
│   │   │   │   ├── env.js          cwd-independent .env loading + validation
│   │   │   │   ├── db.js           pg Pool, session timezone
│   │   │   │   ├── errors.js       ApiError, asyncHandler, errorHandler
│   │   │   │   ├── validate.js     Hand-rolled 400 helpers
│   │   │   │   ├── stock.js        applyMove — the non-negative rule
│   │   │   │   ├── idempotency.js  Replay detection
│   │   │   │   ├── installationServices.js  Labour lines: parse, write, read
│   │   │   │   ├── constants.js    Enum arrays + per-role movement table
│   │   │   │   └── serialize.js    publicUser — password_hash can never leak
│   │   │   ├── middleware/auth.js  requireAuth, requireRole, location scoping
│   │   │   └── routes/             auth, stock, premises, installations,
│   │   │                           transactions, catalog, users,
│   │   │                           itemInstances, restockRequests, reports
│   │   └── test/                   helpers.js + 6 *.test.js files
│   ├── web/
│   │   └── src/
│   │       ├── main.jsx  mount.jsx  router.jsx
│   │       ├── styles/             tokens.css (from the mockup) · base · components
│   │       ├── lib/                api · ApiError · num · format · constants
│   │       │                       queryKeys · queryClient · groupSerialized
│   │       ├── auth/               AuthProvider · AuthContext · tokenStore · routes
│   │       ├── components/         AppShell · DataTable · Meter · Badge · Toast
│   │       │                       Modal · fields · states · PageHeader
│   │       │                       InstallationServices (summary + editor)
│   │       ├── charts/             chartTheme · ChartFrame · marks · LazyMarks
│   │       ├── hooks/              useData (queries + mutations) · useDebounced
│   │       └── pages/              login · overview · items · services · locations
│   │                               stock · premises · workorders · restock · users
│   │                               reports
│   └── mobile/
│       ├── app/                    expo-router file routes
│       │   ├── _layout.jsx         fonts, providers, auth gate
│       │   ├── login.jsx  profile.jsx  restock.jsx  +not-found.jsx
│       │   ├── (tabs)/             _layout · stock · install · history
│       │   └── premises/           [id].jsx · new.jsx · [id]/install · [id]/replace
│       │                           [id]/work  (amend recorded labour)
│       ├── src/
│       │   ├── theme.js            The mockup's tokens, ported
│       │   ├── lib/                config (LAN host) · format · constants · groupSerialized
│       │   ├── api/                client · queries
│       │   ├── auth/               AuthProvider · tokenStore (SecureStore)
│       │   └── components/         ui · Screen · fields · SerialPicker
│       ├── app.config.js  babel.config.js  metro.config.js
├── mockups/
│   └── mobile_screens.html         The design source of truth. Lines 9-22 are
│                                   the palette; 126-356 are the component system.
├── package.json                    Workspace root + delegating scripts
├── PROCESS.md                      This file
├── README.md                       API + data-model reference
└── TUTORIAL.md                     Hands-on walkthrough
```

---

## 7. Conventions

**Routes**

- One router file per domain area; mount it in `src/app.js` **below** the
  `requireAuth` line.
- Wrap every handler in `asyncHandler` and `throw` an `ApiError` (or one of the
  `badRequest` / `notFound` / `conflict` helpers). Do not hand-roll try/catch
  around a whole handler any more.
- Response bodies are always a named-key object, never a bare array:
  `{ items: [...] }`, `{ transaction: {...} }`, `{ current: null }`.
- Validate with `src/lib/validate.js`, which names the offending field in the
  message. Chosen over zod deliberately: both clients present `data.error`
  directly to a person, so a schema library's issue arrays would have to be
  flattened back into exactly this shape.
- `201` for creates, `200` for an idempotent replay, `404` for a missing row,
  `409` for a conflicting state, `403` for a role or scope failure.
- Never leak driver internals. `errorHandler` maps known pg codes and constraint
  names to messages and logs the real error.
- Actor identity always comes from `req.user`. Client-supplied `performed_by` /
  `installed_by` are rejected with a loud 400 — silently ignoring them would let
  a client believe it wrote as someone else.

**SQL**

- Always parameterized (`$1`, `$2`, …). Never string-interpolate user input.
- Dynamic filters push onto a `params` array and reference `$${params.length}` —
  see `routes/transactions.js`.
- Set `updated_at = now()` explicitly on any `UPDATE` of a table that has it;
  there are no triggers.
- Take a row lock (`FOR UPDATE`) before reading a value you are about to decide
  on. `src/lib/stock.js` is the pattern.

**Schema changes**

- Add a new numbered migration in `db/migrations/`. **Never edit an applied
  one** — the runner's checksum check will reject it, on purpose.
- New enum values go on the existing `*_enum` types rather than becoming free
  text. Update the mirrored arrays in all three `constants.js` files.

**Clients**

- The mockup's tokens are copied verbatim into `apps/web/src/styles/tokens.css`
  and `apps/mobile/src/theme.js`. Do not re-pick colours.
- Coerce `NUMERIC` in a query's `select`, never in a component.
- Test `row.is_low_stock === true`, never truthiness.
- Every screen needs four states: loading, error, empty, populated. The mockup
  shows only the last one.
- Charts: see the rules in `charts/ChartFrame.jsx`. No dual-axis charts, every
  chart has a table view, one filter row per page.

**Style**

- Match the surrounding file: 2-space indent, single quotes, semicolons.
- Comment the *why*, not the *what*.

---

## 8. Known gaps

Recorded here so they are not rediscovered.

**Security**

- **Login throttling is per-process and in-memory.** `routes/auth.js` keeps a
  `Map`. It resets on restart and does nothing across multiple instances. It
  makes casual guessing slow; it is **not** real protection. Anything deployed
  publicly needs a shared store or a proxy-level limiter.
- **CORS is permissive when `CORS_ORIGINS` is empty**, which is the development
  default. Set the allowlist before deploying. Acceptable while auth is
  Bearer-token-only (no cookies, so no CSRF surface).
- **No token revocation beyond `is_active`.** A leaked token stays valid for
  `JWT_TTL`. The per-request user lookup in `requireAuth` is what makes
  deactivation immediate — see §5.
- **The dashboard stores its token in `localStorage`**, which is XSS-readable.
  The alternative (an httpOnly cookie) needs the API to set cookies, a CSRF
  strategy, and a same-site story across the Vite proxy, and helps the mobile
  app not at all. The mitigations in place are a short `JWT_TTL` and no
  third-party scripts on the dashboard. Keep it that way.
- **On web, the mobile app falls back to `localStorage`** because
  `expo-secure-store` is native-only. Native builds use the Keychain /
  EncryptedSharedPreferences.
- **Any authenticated user can search the whole customer address book.** That is
  what the mockup shows and what a tech arriving at an unlisted address needs,
  but it is a deliberate choice about PII, not an oversight.
- **Express 4 pulls a `qs` with known moderate DoS advisories** (`npm audit`
  reports 3). The fix is Express 5; the 4.x line has no patched release. Deferred
  rather than mixed into this build.

**Functionality**

- No CI.
- The clients have no automated tests (see §4).
- `GET /api/transactions` is capped at 500 rows and has no cursor pagination.
- `POST /api/item-instances` caps a batch at 200 units.
- A restock request can only carry **bulk** items. Which specific serialized unit
  a tech gets is the warehouse's choice at fulfilment time, so the API refuses a
  serialized line — the warehouse issues those with a normal transfer.
- Reports have no export. Everything is on screen or behind a chart's table view.
- The dashboard is dark-only. PMs printing reports will want light: the
  CSS-variable structure makes that a later `[data-theme="light"]` block with no
  component changes, but **the chart palette must be re-selected for light, never
  auto-flipped from dark.**
- `--text-3` (`#5A6478`) from the mockup measures 2.77:1 on `--surface`, below
  the 4.5:1 needed for normal text. Both clients promote load-bearing uses to
  `--text-2` and keep `--text-3` for decoration. This is a deliberate,
  documented deviation from the mockup.
- The brand teal `#2DD4BF` is **not** a legal chart fill (OKLCH L 0.785, above
  the dark categorical ceiling of 0.67). Series use `#17A398`. There is a comment
  in `chartTheme.js` saying so, because "fixing" the charts for brand
  consistency would break the palette.

**Not built, by design**

- **Barcode scanning.** Hooks in at `SerialPicker`'s search field: add an
  `expo-camera` button and feed the decoded string into `setFilter`. Nothing else
  changes — the picker already filters the van's units by serial.
- **Offline sync.** Hooks in at the mobile `QueryClient` (a persister plus a
  mutation queue). The idempotency keys it needs are already in the schema and
  already sent by both clients.
