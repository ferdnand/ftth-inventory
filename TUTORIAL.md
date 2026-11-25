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

A fibre-to-the-home operator works two rural sites in Kenya, **Bungoma** and
**Kisumu**, with technicians driving vans full of equipment to customer
compounds. Three things have to stay true:

1. **Where is every piece of equipment right now?** Some equipment is
   serialized and tracked one unit at a time (ONTs, media converters — each has
   a serial number and MAC address). Some is bulk and tracked by quantity
   (drop cable in metres, connectors, heat-shrink sleeves).
2. **What happened on each visit, and what did it cost?** A visit is a **job**.
   The job owns the unit fitted, the materials out of the van, the labour, and
   the money spent getting there — fares included. A manager may dispatch a job,
   but usually does not: most of the work here is found, not ticketed, so the
   tech opens their own.
3. **What is the history at each premises?** Which router is installed there
   today, which ones were there before, why each was removed, and how many times
   it has been replaced.

Two things about a premises are worth saying up front, because they shape the
whole app:

- **It may not exist before the tech gets there.** A tech arrives, finds a
  household nobody has recorded, and captures it on the spot — in the same
  submit that opens the job, so a dropped connection cannot leave an address
  with no job against it.
- **It may have no address.** Out here streets have no names and houses have no
  numbers, and most premises are a single household in its own compound. What
  gets somebody back to the same gate is a **GPS pin**, then a landmark, then the
  customer's name and phone. So the rule is not "has an address" — it is "can be
  found again", and a pin satisfies it.

Serialized units live in `item_instances`; bulk quantities live in
`stock_levels`. Every movement of either writes a row to `transactions`, which is
append-only. What a job used and cost lives in `job_materials`, `job_services`
and `job_expenses`, all hanging off the job.

Three apps sit on top of that:

- **`apps/api`** — the REST API and the database. All the rules live here.
- **`apps/web`** — the warehouse dashboard. Receiving, transfers, jobs and their
  costs, the restock queue, user admin and reporting.
- **`apps/mobile`** — the field tech's phone app. Their jobs, their van's stock,
  and everything a visit produced.

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
Applying 010_admin_role.sql ... ok
Applying 011_sites_and_premises_capture.sql ... ok
Applying 012_jobs.sql ... ok
Applying 013_job_costing.sql ... ok
Applying 014_location_active.sql ... ok
Applying 015_job_site.sql ... ok
Applying 016_hotspots_and_former_clients.sql ... ok
Applying 017_job_premises_optional.sql ... ok
Applied 17 migration(s).
```

This works the same in PowerShell, cmd.exe and bash. Run it again and it says
`Database is up to date` — it is safe to re-run.

> **Run `npm run migrate` every time you pull.** A new feature that adds a column
> (a job's site, a premises' connection type) ships with a numbered migration, and
> the code assumes the column is there. Until you migrate, the API cannot read the
> table and the screens that depend on it come up **blank** — the jobs and
> premises pages did exactly this after migrations 015 and 016. To see whether
> you are behind:
>
> ```bash
> npm run migrate -w apps/api -- status    # PENDING lines are not applied yet
> ```
>
> The test suite does not catch this, because it migrates its own throwaway
> database on every run. Your development database only changes when you do.

> **Already have a database from the old `db/schema.sql`?** Run
> `npm run migrate -w apps/api -- baseline 1` first, then `npm run migrate`.
> See [PROCESS.md](PROCESS.md) §2.

### 1.3 Seed sample data

```bash
npm run seed
```

```
Seeded users: 6
Seeded locations, alongside sites: Bungoma, Kisumu
Seeded items: 6
Seeded services: 3
Seeded item instances: 2
Seeded stock levels
Seeded premises: 3
Seeded a completed job with materials, labour and expenses: 1

--- Reference IDs for smoke testing ---
warehouse_location_id: 3
van_location_id: 4
bungoma_site_id: 1
kisumu_site_id: 2
addressed_premises_id: 1
gps_only_premises_id: 2
completed_job_id: 1
open_job_id: 2
john_kamau_user_id: 1
new_ont_instance_id (in van, ready to install): 1

--- Sign in with ---
field tech:       john.kamau@ftth.local
warehouse staff:  grace.njeri@ftth.local
project manager:  peter.mwangi@ftth.local
administrator:    alice.wambui@ftth.local
password (all):   ftth-dev-password
```

Bungoma and Kisumu are **not** seeded — they are inserted by
`011_sites_and_premises_capture.sql`, because they are operational reference data
rather than a development fixture. A deployed database has them without ever
running the seed.

The three seeded premises are three shapes on purpose, because all three are
real: one with a street address, one household found only by a GPS pin and a
landmark (which is what most of Bungoma and Kisumu actually looks like), and one
business captured with a phone number and no address.

Job 1 is completed and carries everything a job can: the router fitted, 65 m of
cable and some sleeves, a splice and a cable run, and a 400-shilling fare. It
comes to **KES 7,285**, and it is what the cost report reads. Job 2 is open and
dispatched to John, so the field app's job list has something in it.

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
machine's LAN IP — so there is nothing to configure unless your API is not on
`:4000`; in that case set `EXPO_PUBLIC_API_PORT` in `apps/mobile/.env`. If it
cannot connect, open the **Profile** tab: it shows the resolved API URL and where
that URL came from. See [PROCESS.md](PROCESS.md) §3 for the short debugging path.

The warehouse dashboard also works in a phone browser: below 900px the sidebar
becomes a drawer behind the ☰ button. To open it from a phone, see
[PROCESS.md](PROCESS.md) §3, "Opening the dashboard on a phone".

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

**Several items move at once.** Press **+ Add another item** for each extra
line — cable, sleeves and connectors can go in one submit. An item already
chosen is dropped from the other lines' dropdowns. Each line is its own
request, so if one fails (someone just drew the stock down) the rest still
move and only the failed line stays on the form, with its reason beside it.

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

## Part 5 — A job, from arriving to done

The **Jobs** tab is the app's home screen, and it leads with **Start a job**
rather than a search box. That is the whole shape of the change: the manager does
not ticket every visit, so the tech opens their own. Anything a manager *did*
dispatch appears in the same list, tagged **Sent to you** — to the tech they are
the same thing.

Below the job list is a search box. It matches the customer's name, the village,
the landmark, a phone number, an address or an account reference — whichever
fragment the tech was given on the phone, which is rarely an address. Under two
characters it shows a hint, not "no results": the API deliberately answers
`{"results": []}` with a 200 there, and rendering that as an empty state would be
wrong.

You can also type `PREM-00001`. That code is a display format computed from the
premises id; it is never sent to the API, but the search box accepts it so a tech
can type what is on a dispatch note.

### 5.1 Starting a job at a place nobody has recorded

**Start a job** asks three things: what kind of job, which **site** (Bungoma or
Kisumu), and which premises. The premises options only ever show that site —
change the site and the list changes with it, and a premises filed under the
other site is refused by the API. The premises has three ways in, in the order
they are actually useful here:

- **Pick from site** — scroll the premises already recorded at Bungoma or
  Kisumu. This exists because a compound saved as a GPS pin and a landmark has
  nothing anyone would think to type into a search box.
- **Search** — the same search as above, narrowed to one site.
- **New premises** — capture it now.

The capture form leads with **Use my location**, because that is the field that
always works. It takes one fix on demand — no background tracking — and grades
it: under 20 m is a *Good fix*, under 50 m a *Rough fix*, worse than that *Too
rough*, with a nudge to step into the open and tap again. A rough pin is still
saved, because a rough pin beats no pin.

Then the customer's name and phone, the village, the landmark, and the kind of
premises (a single household in its own compound is the default, because it is
the common case). The address is last and optional.

One submit creates both the premises and the job, in one transaction:

```bash
curl -s localhost:4000/api/work-orders \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"type": "new_install",
       "premises": {"customer_name": "Nekesa Wanyonyi",
                    "customer_phone": "0733123456",
                    "village": "Nasianda",
                    "landmark": "Third compound past the borehole",
                    "site_id": 1,
                    "gps_lat": 0.5635, "gps_lng": 34.5606, "gps_accuracy_m": 8}}'
```

```json
{ "work_order": { "id": 3, "status": "in_progress", "performed_on": "2026-09-10",
                  "label": "Third compound past the borehole, Nasianda",
                  "site_name": "Bungoma", "customer_premises_id": 4 } }
```

Three things in that response are worth noticing:

- **`status` is `in_progress`, not `open`.** A tech-opened job exists because
  they are standing there. A manager-dispatched one starts `open` with no
  `performed_on` until somebody goes.
- **`performed_on` is today.** It is the day the work was *done*, which is not
  the day it reached the server — a tech recording Friday's job on Monday is
  normal, and every cost report windows on this date, so the tech can correct it.
- **`label` is what to call the place.** There is no address, so the API falls
  back through landmark → customer name → the pin, and qualifies it with the
  village. It sends the label so three clients cannot disagree about it.

Try it with nothing findable and both the premises and the job are refused
together:

```bash
curl -s localhost:4000/api/work-orders \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"type": "repair", "premises": {"customer_name": "No idea where"}}'
```

```json
{ "error": "A premises has to be findable again: give an address, a landmark, or a GPS fix" }
```

That sentence comes from the app; `premises_must_be_locatable` in the database is
the guarantee behind it.

### 5.2 The job screen

Opening the job gives one screen with everything on it: the premises (with the
pin and a link to improve it), the router, **Materials**, **Work done**, **Other
costs**, a running total, and **Mark the job done**.

The router row goes to the same install screen the rest of this part describes,
carrying the job along so the hardware lands on it.

Tap the result → the site history screen → **Install router**.

### 5.3 Fitting the router: the serial field is a filter, not free text

The mockup shows typed "serial number" and "MAC address" inputs. The API needs an
`item_instance_id`, and nothing turns an arbitrary typed serial into one. So the
field filters *your van's own units*: type or scan a serial to narrow the list,
tap to select. The MAC then renders **read-only** from the unit's record, because
the system already holds it.

Same interaction as the mockup, honest about the rule underneath: **you can only
install a unit you are actually carrying.** That is also the correct
authorization posture.

### 5.4 Recording the work, not just the hardware

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

`PUT /api/installations/:id/services` and `PUT /api/work-orders/:id/services` are
the same write reached from two directions. Use the job one when the visit fitted
no hardware at all, which is the case the old model could not express:

```bash
# A tech drives out, re-splices a cut cable, and installs nothing.
curl -s localhost:4000/api/work-orders \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"type": "repair", "customer_premises_id": 4}'

curl -s -X PUT localhost:4000/api/work-orders/5/services \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"services": [{"service_id": 1}]}'
```

```json
{ "costs": { "labour_total": 500, "hardware_total": 0, "total": 500 } }
```

### 5.5 The 409 is a first-class path

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

That 409 comes from an app-level check *and* is backed by the database
(`uq_active_installation_per_premises`, now raised by a trigger — see Part 7b).
The app check exists to give you that sentence; the database is the guarantee.

Two more guards worth trying:

```bash
# A unit that is not in_stock
# {"error":"Serial ZTE60912F7A3B is 'installed', not 'in_stock', so it cannot be installed"}

# A unit in the warehouse rather than your van
# {"error":"Serial HW8245Q2-A001 is not in your van"}
```

### 5.6 The materials — this is the one that moves stock

**Materials** on the job screen lists the bulk stock **at the job's site** (a job
at Bungoma draws on Bungoma's stock), with what is available against each row
and the price per unit. Tap one, type how much you used. Send a
`from_location_id` to draw from something else — a tech may name their own van
or the job's site, nothing more.

```bash
curl -s -X PUT localhost:4000/api/work-orders/3/materials \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"materials": [{"item_id": 4, "quantity": 55},
                     {"item_id": 5, "quantity": 3}]}'
```

The site had 180 m of drop cable; it now has 125. The list you send is the
**complete** list, not an addition, and the API moves stock by the *difference*
between what was there and what you sent. Three things follow from that, and all
three are worth trying:

```bash
# Send the identical list again. Nothing moves — the difference is zero.
# This is why none of these routes needs an idempotency key: a second tap on a
# dying connection is a no-op, not a double entry.

# Correct 55 down to 40. Fifteen metres come back to the site's stock.
curl -s -X PUT localhost:4000/api/work-orders/3/materials \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"materials": [{"item_id": 4, "quantity": 40}, {"item_id": 5, "quantity": 3}]}'

# Drop a line entirely and all of it comes back.
```

The picker's arithmetic follows the same rule: what you may claim is the site's
balance **plus** whatever this job already took out of it, so a line recorded at
55 can be corrected up to 195 even though the site only shows 125 on hand.

A router is not a material — it is traced to the premises by serial through the
installation, so counting it here would double it in the cost total:

```bash
curl -s -X PUT localhost:4000/api/work-orders/3/materials \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"materials": [{"item_id": 1, "quantity": 1}]}'
```

```json
{ "error": "ONT HG8245Q2 is serialized — record it by installing the unit, not as a material" }
```

App-level, and backed by `trg_job_material_is_bulk` in the database.

### 5.7 The fare, and what the job cost

**Other costs** is for the money that is neither stock nor labour. Transport is
why it exists: a compound an hour off the road costs a fare each way, the tech
pays it, and before this there was nowhere to say so. Two fares on one job are
two rows, not a double entry — there is deliberately no uniqueness rule on the
category.

```bash
curl -s -X PUT localhost:4000/api/work-orders/3/expenses \
  -H "Authorization: Bearer $TECH" -H 'Content-Type: application/json' \
  -d '{"expenses": [{"category": "transport", "amount": 250, "description": "Boda out"},
                    {"category": "transport", "amount": 250, "description": "Boda back"}]}'
```

Now read the whole job back:

```bash
curl -s localhost:4000/api/work-orders/3 -H "Authorization: Bearer $TECH"
```

```json
{ "costs": { "currency": "KES",
             "materials_total": 925,
             "labour_total": 1100,
             "expenses_total": 500,
             "hardware_total": 4200,
             "total": 6725,
             "unpriced_lines": 0 } }
```

Four buckets, never one number, because they are four different kinds of spend.
`unpriced_lines` is the honesty column: if an item or a service has no price set,
its line contributes nothing to the total and gets counted here instead, and both
clients say so next to the figure. **A total with unpriced lines behind it is a
floor, not a cost.** Set prices under **Catalog → Items** (`unit_cost`) and
**Catalog → Services** (`unit_rate`).

A rate is *copied* onto the line when the work is recorded, not joined at read
time — so re-pricing the catalog next quarter changes what the next job costs and
leaves this one exactly as it was. Hardware is the exception: `installations`
carries no cost of its own, so it is priced from the catalog when you read it,
which is why it is named as its own bucket.

**Mark the job done** finishes it. A completed job still accepts a cost you
remembered on the drive home — only *cancelling* a job freezes its lines.

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

## Part 7a — A new install before you know where it is

On the dashboard, **Jobs → Dispatch a job** asks for the **site** first, then the
**type**, then the premises. For a **new install** the premises is optional: the
request often arrives before anybody has found the compound. Leave it empty and put
a rough idea of the location in the notes — the field is relabelled *Rough location
(required)* and the form will not submit without it.

```bash
curl -s localhost:4000/api/work-orders \
  -H "Authorization: Bearer $STAFF" -H 'Content-Type: application/json' \
  -d '{"type": "new_install", "site_id": 1,
       "notes": "Past Nasianda market, ask for Mama Pima"}'
```

The job shows as **Location to be confirmed**, with those notes. A **repair,
upgrade or removal** always needs a premises — it is work at a place that already
exists — and asking for one without gets a 400.

The premises is filled in later, three ways:

- the dashboard job page → **Attach a premises** (lists only the job's site);
- the field app job screen → **Set the premises** — pick one, search, or capture a
  new one on the spot;
- installing the router against the job, which attaches the premises you installed
  it at.

It can be set **once**: a job's materials and costs belong to the place they were
used, so it cannot be moved from one house to another afterwards. A premises at a
different site, or a former client, is refused.

---

## Part 7b — Hotspots, plots and flats, and former clients

Every premises is either **PPPoE** (the default: an ordinary customer, one router)
or a **hotspot** (a kiosk, stall or compound hosting public wifi). Choose it under
**Connection** when adding or editing a premises, on the web dashboard or in the
field app.

**Hotspots differ in three ways:**

- They can have **more than one router**. Installing again at a hotspot adds a
  router rather than hitting the 409 above; the premises screen then lists every
  router, each with its own *Replace* and *Record work*. With several routers, a
  replacement has to say which one is coming out (`installation_id`), and the
  mobile screen asks.
- The person on file is the **contact person**, not a subscriber — the forms and
  screens relabel *Customer name / Phone* accordingly.
- A hotspot **must say what its host gets**: a **token** (we pay them) or a
  **voucher** (we give them one).

```bash
curl -s localhost:4000/api/premises \
  -H "Authorization: Bearer $STAFF" -H 'Content-Type: application/json' \
  -d '{"landmark": "Mama Pima kiosk", "site_id": 1, "customer_name": "Pima Wafula",
       "customer_phone": "0712000111", "connection_type": "hotspot",
       "hotspot_arrangement": "token"}'
```

Leave `hotspot_arrangement` out and you get a 400 saying it must be `token` or
`voucher`. Send one for a PPPoE premises and you also get a 400.

**Kind of premises** now includes **Plot** and **Flat**, alongside Household,
Business, Institution and Multi-dwelling.

**A customer who has left.** On the premises page:

- **Mark as former client** (warehouse staff, PMs, admins) hides it from the
  lists and search and stops new jobs or installs there. The record and every job
  and router stay. *Include former clients* on the Premises page shows it again,
  and **Reinstate client** undoes it.
- **Delete…** (admins only) removes it permanently, but only if it never had a job
  or a router — a premises added by mistake. Anything with history answers 409 and
  tells you to mark it a former client instead.

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

## Part 9 — Jobs from the manager's side

A job is no longer an optional layer over an install. Every installation belongs
to one, and `POST /api/installations` opens a job when the caller names none — so
an install that belongs to nothing is not a state the system can reach. What
stays optional is the *dispatching*: a manager may create a job for a tech, and
usually does not.

**Work orders → New work order** creates one. Choose the premises, the type, the
tech and a date; it starts `open` with no `performed_on`, because nobody has been
yet. Then open it.

The job list carries a **Cost** column (`?with_costs=true`, opt-in because the
roll-up is four aggregates per job) and a **Work done** date, which is
`performed_on` rather than the schedule.

The detail page is the back office for a phone. Alongside the status stepper and
the tech reassignment control it now has:

- **The premises**, including the pin and whether there is one. A job whose
  premises has no GPS says so in as many words: nobody can find that place from
  the record alone.
- **Hardware fitted**, with what the unit cost.
- **Materials used / Work performed / Other costs**, each as a table with the
  per-line rate and total, each with a **Correct** button. This is where a cable
  length typed wrong on a phone gets fixed, and where a manager prices up a job
  whose catalog entries had no rate on the day.
- **What the job cost** — the four buckets and the total, with the unpriced-line
  warning if any line carries no price.
- **Stock movements behind this job**, fed by
  `GET /api/transactions?work_order_id=`. A downward material correction shows up
  here as a `return`, because the trail is append-only and a correction is a
  movement in its own right.
- **Day the work was done**, editable. Every cost report buckets on it, and the
  tech is often recording Friday's work on Monday.

Correcting materials from the dashboard moves stock exactly as it does from the
phone, so a new line has to say where it comes from — warehouse staff have no van
of their own to default to. Lines that already exist keep whatever stock they
were first drawn from, so the difference goes back to the van that supplied it
and not to whichever van the tech drives by then.

A completed or cancelled job is terminal for *status* — reopening one would make
`completed_at` meaningless, so the API refuses:

```json
{ "error": "A completed job cannot change status" }
```

Its *lines* are a different matter. A completed job still accepts a cost
remembered afterwards; only a cancelled one is frozen:

```json
{ "error": "This job was cancelled — reopen it as a new job to record work against it" }
```

A tech may progress their own job, annotate it and correct the day they did it,
but not reassign or reschedule it, and cannot touch a job assigned to someone
else.

---

## Part 10 — Reporting

Six report pages, all warehouse-staff-or-manager only. A tech gets a 403 from
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

- **The date is when the work was done**, taken from
  `work_orders.performed_on`, not when someone typed it in. A tech recording
  Friday's splice on Monday still lands in Friday.
- **Labour hangs off the job, not the installation.** That is what lets a visit
  which fitted no hardware count here at all — a re-splice of a cut cable is
  billable work, and under the old model it was invisible.
- **Quantities are never summed across units.** 40 m of cable run plus one splice
  is not 41 of anything, so the totals tile reads `412 m · 37 jobs`. Grouped by
  tech, quantity is omitted entirely and the count of services performed is
  shown instead.

```bash
curl -s "localhost:4000/api/reports/services?group_by=service&from=2026-01-01"   -H "Authorization: Bearer $TOKEN"
```

### Job costs

The question none of the other reports could answer: **what does a connection
cost?** `/consumption` counts stock leaving the business and `/services` counts
labour, and neither of them knows about the fare that got the tech to the
compound. This one reads the job's own lines, which is where all three live.

```bash
curl -s "localhost:4000/api/reports/job-costs?group_by=site" \
  -H "Authorization: Bearer $STAFF"
```

```json
{ "currency": "KES",
  "job_costs": [
    { "label": "Bungoma", "jobs": 5, "materials_total": 2535, "labour_total": 3075,
      "expenses_total": 900, "hardware_total": 12200, "total": 18710,
      "average_per_job": 3742, "unpriced_lines": 0 }
  ],
  "totals": { "jobs": 5, "total": 18710, "unpriced_lines": 0 } }
```

Group by `site`, `type`, `tech` or `month`. The chart stacks the four buckets so
one bar answers both "how much" and "of what" at once.

Three things it does deliberately:

- **Windows on the day the work was done**, falling back to the completion date
  and then to when the ticket was opened, so a job can never drop out of every
  window.
- **Excludes cancelled jobs.** A cancelled visit did not happen.
- **Reports `unpriced_lines` next to the totals**, and the page puts a banner
  above them when it is non-zero. Presenting a floor as the answer is worse than
  presenting no number.

`average_per_job` is computed server-side rather than left to the client to
divide two columns — that is the figure that gets quoted, so it is the figure
that should not be got wrong twice.

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

### 11.0 Seeing what you hold

**Stock → Stock on hand** lists every item we hold with its total, and chips for
each location it sits in (click one for that location's serials). Filter by
item name, category or location. Serialized items show how many are ready to
install and how many are waiting to be collected; installed and retired units are
not "on hand" anywhere. Warehouse staff, PMs and admins only — a field tech sees
their own van in the app.

`GET /api/stock/overview` is the endpoint behind it.

### 11.1b Cleaning up without SQL: the three-dots menu

**Catalog → Items**, **Stock → Locations** and **Operations → Jobs** each have a
`⋮` menu at the end of every row.

| | Edit | Retire / Restore | Delete (admin only) |
|---|---|---|---|
| Item | name, category, unit, threshold, cost… (tracking type is locked) | hides it from pickers, keeps history | only if never received, moved, requested or used |
| Location | name, address, assigned tech (type is locked) | only when it holds no stock | only if nothing ever touched it and nobody is assigned |
| Job | assigned tech, scheduled date, notes | **Cancel job** (open/in-progress only) | only a job with no installation, stock or recorded costs |

Retired items and locations stay visible to staff, marked "Retired", so you can
restore them. A refused delete answers `409` and says what blocks it and what
to do instead.

```bash
curl -s -X DELETE localhost:4000/api/items/12 -H "Authorization: Bearer $ADMIN"
```

Run `npm run migrate` in `apps/api` once to add the location retire flag (migration 014).

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
| Find a premises | either | `GET /api/premises/search?q=&site_id=` |
| Browse a site's premises | either | `GET /api/premises?site_id=` |
| Add a premises | either | `POST /api/premises` |
| Improve a premises' GPS pin | mobile → job or premises | `PATCH /api/premises/:id` |
| See what is installed somewhere | either | `GET /api/premises/:id/current` |
| See a site's full history | either | `GET /api/premises/:id/history` |
| Start a job | mobile → Jobs → Start a job | `POST /api/work-orders` |
| Start a job at a place not on record | mobile → New premises | `POST /api/work-orders` with `premises` |
| Install a router | mobile | `POST /api/installations` |
| Replace a router | mobile | `POST /api/installations/:premisesId/replace` |
| Record materials used on a job | mobile → job → Materials | `PUT /api/work-orders/:id/materials` |
| Record the labour on a job | mobile → job → Work done | `PUT /api/work-orders/:id/services` |
| Record a fare or other cost | mobile → job → Other costs | `PUT /api/work-orders/:id/expenses` |
| See what a job cost | either | `GET /api/work-orders/:id` |
| Ask for more van stock | mobile → Restock | `POST /api/restock-requests` |
| Fulfil a restock request | dashboard → Restock queue | `PATCH /api/restock-requests/:id` |
| Progress or complete a job | either | `PATCH /api/work-orders/:id` |
| Say which day a job was done | either | `PATCH /api/work-orders/:id` (`performed_on`) |
| Price an item or a service | dashboard → Catalog | `PATCH /api/items/:id` · `PATCH /api/services/:id` |
| Retire or delete an item you no longer use | dashboard → Catalog → Items | `PATCH /api/items/:id` (`is_active`) · `DELETE /api/items/:id` (admin) |
| Add a user / assign a van | dashboard → Users (PM only) | `POST` / `PATCH /api/users` |
| Rename a location / reassign a van | dashboard → Locations → Edit | `PATCH /api/locations/:id` |
| Fix a customer address | dashboard → Premises → Edit premises | `PATCH /api/premises/:id` |
| Fix a serial or MAC on a unit | admin, over the API | `PATCH /api/item-instances/:id` |
| Reconcile stock against a count | dashboard → Locations → Correct (admin) | `POST /api/stock/adjustments` |
| Correct the date on an install | admin, over the API | `PATCH /api/installations/:id` |
| Create the first admin | the server's shell | `npm run create-admin -w apps/api` |
| See what needs reordering | dashboard → Reports | `GET /api/reports/low-stock` |
| Record work against one installation | mobile → premises → Record work | `PUT /api/installations/:id/services` |
| See labour billed this month | dashboard → Reports → Services | `GET /api/reports/services` |
| See what the work cost | dashboard → Reports → Job costs | `GET /api/reports/job-costs` |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `DATABASE_URL is not set` on startup | No `apps/api/.env` | `cp apps/api/.env.example apps/api/.env` and fill it in |
| Jobs or premises screens are blank, or the API answers 500 with `column … does not exist` | The database is behind the code — a migration is pending | `npm run migrate -w apps/api -- status`, then `npm run migrate`; restart the API if it does not pick the change up |
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
| `A premises has to be findable again` | No address, landmark or GPS pin | Take a fix, or give a landmark |
| `gps_lat and gps_lng must be sent together` | Half a fix | Send both, or neither |
| `A GPS fix cannot be cleared, only replaced` | Sending `gps_lat: null` on a premises that has one | Take a better fix instead |
| `is serialized — record it by installing the unit` | A router sent as a job material | Install it: `POST /api/installations` |
| `This job was cancelled` | Recording lines on a cancelled job | Open a new job for the visit |
| `Field techs can only record materials out of their own van` | `from_location_id` is not the tech's van | Drop the field; a tech's van is the default |
| A job total looks too low | Some lines have no price | `unpriced_lines` says how many. Set `unit_cost` / `unit_rate` under Catalog |
| Location permission refused on the phone | The tech declined it | The premises can still be saved on a landmark; or allow location in phone settings |
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
