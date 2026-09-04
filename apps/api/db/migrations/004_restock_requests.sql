-- ============================================================
-- Restock requests
-- ============================================================
-- A field tech running low needs a way to ask the warehouse for more stock.
-- The alternative — letting the tech POST a warehouse -> van transfer directly —
-- would let techs self-issue warehouse stock, which is the wrong authorization
-- posture. A request is a separate object that warehouse staff approve and
-- fulfil; fulfilment is what generates the actual transfer transactions.

CREATE TYPE restock_request_status_enum AS ENUM
    ('requested', 'approved', 'fulfilled', 'rejected', 'cancelled');

CREATE TABLE restock_requests (
    id                  SERIAL PRIMARY KEY,
    requesting_user_id  INTEGER NOT NULL REFERENCES users(id),
    from_location_id    INTEGER NOT NULL REFERENCES locations(id),  -- warehouse to draw from
    to_location_id      INTEGER NOT NULL REFERENCES locations(id),  -- the tech's van
    status              restock_request_status_enum NOT NULL DEFAULT 'requested',
    notes               TEXT,
    resolved_at         TIMESTAMPTZ,
    resolved_by         INTEGER REFERENCES users(id),
    resolution_notes    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT restock_resolution_fields_together
        CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
    CONSTRAINT restock_distinct_locations
        CHECK (from_location_id <> to_location_id)
);

CREATE INDEX idx_restock_requests_status ON restock_requests(status);
CREATE INDEX idx_restock_requests_user ON restock_requests(requesting_user_id);
CREATE INDEX idx_restock_requests_to_location ON restock_requests(to_location_id);

-- One line per item asked for. Bulk items only: a tech asks for "200 m of drop
-- cable" or "10 ONTs", never for a specific serial number — which unit they get
-- is the warehouse's choice at fulfilment time.
CREATE TABLE restock_request_lines (
    id                  SERIAL PRIMARY KEY,
    restock_request_id  INTEGER NOT NULL REFERENCES restock_requests(id) ON DELETE CASCADE,
    item_id             INTEGER NOT NULL REFERENCES items(id),
    quantity_requested  NUMERIC NOT NULL,
    quantity_fulfilled  NUMERIC,
    UNIQUE (restock_request_id, item_id),
    CONSTRAINT restock_line_quantity_positive
        CHECK (quantity_requested > 0),
    CONSTRAINT restock_line_fulfilled_non_negative
        CHECK (quantity_fulfilled IS NULL OR quantity_fulfilled >= 0)
);

CREATE INDEX idx_restock_lines_request ON restock_request_lines(restock_request_id);
