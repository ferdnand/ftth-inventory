-- ============================================================
-- Authentication
-- ============================================================
-- Until now every write trusted a client-supplied performed_by / installed_by.
-- With this column the API derives the acting user from a verified JWT instead.
--
-- Nullable on purpose: a user row can exist before a password is set (created by
-- an admin, invited later). Login rejects any user whose password_hash IS NULL.

ALTER TABLE users ADD COLUMN password_hash TEXT;

-- Login looks users up by email, which is already UNIQUE, but the unique index
-- is case-sensitive while email comparison should not be.
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));
