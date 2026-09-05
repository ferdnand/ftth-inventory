-- ============================================================
-- Admin role and stock adjustments
-- ============================================================
-- Until now the most privileged role was `pm`, and its reach was defined one
-- route at a time: requireRole('warehouse_staff', 'pm') on some, requireRole('pm')
-- on others. That is fine for a role with a job description, but there was no
-- role that could simply correct a record — rename a location, fix a serial
-- typed wrong at receiving, reconcile a stock level against a physical count.
-- Several of those tables had no UPDATE path in the API at all.
--
-- `admin` is that role. It is not a fourth job title: it is the break-glass
-- account that owns the data. See PROCESS.md > Roles.
ALTER TYPE user_role_enum ADD VALUE 'admin';

-- A correction to a bulk stock level is still a movement of stock, and
-- PROCESS.md is clear that every change to stock_levels leaves an audit row.
-- 'transfer' or 'receive' would be a lie about what happened, so corrections
-- get their own type. Like 'install', it is not accepted by
-- POST /api/transactions — POST /api/stock/adjustments is the only writer.
ALTER TYPE transaction_type_enum ADD VALUE 'adjustment';

-- Nothing in this file USES either value, deliberately. Postgres lets
-- ALTER TYPE ... ADD VALUE run inside a transaction block (12+), but the new
-- label cannot be referenced until that transaction commits — and db/migrate.js
-- wraps each file in one. Anything that needs to write 'admin' or 'adjustment'
-- belongs in a later migration or in application code.
