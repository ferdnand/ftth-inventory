# Tutorial — FTTH Field Inventory API

A hands-on walkthrough for someone touching this repo for the first time. By the
end you will have the API running against a seeded database and will have driven
the core field workflow end to end: check a van's stock, look up a customer
premises, install a router, replace a faulty one, and read back the audit trail.

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

The API models both. Serialized units live in `item_instances`; bulk quantities
live in `stock_levels`. Every movement of either writes a row to
`transactions`, which is append-only.

---

## Part 1 — Get it running

### 1.1 Install

```bash
npm install
cp .env.example .env
```

Open `.env` and set `DATABASE_URL` to a Postgres database you can write to.

### 1.2 Create the database and apply the schema

```bash
createdb ftth_inventory
psql "postgres://user:pass@localhost:5432/ftth_inventory" -f db/schema.sql
```

Use your real connection string. `db/schema.sql` builds the enum types, tables,
indexes, and constraints from scratch — point it at an **empty** database, since
it is not re-runnable.

> On macOS/Linux you can instead run `npm run migrate` after exporting
> `DATABASE_URL` in your shell. That script does not work on Windows — see
> [PROCESS.md](PROCESS.md) §2.

### 1.3 Seed sample data

```bash
npm run seed
```

The output ends with the IDs you need for the rest of this tutorial:

```
--- Reference IDs for smoke testing ---
van_location_id: 2
premises_id: 1
john_kamau_user_id: 1
new_ont_instance_id (in van, ready to install): 1
```

**Keep these.** Your numbers may differ from the ones below; substitute yours.

The seed gives you: John Kamau (a field tech) with van `Tech Van JK-04`, two
spare Huawei ONTs sitting in that van, bulk cable and consumables in the van,
one customer at `14B Ngong Road, Nairobi`, and a ZTE router that has been
installed at that address for four months.

### 1.4 Start the API

```bash
npm run dev
```

```bash
curl http://localhost:4000/api/health
# {"status":"ok"}
```

If that returns `{"status":"ok"}` the server is up. Note that health does not
touch the database — if later calls return `Failed to fetch…`, your
`DATABASE_URL` is wrong, and the real error is printed in the server console.

---

## Part 2 — The field technician workflow

### 2.1 "What's in my van?"

This is the first screen a tech sees. Pass the van's location id:

```bash
curl "http://localhost:4000/api/stock?location_id=2"
```

You get two lists, because the two tracking models are genuinely different:

```json
{
  "location_id": 2,
  "serialized": [
    { "id": 1, "serial_number": "HW8245Q2-991A", "mac_address": "F0:9E:63:22:8B:C1",
      "status": "in_stock", "item_name": "ONT HG8245Q2", "category": "ONT" }
  ],
  "bulk": [
    { "item_name": "Drop Cable 1-core", "quantity": "180", "unit_of_measure": "meter",
      "reorder_threshold": "100", "is_low_stock": false },
    { "item_name": "Heat-shrink Sleeves", "quantity": "6",
      "reorder_threshold": "20", "is_low_stock": true }
  ]
}
```

`serialized` lists individual units by serial number. `bulk` lists quantities,
with `is_low_stock` already computed against each item's `reorder_threshold` —
the heat-shrink sleeves are down to 6 against a threshold of 20, so the UI can
flag them without the client knowing the rule.

The same endpoint works for a warehouse or a site; only `location_id` changes.

### 2.2 Find the customer

```bash
curl "http://localhost:4000/api/premises/search?q=Ngong"
```

```json
{ "results": [ { "id": 1, "address": "14B Ngong Road, Nairobi", "customer_account_id": "KE-77291" } ] }
```

Search matches address *or* account number, so `q=KE-772` finds the same row.
Queries shorter than two characters return an empty list rather than every
premises in the database.

### 2.3 What is installed there right now?

```bash
curl "http://localhost:4000/api/premises/1/current"
```

```json
{
  "current": {
    "installation_id": 1,
    "installed_at": "2025-05-04T09:12:44.000Z",
    "serial_number": "ZTE60912F7A3B",
    "mac_address": "A4:B1:C2:3D:44:5E",
    "item_name": "ONT F663N"
  }
}
```

A premises with no active router returns `{"current": null}` — not a 404. The
address exists; it simply has no equipment.

---

## Part 3 — Installing a router

### 3.1 First-time install

For a premises with nothing installed yet:

```bash
curl -X POST http://localhost:4000/api/installations \
  -H "Content-Type: application/json" \
  -d '{ "customer_premises_id": 2, "item_instance_id": 1, "installed_by": 1 }'
```

Three things happen in one transaction: the `installations` row is created, the
ONT's status flips to `installed` and its location is cleared (it is at a
customer's home now, not in a van), and an `install` row is appended to
`transactions`.

### 3.2 What happens if a router is already there

Try the same call against premises 1, which already has the ZTE router:

```bash
curl -X POST http://localhost:4000/api/installations \
  -H "Content-Type: application/json" \
  -d '{ "customer_premises_id": 1, "item_instance_id": 1, "installed_by": 1 }'
```

```json
{ "error": "An active router already exists at this premises. Use /replace instead." }
```

That is a `409`. The check is deliberate: a premises may only ever have one
active router, and the database enforces it too, via a partial unique index on
`(customer_premises_id) WHERE removed_at IS NULL`. Even a direct SQL insert
cannot create a second active installation.

---

## Part 4 — Replacing a faulty router

This is the operation the data model was really built around. The old router
must be accounted for, and the reason must be recorded.

```bash
curl -X POST http://localhost:4000/api/installations/1/replace \
  -H "Content-Type: application/json" \
  -d '{ "new_item_instance_id": 1, "removal_reason": "faulty", "performed_by": 1 }'
```

`removal_reason` must be one of `faulty`, `upgrade`, `customer_cancelled`,
`theft`, `other`. Omit it and you get a `400`; the request never reaches the
database.

Inside a single `BEGIN`/`COMMIT`, this endpoint:

1. Locks the active installation row (`FOR UPDATE`) so two techs cannot replace
   the same router at once.
2. Closes it out — sets `removed_at`, `removed_by`, and `removal_reason`.
3. Moves the old unit's status to `faulty` if the reason was `faulty`, otherwise
   to `returned`. A broken router and a router pulled for an upgrade should not
   end up in the same bucket.
4. Creates the new installation and marks the new unit `installed`.
5. Appends **two** audit rows: a `return` for the old unit and an `install` for
   the new one.

If any step fails, the whole thing rolls back. You can never end up with two
active routers, or none.

Confirm the swap:

```bash
curl "http://localhost:4000/api/premises/1/current"
```

The serial number is now the Huawei unit, not the ZTE.

---

## Part 5 — Reading the history

```bash
curl "http://localhost:4000/api/premises/1/history"
```

```json
{
  "premises": { "id": 1, "address": "14B Ngong Road, Nairobi", "customer_account_id": "KE-77291" },
  "total_routers": 2,
  "replacement_count": 1,
  "timeline": [
    { "serial_number": "HW8245Q2-991A", "installed_at": "…", "removed_at": null,
      "removal_reason": null, "installed_by_name": "John Kamau" },
    { "serial_number": "ZTE60912F7A3B", "installed_at": "…", "removed_at": "…",
      "removal_reason": "faulty", "installed_by_name": "John Kamau",
      "removed_by_name": "John Kamau" }
  ]
}
```

`replacement_count` is `total_routers - 1` — the number of times equipment was
swapped, not the number of routers ever present. An address on its first router
reports `0`. A premises id that does not exist returns `404` here, unlike
`/current`, because you asked for a specific record.

The timeline is newest first, with technician names resolved, so it can be
rendered directly as a history list.

---

## Part 6 — Moving stock around

Installs are one specific kind of movement. Everything else — receiving from a
supplier, loading a van from the warehouse, sending a faulty unit back — goes
through one generic endpoint.

**Bulk: load 200 m of drop cable from the warehouse into the van**

```bash
curl -X POST http://localhost:4000/api/transactions \
  -H "Content-Type: application/json" \
  -d '{ "item_id": 4, "quantity": 200, "from_location_id": 1,
        "to_location_id": 2, "type": "transfer", "performed_by": 4 }'
```

The source `stock_levels` row is decremented and the destination is incremented
in the same transaction. The destination row is created if it does not exist yet
(`ON CONFLICT … DO UPDATE`), so you never have to pre-create a location's stock
rows.

**Serialized: return a faulty ONT to the warehouse**

```bash
curl -X POST http://localhost:4000/api/transactions \
  -H "Content-Type: application/json" \
  -d '{ "item_instance_id": 3, "from_location_id": 2, "to_location_id": 1,
        "type": "faulty", "performed_by": 1 }'
```

For serialized moves you pass `item_instance_id` and no quantity — the endpoint
looks up the `item_id` itself, and updates the unit's location and status. For
bulk moves you pass `item_id` + `quantity` and no instance id. Valid `type`
values here are `receive`, `transfer`, `issue`, `return`, `faulty`; `install` is
not accepted, because installs must go through
[Part 3](#part-3--installing-a-router) so that an `installations` row is created
alongside the audit entry.

**Trace one unit's whole life**

```bash
curl "http://localhost:4000/api/transactions?item_instance_id=3"
```

Filters are combinable — `?work_order_id=` for everything consumed by one job,
`?location_id=` for everything in or out of a warehouse. Results are newest
first, capped at 200 rows.

---

## Part 7 — Work orders (optional)

If you want to group work into jobs:

```bash
curl -X POST http://localhost:4000/api/work-orders \
  -H "Content-Type: application/json" \
  -d '{ "customer_premises_id": 1, "type": "repair", "assigned_tech_id": 1,
        "scheduled_date": "2026-09-10" }'
```

Then pass `work_order_id` on any install, replace, or transaction, and
`GET /api/transactions?work_order_id=…` shows every part consumed by that job.

This layer is entirely optional. Every `work_order_id` column is nullable, and
everything in Parts 2–6 works without ever creating one. Turn it on for the
workflows that need it.

A tech's job list:

```bash
curl "http://localhost:4000/api/work-orders?assigned_tech_id=1&status=open"
```

---

## Part 8 — The mobile mockup

```bash
# open mockups/mobile_screens.html in a browser
start mockups/mobile_screens.html      # Windows
```

Three static screens showing the intended field-tech UI: **My Stock**, **Find
premises**, and a **premises detail** view for 14B Ngong Road. It is standalone
HTML with hard-coded content and makes no API calls — it is a design reference
for what the endpoints above are meant to feed, not a working client.

---

## Common workflows at a glance

| I want to… | Call |
|---|---|
| See a van's or warehouse's stock | `GET /api/stock?location_id=` |
| Find a customer | `GET /api/premises/search?q=` |
| See the router at an address | `GET /api/premises/:id/current` |
| See an address's full history | `GET /api/premises/:id/history` |
| Install at a new address | `POST /api/installations` |
| Swap out a router | `POST /api/installations/:premisesId/replace` |
| Load a van / receive stock / send back a faulty unit | `POST /api/transactions` |
| Trace one unit or one job | `GET /api/transactions?item_instance_id=` / `?work_order_id=` |
| Browse the SKU catalog | `GET /api/items` |
| List locations (`warehouse` / `site` / `tech_van`) | `GET /api/locations?type=` |

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `{"error":"Failed to fetch items"}` but `/api/health` is fine | `DATABASE_URL` is wrong or Postgres is unreachable. The real driver error is in the server console. |
| `psql: error: connection to server failed` on migrate | Postgres is not running, or the connection string is wrong. |
| `type "tracking_type_enum" already exists` | `schema.sql` was already applied. It is not re-runnable — drop and recreate the database. |
| Seed fails on `duplicate key value` | The database already has data. `db/seed.js` expects empty tables. |
| `409 An active router already exists` | Use `/replace` rather than `POST /api/installations`. |
| `400 removal_reason must be one of…` | Removals always require a reason — enforced in the route *and* by a DB check constraint. |

## Where to go next

- [README.md](README.md) — full endpoint list and table-by-table data model.
- [PROCESS.md](PROCESS.md) — architecture, conventions to follow when adding
  code, and the current list of known gaps (no auth and no test suite among
  them).
