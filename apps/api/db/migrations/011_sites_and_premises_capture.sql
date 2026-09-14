-- ============================================================
-- Sites, and a premises a tech can capture while standing at it
-- ============================================================
-- Two things were assumed that do not hold in Bungoma or Kisumu.
--
-- First, that a premises exists before anyone goes there. It often does not:
-- the tech arrives, finds a household nobody has ever recorded, and has to be
-- able to write it down and carry on with the job.
--
-- Second, that `address` locates it. Out here the streets have no names and no
-- numbers, so an address line is a description at best. What actually finds the
-- place again is a GPS fix, plus the village and a landmark, plus the
-- customer's name and phone. So `address` stops being mandatory and a
-- coordinate pair is accepted in its place.
--
-- Sites are `locations` of type 'site', which already exists — a site can hold
-- stock, so it is a location, not a separate kind of thing.

CREATE TYPE premises_type_enum AS ENUM
    ('household', 'business', 'institution', 'multi_dwelling');

-- Idempotent, like 006: a deployed database gets these without the dev seed,
-- and re-running cannot duplicate them. locations.name has no unique
-- constraint, so the NOT EXISTS guard is the only thing that would catch it.
INSERT INTO locations (name, type, address)
SELECT v.name, 'site'::location_type_enum, v.address
FROM (VALUES
    ('Bungoma', 'Bungoma County'),
    ('Kisumu',  'Kisumu County')
) AS v(name, address)
WHERE NOT EXISTS (
    SELECT 1 FROM locations l WHERE lower(l.name) = lower(v.name) AND l.type = 'site'
);

-- ------------------------------------------------------------
-- What a tech can capture about a premises
-- ------------------------------------------------------------
ALTER TABLE customer_premises
    ADD COLUMN site_id         INTEGER REFERENCES locations(id),
    ADD COLUMN customer_name   TEXT,
    ADD COLUMN customer_phone  TEXT,
    ADD COLUMN village         TEXT,
    ADD COLUMN landmark        TEXT,
    ADD COLUMN premises_type    premises_type_enum NOT NULL DEFAULT 'household',
    ADD COLUMN gps_accuracy_m  NUMERIC,
    ADD COLUMN gps_captured_at TIMESTAMPTZ,
    ADD COLUMN created_by      INTEGER REFERENCES users(id),
    ADD COLUMN notes           TEXT;

-- A single household in its own compound is the common case here, so it is the
-- default rather than something the tech has to choose every time.

-- ------------------------------------------------------------
-- A premises has to be findable, but not necessarily by address
-- ------------------------------------------------------------
ALTER TABLE customer_premises ALTER COLUMN address DROP NOT NULL;

-- Latitude and longitude are meaningless one at a time.
ALTER TABLE customer_premises
    ADD CONSTRAINT premises_gps_pair_together
    CHECK ((gps_lat IS NULL) = (gps_lng IS NULL));

ALTER TABLE customer_premises
    ADD CONSTRAINT premises_gps_in_range
    CHECK (
        (gps_lat IS NULL OR gps_lat BETWEEN -90 AND 90)
        AND (gps_lng IS NULL OR gps_lng BETWEEN -180 AND 180)
    );

ALTER TABLE customer_premises
    ADD CONSTRAINT premises_gps_accuracy_non_negative
    CHECK (gps_accuracy_m IS NULL OR gps_accuracy_m >= 0);

-- This is the replacement for NOT NULL on address: you may describe where it is
-- in words, or drop a pin, but you may not create a premises that nobody can
-- ever find again.
ALTER TABLE customer_premises
    ADD CONSTRAINT premises_must_be_locatable
    CHECK (
        address IS NOT NULL
        OR landmark IS NOT NULL
        OR (gps_lat IS NOT NULL AND gps_lng IS NOT NULL)
    );

-- ------------------------------------------------------------
-- Search
-- ------------------------------------------------------------
-- 001 indexed the address alone, which was the only thing there was. Now a
-- premises is found by whichever fragment the caller happens to have — the
-- customer's name off a phone call, a village, a landmark, a phone number.
--
-- A generated column rather than a bare expression index, so the search query
-- and the index cannot drift apart: both name `search_text`.
ALTER TABLE customer_premises
    ADD COLUMN search_text TEXT GENERATED ALWAYS AS (
        coalesce(address, '') || ' ' ||
        coalesce(customer_name, '') || ' ' ||
        coalesce(customer_phone, '') || ' ' ||
        coalesce(village, '') || ' ' ||
        coalesce(landmark, '') || ' ' ||
        coalesce(customer_account_id, '')
    ) STORED;

-- IF EXISTS because a database baselined from the old schema.sql may never
-- have had it.
DROP INDEX IF EXISTS idx_premises_address;
CREATE INDEX idx_premises_search
    ON customer_premises USING gin (to_tsvector('english', search_text));

-- The search route also falls back to ILIKE '%fragment%' for partial phone
-- numbers and half-remembered names, which cannot use the GIN index above.
-- That is left as a sequential scan on purpose: two sites' worth of premises is
-- thousands of rows, and a pg_trgm index would make the extension a deployment
-- prerequisite for no measurable gain at this size.

CREATE INDEX idx_premises_site ON customer_premises(site_id);
