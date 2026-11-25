# FTTH Field Inventory

Job and inventory tracking for a fibre-to-the-home operator working two rural
sites in Kenya, **Bungoma** and **Kisumu**.

A field tech opens a job wherever they are, captures the premises by GPS if
nobody has recorded it, and records what the visit used: the unit fitted, the
materials out of their van, the labour, and the money spent getting there. A
manager may dispatch a job instead, but does not have to — most of the work here
is found, not ticketed.

Serialized equipment (ONTs, media converters) is tracked one unit at a time and
traced to the premises it ends up at; bulk material (cable, consumables) is
tracked by quantity and consumed against a job. Costs are in KES.

Three apps in one npm workspace:

| App | Stack | Who uses it |
|---|---|---|
| `apps/api` | Express 4 + PostgreSQL, JWT auth | both clients |
| `apps/web` | React 19 + Vite, TanStack Query, Recharts | warehouse staff, project managers |
| `apps/mobile` | Expo SDK 58 + expo-router | field techs |

## Documentation

| Document | What it covers |
|---|---|
| `README.md` (this file) | Endpoint list and data-model reference |
| [PROCESS.md](PROCESS.md) | Setup, architecture, conventions, known gaps |
| [TUTORIAL.md](TUTORIAL.md) | Hands-on walkthrough of every workflow |

## Setup

```bash
npm install                                # all three workspaces
cp apps/api/.env.example apps/api/.env     # then set DATABASE_URL and JWT_SECRET
createdb ftth_inventory
npm run migrate                            # works on Windows, macOS and Linux
npm run seed                               # sample data + sign-in credentials
```

Then, in separate terminals:

```bash
npm run dev:api      # :4000
npm run dev:web      # :5173, proxies /api to the API
npm run dev:mobile   # Expo — scan the QR code with Expo Go
npm test             # API test suite (needs TEST_DATABASE_URL)
```

The mobile app derives its API address from Metro's host, so there is nothing to
configure for a phone on the same Wi-Fi. See [PROCESS.md](PROCESS.md) §3 if it
cannot connect.

## Data model

| Table | Purpose |
|---|---|
| `items` | SKU catalog. `tracking_type` = `serialized` or `bulk`. |
| `item_instances` | One row per serialized unit. Has `serial_number` + `mac_address`, a status, and a current location/holder. |
| `stock_levels` | Quantity of a bulk item at a location. Cannot go negative. |
| `locations` | `warehouse`, `site`, or `tech_van`. A van carries a `tech_id`. |
| `users` | `warehouse_staff`, `field_tech`, `pm`, `admin`. `assigned_location_id` is what the mobile app resolves as "my van". |
| `customer_premises` | A place. Needs no address: a GPS pin or a landmark is enough, because the villages have no street names. Carries the customer's name and phone, the village, a `premises_type`, and the site it belongs to. |
| `installations` | Install/removal history per premises. `removal_reason` is required whenever `removed_at` is set, only one active installation per premises is possible, and every row belongs to a job — all three enforced in the database. |
| `work_orders` | **The job.** One row per visit, opened by a manager or by the tech. Owns everything the visit produced. `performed_on` is the day the work was done, which is what every report windows on. |
| `job_materials` | Bulk stock consumed on a job, with the cost per unit copied at the time. Writing these moves van stock by the difference. |
| `job_services` | Labour performed on a job, with the rate copied at the time. On the job rather than the installation, so a visit that fitted no hardware can still record work. |
| `job_expenses` | What else the job cost — fares, casual help, permits. |
| `restock_requests` / `restock_request_lines` | A tech asks the warehouse for bulk stock; fulfilling the request is what moves it. |
| `transactions` | Append-only audit trail of every stock movement, corrections included (`adjustment`). |
| `schema_migrations` | Applied migrations, with checksums. |

## API endpoints

Everything except `/api/health` and `/api/auth/login` requires
`Authorization: Bearer <token>`. Role column: **T** field_tech · **W**
warehouse_staff · **P** pm · **A** admin.

**A passes every role check**, so it is listed only where a route is
admin-only. See "The admin role" below.

**Auth**

| Method | Path | Roles |
|---|---|---|
| `POST` | `/api/auth/login` | — |
| `GET` | `/api/auth/me` | any |

**Stock**

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/stock?location_id=` | any (T: own location only) |
| `GET` | `/api/stock/summary?location_id=` | any (T: own location only) |
| `POST` | `/api/transactions` | any (T: `issue`/`return`/`faulty` via own van) |
| `POST` | `/api/stock/adjustments` | A (reconcile a bulk level against a count) |
| `GET` | `/api/transactions?item_instance_id=&item_id=&work_order_id=&location_id=&type=&from=&to=&limit=` | any (T: scoped to own van) |
| `POST` | `/api/item-instances` | W P |
| `GET` | `/api/item-instances?serial=&mac=&item_id=&status=&location_id=` | any (T: own location) |
| `GET` | `/api/item-instances/:id` | any |
| `PATCH` | `/api/item-instances/:id` | W P (retire only) · A (serial, MAC, status, location) |

**Premises and installations**

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/premises/search?q=&site_id=&limit=` | any |
| `GET` | `/api/premises?site_id=&limit=` | any (browse a site — a GPS-only premises has nothing to type into a search box) |
| `POST` | `/api/premises` | any |
| `PATCH` | `/api/premises/:id` | any for the GPS fix · W P for everything else |
| `GET` | `/api/premises/:id` | any |
| `GET` | `/api/premises/:id/current` | any |
| `GET` | `/api/premises/:id/history` | any |
| `POST` | `/api/installations` | any |
| `POST` | `/api/installations/:premisesId/replace` | any |
| `PUT` | `/api/installations/:id/services` | any (T: own active install) |
| `PATCH` | `/api/installations/:id` | A (correct dates, work order, removal reason) |

**Catalog and admin**

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/items?include_inactive=` | any |
| `POST` / `PATCH` | `/api/items`, `/api/items/:id` | W P |
| `GET` | `/api/services?include_inactive=` | any |
| `POST` / `PATCH` | `/api/services`, `/api/services/:id` | W P |
| `GET` | `/api/locations?type=` | any |
| `POST` / `PATCH` | `/api/locations`, `/api/locations/:id` | W P (`type` is not editable) |
| `GET` | `/api/users?role=&is_active=`, `/api/users/:id` | W P |
| `POST` / `PATCH` | `/api/users`, `/api/users/:id` | P |

**Jobs** (mounted at `/api/work-orders`)

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/work-orders?assigned_tech_id=&status=&open=&customer_premises_id=&site_id=&performed_from=&performed_to=&with_costs=` | any (T: own jobs) |
| `GET` | `/api/work-orders/:id` | any (T: own jobs) — the premises, the units fitted, all three kinds of line, and the cost total in one response |
| `POST` | `/api/work-orders` | any, **including T** |
| `PATCH` | `/api/work-orders/:id` | any (T: own jobs — status, notes, `performed_on`) |
| `PUT` | `/api/work-orders/:id/materials` | any (T: own van) — moves stock |
| `PUT` | `/api/work-orders/:id/services` | any (T: own jobs) |
| `PUT` | `/api/work-orders/:id/expenses` | any (T: own jobs) |

`assigned_tech_id=me` resolves to the caller. `open=true` returns both `open`
and `in_progress` in one request, which is the field app's home screen.

`POST` takes either `customer_premises_id`, or a `premises` object that is
created alongside the job in one transaction — a tech at an unrecorded compound
gets one submit rather than two, and never an orphan address.

The three `PUT` routes each take the **complete list** and replace what was
there, so a retry on a dying connection is a no-op rather than a double entry.
`materials` additionally moves van stock by the difference between the old list
and the new one: raise a line and the extra leaves the van, lower it and the
difference goes back, remove it and all of it does.

**Restock**

| Method | Path | Roles |
|---|---|---|
| `POST` | `/api/restock-requests` | T |
| `GET` | `/api/restock-requests?status=&requesting_user_id=&to_location_id=`, `/:id` | any (T: own) |
| `PATCH` | `/api/restock-requests/:id` | W P (approve / reject / fulfil) |
| `PATCH` | `/api/restock-requests/:id/cancel` | any (T: own) |

**Reports**

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/reports/summary` | W P |
| `GET` | `/api/reports/low-stock?location_id=` | W P |
| `GET` | `/api/reports/consumption?from&to&group_by=item\|category\|location` | W P |
| `GET` | `/api/reports/tech-activity?from&to` | W P |
| `GET` | `/api/reports/installation-trends?from&to&interval=week\|month` | W P |
| `GET` | `/api/reports/services?from&to&group_by=service\|tech` | W P |
| `GET` | `/api/reports/job-costs?from&to&group_by=site\|type\|tech\|month` | W P |
| `GET` | `/api/reports/stock-by-location` | W P |

## The admin role

`admin` is not a fourth job title alongside warehouse staff, field techs and
PMs. It is the account that owns the data: the one that can correct a record
when the normal workflow has already written the wrong thing.

- It passes every `requireRole` check without being named in one, so a route
  added tomorrow cannot quietly lock an admin out.
- It is the only role that can reconcile a stock level against a physical count
  (`POST /api/stock/adjustments`), rewrite a serial or MAC on a unit, or correct
  the dates on an installation record.
- Corrections are not silent. A stock adjustment and a unit correction both
  write an `adjustment` row to `transactions`, naming who changed what and why.
- It cannot break the invariants the schema depends on: a unit that is installed
  must still be removed through the installation endpoints, a location's `type`
  and an item's `tracking_type` are still fixed at creation, and `transactions`
  is still append-only.
- The API refuses to demote or deactivate the last active admin, and refuses to
  let an admin remove their own admin access.

Create the first one on the machine that can reach the database — `POST
/api/users` needs somebody signed in, and a fresh database has nobody:

```bash
cd apps/api
ADMIN_NAME="Your Name" ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run create-admin
```

Re-running it for an existing address promotes that user to admin, reactivates
them, and resets their password — which is also the recovery path if an admin
account is ever lost.

## Design decisions worth knowing before you change anything

- **Invariants are enforced in the database, not only in JavaScript.** The
  removal reason, the single-active-installation rule, non-negative stock, and
  the serialized-xor-bulk split are all `CHECK` constraints or partial unique
  indexes. The application checks exist to return a useful sentence; the
  constraints are the guarantee. Both are tested.
- **`app.use('/api', requireAuth)` sits above the domain routers**, so a newly
  added router fails closed. A router mounted above that line is silently public.
- **`requireAuth` re-reads the user from the database on every request.** That is
  the only revocation mechanism there is — it makes deactivating a user take
  effect immediately rather than at token expiry.
- **Actor identity comes from the token.** `performed_by` / `installed_by` in a
  request body are rejected with a 400, not ignored.
- **There is one implementation of the non-negative stock rule**
  (`src/lib/stock.js`), and it takes a row lock before reading the balance. Two
  concurrent decrements cannot both pass the check.
- **Replace is one atomic transaction**: closes the old installation, updates both
  instance statuses, parks the removed unit back in the tech's van, creates the
  new installation, and writes two audit rows. All or nothing.
- **The job is the unit of record, and it is not optional.** 001 called
  `work_orders` an "optional layer" and every link to one was nullable, which is
  what left a tech with nowhere to record what a visit consumed. Since migration
  012 every installation belongs to a job, and `POST /api/installations` opens
  one when the caller names none. A trigger enforces that a job and its
  installation are at the same premises.
- **A field tech may open a job.** The manager does not ticket every visit. A
  tech-opened job is assigned to them whatever they send, starts `in_progress`,
  and is dated today; a manager-dispatched one starts `open` with no work date
  until it is done.
- **A premises does not need an address.** `premises_must_be_locatable` requires
  an address *or* a landmark *or* a GPS pin, because out here streets have no
  names and houses have no numbers. `premisesLabel` in `src/lib/premises.js` is
  what to call the place, and the API sends it as `label` so three clients cannot
  disagree about it.
- **Any authenticated user may improve a GPS fix, but not rename an address.** A
  tech who saved a premises indoors on a 200 m fix and walks outside to a 6 m one
  is correcting the most useful field on the record; making them phone the
  warehouse means it never happens. A fix can be replaced, never cleared.
- **The three job-line routes take the complete list, not an addition.** That is
  what makes them safe to retry without an idempotency key, and it is why
  materials move stock by the difference rather than by the amount sent.
- **A price is copied onto a job line when the work is recorded**, never joined
  from the catalog at read time. Re-pricing `items.unit_cost` or
  `services.unit_rate` changes what the next job costs and leaves last quarter's
  jobs exactly as they were. Hardware is the one exception, and the cost response
  names it as its own bucket for that reason.
- **An unpriced line is counted, not treated as free.** Every cost response
  carries `unpriced_lines`, and both clients say so next to the total. A total
  with unpriced lines behind it is a floor, and presenting it as the answer is
  worse than showing no number.
- **A `DATE` is parsed as a string, not a `Date`** (`src/lib/db.js`). pg's default
  turns a calendar day into midnight UTC, which in Kenya (UTC+3) serializes back
  out as the previous day — so a job done on the 10th reached both clients as the
  9th and landed in the wrong day's figures.
- **`transactions` is append-only.** Nothing updates or deletes from it. This is
  why idempotency keys exist: a replayed write would have no cleanup path.
- **`NUMERIC` arrives as a string** (`quantity: "180"`). The clients coerce at the
  query boundary; the API's wire format is deliberately unchanged.
- **Restock requests exist so a tech cannot self-issue warehouse stock.** The only
  movement they could otherwise make is a warehouse → van transfer.

See [PROCESS.md](PROCESS.md) §8 for the list of known gaps — read it before
assuming something is missing by accident.
