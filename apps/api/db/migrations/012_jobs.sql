-- ============================================================
-- The job becomes the record, not an optional layer over it
-- ============================================================
-- 001 called work_orders an "optional layer — jobs", and that is exactly what
-- went wrong. It assumed a manager dispatches every visit, so a tech who just
-- goes and does the work had nowhere to put it: `installations.work_order_id`
-- was nullable, and in practice always null.
--
-- Everything a visit produces — the unit fitted, the cable used, the labour,
-- the fare to get there — belongs to one thing. That thing is the job. So:
--
--   * a job records who opened it, which is now either a manager or the tech
--   * a job records the day the work was DONE, separately from the day it was
--     typed in, because those differ whenever the signal does
--   * every installation belongs to a job. Where one did not, this creates it.

ALTER TABLE work_orders
    ADD COLUMN created_by   INTEGER REFERENCES users(id),
    ADD COLUMN performed_on DATE;

COMMENT ON COLUMN work_orders.created_by IS
    'Who opened the ticket — a manager dispatching, or the tech who found the work';
COMMENT ON COLUMN work_orders.performed_on IS
    'The day the work was done. scheduled_date is the plan; created_at is when it was typed in.';

-- Existing rows: the plan date is the best available answer for when the work
-- happened, and there is no honest answer for who opened them, so created_by
-- stays null rather than guessing at a manager.
UPDATE work_orders
   SET performed_on = coalesce(completed_at::date, scheduled_date)
 WHERE performed_on IS NULL;

-- ------------------------------------------------------------
-- Every installation belongs to a job
-- ------------------------------------------------------------
-- Backfilled jobs are marked completed on the day of the install and credited
-- to whoever did it, because that is what demonstrably happened. Type is
-- 'new_install' for the first unit at a premises and 'upgrade' for each one
-- after it — a second unit at an address is a swap, not a first connection.
-- A loop rather than one INSERT ... SELECT with a join back: the link from a
-- new job to the installation it was created for has to be exact, and matching
-- rows up afterwards by premises and date would rely on RETURNING coming back
-- in the order the SELECT was written, which Postgres does not promise. This is
-- a one-off backfill over rows that predate jobs, so being obviously correct
-- matters and speed does not.
DO $$
DECLARE
    inst RECORD;
    new_job_id INTEGER;
BEGIN
    FOR inst IN
        SELECT i.id, i.customer_premises_id, i.installed_by, i.installed_at,
               row_number() OVER (
                   PARTITION BY i.customer_premises_id ORDER BY i.installed_at, i.id
               ) AS visit_number
          FROM installations i
         WHERE i.work_order_id IS NULL
         ORDER BY i.customer_premises_id, i.installed_at, i.id
    LOOP
        INSERT INTO work_orders
            (customer_premises_id, type, status, assigned_tech_id, created_by,
             scheduled_date, performed_on, completed_at, notes, created_at)
        VALUES
            (inst.customer_premises_id,
             CASE WHEN inst.visit_number = 1 THEN 'new_install' ELSE 'upgrade' END
                 ::work_order_type_enum,
             'completed'::work_order_status_enum,
             inst.installed_by, inst.installed_by,
             inst.installed_at::date, inst.installed_at::date, inst.installed_at,
             'Job created from an installation recorded before jobs were mandatory',
             inst.installed_at)
        RETURNING id INTO new_job_id;

        UPDATE installations SET work_order_id = new_job_id WHERE id = inst.id;
    END LOOP;
END $$;

ALTER TABLE installations ALTER COLUMN work_order_id SET NOT NULL;

-- An installation's job must be at the same address as the installation. Two
-- FKs to the same premises with nothing tying them together is how a job at
-- one house ends up owning the cable used at another.
--
-- Enforced by trigger rather than CHECK because the rule spans two tables.
CREATE OR REPLACE FUNCTION assert_installation_job_premises() RETURNS trigger AS $$
DECLARE
    job_premises INTEGER;
BEGIN
    SELECT customer_premises_id INTO job_premises
      FROM work_orders WHERE id = NEW.work_order_id;

    IF job_premises IS DISTINCT FROM NEW.customer_premises_id THEN
        RAISE EXCEPTION
            'Job % is at premises %, not premises %',
            NEW.work_order_id, job_premises, NEW.customer_premises_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'installation_job_same_premises';
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_installation_job_premises
    BEFORE INSERT OR UPDATE OF work_order_id, customer_premises_id ON installations
    FOR EACH ROW EXECUTE FUNCTION assert_installation_job_premises();
