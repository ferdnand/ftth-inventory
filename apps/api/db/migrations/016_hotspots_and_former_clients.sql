-- ============================================================
-- Hotspots, plots and flats, and premises that stop being clients
-- ============================================================
-- Three things the premises model did not say.
--
-- 1. HOW the place is connected. A premises is either a PPPoE customer (one
--    router, billed to the household) or a hotspot (a shop, a stall, a compound
--    that hosts public wifi). They behave differently enough to be told apart:
--    a hotspot can carry several routers, and the person recorded against it is
--    the contact who looks after the place, not a subscriber.
--
-- 2. WHAT we give a hotspot's host in return. Hosting costs them power and floor
--    space, so we either pay a token (cash) or hand them a voucher. Which one is
--    recorded, because it is a running obligation somebody has to honour.
--
-- 3. Whether the place is still a client. A premises whose customer has left
--    cannot simply be deleted once it has history — the jobs, the routers and
--    the stock movements all hang off it — so it is marked as a former client
--    instead, which takes it out of every list and picker but keeps the record.
--    One that never had any history can still be deleted outright.

-- ------------------------------------------------------------
-- Plots and flats
-- ------------------------------------------------------------
-- 'household' already means a single home in its own compound, and
-- 'multi_dwelling' a block. These two describe the unit a customer actually
-- rents or owns: a plot (land, possibly not yet built on) or a flat in a block.
-- ADD VALUE inside a transaction is fine from Postgres 12, as long as the new
-- value is not used in the same transaction — it is not.
ALTER TYPE premises_type_enum ADD VALUE IF NOT EXISTS 'plot';
ALTER TYPE premises_type_enum ADD VALUE IF NOT EXISTS 'flat';

-- ------------------------------------------------------------
-- PPPoE or hotspot
-- ------------------------------------------------------------
CREATE TYPE connection_type_enum AS ENUM ('pppoe', 'hotspot');
CREATE TYPE hotspot_arrangement_enum AS ENUM ('token', 'voucher');

-- Everything recorded so far is an ordinary customer, so PPPoE is the default.
ALTER TABLE customer_premises
    ADD COLUMN connection_type      connection_type_enum NOT NULL DEFAULT 'pppoe',
    ADD COLUMN hotspot_arrangement  hotspot_arrangement_enum,
    ADD COLUMN is_active            BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN customer_premises.hotspot_arrangement IS
    'What the host of a hotspot gets for hosting it: a cash token, or a voucher';

-- A hotspot has to say which; anything else must not carry one. Saying it in
-- the database as well as the API means a stray arrangement on a PPPoE customer
-- cannot linger after a premises is reclassified.
ALTER TABLE customer_premises
    ADD CONSTRAINT hotspot_arrangement_matches_connection
    CHECK (
        (connection_type = 'hotspot' AND hotspot_arrangement IS NOT NULL)
        OR (connection_type <> 'hotspot' AND hotspot_arrangement IS NULL)
    );

CREATE INDEX idx_premises_active ON customer_premises(is_active);

-- ------------------------------------------------------------
-- A hotspot can carry more than one router
-- ------------------------------------------------------------
-- 001 made "one active router per premises" a partial unique index. That is
-- still the rule for PPPoE, but the index cannot tell the two apart because the
-- connection type lives on another table. A trigger can.
DROP INDEX uq_active_installation_per_premises;

CREATE OR REPLACE FUNCTION assert_one_active_router_unless_hotspot() RETURNS trigger AS $$
DECLARE
    kind connection_type_enum;
BEGIN
    IF NEW.removed_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- The row lock is the point: two techs installing at the same premises at
    -- the same moment would otherwise each see "no active router" and both
    -- succeed. The unique index used to settle that race; this does.
    SELECT connection_type INTO kind
      FROM customer_premises WHERE id = NEW.customer_premises_id FOR UPDATE;

    IF kind IS DISTINCT FROM 'hotspot' AND EXISTS (
        SELECT 1 FROM installations
         WHERE customer_premises_id = NEW.customer_premises_id
           AND removed_at IS NULL
           AND id IS DISTINCT FROM NEW.id
    ) THEN
        -- Same constraint name the index had, so the API's existing mapping of it
        -- to a friendly message keeps working.
        RAISE EXCEPTION
            'Premises % already has an active router and is not a hotspot',
            NEW.customer_premises_id
            USING ERRCODE = 'unique_violation',
                  CONSTRAINT = 'uq_active_installation_per_premises';
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_one_active_router_unless_hotspot
    BEFORE INSERT OR UPDATE OF customer_premises_id, removed_at ON installations
    FOR EACH ROW EXECUTE FUNCTION assert_one_active_router_unless_hotspot();

-- The lookup the trigger and the "current router" queries both make.
CREATE INDEX idx_installations_active
    ON installations(customer_premises_id) WHERE removed_at IS NULL;
