# Tutorial — FTTH Field Inventory

A hands-on walkthrough for someone touching this repo for the first time. By the
end you will have all three apps running against a seeded database, and you will
have driven the full workflow: receive stock into a warehouse, transfer it to a
van, install a router from a phone, replace a faulty one, request a restock, and
read the whole thing back as reports.

If you only need reference material, see [README.md](README.md) for the endpoint
and data-model tables, and [PROCESS.md](PROCESS.md) for architecture and
conventions.

---

## What this system is for

A fibre-to-the-home operator has technicians driving vans full of equipment to
customer homes. Two things have to stay true:

1. **Where is every piece of equipment right now?** Some equipment is
   serialized and tracked one unit at a time (ONTs, media converters — each has
   a serial number and MAC address). Some is bulk and tracked by quantity
   (drop cable in metres, connectors, heat-shrink sleeves).
2. **What is the history at each customer address?** Which router is installed
   there today, which ones were there before, why each was removed, and how many
   times it has been replaced.

Serialized units live in `item_instances`; bulk quantities live in
`stock_levels`. Every movement of either writes a row to `transactions`, which is
append-only.

Three apps sit on top of that:

- **`apps/api`** — the REST API and the database. All the rules live here.
- **`apps/web`** — the warehouse dashboard. Receiving, transfers, work orders,
  the restock queue, user admin and reporting.
- **`apps/mobile`** — the field tech's phone app. Their van's stock, and
  installing or replacing a router at a customer address.

---

## Part 1 — Get it running

### 1.1 Install

```bash
npm install                              # from the repo root: all three workspaces
cp apps/api/.env.example apps/api/.env
```

Open `apps/api/.env` and set `DATABASE_URL` to a Postgres database you can write
to. While you are there, set a real `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 1.2 Create the database and migrate

```bash
createdb ftth_inventory
npm run migrate
```

You should see:

```
Applying 001_init.sql ... ok
Applying 002_auth.sql ... ok
Applying 003_idempotency.sql ... ok
Applying 004_restock_requests.sql ... ok
Applying 005_guards.sql ... ok
Applied 5 migration(s).
```

This works the same in PowerShell, cmd.exe and bash. Run it again and it says
`Database is up to date` — it is safe to re-run.

> **Already have a database from the old `db/schema.sql`?** Run
> `npm run migrate -w apps/api -- baseline 1` first, then `npm run migrate`.
> See [PROCESS.md](PROCESS.md) §2.

### 1.3 Seed sample data

```bash
npm run seed
```

```
Seeded users: 5
Seeded locations
Seeded items: 6
Seeded item instances: 2
Seeded stock levels
Seeded premises: 1
Seeded active installation at premises 1

--- Reference IDs for smoke testing ---
warehouse_location_id: 1
van_location_id: 2
premises_id: 1
john_kamau_user_id: 1
new_ont_instance_id (in van, ready to install): 1

--- Sign in with ---
field tech:       john.kamau@ftth.local
warehouse staff:  grace.njeri@ftth.local
project manager:  peter.mwangi@ftth.local
password (all):   ftth-dev-password
```

Note the three accounts — the rest of this tutorial switches between them,
because **who you are signed in as changes what you can do.**

### 1.4 Start the API

```bash
npm run dev:api
```

```bash
curl http://localhost:4000/api/health
# {"status":"ok"}
```

Health is the only unauthenticated endpoint besides login. Anything else without
a token is a 401:

```bash
curl http://localhost:4000/api/items
# {"error":"Send an Authorization: Bearer <token> header"}
```

### 1.5 Get a token

```bash
curl -s http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"grace.njeri@ftth.local","password":"ftth-dev-password"}'
```

```json
{
  "token": "eyJhbGciOi...",
  "user": {
    "id": 4,
    "name": "Grace Njeri",
    "email": "grace.njeri@ftth.local",
    "role": "warehouse_staff",
    "assigned_location_id": 1,
    "assigned_location_name": "Central Warehouse - Nairobi",
    "assigned_location_type": "warehouse",
    "is_active": true
  }
}
```

For the curl examples below, save it:

```bash
STAFF=$(curl -s localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"grace.njeri@ftth.local","password":"ftth-dev-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

TECH=$(curl -s localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"john.kamau@ftth.local","password":"ftth-dev-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
```

Then every request carries `-H "Authorization: Bearer $STAFF"`.

> **`performed_by` and `installed_by` are gone from every request body.** The API
> takes the acting user from the token. Sending them is a 400, not a silent
> ignore — otherwise a client could believe it wrote as someone else.

### 1.6 Start the dashboard

```bash
npm run dev:web       # in a second terminal
```

Open <http://localhost:5173> and sign in as `grace.njeri@ftth.local`. Vite
proxies `/api` to `:4000`, so CORS never comes into it during development.

### 1.7 Start the mobile app

```bash
npm run dev:mobile    # in a third terminal
```

Scan the QR code with **Expo Go** on a phone that is on the same Wi-Fi as your
dev machine, and sign in as `john.kamau@ftth.local`.

The app derives the API address from Metro's host, which in Expo Go is your
machine's LAN IP — so there is nothing to configure. If it cannot connect, open
the **Profile** tab: it shows the resolved API URL and where that URL came from.
See [PROCESS.md](PROCESS.md) §3 for the short debugging path.

---

## Part 2 — Receive stock into the warehouse

Signed in as **Grace Njeri (warehouse staff)**.

The seeded warehouse has bulk stock but no serialized units. Before this build
there was no way to create one at all — nothing in the API inserted an
`item_instances` row — so receiving ONTs from a supplier was impossible.

### 2.1 On the dashboard

**Stock → Receive stock**, with the **Serialized** mode selected. Choose
`ONT HG8245Q2`, choose `Central Warehouse - Nairobi`, and paste a block of
serials — one unit per line, MAC after a comma if you have it:

```
HW8245Q2-A001, F0:9E:63:22:90:01
HW8245Q2-A002, F0:9E:63:22:90:02
HW8245Q2-A003
```

The form previews what it parsed as a table before you commit, and flags a
repeated serial by line number. Press **Register 3 units**.

### 2.2 The same thing over curl

```bash
curl -s localhost:4000/api/item-instances \
  -H "Authorization: Bearer $STAFF" -H 'Content-Type: application/json' \
  -d '{
    "item_id": 1,
    "location_id": 1,
    "units": [
      {"serial_number":"HW8245Q2-A001","mac_address":"F0:9E:63:22:90:01"},
      {"serial_number":"HW8245Q2-A002","mac_address":"F0:9E:63:22:90:02"},
      {"serial_number":"HW8245Q2-A003"}
    ]
  }'
```

```json
{ "item_instances": [ … ], "created": 3 }
```

Two things happened per unit: an `item_instances` row, and a `receive`
transaction. Each serial's history now starts at the moment it entered the
business.

**The batch is all-or-nothing.** Send it again and the duplicate serials reject
the whole request with a 409 — including the third one, which would otherwise
have been fine:

```json
{ "error": "That serial number is already registered" }
```

### 2.3 Bulk receiving

Same page, **Bulk** mode — or:

```bash
curl -s localhost:4000/api/transactions \
  -H "Authorization: Bearer $STAFF" -H 'Content-Type: application/json' \
  -d '{"item_id":4,"quantity":500,"to_location_id":1,"type":"receive","notes":"DN-4471"}'
```

A field tech cannot do this. Try it with `$TECH`:

```json
{ "error": "Your role may only record: issue, return, faulty. Use a restock request to draw stock from a warehouse." }
```

---

## Part 3 — Transfer stock to a van

**Stock → Transfer stock** on the dashboard.

In **Bulk** mode, choose the warehouse as the source. The item dropdown shows
what it actually holds (`Drop Cable 1-core — 2400 meter on hand`), and typing a
quantity previews the result: `Drop Cable 1-core: 2400 → 2300 meter`.

**That preview is a convenience, not the guarantee.** The API takes a row lock
and refuses any movement that would leave stock negative, which is what makes
two operators racing safe. The page says so, in a banner, on purpose. Prove it:

```bash
curl -s localhost:4000/api/transactions \
  -H "Authorization: Bearer $STAFF" -H 'Content-Type: application/json' \
  -d '{"item_id":4,"quantity":999999,"from_location_id":1,"to_location_id":2,"type":"transfer"}'
```

```json
{ "error": "Not enough stock at that location: 2400 on hand, 999999 requested" }
```

In **Serialized** mode you pick specific units by checkbox — the page filters by
serial as you type and reports the outcome per unit, so one bad serial does not
hide the twelve that worked. Move three ONTs to `Tech Van JK-04`.

Then open **Locations → Tech Van JK-04**. Both location pages update from one
cache invalidation, and the serialized table has a **Group by model / Show every
serial** toggle.

---

## Part 4 — The field tech's van

Signed in on the phone as **John Kamau (field tech)**.

The **Stock** tab is the mockup's first screen. A stat row across the top
(Ready / Bulk items / Low stock), then serialized units grouped by model showing
`3 units in van`, then bulk items.

Three things are worth noticing:

- **Tap a model to expand its serial numbers.** Grouping gives the tech the count
  they need; expanding keeps the per-unit data they also need — to pick one, or
  to read a serial out over the phone.
- **Heat-shrink sleeves show an amber border and a "Reorder soon" badge.** The
  seed puts 6 in the van against a threshold of 20. `is_low_stock` is computed
  server-side and `COALESCE`d to `false`, so an item with *no* threshold is never
  falsely flagged.
- **There is a "To return to the warehouse" section** the mockup does not have.
  A van also carries units it took out of service. Badging those "Ready to
  install" would be a lie, and they are exactly what the tech has to run back.

Over curl, as the tech:

```bash
curl -s "localhost:4000/api/stock?location_id=2" -H "Authorization: Bearer $TECH"
```

A tech is scoped to their own van. Ask for the warehouse and you get a 403:

```bash
curl -s "localhost:4000/api/stock?location_id=1" -H "Authorization: Bearer $TECH"
# {"error":"Field techs can only access stock at their own assigned location"}
```

> A tech with no `assigned_location_id` sees an empty van however much stock is
> really there. The Stock tab says exactly that instead of showing "no stock" —
> a manager needs to set it under **Users** on the dashboard.

---

## Part 5 — Install a router

**Install** tab. Your open jobs are listed at the top; below that, a search box.

Search matches the street address **or** the customer account reference, so both
`Ngong` and `KE-77291` find the same row. Under two characters it shows a hint,
not "no results" — the API deliberately answers `{"results": []}` with a 200
there, and rendering that as an empty state would be wrong.

You can also type `PREM-00001`. That code is a display format computed from the
premises id; it is never sent to the API, but the search box accepts it so a tech
can type what is on a dispatch note.

Tap the result → the site history screen → **Install router**.

### The serial field is a filter, not free text

The mockup shows typed "serial number" and "MAC address" inputs. The API needs an
`item_instance_id`, and nothing turns an arbitrary typed serial into one. So the
field filters *your van's own units*: type or scan a serial to narrow the list,
tap to select. The MAC then renders **read-only** from the unit's record, because
the system already holds it.

Same interaction as the mockup, honest about the rule underneath: **you can only
install a unit you are actually carrying.** That is also the correct
authorization posture.

### The 409 is a first-class path

Premises 1 already has an active router from the seed, so the install screen
tells you so and offers **Replace it instead**. Over curl:

```bash
curl -s localhost:4000/api/installations \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"customer_premises_id":1,"item_instance_id":1}'
```

```json
{ "error": "An active router already exists at this premises. Use /replace instead." }
```

That 409 comes from an app-level check *and* is backed by
`uq_active_installation_per_premises`, a partial unique index. The app check
exists to give you that sentence; the index is the guarantee.

Two more guards worth trying:

```bash
# A unit that is not in_stock
# {"error":"Serial ZTE60912F7A3B is 'installed', not 'in_stock', so it cannot be installed"}

# A unit in the warehouse rather than your van
# {"error":"Serial HW8245Q2-A001 is not in your van"}
```

---

## Part 6 — Replace a faulty router

The site-history screen shows **Replace router** when something is installed and
**Install router** when nothing is. Only one, because offering both guarantees
one of them errors.

The replace screen is the mockup's second screen: the currently installed unit at
the top, the serial picker in the middle, and five reason pills at the bottom —
Faulty / Upgrade / Cancelled / Theft / Other — under the hint *"Required to
complete a replacement."*

That hint is literally true at three levels: the UI disables the button, the API
returns a 400, and `removal_reason_required_if_removed` rejects the row.

```bash
curl -s localhost:4000/api/installations/1/replace \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"new_item_instance_id":1,"removal_reason":"faulty"}'
```

In one transaction the API:

1. Takes `FOR UPDATE` on the active installation, so two techs cannot replace the
   same router at once.
2. Stamps `removed_at`, `removed_by` and `removal_reason` on it.
3. Marks the removed unit `faulty` (or `returned` for any other reason) **and
   parks it back in the tech's van** — so it shows up under "To return" rather
   than vanishing from every stock view with a NULL location.
4. Creates the new installation and marks the new unit `installed`.
5. Writes two audit rows: a `return` and an `install`.

`:premisesId` in that path is a **customer_premises id, not an installation id.**
Easy to get wrong; there is a comment about it in both clients' API modules.

### Retry safety

Both clients send an `idempotency_key` per submit. Send the same request twice
with the same key:

```bash
curl -s localhost:4000/api/installations/1/replace \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"new_item_instance_id":2,"removal_reason":"upgrade","idempotency_key":"demo-key-1"}'
```

The first call returns `201`. The second returns `200` with
`"replayed": true` and the *same* installation — not a second swap. Without this,
a flaky connection could double-install a router, and `transactions` is
append-only by design, so there would be no cleanup path.

---

## Part 7 — Site history

The **site history** screen, and `GET /api/premises/1/history`:

```json
{
  "premises": { "id": 1, "address": "14B Ngong Road, Nairobi", "customer_account_id": "KE-77291" },
  "total_routers": 2,
  "replacement_count": 1,
  "timeline": [ … ]
}
```

`replacement_count` is `total_routers - 1`, so the first router is not counted as
a replacement. Both figures are computed server-side.

The API returns **one row per installation**, each carrying both `installed_at`
and a nullable `removed_at`. The mockup's timeline shows separate "Installed" and
"Removed" entries, so both clients fan each row into up to two events and re-sort
descending. The oldest gets the label "Initial install"; a removal gets a grey dot
and a reason chip — teal for `upgrade`, red for everything else, matching the
mockup.

Note the asymmetry between two adjacent endpoints, which both clients handle:

| Endpoint | Nothing there | Unknown id |
|---|---|---|
| `/premises/:id/current` | `{"current": null}` with **200** | `{"current": null}` with 200 |
| `/premises/:id/history` | `timeline: []` with 200 | **404** |

"No router here" is a normal answer, not a missing resource.

---

## Part 8 — Restock requests

A tech running low needs stock. The only movement they could otherwise make is a
warehouse → van transfer, which would be self-issuing warehouse stock with no
approval. So a restock request is its own object.

### On the phone

**Stock → Request a restock.** It lists the bulk items, shows how much of each is
in the van, flags the low ones, and takes a quantity per item. Send it.

```bash
curl -s localhost:4000/api/restock-requests \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"from_location_id":1,"lines":[{"item_id":4,"quantity_requested":250}],"notes":"Running low"}'
```

The destination is always the caller's own van — a tech cannot request stock into
someone else's vehicle. Warehouse staff cannot raise one at all (403); it is a
field-tech action by definition.

### On the dashboard

**Stock → Restock queue.** Approve, reject, or **Fulfil**. Fulfilling opens a
dialog pre-filled with the requested amounts and showing what the warehouse
actually holds, so a partial fulfilment ("we only had 120 of the 200") is one
edit.

```bash
curl -s -X PATCH localhost:4000/api/restock-requests/1 \
  -H "Authorization: Bearer $STAFF" -H 'Content-Type: application/json' \
  -d '{"status":"fulfilled"}'
```

Fulfilment is what moves the stock: one `applyMove` per line plus a `transfer`
transaction each, all inside the same database transaction as the status change.
If the warehouse cannot cover a line, **the whole fulfilment is refused** and the
request stays open for a partial one.

---

## Part 9 — Work orders

Work orders are an entirely optional layer. Every `work_order_id` foreign key is
nullable — installs and stock movements work with or without one.

Create one from **Work orders → New work order**, then open it. The detail page
has a status stepper (open → in progress → completed, plus cancel), a tech
reassignment control, and a "Parts used on this job" table fed by
`GET /api/transactions?work_order_id=`.

A completed or cancelled job is terminal — reopening one would make
`completed_at` meaningless, so the API refuses:

```json
{ "error": "A completed work order can only move to: " }
```

A tech may progress their own job but not reassign or reschedule it, and cannot
touch a job assigned to someone else.

---

## Part 10 — Reporting

Four report pages, all warehouse-staff-or-manager only. A tech gets a 403 from
`/api/reports/*`, and the dashboard shows them their van instead of a wall of
errors.

### Low stock — a table, not a chart

A single ratio against a limit is a **meter**, not a chart, and quantities across
items with different units and different thresholds are not comparable on one
axis. So this page is a table with a per-row meter, sorted worst-first, and every
severity carries an icon **and** a text label — never colour alone.

The interesting part is what it includes: **items a location holds none of.** A
naive `GROUP BY` cannot report those — there is no row to group — so the item
that most needs reordering is exactly the one that disappears. The query
cross-joins active items with a threshold against every warehouse and van, then
left-joins the counts.

For serialized items it counts only units that are **installable**. Two in stock
plus one faulty is not three in stock.

### Consumption

Horizontal bars, top 12, one hue for every bar. Horizontal because item names are
long; one hue because these are nominal categories and colouring them by value
would double-encode what the bar length already says.

"Consumption" means stock that **left the business** — a router installed, or
bulk material issued to a job. A transfer between two locations is movement, not
consumption, and is deliberately excluded. The page says so in a banner, because
getting that wrong silently doubles every number.

### Tech activity

Installs and removals per tech. A removal is credited to whoever **removed** it,
not whoever installed it — so a replacement counts as one install and one
removal.

### Installations

Installs over time, removals over time, and a removal-reason breakdown. Two
stacked charts sharing one filter row rather than one chart with two y-axes:
**this dashboard has no dual-axis charts.** Empty buckets are rendered as zero
rather than skipped, so a gap reads as a gap instead of a straight line through
it.

Every chart has a **Table** toggle, so no value is only reachable by hovering.
Filter state lives in the URL, so a report is a link you can send someone.

---

## Common workflows at a glance

| I want to… | Where | Endpoint |
|---|---|---|
| Sign in | any client | `POST /api/auth/login` |
| Register new serialized stock | dashboard → Receive | `POST /api/item-instances` |
| Receive bulk stock | dashboard → Receive | `POST /api/transactions` type `receive` |
| Move stock between locations | dashboard → Transfer | `POST /api/transactions` type `transfer` |
| Find a unit by serial | dashboard | `GET /api/item-instances?serial=` |
| See what a location holds | dashboard → Locations | `GET /api/stock?location_id=` |
| See per-model counts | mobile Stock tab | `GET /api/stock/summary?location_id=` |
| Find a customer address | either | `GET /api/premises/search?q=` |
| Add a customer address | either | `POST /api/premises` |
| See what is installed somewhere | either | `GET /api/premises/:id/current` |
| See a site's full history | either | `GET /api/premises/:id/history` |
| Install a router | mobile | `POST /api/installations` |
| Replace a router | mobile | `POST /api/installations/:premisesId/replace` |
| Ask for more van stock | mobile → Restock | `POST /api/restock-requests` |
| Fulfil a restock request | dashboard → Restock queue | `PATCH /api/restock-requests/:id` |
| Progress a job | either | `PATCH /api/work-orders/:id` |
| Add a user / assign a van | dashboard → Users (PM only) | `POST` / `PATCH /api/users` |
| See what needs reordering | dashboard → Reports | `GET /api/reports/low-stock` |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `DATABASE_URL is not set` on startup | No `apps/api/.env` | `cp apps/api/.env.example apps/api/.env` and fill it in |
| `type "tracking_type_enum" already exists` during migrate | Database predates the migration runner | `npm run migrate -w apps/api -- baseline 1`, then `npm run migrate` |
| `Migration … contents have changed` | An applied migration was edited | Revert the edit; add a **new** numbered migration |
| `Send an Authorization: Bearer <token> header` | No token | Sign in; get one from `POST /api/auth/login` |
| `Your session has expired` | Token older than `JWT_TTL` | Sign in again |
| `This account is no longer active` | User deactivated | `requireAuth` re-reads the DB each request — reactivate under Users |
| `performed_by must not be sent` | Old client or old curl example | Remove it; the API takes it from the token |
| `Field techs can only access stock at their own assigned location` | Tech asked for another location | Expected. Use a warehouse account. |
| Mobile app shows an empty van | Tech has no `assigned_location_id` | Dashboard → Users → assign the van |
| Mobile app cannot reach the API | Phone not on the dev machine's network | Profile tab shows the resolved URL; open `<host>/api/health` in the **phone's** browser |
| `Cannot reach the server at http://localhost:4000/api` on the phone | Metro did not report a LAN host | Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` |
| Metro: "Unable to resolve module" for something installed | npm workspace hoisting | See the escape hatch in `apps/mobile/metro.config.js` |
| `Not enough stock at that location` | Movement would go negative | Expected. Lower the quantity. |
| `An active router already exists at this premises` | Installing where one is installed | Use replace |
| `removal_reason is required` | Replace without a reason | Pick one of the five |
| `npm test` refuses to run | `TEST_DATABASE_URL` unset or same as `DATABASE_URL` | Create a separate test database |
| Seed fails on duplicate key | Tables not empty | Truncate the data tables, or drop and recreate |

---

## Where to go next

- [README.md](README.md) — endpoint and data-model reference.
- [PROCESS.md](PROCESS.md) — architecture, conventions, and §8's list of known
  gaps. Read §8 before assuming something is missing by accident.
- `mockups/mobile_screens.html` — the design source of truth. Lines 9–22 are the
  palette both clients use verbatim; 126–356 are the component system.
- The two deliberate, documented deviations from that mockup are in
  [PROCESS.md](PROCESS.md) §8: the `--text-3` contrast fix, and the chart palette
  not using the brand teal.
- Barcode scanning and offline sync are designed for but not built. Both hook in
  at specific, commented seams — see the end of [PROCESS.md](PROCESS.md) §8.
