-- ============================================================
-- A new install may be dispatched before anyone knows where it is
-- ============================================================
-- A manager often learns of a new connection before the customer's compound has
-- been found: the request is "somebody near Nasianda wants a router", and the
-- premises is only captured when a tech gets there. Until now a job could not
-- exist without one.
--
-- So a job's premises becomes optional — but only for a new install. A repair, an
-- upgrade or a removal is by definition work at a place that already exists, and
-- letting those float free would make every per-premises history quietly
-- incomplete.
--
-- With no premises, the only thing that says where the job is is the site and the
-- notes, so the notes are required then: a rough idea of the location is the whole
-- point. The API attaches the premises later, when the tech has found it or
-- installed the router.
ALTER TABLE work_orders ALTER COLUMN customer_premises_id DROP NOT NULL;

ALTER TABLE work_orders
    ADD CONSTRAINT job_premises_required_unless_new_install
    CHECK (
        customer_premises_id IS NOT NULL
        OR (
            type = 'new_install'
            AND site_id IS NOT NULL
            AND notes IS NOT NULL
            AND btrim(notes) <> ''
        )
    );
