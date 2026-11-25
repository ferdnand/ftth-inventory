-- ============================================================
-- A job belongs to a site
-- ============================================================
-- Until now a job only had a site by way of its premises, so "which site is this
-- job at" had no answer of its own — and nothing could be said about a job
-- before a premises was chosen. Dispatching works the other way round: a
-- manager decides the work is at Kisumu first, and only then picks the house.
--
-- So the job carries its own site. It is also where the job's materials are
-- drawn from: a site is a `location`, so it holds stock like a warehouse or a
-- van, and the stock a job can use is the stock at its site.
--
-- Nullable in the database because jobs recorded before this existed may sit at
-- a premises nobody ever filed under a site. The API will not open a new job
-- without one.
ALTER TABLE work_orders ADD COLUMN site_id INTEGER REFERENCES locations(id);

-- Existing jobs take the site their premises is filed under. A job at an
-- un-sited premises stays NULL rather than being guessed at.
UPDATE work_orders wo
   SET site_id = cp.site_id
  FROM customer_premises cp
 WHERE cp.id = wo.customer_premises_id
   AND wo.site_id IS NULL;

CREATE INDEX idx_work_orders_site ON work_orders(site_id);

-- A job's site and its premises' site cannot disagree: that is how a "Kisumu"
-- job ends up at a house in Bungoma and every per-site total quietly lies.
-- A trigger rather than a CHECK because the rule spans two tables.
CREATE OR REPLACE FUNCTION assert_job_site_matches_premises() RETURNS trigger AS $$
DECLARE
    premises_site INTEGER;
BEGIN
    IF NEW.site_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT site_id INTO premises_site
      FROM customer_premises WHERE id = NEW.customer_premises_id;

    IF premises_site IS NOT NULL AND premises_site <> NEW.site_id THEN
        RAISE EXCEPTION
            'Job site % does not match the site of premises % (%)',
            NEW.site_id, NEW.customer_premises_id, premises_site
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'job_site_matches_premises';
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_job_site_matches_premises
    BEFORE INSERT OR UPDATE OF site_id, customer_premises_id ON work_orders
    FOR EACH ROW EXECUTE FUNCTION assert_job_site_matches_premises();
