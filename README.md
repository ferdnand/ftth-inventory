# FTTH Field Inventory — Backend API (v1)

Node/Express + PostgreSQL API implementing the inventory data model:
serialized items (ONTs, media converters), bulk items (cable, consumables),
site-based locations, customer premises, router install/replace history,
and an optional work-order layer.

## Setup

```bash
npm install
cp .env.example .env      # edit DATABASE_URL
npm run migrate           # applies db/schema.sql
npm run dev                # starts API on :4000
```

## Data model summary

| Table | Purpose |
|---|---|
| `items` | SKU catalog. `tracking_type` = serialized or bulk. |
| `item_instances` | One row per serialized unit (ONT, media converter). Has `serial_number` + `mac_address`. |
| `stock_levels` | Quantity of a bulk item at a location. |
| `locations` | `warehouse`, `site`, or `tech_van`. |
| `customer_premises` | A customer address/account. |
| `installations` | Install/removal history of routers at a premises. `removal_reason` is required whenever `removed_at` is set (enforced by DB check constraint). Only one active (non-removed) installation per premises at a time. |
| `work_orders` | Optional job layer. `installations` and `transactions` can optionally link to a `work_order_id`. |
| `transactions` | Full audit trail of every stock movement (receive/transfer/issue/return/faulty/install). |
| `users` | `warehouse_staff`, `field_tech`, `pm`. |

## API endpoints

**Stock**
- `GET /api/stock?location_id=` — serialized + bulk items at a location (powers "My Stock")

**Premises**
- `GET /api/premises/search?q=` — address/account search
- `GET /api/premises/:id/current` — currently installed router, if any
- `GET /api/premises/:id/history` — full install/removal timeline + replacement count

**Installations (router install/replace)**
- `POST /api/installations` — first-time install at a premises
- `POST /api/installations/:premisesId/replace` — remove active router (reason required) + install new one, atomically

**Transactions (generic stock movement)**
- `POST /api/transactions` — receive / transfer / issue / return / faulty, for bulk or serialized items
- `GET /api/transactions?item_instance_id=&work_order_id=&location_id=`

**Catalog**
- `GET/POST /api/items`
- `GET /api/locations?type=`
- `GET/POST /api/work-orders`

## Notes on design decisions

- **Removal reason is enforced at the DB level** via a check constraint on `installations`, not just in application code — so it can't be bypassed by a future integration or script.
- **Replace is one atomic transaction** (`BEGIN...COMMIT`): closes the old installation, updates its instance status, creates the new installation, updates its instance status, and logs both movements to `transactions`. If anything fails, the whole operation rolls back — you never end up with two active routers or zero.
- **Work orders are fully optional** — every `work_order_id` foreign key is nullable, so stock movement and installs work with or without job tracking turned on for a given workflow.
