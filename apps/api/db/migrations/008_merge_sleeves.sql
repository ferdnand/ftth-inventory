-- ============================================================
-- Merge 'Sleeves' into 'Heat-shrink Sleeves'
-- ============================================================
-- They are the same physical item: db/seed.js created 'Heat-shrink Sleeves' and
-- 006 added 'Sleeves' from the field catalog list. Two rows means stock splits
-- across both and neither total is the real one.
--
-- 'Heat-shrink Sleeves' survives — it is the descriptive name and the one any
-- existing stock was booked against. Rename it with PATCH /api/items/:id if the
-- shorter name is what the field team actually says.
--
-- Three cases, because a database that never ran the dev seed only has the row
-- 006 added:
--   both rows      -> fold the duplicate's stock and movements into the survivor
--   'Sleeves' only -> rename it, nothing to fold
--   survivor only  -> nothing to do

DO $$
DECLARE
    survivor_id  INTEGER;
    duplicate_id INTEGER;
BEGIN
    SELECT id INTO survivor_id  FROM items WHERE lower(name) = 'heat-shrink sleeves';
    SELECT id INTO duplicate_id FROM items WHERE lower(name) = 'sleeves';

    IF duplicate_id IS NULL THEN
        RETURN;
    END IF;

    IF survivor_id IS NULL THEN
        UPDATE items SET name = 'Heat-shrink Sleeves' WHERE id = duplicate_id;
        RETURN;
    END IF;

    -- stock_levels is UNIQUE (item_id, location_id). Where a location holds
    -- both rows they cannot simply be repointed — add the quantities together,
    -- drop the duplicate row, then move whatever is left.
    UPDATE stock_levels s
       SET quantity = s.quantity + d.quantity
      FROM stock_levels d
     WHERE s.item_id = survivor_id
       AND d.item_id = duplicate_id
       AND d.location_id = s.location_id;

    DELETE FROM stock_levels d
     WHERE d.item_id = duplicate_id
       AND EXISTS (
           SELECT 1 FROM stock_levels s
            WHERE s.item_id = survivor_id AND s.location_id = d.location_id
       );

    UPDATE stock_levels SET item_id = survivor_id WHERE item_id = duplicate_id;

    -- restock_request_lines is UNIQUE (restock_request_id, item_id): same fold.
    -- quantity_fulfilled stays NULL when both sides are NULL — NULL means "not
    -- fulfilled yet", which is not the same as fulfilled zero.
    UPDATE restock_request_lines s
       SET quantity_requested = s.quantity_requested + d.quantity_requested,
           quantity_fulfilled = CASE
               WHEN s.quantity_fulfilled IS NULL AND d.quantity_fulfilled IS NULL THEN NULL
               ELSE coalesce(s.quantity_fulfilled, 0) + coalesce(d.quantity_fulfilled, 0)
           END
      FROM restock_request_lines d
     WHERE s.item_id = survivor_id
       AND d.item_id = duplicate_id
       AND d.restock_request_id = s.restock_request_id;

    DELETE FROM restock_request_lines d
     WHERE d.item_id = duplicate_id
       AND EXISTS (
           SELECT 1 FROM restock_request_lines s
            WHERE s.item_id = survivor_id
              AND s.restock_request_id = d.restock_request_id
       );

    UPDATE restock_request_lines SET item_id = survivor_id WHERE item_id = duplicate_id;

    -- No unique constraint on these two: repoint them as they are. The audit
    -- trail keeps every movement, it just now names one item instead of two.
    UPDATE item_instances SET item_id = survivor_id WHERE item_id = duplicate_id;
    UPDATE transactions    SET item_id = survivor_id WHERE item_id = duplicate_id;

    DELETE FROM items WHERE id = duplicate_id;
END $$;
