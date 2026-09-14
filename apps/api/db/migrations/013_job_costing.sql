-- ============================================================
-- What a job cost
-- ============================================================
-- A tech could record the router they fitted (installations) and the labour
-- (installation_services), and nothing else. There was no way to say "40 m of
-- drop cable and six sleeves went into this job", and no way to record money at
-- all — not the materials, not the labour rate, not the 300 bob boda fare to
-- get to the compound. So nobody could answer what a connection costs.
--
-- Three tables, all hanging off the job, because that is the thing being
-- costed:
--
--   job_materials   stock consumed          quantity x unit_cost
--   job_services    labour performed        quantity x unit_rate
--   job_expenses    everything else         a single amount
--
-- Money is NUMERIC(12,2) in KES throughout. Not a float: a shilling that
-- rounds differently depending on the order you add it up is not a cost.
-- Not an integer of cents either — every rate here is quoted in whole
-- shillings and the extra indirection would show up in every query.

-- ------------------------------------------------------------
-- Standard costs on the catalog
-- ------------------------------------------------------------
-- The price list. A job line copies the figure at the time it is recorded
-- rather than joining to it, so re-pricing the catalog next quarter does not
-- silently rewrite what last quarter's jobs cost.
ALTER TABLE items    ADD COLUMN unit_cost NUMERIC(12,2);
ALTER TABLE services ADD COLUMN unit_rate NUMERIC(12,2);

ALTER TABLE items
    ADD CONSTRAINT item_unit_cost_non_negative
    CHECK (unit_cost IS NULL OR unit_cost >= 0);
ALTER TABLE services
    ADD CONSTRAINT service_unit_rate_non_negative
    CHECK (unit_rate IS NULL OR unit_rate >= 0);

COMMENT ON COLUMN items.unit_cost IS
    'Standard cost per unit_of_measure, in KES. NULL means not priced yet.';
COMMENT ON COLUMN services.unit_rate IS
    'Standard charge per unit_of_measure, in KES. NULL means not priced yet.';

-- ------------------------------------------------------------
-- Materials consumed
-- ------------------------------------------------------------
-- Bulk items only. A serialized unit is not a material: it is traced to the
-- premises it ends up at through `installations`, and counting it here as well
-- would double it in every cost total. The API refuses a serialized item_id.
CREATE TABLE job_materials (
    id            SERIAL PRIMARY KEY,
    work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    item_id       INTEGER NOT NULL REFERENCES items(id),
    quantity      NUMERIC NOT NULL,
    unit_cost     NUMERIC(12,2),
    -- The stock this line came out of, almost always the tech's van. Recorded
    -- rather than derived because a corrected line has to put the difference
    -- back where it came from: if a 40 m run is fixed to 20 m next week, those
    -- 20 m return to that van, not to whichever van the tech drives by then.
    from_location_id INTEGER NOT NULL REFERENCES locations(id),
    notes         TEXT,
    recorded_by   INTEGER NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One line per item per job, for the same reason installation_services had
    -- it: two lines of 40 m leave "how much cable did this job use" guessing
    -- whether they are a duplicate submission or two genuine runs.
    UNIQUE (work_order_id, item_id),

    CONSTRAINT job_material_quantity_positive CHECK (quantity > 0),
    CONSTRAINT job_material_unit_cost_non_negative
        CHECK (unit_cost IS NULL OR unit_cost >= 0)
);

CREATE INDEX idx_job_materials_job ON job_materials(work_order_id);
CREATE INDEX idx_job_materials_item ON job_materials(item_id);

-- 'Bulk items only' above is the invariant the cost totals depend on, so it is
-- enforced here and not only in the route. A serialized unit counted as a
-- material would appear once in job_materials and once through installations,
-- and every job total would be wrong by the price of a router.
CREATE OR REPLACE FUNCTION assert_job_material_is_bulk() RETURNS trigger AS $$
DECLARE
    tracking tracking_type_enum;
    item_name TEXT;
BEGIN
    SELECT i.tracking_type, i.name INTO tracking, item_name
      FROM items i WHERE i.id = NEW.item_id;

    IF tracking <> 'bulk' THEN
        RAISE EXCEPTION
            '% is a serialized item — record it through an installation, not as a material',
            item_name
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'job_material_must_be_bulk';
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_job_material_is_bulk
    BEFORE INSERT OR UPDATE OF item_id ON job_materials
    FOR EACH ROW EXECUTE FUNCTION assert_job_material_is_bulk();

-- ------------------------------------------------------------
-- Labour performed — moved off the installation, onto the job
-- ------------------------------------------------------------
-- 009 hung labour on `installations`, which meant a visit that fitted no
-- hardware could not record any: a tech who drives out to re-splice a cut
-- cable does real, billable work and installs nothing. On the job it fits
-- either way, and the premises timeline still shows it — through the job the
-- installation belongs to, which 012 made mandatory.
CREATE TABLE job_services (
    id            SERIAL PRIMARY KEY,
    work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    service_id    INTEGER NOT NULL REFERENCES services(id),
    quantity      NUMERIC NOT NULL DEFAULT 1,
    unit_rate     NUMERIC(12,2),
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (work_order_id, service_id),
    CONSTRAINT job_service_quantity_positive CHECK (quantity > 0),
    CONSTRAINT job_service_unit_rate_non_negative
        CHECK (unit_rate IS NULL OR unit_rate >= 0)
);

CREATE INDEX idx_job_services_job ON job_services(work_order_id);
CREATE INDEX idx_job_services_service ON job_services(service_id);

-- Carry the existing lines over. SUM and MAX because the unique key moves from
-- (installation, service) to (job, service): if a job somehow owns two
-- installations that both recorded the same service, the quantities add and the
-- notes of one of them survives — losing a note is better than losing a line.
INSERT INTO job_services (work_order_id, service_id, quantity, notes, created_at)
SELECT inst.work_order_id,
       isv.service_id,
       SUM(isv.quantity),
       MAX(isv.notes),
       MIN(isv.created_at)
  FROM installation_services isv
  JOIN installations inst ON inst.id = isv.installation_id
 GROUP BY inst.work_order_id, isv.service_id;

-- unit_rate is left NULL on carried-over rows on purpose: nothing recorded a
-- rate when they were written, and back-filling today's price onto last year's
-- work would invent a cost that was never agreed.

DROP TABLE installation_services;

-- ------------------------------------------------------------
-- Everything else the job cost
-- ------------------------------------------------------------
-- Transport is the one that matters here — a compound an hour off the road
-- costs a boda fare each way, and that is a real cost of the connection that
-- neither stock nor labour will ever capture.
CREATE TYPE job_expense_category_enum AS ENUM
    ('transport', 'casual_labour', 'permit', 'accommodation', 'airtime', 'other');

CREATE TABLE job_expenses (
    id            SERIAL PRIMARY KEY,
    work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    category      job_expense_category_enum NOT NULL,
    amount        NUMERIC(12,2) NOT NULL,
    description   TEXT,
    recorded_by   INTEGER NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- No unique key on (job, category), unlike the other two: two separate boda
    -- fares on one job are two facts, not a double entry, and each needs its own
    -- description to be worth anything.
    CONSTRAINT job_expense_amount_positive CHECK (amount > 0)
);

CREATE INDEX idx_job_expenses_job ON job_expenses(work_order_id);

-- ON DELETE CASCADE on all three, for the reason 009 gave for the one before
-- them: these rows describe one job and mean nothing without it.
