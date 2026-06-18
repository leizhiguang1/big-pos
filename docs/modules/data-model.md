# Data Model

**Canonical reference.** The high-level summary in [`docs/ARCHITECTURE.md §3`](../ARCHITECTURE.md) points here; this is the expanded authoritative version.

---

## Entity relationships

```
customers ──< invoices ──< invoice_items ──< invoice_item_status_history
   (clinic)      │   │           │  │
                 │   │           │  └─ stage_id ───> work_stages
                 │   │           └──── product_id ─> products
                 │   └── service_status_id ───────> service_statuses
                 └──< payments

profiles ──> roles ──< role_permissions          (RBAC)
  profiles.id == auth.users.id (1:1 with Supabase Auth)
```

---

## Tables

### `customers`
The clinics you bill.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `clinic_name` | text NOT NULL | |
| `contact_person` | text | |
| `phone` | text | |
| `email` | text | |
| `billing_address` | text | |
| `delivery_address` | text | |
| `ssm_no` | text | Malaysian company reg number |
| `notes` | text | |
| `created_at` | timestamptz | |

---

### `invoices`
Order header. `status` is **text guarded by a CHECK constraint** (default `'draft'`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `invoice_number` | text NOT NULL | Set by `set_invoice_number_default` trigger |
| `customer_id` | uuid NOT NULL → `customers` | |
| `created_by` | uuid NOT NULL → `auth.users` | |
| `invoice_date` | date | Defaults to today |
| `due_date` | date NOT NULL | |
| `status` | text NOT NULL | `'draft'` default; `invoices_status_check` allows `draft\|sent\|partial\|paid\|overdue`. `overdue` is derived-only — never stored |
| `subtotal` | numeric NOT NULL | Equals `total` — no tax field |
| `total` | numeric NOT NULL | |
| `notes` | text | |
| `patient` | text | Patient name for the dental work |
| `doctor` | text | Referring clinician |
| `service_status_id` | uuid → `service_statuses` | Optional service-status tag |
| `billing_address` | text | Snapshot copied from customer at creation |
| `delivery_address` | text | Snapshot copied from customer at creation |
| `bill_to_name` | text | Recipient snapshot |
| `bill_to_contact` | text | |
| `bill_to_phone` | text | |
| `ship_to_name` | text | |
| `ship_to_contact` | text | |
| `voided_at` | timestamptz | Non-null = voided (overlay, not a status value) |
| `voided_by` | uuid → `auth.users` | |
| `void_reason` | text | |
| `created_at` | timestamptz | |

The `bill_to_*` / `ship_to_*` / address fields are a **recipient snapshot** — editing the customer master later does not rewrite invoice history.

---

### `invoice_items`
Order lines. Production state lives here.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `invoice_id` | uuid NOT NULL → `invoices` | |
| `product_id` | uuid → `products` | Nullable — free-text lines allowed |
| `description` | text NOT NULL | |
| `quantity` | numeric NOT NULL | Default 1 |
| `unit_price` | numeric NOT NULL | Default 0 |
| `amount` | numeric NOT NULL | `quantity × unit_price`; default 0 |
| `work_status` | `work_status` enum NOT NULL | Default `'received'` |
| `stage_id` | uuid → `work_stages` | Nullable; meaningful only when `work_status = 'in_progress'` |
| `work_status_updated_at` | timestamptz NOT NULL | Stamped by `stamp_invoice_item_work_status_updated_at` trigger |
| `work_note` | text | Free-text note on the current status |
| `resume_status` | `work_status` enum | When `work_status = on_hold`, the status to resume to; null otherwise (added 2026-06-18) |
| `created_at` | timestamptz | |

---

### `payments`
Money received against an invoice.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `invoice_id` | uuid NOT NULL → `invoices` | |
| `amount` | numeric NOT NULL | |
| `payment_date` | date | Default today |
| `reference_number` | text | Cheque/transfer reference |
| `notes` | text | |
| `created_by` | uuid NOT NULL → `auth.users` | |
| `created_at` | timestamptz | |

---

### `products`
Catalog with optional price guard rails.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text NOT NULL | |
| `description` | text | |
| `unit_price` | numeric NOT NULL | Default 0 |
| `unit` | text NOT NULL | Default `'unit'` |
| `min_unit_price` | numeric | Optional lower bound |
| `max_unit_price` | numeric | Optional upper bound |
| `active` | boolean NOT NULL | Default true |
| `created_at` | timestamptz | |

`enforce_invoice_item_price_range` trigger rejects a line-item price outside the product's `min`/`max` band.

---

### `invoice_item_status_history`
Audit trail of every production-status change. Written by the `log_invoice_item_status_change` trigger.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `invoice_item_id` | uuid NOT NULL → `invoice_items` | |
| `status` | `work_status` enum NOT NULL | |
| `stage_id` | uuid → `work_stages` | |
| `changed_by` | uuid | Auth user ID |
| `changed_by_name` | text | Denormalised display name |
| `note` | text | |
| `changed_at` | timestamptz | |

---

### `service_statuses` and `work_stages`
Admin-configurable taxonomies. Identical shape.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `label` | text NOT NULL | |
| `color` | text | Tailwind class string |
| `sort_order` | integer NOT NULL | Default 0 |
| `is_active` | boolean NOT NULL | Default true |
| `created_at` | timestamptz | |

`work_stages` sub-divides the `in_progress` production phase; see [`docs/modules/work-status.md`](./work-status.md).

---

### `profiles`
App identity, 1:1 with Supabase Auth user.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Equals `auth.users.id` |
| `username` | text NOT NULL | Used as login handle |
| `full_name` | text NOT NULL | |
| `role_id` | uuid → `roles` | |
| `active` | boolean NOT NULL | Default true; deactivated users get a ~100yr ban on the Auth side |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Maintained by `set_updated_at` trigger |

---

### `roles`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text NOT NULL | |
| `description` | text | |
| `is_system` | boolean NOT NULL | Default false; `true` = Super Admin (implicit all-permissions) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

### `role_permissions`
Flat grant table — one row per (role, permission) pair.

| Column | Type | Notes |
|---|---|---|
| `role_id` | uuid NOT NULL → `roles` | |
| `permission` | text NOT NULL | One of the 12 keys in the permission catalogue |

See [`docs/modules/permissions.md`](./permissions.md) for the full catalogue.

---

## Enums

### `work_status` (Postgres enum)
Values: `received`, `in_progress`, `ready`, `delivered`, `on_hold`

The value `qc` was removed. The forward-only flow is `received → in_progress → ready → delivered`; `on_hold` is off-flow.

### `invoices.status` (text + CHECK, NOT a Postgres enum)
Plain text guarded by `invoices_status_check`: `status in ('draft','sent','partial','paid','overdue')`. **`overdue` is derived from `due_date` at read time and never stored** — the constraint permits it, but no code writes it (stored values are only `draft`/`sent`/`partial`/`paid`).

---

## Database functions and triggers

These are captured in the baseline migration (`supabase/migrations/00000000000000_baseline_schema.sql`); the two payment RPCs were added 2026-06-18 in `20260618010200_payment_rpcs.sql`.

| Object | Type | Purpose |
|---|---|---|
| `create_invoice_with_items(jsonb, jsonb)` | RPC | Insert invoice header + all line items in one transaction |
| `update_invoice_with_items(uuid, jsonb, jsonb)` | RPC | Update header + insert/update/delete lines in one transaction |
| `record_payment(uuid, numeric, uuid, date?, text?, text?)` | RPC | Insert a payment + atomically set `partial`/`paid` (never downgrades a paid invoice). Added 2026-06-18 |
| `mark_invoice_paid(uuid, uuid, text?)` | RPC | Insert a balancing payment for the outstanding amount, then set `paid` — keeps `sum(payments)` reconciled with status. Added 2026-06-18 |
| `generate_invoice_number()` | Function | Produces the sequential invoice number string |
| `set_invoice_number_default()` | Trigger (BEFORE INSERT on `invoices`) | Assigns the invoice number server-side |
| `enforce_invoice_item_price_range()` | Trigger (BEFORE INS/UPD on `invoice_items`) | Rejects a line price outside the product's min/max band |
| `log_invoice_item_status_change()` | Trigger (AFTER INS/UPD on `invoice_items`, SECURITY DEFINER) | Writes the `invoice_item_status_history` row |
| `stamp_invoice_item_work_status_updated_at()` | Trigger (BEFORE INS/UPD on `invoice_items`) | Stamps `work_status_updated_at` |
| `set_updated_at()` | Trigger (BEFORE UPDATE on `profiles`) | Maintains `profiles.updated_at` |
| `is_admin()` | Function (SECURITY DEFINER) | Admin check helper |

---

## Row-Level Security

RLS is **enabled on all 11 tables**.

| Tables | Policy | Effect |
|---|---|---|
| 9 business tables (invoices, items, payments, customers, products, service_statuses, work_stages, invoice_item_status_history, profiles) | `authenticated_all` (`USING true / WITH CHECK true`) | Any logged-in user has full read+write; `anon` is denied |
| `roles`, `role_permissions` | Authenticated SELECT only | Writes go via service-role (server actions) |

This means authorization for business data is currently **UI-only** — `hasPermission()` hides controls but any authenticated user can write directly to the API. Deferring real enforcement to Spec 5 (security) is an accepted risk for the current small trusted-staff deployment.

---

## How to change this

### Add a column
Write a Supabase migration file (e.g. `supabase/migrations/<timestamp>_add_col.sql`), then regenerate TypeScript types:
```bash
supabase gen types typescript --linked --schema public > src/lib/database-generated.types.ts
```
Update `src/lib/database.types.ts` aliases if the new column needs a named alias.

### Add a value to the `work_status` enum
```sql
ALTER TYPE work_status ADD VALUE 'new_value';
```
Then update `WorkStatus` and related helpers in `src/domain/production.ts`. See [work-status.md § How to change this](./work-status.md).

### Add a database function / RPC
Write a migration under `supabase/migrations/` (`language plpgsql`, `set search_path to 'public'`, not SECURITY DEFINER — match the existing RPCs), apply it, then regenerate types. The full current schema (tables, functions, triggers, policies) is already captured in `00000000000000_baseline_schema.sql`.
