-- ============================================================
-- Services (billable labour) move out of the item catalog
-- ============================================================
-- 006 catalogued splicing, cable runs and the rest as `items` rows under a
-- 'Service' category. That was wrong: an item is something you hold, move and
-- count. A service has no stock level, no serial number and no location, so
-- every stock report had to carry six rows that are permanently zero, and
-- nothing stopped a tech transferring 5 splicings into a van.
--
-- They get their own table, with no link to locations or quantities on hand.

CREATE TABLE services (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    unit_of_measure TEXT NOT NULL,          -- 'job' for flat-rate work, 'meter' for a cable run
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- items.name has no unique constraint, which is how 'Sleeves' and 'Heat-shrink
-- Sleeves' both ended up in the catalog (008 merges them). Don't repeat that
-- here — UNIQUE above makes a duplicate service impossible rather than a
-- cleanup migration later.

INSERT INTO services (name, unit_of_measure)
SELECT name, unit_of_measure
FROM items
WHERE category = 'Service'
ON CONFLICT (name) DO NOTHING;

-- Refuse to delete a service item that something already points at. Nothing
-- should — 006 created these and no stock or movement can legitimately name
-- one — but an orphaned transaction row is not worth the risk of assuming.
DO $$
DECLARE
    blocked TEXT;
BEGIN
    SELECT string_agg(DISTINCT i.name, ', ')
      INTO blocked
      FROM items i
     WHERE i.category = 'Service'
       AND (EXISTS (SELECT 1 FROM item_instances       x WHERE x.item_id = i.id)
         OR EXISTS (SELECT 1 FROM stock_levels         x WHERE x.item_id = i.id)
         OR EXISTS (SELECT 1 FROM transactions         x WHERE x.item_id = i.id)
         OR EXISTS (SELECT 1 FROM restock_request_lines x WHERE x.item_id = i.id));

    IF blocked IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot move these out of items — stock or movements already reference them: %',
            blocked;
    END IF;
END $$;

DELETE FROM items WHERE category = 'Service';
