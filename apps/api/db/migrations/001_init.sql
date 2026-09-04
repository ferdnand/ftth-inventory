-- ============================================================
-- FTTH Field Inventory — Database Schema (v1)
-- Postgres
-- ============================================================

CREATE TYPE tracking_type_enum AS ENUM ('serialized', 'bulk');
CREATE TYPE location_type_enum AS ENUM ('warehouse', 'site', 'tech_van');
CREATE TYPE instance_status_enum AS ENUM ('in_stock', 'issued', 'installed', 'faulty', 'returned', 'retired');
CREATE TYPE user_role_enum AS ENUM ('warehouse_staff', 'field_tech', 'pm');
CREATE TYPE transaction_type_enum AS ENUM ('receive', 'transfer', 'issue', 'install', 'return', 'faulty');
CREATE TYPE removal_reason_enum AS ENUM ('faulty', 'upgrade', 'customer_cancelled', 'theft', 'other');
CREATE TYPE work_order_type_enum AS ENUM ('new_install', 'repair', 'upgrade', 'removal');
CREATE TYPE work_order_status_enum AS ENUM ('open', 'in_progress', 'completed', 'cancelled');

-- ------------------------------------------------------------
-- Users
-- ------------------------------------------------------------
CREATE TABLE users (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    email               TEXT UNIQUE NOT NULL,
    role                user_role_enum NOT NULL,
    assigned_location_id INTEGER,  -- FK added after locations table
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Locations (warehouse / site / tech_van)
-- ------------------------------------------------------------
CREATE TABLE locations (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    type        location_type_enum NOT NULL,
    tech_id     INTEGER REFERENCES users(id),   -- set when type = tech_van
    address     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
    ADD CONSTRAINT fk_users_location
    FOREIGN KEY (assigned_location_id) REFERENCES locations(id);

-- ------------------------------------------------------------
-- Item catalog (SKUs)
-- ------------------------------------------------------------
CREATE TABLE items (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    category            TEXT NOT NULL,          -- e.g. 'ONT', 'Drop Cable', 'Splitter', 'Consumable'
    tracking_type       tracking_type_enum NOT NULL,
    unit_of_measure     TEXT NOT NULL,           -- 'unit', 'meter', 'box'
    manufacturer        TEXT,
    model               TEXT,
    reorder_threshold   NUMERIC,                 -- bulk items: qty; serialized: min units in stock
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Item instances (serialized items only: ONTs, media converters, etc.)
-- ------------------------------------------------------------
CREATE TABLE item_instances (
    id                  SERIAL PRIMARY KEY,
    item_id             INTEGER NOT NULL REFERENCES items(id),
    serial_number       TEXT NOT NULL UNIQUE,
    mac_address         TEXT UNIQUE,             -- populated for network-capable devices (routers/ONTs)
    status              instance_status_enum NOT NULL DEFAULT 'in_stock',
    current_location_id INTEGER REFERENCES locations(id),
    current_holder_id   INTEGER REFERENCES users(id),  -- set when checked out to a tech
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_item_instances_item ON item_instances(item_id);
CREATE INDEX idx_item_instances_status ON item_instances(status);
CREATE INDEX idx_item_instances_location ON item_instances(current_location_id);

-- ------------------------------------------------------------
-- Stock levels (bulk items only: cable, consumables)
-- ------------------------------------------------------------
CREATE TABLE stock_levels (
    id          SERIAL PRIMARY KEY,
    item_id     INTEGER NOT NULL REFERENCES items(id),
    location_id INTEGER NOT NULL REFERENCES locations(id),
    quantity    NUMERIC NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (item_id, location_id)
);

-- ------------------------------------------------------------
-- Customer premises
-- ------------------------------------------------------------
CREATE TABLE customer_premises (
    id                  SERIAL PRIMARY KEY,
    address             TEXT NOT NULL,
    customer_account_id TEXT,
    gps_lat             NUMERIC,
    gps_lng             NUMERIC,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_premises_address ON customer_premises USING gin (to_tsvector('english', address));

-- ------------------------------------------------------------
-- Work orders (optional layer — jobs)
-- ------------------------------------------------------------
CREATE TABLE work_orders (
    id                    SERIAL PRIMARY KEY,
    customer_premises_id  INTEGER NOT NULL REFERENCES customer_premises(id),
    type                  work_order_type_enum NOT NULL,
    status                work_order_status_enum NOT NULL DEFAULT 'open',
    assigned_tech_id      INTEGER REFERENCES users(id),
    scheduled_date        DATE,
    completed_at          TIMESTAMPTZ,
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_work_orders_premises ON work_orders(customer_premises_id);
CREATE INDEX idx_work_orders_tech ON work_orders(assigned_tech_id);
CREATE INDEX idx_work_orders_status ON work_orders(status);

-- ------------------------------------------------------------
-- Installations (router install/removal history per premises)
-- ------------------------------------------------------------
CREATE TABLE installations (
    id                    SERIAL PRIMARY KEY,
    customer_premises_id  INTEGER NOT NULL REFERENCES customer_premises(id),
    item_instance_id      INTEGER NOT NULL REFERENCES item_instances(id),
    work_order_id         INTEGER REFERENCES work_orders(id),   -- optional link
    installed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    installed_by          INTEGER NOT NULL REFERENCES users(id),
    removed_at            TIMESTAMPTZ,
    removed_by            INTEGER REFERENCES users(id),
    removal_reason        removal_reason_enum,
    CONSTRAINT removal_reason_required_if_removed
        CHECK (removed_at IS NULL OR removal_reason IS NOT NULL)
);

CREATE INDEX idx_installations_premises ON installations(customer_premises_id);
CREATE INDEX idx_installations_instance ON installations(item_instance_id);
CREATE INDEX idx_installations_work_order ON installations(work_order_id);

-- Only one *active* installation (removed_at IS NULL) per premises at a time
CREATE UNIQUE INDEX uq_active_installation_per_premises
    ON installations (customer_premises_id)
    WHERE removed_at IS NULL;

-- ------------------------------------------------------------
-- Transactions (full audit trail of stock movement)
-- ------------------------------------------------------------
CREATE TABLE transactions (
    id                  SERIAL PRIMARY KEY,
    item_id             INTEGER NOT NULL REFERENCES items(id),
    item_instance_id    INTEGER REFERENCES item_instances(id),   -- set for serialized moves
    quantity            NUMERIC,                                  -- set for bulk moves
    from_location_id    INTEGER REFERENCES locations(id),
    to_location_id      INTEGER REFERENCES locations(id),
    type                transaction_type_enum NOT NULL,
    work_order_id       INTEGER REFERENCES work_orders(id),       -- optional link
    performed_by        INTEGER NOT NULL REFERENCES users(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_item ON transactions(item_id);
CREATE INDEX idx_transactions_instance ON transactions(item_instance_id);
CREATE INDEX idx_transactions_work_order ON transactions(work_order_id);
CREATE INDEX idx_transactions_created ON transactions(created_at);
