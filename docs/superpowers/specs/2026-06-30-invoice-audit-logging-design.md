# Invoice Audit Logging — Design Spec

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation
**Owner:** suddenly6666@gmail.com

## Problem

Invoice actions (issue/mark-sent, record payment, void, edit, recipient/case/service-status
changes, work notes, work-status changes, admin soft-delete/restore/purge) need to record
**which user performed each action, and when**, so staff can see a per-invoice activity
timeline and admins have a central, immutable audit trail for accountability/compliance.

Today, only a few actions stamp the actor (`invoices.created_by`, `payments.created_by`,
`invoices.voided_by`); many actions record nothing, and there is no single place to answer
"who did what, and when, on this invoice?".

## Decisions (from brainstorming)

- **Purpose:** Both — a user-facing per-invoice timeline **and** a central admin audit view.
- **Scope:** Everything — lifecycle + content edits + work-status changes, unified.
- **Edit detail:** Field-level before/after diffs.
- **Architecture:** Approach A — a dedicated `invoice_activity_log` table written explicitly
  from server actions (reliable actor, incl. void/admin via the service-role client), with the
  existing work-status trigger merged at read time.

### Why action-layer capture (not DB triggers)

Void, soft-delete, restore, and purge run through the **service-role (admin) client**, which
has no user session, so `auth.uid()` is `null` inside DB triggers for exactly the actions we
most want to attribute. The server-action layer always knows the actor (`requirePermission()`
returns `gate.userId`), so capturing in actions gives a reliable actor everywhere, plus
semantic events and money-aware labels that triggers can't easily produce.

## Data model

### New table `invoice_activity_log` (append-only)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `invoice_id` | `uuid` | **no FK** (plain uuid; survives purge) — mirrors `admin_audit_log` |
| `actor_id` | `uuid` NOT NULL | **no FK** (plain uuid) — mirrors `admin_audit_log.actor_id` |
| `actor_name` | `text` NOT NULL | snapshot of `profiles.full_name` (fallback `username`) at write time |
| `action` | `text` NOT NULL | semantic key, e.g. `invoice.issued`, `payment.recorded` |
| `entity_label` | `text` | snapshot of `invoice_number` (survives purge) |
| `changes` | `jsonb` | `[{field, label, from, to}]` — changed fields only; null for pure lifecycle events |
| `reason` | `text` | void/delete reasons |
| `metadata` | `jsonb` | extra structured context (payment amount/id, line-item id+label, etc.) |
| `created_at` | `timestamptz` NOT NULL | `now()` |

- **Indexes:** `(invoice_id, created_at desc)`, `(created_at desc)`, `(actor_id, created_at desc)`.
- **Security / immutability:** RLS enabled with **no policies** → service-role only (mirrors
  `admin_audit_log`). All writes go through the admin client inside server actions; all reads
  go through gated server components/actions. A `BEFORE UPDATE OR DELETE` trigger raises to
  enforce true append-only.
- **No human copy stored in the DB:** `action` + `changes` + `metadata` are structured; the UI
  renders labels (keeps the Clinic/`customer` naming rule and relabeling out of the data).

## Capture

- Extend `src/lib/audit/audit-log.ts` with `logInvoiceActivity(entry)` writing to the new table
  (best-effort, same as today's `writeAuditLog`; reuses the `createAdminClient()` + try/catch +
  `logServerError('audit', …)` pattern at `src/lib/audit/audit-log.ts:23-39`).
- Extend `requirePermission()` (`src/lib/auth/require-permission.ts:19-23,43`) to also return
  `actorName` — it already selects from `profiles` for the role check, so add `full_name` and
  `username` to that same select and return `actorName = full_name ?? username` (no extra query).
  Do the same for `requireSuperadmin()`. **Verified:** today both return only `{ ok, userId }`.
- **Field diffs:** for edit actions, read the invoice's current row *before* the mutation,
  compare to the new input, emit `changes` for changed fields only. A diff helper
  (`src/lib/audit/diff.ts`) computes the changed-field set. **No-op saves (nothing changed)
  write no event** — avoids timeline noise.
  - **Scope of diffing:** header/scalar fields are diffed field-by-field into `changes`
    (`customer_id`, `invoice_date`, `due_date`, `notes`, `patient`, `doctor`,
    `service_status_id`, `bill_to_*`, `ship_to_*`, `billing_address`, `delivery_address`).
    For `updateInvoiceAction`, **line-item** changes are summarized in `metadata`
    (`{added, removed, modified}` counts + per-item before/after for modified rows) rather than
    flattened into `changes`, to bound complexity. `subtotal`/`total` deltas are included.
- **Label rendering:** action keys are mapped to human labels in a new
  `src/lib/audit/action-labels.ts` (Clinics-naming-safe), since there is no i18n system and the
  existing `admin_audit_log` viewer renders raw keys.
- **Work-status** changes are **not** written here — they keep their existing trigger →
  `invoice_item_status_history`, and are merged into the timeline at read time.

### Event catalogue

| Server action | `action` key | Captures |
|---|---|---|
| `createInvoiceAction` | `invoice.created` | actor, invoice_number, initial status |
| `markSentAction` | `invoice.issued` | actor |
| `updateInvoiceAction` | `invoice.edited` | field diffs (header + line-item changes) |
| `saveRecipientAction` | `invoice.recipient_changed` | bill-to/ship-to diffs |
| `updateCaseDetailsAction` | `invoice.case_changed` | patient/doctor diffs |
| `updateServiceStatusAction` | `invoice.service_status_changed` | from→to status |
| `updateWorkNoteAction` | `invoice.work_note_changed` | item label + note diff |
| `recordPaymentAction` | `payment.recorded` | `metadata = {amount, payment_date, reference_number}` |
| `createCreditAction` (src/data/credits.ts) | `credit.recorded` | `metadata = {amount, reason?}` |
| `voidInvoice` | `invoice.voided` | reason |
| `softDeleteInvoiceAction` (admin) | `invoice.soft_deleted` | reason |
| `restoreInvoiceAction` (admin) | `invoice.restored` | — |
| `restoreVoidedInvoiceAction` (admin) | `invoice.void_restored` | — |
| `purgeInvoiceAction` (admin) | `invoice.purged` | header snapshot in metadata |
| _delete payment / delete credit (if such actions exist)_ | `payment.deleted` / `credit.deleted` | grep + wire during impl |

**Admin destructive actions are ADDITIVE, not moved:** they keep their existing
`writeAuditLog()` → `admin_audit_log` calls (the `/settings/admin` "Activity" tab reads those via
`getAuditFeed()` in `src/data/admin.ts`, and other entity types rely on that table) and **also**
call `logInvoiceActivity()` so the event shows in the per-invoice timeline and the new invoice
activity view. This is purely additive — no existing behavior changes.

**Note (verified):** `createCreditAction` gates on `invoices.manage` and uses the admin client.
The `AuditAction` union already references `payment.delete`/`credit.delete`, so delete actions
exist; confirm their locations during implementation and wire `payment.deleted`/`credit.deleted`.

## Reads

### Per-invoice timeline

- `getInvoiceActivity(invoiceId)` server function (new file `src/data/invoice-activity.ts`):
  after `requirePermission('invoices.view')`, uses the admin client to:
  - select `invoice_activity_log` where `invoice_id = id`;
  - select `invoice_item_status_history` joined to `invoice_items` (the history table has **no
    `invoice_id`** — filter via `invoice_items.invoice_id = id`), normalize to work-status events
    (uses `changed_by_name`, `changed_at`, `status`, `stage_id`);
  - **merge + sort in TypeScript** by timestamp desc → `TimelineEvent[]`
    (`{ at, actorName, action, changes?, reason?, metadata?, itemLabel? }`). No SQL view/RPC.
- UI: new **Activity** panel on the invoice detail page, rendered as a server component child of
  `InvoiceDetailClient` (`src/components/invoices/detail/InvoiceActivityPanel.tsx`, slotted among
  the existing Card sections). Each row: actor name, action label (from `action-labels.ts`),
  relative timestamp (new `formatRelativeTime` in `src/lib/utils.ts`, date-fns
  `formatDistanceToNow`), and expandable field diffs for edits. Visible to `invoices.view`.

### Admin compliance view

- **Verified:** a superadmin admin console already exists at
  `src/app/(authenticated)/settings/admin/page.tsx` with an "Activity" tab in
  `AdminConsoleClient.tsx` that renders `admin_audit_log` via `getAuditFeed()`
  (`src/data/admin.ts`), using the admin client after `requireSuperadmin()` — the exact pattern
  to mirror.
- Add a new **"Invoice Activity"** view here (new tab in `AdminConsoleClient`, backed by a new
  `getInvoiceActivityFeed(filters)` in `src/data/admin.ts`) listing `invoice_activity_log`
  globally with filters (actor, action type, date range, invoice number). The existing "Activity"
  tab (admin destructive log) is left unchanged.

## Error handling

Logging is **best-effort**: never fail the user's mutation if the audit insert fails. On error,
call `logServerError('audit', err, ctx)` and continue — matches the existing `writeAuditLog`
convention. (If strict guaranteed logging is later required, move the insert into the mutation
RPC/transaction.)

## Testing (TDD)

**Verified setup:** vitest, with unit tests `src/**/*.test.ts` (run by `npm test`, mocked Supabase)
and integration tests `src/**/*.integration.test.ts` (run by `npm run test:integration`, real DB via
`src/integration/db.ts` harness with `seedUser`/`seedInvoice`/`seedCustomer`). Existing examples:
`src/lib/audit/audit-log.test.ts`, `src/integration/admin-actions.integration.test.ts`.

- **Unit:** diff helper (changed-field extraction, no-op detection, value formatting); action-label
  map; `getInvoiceActivity` merge/order logic (with mocked rows); `logInvoiceActivity` payload shape.
- **Integration:** each wired action emits the right `invoice_activity_log` row (and no-op edits
  emit nothing); timeline aggregator merges both sources for a seeded invoice.
- Final gates: `npm test` + `npm run build` (tsc/lint are unusable here).

## Migration & backfill (MCP `apply_migration`)

Applied via MCP `apply_migration`. New file sorts after the latest
(`20260624145126_clinic_archived_at.sql`) — use e.g. `20260630000000_invoice_activity_log.sql`.

1. Create `invoice_activity_log` table + indexes + RLS (enabled, no policies, mirroring
   `admin_audit_log`) + append-only `BEFORE UPDATE OR DELETE` trigger that raises.
   **No foreign keys** — `actor_id`/`invoice_id` are plain uuids (mirrors `admin_audit_log`); this
   avoids the FK cascade firing an UPDATE on the append-only log during invoice purge, and lets the
   audit trail survive a purged invoice.
2. One-time backfill from known columns, **joining `profiles` for `actor_name`**
   (`coalesce(full_name, username, '(unknown)')`):
   - `invoice.created` from `invoices.created_by` / `created_at`;
   - `payment.recorded` from `payments.created_by` / `created_at` / `amount`;
   - `invoice.voided` from `invoices.voided_by` / `voided_at` / `void_reason` (where voided);
   - `invoice.soft_deleted` from `invoices.deleted_by` / `deleted_at` / `delete_reason` (where deleted).
   Work-status history already exists in `invoice_item_status_history` (merged at read, no backfill).
3. Regenerate TS types via MCP `generate_typescript_types` → `src/lib/database-generated.types.ts`,
   then add a domain alias in `src/lib/database.types.ts`
   (`export type InvoiceActivityLog = Tables<'invoice_activity_log'>`).

## Edge cases

- Actor name changes later → snapshot preserves the historical name.
- Admin/service-role actions → attributed via `gate.userId` (+ `actorName`) passed explicitly.
- Purge (hard delete) → `invoice_id` set null, `entity_label` retains `invoice_number`; the log
  row survives for the admin view.
- Concurrent edits → each appends its own row.
- No-op edits → skipped (no event written).

## Out of scope

- Field-level diffs of line-item *work status* (kept in the existing trigger table as-is).
- Generalizing `admin_audit_log` for non-invoice entities (left unchanged).
- Real-time/live updates of the timeline (standard server-render/refresh is fine).
