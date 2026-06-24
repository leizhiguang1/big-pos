# Testing

Two suites, two intents.

## Unit tests — pure logic (no DB)

```bash
npm test
```

Covers the pure domain/lib helpers (`src/domain/**`, `src/lib/**`): money math,
billing/invoice-status derivation, work-stage rules, the permission catalogue,
schema validation, report aggregation. Fast, no services required. This is the
gate that runs in CI.

Integration tests are intentionally **excluded** from this run (see
`vitest.config.ts`), so `npm test` never needs a database.

## Integration tests — database behaviour (payment RPCs + RLS)

```bash
supabase start          # one-time per session; needs Docker running
npm run test:integration
```

These exercise behaviour that lives in Postgres and cannot be reached by the
pure-logic tests:

- **Payment RPCs** (`record_payment`, `mark_invoice_paid`) — partial/full/over
  payment, status transitions, the never-downgrade-a-paid-invoice rule, the
  positive-amount guard, and balancing-payment reconciliation.
- **Permission-enforcing RLS** (Spec 5) — per-permission write-gating on
  `customers`/`products`, the no-authenticated-write tables
  (`invoices`/`payments`), the column-restricted `invoice_items` update, the
  `auth_has_permission()` helper, and that the privileged RPCs keep EXECUTE for
  `service_role` only.

### How it works (`src/integration/db.ts`)

They run real SQL against a live Postgres with the project's migrations applied
(the local Supabase stack). To stay fast and dependency-light, the suite only
needs the `db` container and reproduces production's three execution contexts at
the SQL level rather than going through PostgREST:

| Context | Helper | Stands in for |
| --- | --- | --- |
| `postgres` (superuser) | `sql()` | test fixture setup |
| `service_role` | `asServiceRole()` | server actions / RPC path |
| `authenticated` + JWT claims | `asUser(userId, …)` | the browser path RLS guards |

Isolation is one shared connection with a transaction per test
(`begin`/`rollback` in hooks) — nothing is persisted and tests never see each
other's writes.

- **Connection**: defaults to the local DB
  (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`). Override with
  `SUPABASE_DB_URL` to target a branch or CI database.
- If the stack isn't up, the suite fails fast with a message telling you to run
  `supabase start`.

> ⚠️ Do **not** invoke an EXECUTE-revoked function (e.g. `record_payment`,
> `create_invoice_with_items`) as the `authenticated` role in a test. On the
> local Postgres image the permission-denied path for these functions
> **segfaults the backend** (a Postgres/image quirk, not an app bug). Assert the
> grant model with `has_function_privilege(...)` instead — that's what the
> "service-role only" tests do. See the note in `rls.integration.test.ts`.

## Local-stack note

The baseline schema (`supabase/migrations/00000000000000_baseline_schema.sql`)
was made replayable on a fresh local/CI database: `CREATE SCHEMA IF NOT EXISTS
public`, and the `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` blocks
(which a local `postgres` role cannot execute) were removed — the `FOR ROLE
postgres` defaults already grant the same. No effect on the already-applied
production schema.

## What's still untested (roadmap)

The integration suite above is **Tier 1** (highest blast-radius: money +
security). Still open:

- **Tier 2 — server actions** (`src/data/**`, `src/lib/auth/**`): the ~25
  mutations' three paths each — happy, permission-denied (clean `ActionResult`,
  asserted via `result.ok === false`), and invalid-input rejection.
- **Tier 3 — interactive components & E2E**: the role editor's
  permission-dependency logic and last-superadmin guard, the invoice form, the
  work queue, and a Playwright smoke of login → invoice → payment → work-status
  → void.
