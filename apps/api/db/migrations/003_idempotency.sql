-- ============================================================
-- Idempotency keys
-- ============================================================
-- Neither POST /api/installations nor POST /api/transactions was safe to retry:
-- a replayed request wrote a second row, and `transactions` is append-only by
-- design (PROCESS.md), so there was no cleanup path.
--
-- A client generates a key per user-initiated submit and resends the same key on
-- retry. The unique index is partial so the vast majority of rows — anything
-- written without a key — are unaffected.
--
-- This lands now rather than with the offline-sync milestone because backfilling
-- it onto a populated audit trail is far more expensive than adding it to v1.

ALTER TABLE installations ADD COLUMN idempotency_key TEXT;
ALTER TABLE transactions  ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX uq_installations_idempotency_key
    ON installations (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_transactions_idempotency_key
    ON transactions (idempotency_key)
    WHERE idempotency_key IS NOT NULL;
