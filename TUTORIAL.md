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
Applying 006_catalog_items.sql ... ok
Applying 007_services.sql ... ok
Applying 008_merge_sleeves.sql ... ok
Applying 009_installation_services.sql ... ok
Applied 9 migration(s).
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
Seeded users: 6
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
administrator:    alice.wambui@ftth.local
password (all):   ftth-dev-password
```

Note the four accounts — the rest of this tutorial switches between them,
because **who you are signed in as changes what you can do.**

The administrator is the odd one out: it is not a fourth job, it is the account
that can go back and fix a record the normal workflow has already written wrong.
Part 11 is about that. On a database you have *not* seeded, there is no admin
yet and nobody who can create one over the API — make the first one directly:

```bash
cd apps/api
ADMIN_NAME="Your Name" ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run create-admin
```

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

ADMIN=$(curl -s localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"alice.wambui@ftth.local","password":"ftth-dev-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
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

### Recording the work, not just the hardware

Under the unit picker is **Work performed (optional)** — the services catalog
the warehouse maintains under **Catalog → Services** on the dashboard. Tap a
service to include it.

Flat-rate work ('job') is the whole interaction: tap Splicing and move on, no
keyboard. Only work charged per metre asks for a number, because that is the
only case where the amount is not always one:

```bash
curl -s localhost:4000/api/installations   -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'   -d '{"customer_premises_id": 2, "item_instance_id": 1,
       "services": [{"service_id": 6},
                    {"service_id": 3, "quantity": 40, "notes": "Along the back fence"}]}'
```

The lines are written in the same transaction as the install, so a bad
`service_id` rolls the whole thing back — no half-recorded visit where the
router moved but the paperwork did not.

Got home and remembered a splice? The site-history screen has **Record work
performed**. It is a `PUT` of the complete list, so retrying on a bad connection
is safe:

```bash
curl -s -X PUT localhost:4000/api/installations/2/services   -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'   -d '{"services": [{"service_id": 6}]}'
```

A tech may only amend an installation they performed, and only while it is still
the active one. Correcting a visit that has since been replaced is a warehouse
job — closed history should not move under a report's feet.

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

### Services

Labour performed on site, which is deliberately **absent from Consumption** — a
splice is not stock leaving the business, and folding the two together would
make "consumed" mean two different things in one number.

Two things this report is careful about:

- **The date is when the work was done**, taken from `installations.installed_at`,
  not when someone typed it in. A tech recording Friday's splice on Monday still
  lands in Friday.
- **Quantities are never summed across units.** 40 m of cable run plus one splice
  is not 41 of anything, so the totals tile reads `412 m · 37 jobs`. Grouped by
  tech, quantity is omitted entirely and the count of services performed is
  shown instead.

```bash
curl -s "localhost:4000/api/reports/services?group_by=service&from=2026-01-01"   -H "Authorization: Bearer $TOKEN"
```

Every chart has a **Table** toggle, so no value is only reachable by hovering.
Filter state lives in the URL, so a report is a link you can send someone.

---

## Part 11 — Corrections (the administrator account)

Everything up to here has been the system working as intended: stock arrives,
moves, gets installed, and every step leaves an audit row. This part is about
the other half of real operations — the record being wrong, and nobody being
able to undo what has already been written.

Sign in as `alice.wambui@ftth.local`. She is an `admin`, and the difference
shows up in three places.

### 11.1 An admin reaches every screen

There is no "admin section". The administrator passes every role check in the
API, so the dashboard shows the union of what everyone else sees: the stock
screens warehouse staff get, the reports, and the Users page a PM gets. A route
added next month does not have to remember to include the role.

What that does **not** mean is a way around the rules. Try to retire a unit that
is currently installed at a customer address:

```bash
curl -s -X PATCH localhost:4000/api/item-instances/3 \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"status":"retired"}'
```

```json
{ "error": "Serial ZTE60912F7A3B is installed at a customer premises — remove it first" }
```

That is the same 409 anyone else gets. The unit is one half of a live
installation; removing it through the installation endpoint fixes both rows
together, and there is no path that fixes only one.

### 11.2 Fixing a record: a serial keyed wrong

A carton of ONTs was received last week and one serial went in with a lowercase
l where the label has a 1 — `HW8245Q2-99lA`. Every scan of that unit since has
failed to find it. Set it to what the label actually says:

```bash
curl -s -X PATCH localhost:4000/api/item-instances/1 \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"serial_number":"HW8245Q2-991A","notes":"Keyed wrong off the carton"}'
```

Nothing physically moved, so this is not a transfer — but the row changed, so
the API writes an `adjustment` transaction against Alice's name carrying that
note. Look it up:

```bash
curl -s "localhost:4000/api/transactions?item_instance_id=1&type=adjustment" \
  -H "Authorization: Bearer $ADMIN"
```

The same PATCH also takes `mac_address`, `status` and `current_location_id`, for
a unit recorded in the warehouse that has been riding around in a van for a
week. Warehouse staff sending any of those get a 400 pointing them at
`POST /api/transactions` instead — because for them, a unit in the wrong place
is a movement nobody recorded, not a typo.

### 11.3 Reconciling stock against a physical count

The shelf says 2380 m of drop cable. The seeded warehouse says 2400. Nobody can
say what happened to the other 20.

On the dashboard: **Locations → the warehouse → Bulk**, then **Correct** on the
row. Over curl:

```bash
curl -s -X POST localhost:4000/api/stock/adjustments \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"item_id":4,"location_id":1,"counted_quantity":2380,"notes":"Physical count, quarter end"}'
```

```json
{
  "adjusted": true,
  "previous_quantity": 2400,
  "quantity": 2380,
  "delta": -20,
  "transaction": { "type": "adjustment", "quantity": "20", "from_location_id": 1, "…": "…" }
}
```

Three things about that request are deliberate:

- **It takes the count, not the difference.** That is what the person holding
  the clipboard knows. It also makes the request safe to repeat — submit the
  same count twice and the second one answers `"adjusted": false` and writes
  nothing.
- **`notes` is required.** An adjustment with no stated reason is unauditable,
  and this is the one endpoint that can change a quantity with no movement
  behind it.
- **It is admin-only.** A stock level that disagrees with the shelf is usually a
  movement somebody forgot to record, and the right fix for that is to record
  the movement. Reach for an adjustment when nobody can say what happened.

Serialized items are not counted this way — `POST /api/stock/adjustments`
rejects them. A serialized unit is corrected individually, as in 11.2, because
"there are three on the shelf" does not say *which* three.

### 11.4 Correcting the record of a visit

A job done on Friday was entered on Monday, and the timeline shows it on the
wrong day. Only the dates, the work order link and the removal reason are
editable — never who installed what, or where:

```bash
curl -s -X PATCH localhost:4000/api/installations/1 \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"installed_at":"2026-01-15T09:00:00Z"}'

# The same PATCH takes work_order_id, to link a visit to the job it was for
# (or null, to unlink one filed against the wrong job).
```

```bash
# Rewriting who did it is refused outright
curl -s -X PATCH localhost:4000/api/installations/1 \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"installed_by":4}'
# {"error":"installed_by must not be sent — a correction cannot rewrite who did what, …"}
```

To change *which* unit is installed at an address, replace it. That is a real
event, and it belongs in the timeline as one.

### 11.5 The system will not let you lose the last admin

```bash
curl -s -X PATCH localhost:4000/api/users/6 \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"role":"pm"}'
```

```json
{ "error": "You cannot remove your own administrator access — ask another administrator to do it" }
```

And with a different admin doing it, if that is the only one left:

```json
{ "error": "That is the last active administrator. Give another user the admin role first." }
```

A database with no admin is one nobody can correct through the API at all. If it
happens anyway, `npm run create-admin -w apps/api` on the server is the way back
— it promotes an existing account and resets its password.

### What an admin still cannot do

| | Why |
|---|---|
| Edit or delete a `transactions` row | The audit trail is append-only. A correction is a *new* row, never an edit to an old one. |
| Change a location's `type` or an item's `tracking_type` | Every stock row already booked there was booked against that kind of place, or that storage model. |
| Set a unit's status to `installed` by hand | That is a claim about a customer address. Only `POST /api/installations` can make it true on both sides. |
| Reopen a completed or cancelled work order | Terminal is terminal — `completed_at` would stop meaning anything. |
| Edit a unit that is currently installed | Remove it through the installation endpoints; that fixes both rows at once. |

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
| Rename a location / reassign a van | dashboard → Locations → Edit | `PATCH /api/locations/:id` |
| Fix a customer address | dashboard → Premises → Edit premises | `PATCH /api/premises/:id` |
| Fix a serial or MAC on a unit | admin, over the API | `PATCH /api/item-instances/:id` |
| Reconcile stock against a count | dashboard → Locations → Correct (admin) | `POST /api/stock/adjustments` |
| Correct the date on an install | admin, over the API | `PATCH /api/installations/:id` |
| Create the first admin | the server's shell | `npm run create-admin -w apps/api` |
| See what needs reordering | dashboard → Reports | `GET /api/reports/low-stock` |
| Record work done on a visit | mobile → install / Record work | `PUT /api/installations/:id/services` |
| See labour billed this month | dashboard → Reports → Services | `GET /api/reports/services` |

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
| `is installed at a customer premises — remove it first` | Editing a unit that is in service | Remove or replace it; that fixes both rows |
| `Only an administrator can change: …` | Staff account editing a unit's serial or location | A unit in the wrong place is a movement — `POST /api/transactions` |
| `That is the last active administrator` | Demoting the only admin | Give another user the admin role first |
| `This action requires one of: admin` | Non-admin on a correction endpoint | Sign in as an admin, or `npm run create-admin -w apps/api` |
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
