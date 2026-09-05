-- ============================================================
-- Work performed at an installation
-- ============================================================
-- 007 gave services their own table but nothing pointed at it, so the catalog
-- was a list nobody could use. This records which labour went into a given
-- installation: the splice, the 40 m cable run, the PPPoE setup.
--
-- It hangs off `installations`, not off `customer_premises`, so replacing a
-- router keeps the work done on each visit separate — the same address can be
-- spliced twice, years apart, and the timeline shows both.

CREATE TABLE installation_services (
    id              SERIAL PRIMARY KEY,
    installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
    service_id      INTEGER NOT NULL REFERENCES services(id),
    quantity        NUMERIC NOT NULL DEFAULT 1,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One line per service per visit. Two cable runs on the same job are one
    -- line of 80 m, not two lines of 40 — otherwise "how much cable run did we
    -- bill here" has to guess whether rows are duplicates or genuine repeats.
    UNIQUE (installation_id, service_id),

    -- 'job' services are always 1; 'meter' services carry the real length.
    -- Zero or negative is always a bug, the same rule transactions.quantity has.
    CONSTRAINT installation_service_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX idx_installation_services_installation
    ON installation_services(installation_id);
CREATE INDEX idx_installation_services_service
    ON installation_services(service_id);

-- ON DELETE CASCADE above is deliberate and is the only cascade in the schema:
-- these rows describe one installation and mean nothing without it. The
-- service_id reference is NOT cascading — a service in use cannot be deleted,
-- it gets is_active = false instead, exactly like items.
