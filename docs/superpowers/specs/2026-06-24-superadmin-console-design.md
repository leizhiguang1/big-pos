# Super Admin Console — Design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Owner:** Super Admin (system role)

## Problem

Today, certain data fixes and cleanup can only be done by editing the database
directly (a developer task): deleting a wrong invoice, removing a bogus payment,
clearing test/junk records, reaching data that has no UI (credits). The goal is a
**standing Super Admin Console** so the Super Admin is self-sufficient for routine
fixes and cleanup and does not need code/DB changes for them.

Terminology note (see `docs/CONVENTIONS.md`): the UI says **"Clinic"**, code/DB/
routes/types/permission keys stay `customer`.

## Goals

- Give the Super Admin a single place to delete, restore, purge, and reach data
  that the normal UI hides — no DB access required.
- Make destructive actions safe (confirmations) and accountable (audit log).
- Lock down who can become a Super Admin.

## Non-goals

- No new grantable permission. Access reuses the existing `is_system` Super Admin
  concept (same gate as `/settings/roles`).
- Not redesigning existing settings catalogs (service statuses, work stages, units,
  billing) — those already have CRUD.
- Not building bulk import/export.

## Access model

- Entire console gated by `requireSuperadmin()` server-side, and hidden client-side
  for non-superadmins (hide-not-show, per the app's permission principle).
- Lives under Settings at `/settings/admin` with sub-tabs (see Layout).

## Per-entity delete matrix

"Mix per entity" — the policy per record type reflects what each one carries:

| Entity | Model | Notes |
|---|---|---|
| **Invoices** | Soft-delete → Recycle Bin (restore + permanent purge) | Carry payments/financial history; reversible |
| **Clinics** (`customers`) | Soft-delete → Recycle Bin (restore + purge only when no dependents) | FK from invoices/credits; purge blocked while dependents exist |
| **Payments** | Hard-delete + typed confirm + audit | Correction must truly leave so invoice balance is correct |
| **Credits** | View + hard-delete + confirm + audit | No UI today; same financial-correction logic as payments |
| **Products** | Keep `active` toggle; add hard-delete when unreferenced | Purge only if no `invoice_items` reference it |
| **Employees** (`profiles`) | Keep `active` toggle; add hard-delete when unreferenced | Blocked by `created_by` FK; purge only if they created nothing |
| **Voided invoices** | Restore-from-void (Super Admin override) | Trigger blocks this today; SA can undo a wrong void |

## Components

### 1. Recycle Bin (`/settings/admin` → Deleted Items tab)
Lists soft-deleted **invoices** and **clinics**. Each row: identifying label, who
deleted it, when, reason. Actions per row:
- **Restore** — clears `deleted_at`/`deleted_by`/`delete_reason`; record reappears.
- **Delete permanently** — typed confirmation naming exactly what cascades
  (invoice → its `invoice_items` + `payments`). For a clinic, purge is **blocked**
  while it still has any non-deleted invoices or credits, with a message listing
  the blockers.

### 2. Financial corrections (`/settings/admin` → Payments/Credits tabs)
- **Payments:** searchable list across invoices; hard-delete with typed confirm +
  reason. Deleting recomputes/relies on the invoice payment snapshot
  (`invoice_payment_snapshot`) so balances stay correct. Writes audit row.
- **Credits:** read view of `credits` (currently no UI) + hard-delete with confirm
  + reason. Writes audit row.

### 3. Cleanup extras (`/settings/admin` → Products/Employees tabs, or inline)
- **Products:** in addition to the existing `active` toggle, a hard-delete that is
  enabled **only** when the product is referenced by zero `invoice_items`;
  otherwise disabled with a "still used by N invoices" hint.
- **Employees:** in addition to the existing `active` toggle, a hard-delete enabled
  **only** when the profile is referenced by zero `created_by` rows; the
  last-Super-Admin guard still applies.

### 4. Activity (`/settings/admin` → Activity tab)
Read-only view of `admin_audit_log`, newest first, with actor, action, target
label, reason, timestamp. Lets the Super Admin see what happened without DB access.

### 5. Super Admin governance lockdown
Filter `is_system` roles out of the employee role dropdown
(`src/components/employees/EmployeesManager.tsx`). After this, **no one can promote
a person to Super Admin via the UI** — that is code/DB-only. Creating a Super Admin
*role* is already code-only (`is_system` hardcoded `false` in `role-actions.ts`).
The existing `wouldRemoveLastSuperadmin` guard stays.

## Data model changes

Three additive migrations (no destructive column drops):

1. **Soft-delete columns** on `invoices` and `customers`:
   - `deleted_at timestamptz null`
   - `deleted_by uuid null` (references `auth.users`)
   - `delete_reason text null`
   - Partial index on `(deleted_at)` for fast "not deleted" filtering.

2. **`admin_audit_log`** table:
   - `id uuid pk default gen_random_uuid()`
   - `actor_id uuid not null`
   - `action text not null` (e.g. `invoice.soft_delete`, `invoice.restore`,
     `invoice.purge`, `invoice.void_restore`, `customer.soft_delete`,
     `customer.restore`, `customer.purge`, `payment.delete`, `credit.delete`,
     `product.delete`, `employee.delete`)
   - `entity_type text not null`, `entity_id uuid null`
   - `entity_label text null` (human label, e.g. "INV-1042")
   - `reason text null`
   - `metadata jsonb null` (snapshot of the deleted row(s) for forensic recovery)
   - `created_at timestamptz not null default now()`
   - RLS: readable/writable only via service role + superadmin path (no client RLS
     grant), consistent with how admin actions run.

3. **Restore-from-void path** for the `prevent_invoice_restore` trigger: adjust so a
   Super-Admin-gated action can set `voided_at` back to null. Implementation options
   (decided in plan): a `GUC`/session flag set by the admin action, or replacing the
   blanket trigger with one that allows the transition when an explicit
   "admin override" flag is present. The void-restore action gates on
   `requireSuperadmin()` and writes an audit row.

## The hard part: read-site filtering

Soft-deleting invoices/customers means **every read that lists them must add
`deleted_at IS NULL`** (or use a filtered view). A missed site leaks deleted
records into lists, reports, dashboards, dropdowns, statements, and the work queue.

Mitigation:
- Enumerate every read site for `invoices` and `customers` during planning
  (lists, detail, dashboard, reports, work queue, customer statement, invoice form
  customer/product pickers, snapshot views).
- Prefer centralizing through existing data-access helpers/views where they exist,
  so the filter is applied in one place rather than scattered.
- The implementation plan must include a checklist of read sites and a verification
  pass (grep for `.from('invoices')` / `.from('customers')`).

## Server actions

All actions follow the existing convention:
- `requireSuperadmin()` gate; `if (gate.ok === false) return gate` (strict `=== false`
  under `strict:false`, per project memory).
- `createAdminClient()` (service role) for mutations.
- Write `admin_audit_log` row within the same action.
- `revalidatePath(...)` affected routes.
- Return `ActionResult = { ok: true } | { ok: false; error: string }`.

New action surface (names indicative):
- `softDeleteInvoiceAction`, `restoreInvoiceAction`, `purgeInvoiceAction`,
  `restoreVoidedInvoiceAction`
- `softDeleteCustomerAction`, `restoreCustomerAction`, `purgeCustomerAction`
- `deletePaymentAction`, `deleteCreditAction`
- `hardDeleteProductAction`, `hardDeleteEmployeeAction`
- A shared `writeAuditLog(...)` helper.

## Error handling

- Permission failures return the gate result (handled by existing pattern).
- Purge blocked by dependents returns `{ ok: false, error: "Clinic still has N
  invoices and M credits. Delete or reassign those first." }`.
- Hard-delete-when-unreferenced disabled in UI; server re-checks and returns a clear
  error if a race occurs.
- Typed confirmations on the client gate the destructive call; the server never
  relies on the client confirmation alone.

## Testing

- Unit: `wouldRemoveLastSuperadmin` still holds; audit-log helper writes expected
  rows; purge dependency checks (clinic with/without invoices/credits).
- Integration (existing Tier-1 RLS/RPC suite style): soft-delete hides records from
  list queries; restore brings them back; purge cascades; payment delete recomputes
  balance; non-superadmin is rejected by every new action.
- Read-site verification: a test/checklist asserting deleted invoices/customers do
  not appear in each enumerated list/report.

## Build order (waves)

1. **Foundations** — migrations (soft-delete cols, audit table), `writeAuditLog`
   helper, SA governance lockdown.
2. **Invoices** — soft-delete + recycle bin + restore-from-void + read-site filter.
3. **Clinics** — soft-delete + recycle bin + dependent-aware purge + read-site filter.
4. **Financial corrections** — payment delete, credit view/delete.
5. **Cleanup extras** — product/employee hard-delete-when-unreferenced.

## Open questions (resolve in planning)

- Exact mechanism for the void-restore trigger override (GUC flag vs. trigger
  rewrite).
- Whether the Recycle Bin auto-purges after N days (default: no auto-purge; manual
  only).
