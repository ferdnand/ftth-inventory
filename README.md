# FTTH Field Inventory

Inventory tracking for a fibre-to-the-home operator: serialized equipment (ONTs,
media converters) tracked one unit at a time, bulk material (cable, consumables)
tracked by quantity, router install/replace history per customer address, and an
optional work-order layer.

Three apps in one npm workspace:

| App | Stack | Who uses it |
|---|---|---|
| `apps/api` | Express 4 + PostgreSQL, JWT auth | both clients |
| `apps/web` | React 19 + Vite, TanStack Query, Recharts | warehouse staff, project managers |
| `apps/mobile` | Expo SDK 57 + expo-router | field techs |

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
| `users` | `warehouse_staff`, `field_tech`, `pm`. `assigned_location_id` is what the mobile app resolves as "my van". |
| `customer_premises` | A customer address, with an optional account reference. |
| `installations` | Install/removal history per premises. `removal_reason` is required whenever `removed_at` is set, and only one active installation per premises is possible — both enforced in the database. |
| `work_orders` | Optional job layer. Every link to one is nullable. |
| `restock_requests` / `restock_request_lines` | A tech asks the warehouse for bulk stock; fulfilling the request is what moves it. |
| `transactions` | Append-only audit trail of every stock movement. |
| `schema_migrations` | Applied migrations, with checksums. |

## API endpoints

Everything except `/api/health` and `/api/auth/login` requires
`Authorization: Bearer <token>`. Role column: **T** field_tech · **W**
warehouse_staff · **P** pm.

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
| `GET` | `/api/transactions?item_instance_id=&item_id=&work_order_id=&location_id=&type=&from=&to=&limit=` | any (T: scoped to own van) |
| `POST` | `/api/item-instances` | W P |
| `GET` | `/api/item-instances?serial=&mac=&item_id=&status=&location_id=` | any (T: own location) |
| `GET` | `/api/item-instances/:id` | any |
| `PATCH` | `/api/item-instances/:id` | W P (retire only) |

**Premises and installations**

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/premises/search?q=` | any |
| `POST` | `/api/premises` | any |
| `GET` | `/api/premises/:id` | any |
| `GET` | `/api/premises/:id/current` | any |
| `GET` | `/api/premises/:id/history` | any |
| `POST` | `/api/installations` | any |
| `POST` | `/api/installations/:premisesId/replace` | any |
| `PUT` | `/api/installations/:id/services` | any (T: own active install) |

**Catalog and admin**

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/items?include_inactive=` | any |
| `POST` / `PATCH` | `/api/items`, `/api/items/:id` | W P |
| `GET` | `/api/services?include_inactive=` | any |
| `POST` / `PATCH` | `/api/services`, `/api/services/:id` | W P |
| `GET` | `/api/locations?type=` | any |
| `POST` | `/api/locations` | W P |
| `GET` | `/api/users?role=&is_active=`, `/api/users/:id` | W P |
| `POST` / `PATCH` | `/api/users`, `/api/users/:id` | P |

**Work orders**

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/work-orders?assigned_tech_id=&status=&customer_premises_id=` | any (T: own jobs) |
| `GET` | `/api/work-orders/:id` | any (T: own jobs) |
| `POST` | `/api/work-orders` | W P |
| `PATCH` | `/api/work-orders/:id` | any (T: own jobs, status/notes only) |

`assigned_tech_id=me` resolves to the caller.

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
| `GET` | `/api/reports/stock-by-location` | W P |

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
- **Work orders are fully optional** — every `work_order_id` is nullable.
- **`transactions` is append-only.** Nothing updates or deletes from it. This is
  why idempotency keys exist: a replayed write would have no cleanup path.
- **`NUMERIC` arrives as a string** (`quantity: "180"`). The clients coerce at the
  query boundary; the API's wire format is deliberately unchanged.
- **Restock requests exist so a tech cannot self-issue warehouse stock.** The only
  movement they could otherwise make is a warehouse → van transfer.

See [PROCESS.md](PROCESS.md) §8 for the list of known gaps — read it before
assuming something is missing by accident.
