-- ============================================================
-- Data guards
-- ============================================================
-- The app returns friendly 4xx responses for each of these; these constraints
-- are the actual guarantee. Per PROCESS.md the invariants live in the database,
-- not only in JavaScript — keep both.

-- Stock can never go negative. The app takes a FOR UPDATE row lock and refuses
-- the decrement first; this catches any path that forgets to.
ALTER TABLE stock_levels
    ADD CONSTRAINT stock_quantity_non_negative
    CHECK (quantity >= 0);

-- A transaction is either a serialized move (one instance, no quantity) or a
-- bulk move (a quantity, no instance) — never both and never neither.
-- PROCESS.md calls this split first-class; this makes it enforceable.
ALTER TABLE transactions
    ADD CONSTRAINT transaction_serialized_xor_bulk
    CHECK (
        (item_instance_id IS NOT NULL AND quantity IS NULL)
        OR
        (item_instance_id IS NULL AND quantity IS NOT NULL)
    );

-- A bulk movement of zero or a negative amount is always a bug. Direction is
-- carried by from_location_id / to_location_id, not by the sign of quantity.
ALTER TABLE transactions
    ADD CONSTRAINT transaction_quantity_positive
    CHECK (quantity IS NULL OR quantity > 0);

-- A movement has to come from somewhere or go somewhere.
ALTER TABLE transactions
    ADD CONSTRAINT transaction_has_a_direction
    CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL);

-- A work order marked completed must say when.
ALTER TABLE work_orders
    ADD CONSTRAINT work_order_completed_at_required
    CHECK (status <> 'completed' OR completed_at IS NOT NULL);
