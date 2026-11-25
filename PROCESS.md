# Development Process — FTTH Field Inventory

Reference for setting up, running, and extending this repo.

The domain, in one paragraph: a fibre operator works two rural sites in Kenya,
**Bungoma** and **Kisumu**. A field tech opens a **job**, capturing the premises
by GPS if nobody has recorded it, and the job owns everything the visit produced
— the unit fitted, the materials out of the van, the labour, and the money spent
getting there. A manager may dispatch a job instead, but does not have to. The
job, not the installation, is the unit of record; §5 says why that matters and
what it replaced.

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
IDs and the sign-in credentials. One of the seeded users is an `admin`.

Seeding assumes empty tables. To re-seed, truncate the data tables (leaving
`schema_migrations` alone) or drop and recreate the database.

### Create the first admin (on a database you are not seeding)

`POST /api/users` needs somebody already signed in, and a freshly migrated
database has nobody. This script writes the row directly, so run it on a machine
that can reach the database:

```bash
cd apps/api
ADMIN_NAME="Your Name" ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run create-admin
```

Prefer the environment variables to the `--email` / `--name` / `--password`
flags it also accepts: an argument list shows up in shell history and in `ps`.

Re-running it for an existing address promotes that user to admin, reactivates
them, and resets their password. That is deliberate — it is the recovery path
when the last admin account is lost, which the API itself will not help with.

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

### If port 4000 is already taken

The dashboard shows **"Request failed (404)"** on every call, including sign-in,
when something else is listening on :4000. Confirm with the health check above:
if the reply is not `{"status":"ok"}` (for example `{"detail":"Not Found"}` from
`server: uvicorn`), another program owns the port. One known culprit is the VS
Code **Stata MCP** extension, which serves on `localhost:4000`.

Move this app instead of fighting for the port:

1. `apps/api/.env`: `PORT=4100`
2. `apps/web/.env`: `API_PROXY_TARGET=http://localhost:4100`
3. Restart **both** `dev:api` and `dev:web` — each reads its `.env` at startup only.
4. Mobile: `EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:4100/api` in
   `apps/mobile/.env`. The app hardcodes `:4000` otherwise.

`apps/web/vite.config.js` reads `API_PROXY_TARGET` through Vite's `loadEnv`.
Vite does not copy `.env` values into `process.env` for its own config file, so
a plain `process.env.API_PROXY_TARGET` is silently ignored and the proxy falls
back to :4000 — the proxy target changes nothing until `loadEnv` is used.

To see what owns a port (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen |
  ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" } |
  Select-Object ProcessId, Name, CommandLine
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

175 tests across eight files, using `node:test` — zero dependencies, no build
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
| Admin | Reaches every correction path, still cannot break an invariant, and cannot be the last one demoted |
| Scoping | A field tech cannot read another location's stock |
| Idempotency | The same key replayed returns the original row, and moves stock once |
| Restock | Fulfilment moves the stock atomically, and fails as a whole if it cannot |
| Reports | Low stock includes locations holding **zero** of an item |
| Migrations | `up` is idempotent; an edited applied migration fails its checksum |
| Jobs | A tech can open their own job, cannot dispatch to another tech, and sees only their own |
| Job + premises | A job and a premises are created in one transaction, and an unfindable premises rolls the job back with it |
| Materials | Recording draws stock down; re-sending the identical list moves nothing; a correction returns the difference to the stock it came from |
| Materials | With no `from_location_id`, materials come out of the **job's site**; a tech may use their own van or the job's site and nothing else |
| Premises-less jobs | Only a new install, with a site and notes; attach later (edit, capture, or install); once only; same site; counts in cost reports |
| Hotspots | Hotspot needs a token/voucher; several routers allowed; replace names which; PPPoE still takes one (also in the database) |
| Former clients | Delete only without history (admin); former clients leave lists and cannot take new jobs/installs |
| Job sites | A job takes its premises' site, refuses a different one, files an un-sited premises under the job's site, and is listable per site |
| Materials | A serialized item is refused as a material, by the route **and** by `trg_job_material_is_bulk` |
| Costs | The total is the four buckets summed, and unpriced lines are counted rather than treated as free |
| Costs | A line's own cost beats the catalog and survives a re-pricing |
| Labour | A job that installs nothing can still record work — the case the old model could not express |
| Premises | GPS alone is enough; nothing findable is refused by the route **and** by `premises_must_be_locatable` |
| Premises | A tech may improve a GPS fix but not rename an address, and a fix cannot be cleared |
| Search | A premises is found by name, village, landmark or a partial phone number |
| Job ↔ premises | An installation cannot belong to a job at another premises, enforced by trigger |

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
  - `uq_active_installation_per_premises` — one active router per premises,
    unless it is a hotspot. Originally a partial unique index; 016 replaced it
    with `trg_one_active_router_unless_hotspot`, because whether a premises may
    hold several routers depends on its `connection_type`, which lives on another
    table. The trigger locks the premises row, so two techs installing at once
    still cannot both pass, and it raises under the old constraint name so the
    API's message for it is unchanged.
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

- **Labour hangs off the job, not the installation and not the address.** 009
  put it on `installations`, which meant a visit that fitted no hardware could
  not record any — and a tech who drives out to re-splice a cut cable does real,
  billable work and installs nothing. `013_job_costing.sql` moves it to
  `job_services`. Replacing a router years later still keeps each visit's work
  separate, because each visit is its own job; the premises timeline still shows
  labour per installation, resolved through `installations.work_order_id`, so the
  API shape the clients read did not change (`serviceLinesByInstallation` in
  `src/lib/jobLines.js`).

- **`job_materials`, `job_services` and `job_expenses` are the only cascades in
  the schema.** They describe one job and mean nothing without it. The
  `service_id` and `item_id` references do *not* cascade — a service or item in
  use deactivates, it never deletes.

- **All three job-line routes take the complete list.** Sending `[]` clears it
  and re-sending the same list twice leaves the same rows, so a tech on a bad
  connection can retry without an idempotency key. `PUT
  /api/installations/:id/services` is kept as the installation-addressed way in
  to the same write, because "record the work on this router" is how the premises
  screens are laid out.

- **`PUT /api/work-orders/:id/materials` moves stock by the DIFFERENCE.** This is
  the one place the complete-list rule does real work: the handler reads the
  existing lines, works out a per-item delta, and moves only that. Raise a line
  and the extra leaves the source; lower it and the difference goes back; drop it
  and all of it does. Re-sending an identical list moves nothing, which is
  exactly the retry case. A line records the location it was drawn from
  (`job_materials.from_location_id`) rather than deriving it, so a correction
  next week returns stock to the place that supplied it and not to wherever the
  person editing is working by then.

- **A job belongs to a site, and its materials come out of that site's stock.**
  `work_orders.site_id` (015) is the job's own site; a site is a `location`, so
  it holds stock like a warehouse or a van. `PUT .../materials` draws from the
  job's site unless `from_location_id` names another source, and a field tech
  may name only their own van or the job's site. Because of that, field techs may
  now read `GET /api/stock?location_id=` for **any site** (not other vans or
  warehouses) — see `assertStockReadable`. `POST /api/work-orders` takes a
  `site_id`, or inherits the premises' site, and refuses a job with neither; a
  premises with no site is filed under the job's, and a mismatch is a 400 (and,
  underneath, the `trg_job_site_matches_premises` trigger). Re-filing a premises
  under another site re-files its jobs with it.

- **Consumption is booked as `install` and a correction as `return`.** A material
  consumed on a job left the van and went into a customer premises, which is what
  `install` means, and a premises is not a `location` so there is no destination.
  `/api/reports/consumption` already counts `install`, so materials appear there
  without a new movement type. A downward correction writes a compensating
  `return`; over a period, consumption is installs minus returns, and the job
  cost report reads `job_materials` directly rather than the trail.

- **A rate is copied onto a line, never joined at read time.** `items.unit_cost`
  and `services.unit_rate` are the price list; `job_materials.unit_cost` and
  `job_services.unit_rate` are what was agreed on the day. Re-pricing the catalog
  changes the next job and leaves past ones alone. Hardware is the exception —
  `installations` carries no cost of its own, so it is priced from the catalog at
  read time and named as its own bucket in the response so nobody mistakes it for
  a figure agreed on the day.

- **An unpriced line is counted, not treated as free.** Every cost response
  carries `unpriced_lines`, and both clients render it next to the total. A total
  with unpriced lines behind it is a floor, and showing it as the answer is worse
  than showing no number at all.

- **A premises does not need an address.** `premises_must_be_locatable` requires
  an address *or* a landmark *or* a GPS pin. In the villages this serves streets
  have no names and houses have no numbers, so the old `NOT NULL` on `address`
  forced techs to invent one — and an invented address finds nothing. The
  `search_text` generated column is what makes a premises findable by customer
  name, phone, village or landmark, and the search route and the GIN index both
  name that one column so they cannot drift apart.

- **`premisesLabel` lives in the API.** Three clients need a title for a place
  that may have no address, and computing it in each of them separately is how
  two of them end up showing "Premises 41" for a house with a perfectly good
  landmark. The API sends it as `label`.

- **Any authenticated user may improve a GPS fix; only the warehouse may rename
  an address.** A tech who saved a premises indoors on a 200 m fix and walks
  outside to a 6 m one is correcting the single most useful field on the record,
  and making them phone the warehouse means it never gets done. A fix can be
  replaced, never cleared — something was installed against that record and the
  pin is how anyone finds it again.

- **A `DATE` is parsed as a string.** `src/lib/db.js` overrides pg's parser for
  OID 1082. The default turns a calendar day into a JS `Date` at midnight UTC,
  which serializes back out in Kenya (UTC+3) as the *previous* day — so a job
  performed on the 10th reached both clients as the 9th and landed in the wrong
  day's figures. This affects `work_orders.performed_on` and `scheduled_date`.

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

- **`GET /api/stock/overview` is back-office only.** One row per item per
  location (zero bulk rows left out), so the Stock on hand page needs one request,
  not one per location. A field tech's stock is their own van via `GET /api/stock`.
- **Items, locations and jobs share one rule: retire, don't delete.** Each has a
  three-dots row menu on its list page (`components/RowMenu.jsx`). Retire is
  `is_active=false` for items and locations, and status `cancelled` for a job.
  `DELETE` is admin-only and returns 409 when anything refers to the row: a
  location with stock, movements, restock requests, premises, job lines or an
  assigned user; a job with an installation, stock movement, or any
  material/labour/expense line. A location holding stock also cannot be retired.
- **Items are retired by default, deleted only when untouched.** `DELETE
  /api/items/:id` is admin-only and returns 409 if any unit, stock movement,
  restock line, job material line or non-zero stock row refers to the item;
  zero-quantity `stock_levels` rows are removed with it. Retiring
  (`is_active = false`) is the normal way to stop using an item.
- **Serialized vs bulk is a first-class split.** `items.tracking_type` decides
  which storage model applies — `item_instances` rows per physical unit, or a
  `stock_levels` quantity per `(item_id, location_id)`. Endpoints accepting
  either take `item_instance_id` **or** `item_id` + `quantity`, never both, and
  `transaction_serialized_xor_bulk` enforces it.

- **The job is the record, and an installation cannot exist without one.** 001
  described `work_orders` as an "optional layer", and that assumption is what
  went wrong: it took a manager dispatching every visit, so a tech who simply
  went and did the work had nowhere to record what it consumed.
  `012_jobs.sql` backfills a job for every orphan installation and makes
  `installations.work_order_id` `NOT NULL`. `POST /api/installations` opens a job
  when the caller names none, so the old request shape still works and no longer
  produces an install that belongs to nothing.

  `transactions.work_order_id` and `restock_requests` links stay nullable — a
  warehouse transfer belongs to no job.

  A trigger (`installation_job_same_premises`) enforces that a job and its
  installation are at the same premises. Two foreign keys to `customer_premises`
  with nothing tying them together is how a job at one house ends up owning the
  cable used at another.

- **A field tech may open a job.** `POST /api/work-orders` is open to every role.
  A tech-opened job is assigned to them whatever `assigned_tech_id` they send,
  starts `in_progress`, and is dated today; a manager-dispatched one starts
  `open` with no `performed_on` until the work is actually done. It also accepts
  a `premises` object, creating the place and the job in one transaction — a tech
  at an unrecorded compound gets one submit, and a dropped connection cannot
  leave an address with no job against it.

- **`performed_on` is the day the work was done.** Not `created_at`, which is
  only when the phone found signal, and not `scheduled_date`, which is the plan.
  Every cost and labour report windows on it, falling back to `completed_at` and
  then `created_at` so a row can never drop out of every window. A tech may
  correct it; that is deliberate, because recording Friday's work on Monday is
  the normal case.

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

- **`admin` passes every role check at one place, not fifteen.** `requireRole`
  in `src/middleware/auth.js` lets the role through before it looks at the list
  it was given, and `hasRole` in the web client mirrors it. Adding `'admin'` to
  each `requireRole(...)` call instead would fail in the worst direction: the
  next route someone writes gets whichever roles they happened to type, and an
  admin quietly cannot use it. The whole point of the role is that there is no
  table it cannot correct.

- **An admin is bounded by the invariants, not by the role checks.** It is a
  role check, not an authentication bypass. An installed unit still has to be
  removed through the installation endpoints, a location's `type` and an item's
  `tracking_type` are still fixed at creation, a terminal work order is still
  terminal, and `transactions` is still append-only. Anything an admin *can*
  correct is a route that keeps the rest of the record consistent while it does
  so.

- **A correction is still a movement in the audit trail.** `POST
  /api/stock/adjustments` and an admin `PATCH /api/item-instances/:id` both
  write an `adjustment` transaction naming who changed what and why — stock
  appearing is an arrival at the location, stock missing is a departure from it.
  The type exists (migration 010) precisely so a correction cannot be recorded
  as a `transfer` or a `receive`, which would be a lie about what happened.
  `POST /api/transactions` refuses to write it, exactly as it refuses `install`.

- **The stock adjustment endpoint takes the counted quantity, not a delta.**
  That is what the person holding the clipboard actually knows, and it makes the
  request safe to repeat: a second submit of the same count is a no-op rather
  than a second correction.

- **The system keeps at least one admin.** `PATCH /api/users/:id` refuses to
  demote or deactivate the last active one, and refuses to let an admin remove
  their own admin access. Losing it would leave a database nobody can correct
  without shell access to `db/create-admin.js`.

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
│   │   │   │   ├── 009_installation_services.sql  Labour ↔ installation
│   │   │   │   ├── 010_admin_role.sql  admin role + 'adjustment' movement
│   │   │   │   ├── 011_sites_and_premises_capture.sql
│   │   │   │   │                   Bungoma + Kisumu as sites; a premises a tech
│   │   │   │   │                   can capture by GPS, with no address
│   │   │   │   ├── 012_jobs.sql    The job becomes the record: created_by,
│   │   │   │   │                   performed_on, installations.work_order_id
│   │   │   │   │                   NOT NULL (backfilled)
│   │   │   │   ├── 013_job_costing.sql
│   │   │   │   │                   job_materials / job_services / job_expenses,
│   │   │   │   │                   items.unit_cost, services.unit_rate.
│   │   │   │   │                   installation_services folds into job_services
│   │   │   │   ├── 014_location_active.sql  Retiring a location
│   │   │   │   ├── 015_job_site.sql
│   │   │   │   │                   work_orders.site_id (backfilled from the
│   │   │   │   │                   premises) + a trigger keeping it in step
│   │   │   │   ├── 016_hotspots_and_former_clients.sql
│   │   │   │   │                   premises: PPPoE/hotspot, token/voucher,
│   │   │   │   │                   plot + flat, is_active; several routers
│   │   │   │   │                   allowed at a hotspot (trigger)
│   │   │   │   └── 017_job_premises_optional.sql
│   │   │   │                       a new install may have no premises yet
│   │   │   ├── create-admin.js     Bootstrap/recover an admin (no API needed)
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
│   │   │   │   ├── jobLines.js     Materials, labour and expenses: parse,
│   │   │   │   │                   write, read, and the cost roll-up
│   │   │   │   ├── premises.js     Capture rules, the locatable check, and
│   │   │   │   │                   premisesLabel (what to call a place)
│   │   │   │   ├── constants.js    Enum arrays + per-role movement table
│   │   │   │   └── serialize.js    publicUser — password_hash can never leak
│   │   │   ├── middleware/auth.js  requireAuth, requireRole, location scoping
│   │   │   └── routes/             auth, stock, premises, installations,
│   │   │                           transactions, catalog, users, jobs,
│   │   │                           itemInstances, restockRequests, reports
│   │   └── test/                   helpers.js + 8 *.test.js files
│   │                               (admin, auth, installations, jobs, labour,
│   │                                premisesCapture, restock, stock)
│   ├── web/
│   │   └── src/
│   │       ├── main.jsx  mount.jsx  router.jsx
│   │       ├── styles/             tokens.css (from the mockup) · base · components
│   │       ├── lib/                api · ApiError · num · format · money
│   │       │                       constants · queryKeys · queryClient
│   │       │                       groupSerialized
│   │       ├── auth/               AuthProvider · AuthContext · tokenStore · routes
│   │       ├── components/         AppShell · DataTable · Meter · Badge · Toast
│   │       │                       Modal · fields · states · PageHeader
│   │       │                       InstallationServices (summary + editor)
│   │       │                       JobLines (cost card + the three editors)
│   │       │                       PremisesFields (shared capture form)
│   │       ├── charts/             chartTheme · ChartFrame · marks · LazyMarks
│   │       ├── hooks/              useData (queries + mutations) · useDebounced
│   │       └── pages/              login · overview · items · services · locations
│   │                               stock · premises · workorders · restock · users
│   │                               reports
│   └── mobile/
│       ├── app/                    expo-router file routes
│       │   ├── _layout.jsx         fonts, providers, auth gate
│       │   ├── login.jsx  profile.jsx  restock.jsx  +not-found.jsx
│       │   ├── (tabs)/             _layout · jobs · stock · history
│       │   ├── jobs/               new.jsx  (start a job, capturing the
│       │   │                       premises inline if it is not on record)
│       │   │                       [id].jsx  (the job: router, materials,
│       │   │                       work, costs, complete)
│       │   │                       [id]/materials · [id]/work · [id]/expenses
│       │   └── premises/           [id].jsx · new.jsx · [id]/install · [id]/replace
│       │                           [id]/work  (amend recorded labour)
│       ├── src/
│       │   ├── theme.js            The mockup's tokens, ported
│       │   ├── lib/                config (LAN host) · format · money
│       │   │                       constants · groupSerialized
│       │   ├── api/                client · queries
│       │   ├── auth/               AuthProvider · tokenStore (SecureStore)
│       │   └── components/         ui · Screen · fields · SerialPicker
│       │                           ServicePicker · MaterialPicker
│       │                           ExpenseEditor · CostSummary
│       │                           GpsField · PremisesForm
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
- **Job costs are costs, not billing.** There is no invoice, no customer-facing
  total, no tax and no margin. `job_expenses` records what a tech spent; there is
  no reimbursement or approval flow behind it, so a fare recorded here is a cost
  the business now knows about, not a claim anybody has paid.
- **Currency is KES throughout, and not configurable.** Every money column is
  `NUMERIC(12,2)` and the responses carry `currency: 'KES'` so a client never
  guesses. A second currency would need a column, not a find-and-replace.
- **Editing materials on a job moves stock immediately, whatever the job's
  status.** Only cancelling a job freezes its lines. A cost remembered on the
  drive home has to have somewhere to go, so a completed job stays editable —
  which does mean a correction weeks later moves today's stock. Reconcile with
  `POST /api/stock/adjustments` if that has drifted.
- **`/api/reports/consumption` counts installs without subtracting the returns a
  downward material correction writes.** Its subject is stock movement, and
  changing that would change what every existing number on that report means.
  `/api/reports/job-costs` reads `job_materials` directly and is the netted view.
- **Sites are `locations` of type `site`, and there are two of them.** Bungoma
  and Kisumu are inserted by `011_sites_and_premises_capture.sql`, not seeded, so
  a deployed database has them. A third site is an `INSERT INTO locations`; the
  `SITE_NAMES` arrays in the three `constants.js` files exist only so a client
  can label one without a round trip. A *premises* may still have no site (a
  compound captured in a hurry can be filed later), but a new *job* may not:
  it needs a site to draw materials from, so opening one files the premises.
- **The GPS pin is a point, with no map.** Neither client renders a map or
  navigates to a fix: the field app shows the coordinates and an accuracy
  verdict, and the dashboard shows the numbers. A map tile layer is a network
  dependency in places that have none, and the number is what a tech reads out
  over a phone. `gps_accuracy_m` is recorded so a bad fix can be told from a
  good one; nothing refuses a bad one, because a rough pin beats no pin.
- **A premises is PPPoE or a hotspot, and that changes three rules.** (1) A
  hotspot may carry several active routers; a PPPoE premises one. (2) A hotspot
  must record `hotspot_arrangement` — `token` (we pay the host) or `voucher` (we
  give them one) — and nothing else may carry it; `hotspot_arrangement_matches_connection`
  enforces both ways, and moving a premises off hotspot clears it for you. (3) For
  a hotspot the customer name and phone are the **contact person**; there is no
  separate column, only different wording in the clients. `GET /premises/:id/current`
  returns `installations` (all live routers) as well as `current` (the first, kept
  for older clients), and `POST /installations/:premisesId/replace` takes an
  `installation_id` — optional with one router, required with several, because
  guessing would pull the wrong one off the wall. A hotspot's `replacement_count`
  counts routers taken out, since its extra routers are additions, not swaps. A
  hotspot with more than one router cannot be reclassified as PPPoE until it is
  down to one. There is still no plain "remove a router" action — only replace.
- **A new install can be dispatched with no premises; nothing else can.**
  `work_orders.customer_premises_id` is nullable (017), guarded by
  `job_premises_required_unless_new_install`: with no premises the job must be a
  `new_install`, have a site, and have non-empty notes — the notes are the rough
  location, the only thing that says where it is. `POST /api/work-orders` enforces
  the same with sentences a person can act on. The premises is attached later by
  `PATCH /api/work-orders/:id` with `customer_premises_id` (or a `premises` object,
  captured on the spot and filed under the job's site), or automatically when a
  router is installed against the job (`resolveJob` in `installations.js`); both go
  through `lib/jobPremises.js`, which refuses a job that already has one, a premises
  at another site, and a former client. Field techs may attach (it is what they do
  on arrival). A premises-less job still carries a `premises` object on the wire,
  with nothing in it and `label: 'Location to be confirmed'`, so a client reading
  `premises.village` does not crash — `customer_premises_id === null` is how to
  tell. A job can be completed before it has a premises; it is not blocked on one.
- **A premises that stops being a client is marked, not deleted — unless it never
  had any history.** `DELETE /api/premises/:id` is admin-only and refuses (409) a
  premises with a job or an installation, because those rows carry the cost and
  stock history. The route for a real former client is `PATCH { is_active: false }`
  (warehouse staff, PMs, admins): it leaves every list, search and picker
  (`?include_inactive=true` brings it back) and refuses new jobs and installs until
  reinstated. A router still installed at a former client stays `installed`.
- **Multi-item transfers are several requests, not one transaction.** The
  Transfer page's bulk tab takes any number of item/quantity lines and sends one
  `POST /api/transactions` per line (as the serialized tab already did per unit),
  so one line failing — say the stock was just drawn down — leaves the others
  moved and keeps only the failed lines on the form, each with its reason. A
  single all-or-nothing endpoint is the obvious next step if that proves too loose.
- **No geographic search.** "Premises near me" would need PostGIS or a bounding
  box, and the fallback that exists — browse the site's list — is short enough at
  two sites' worth of premises. `GET /api/premises?site_id=` caps at 500.
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
