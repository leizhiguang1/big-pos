# Chi Dental Lab POS — Architecture Reference

> A complete map of how the app works today, written to drive the upcoming restructure.
> Reflects the live database schema + source as of 2026-06-18.

---

## 1. What this app is

An **internal tool for a dental lab**. The lab fabricates dental work (crowns, dentures, trays, etc.) for dentist/clinic customers. Staff:

- register **customers** (the clinics),
- raise **invoices** with **line items** (each item = a product/job),
- push each item through **production stages** (the work queue),
- record **payments**, and
- read **reports**.

It is used by a small number of trusted staff (3 today), each with a **role** that controls what they can see/do.

---

## 2. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI runtime | React 19 |
| Backend | Supabase (Postgres + Auth + auto REST/PostgREST) via `@supabase/ssr` |
| Styling | Tailwind 3 + shadcn/ui (Radix primitives) |
| Forms | react-hook-form + Zod (everywhere except InvoiceForm) |
| Charts | recharts |
| PDF/print | `@react-pdf/renderer` + browser `window.print()` |
| Tests | Vitest (49 unit tests on the domain helpers) |
| Path alias | `@/* → src/*` |

Key config notes: `tsconfig` has **`strict: false`**; `dev`/`build` run with an 8 GB Node heap flag; ESLint uses a flat config extending `next/core-web-vitals` + TypeScript.

---

## 3. Data model (authoritative)

### Entity relationships

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

### Tables

**customers** — the clinics you bill.
`id, clinic_name*, contact_person, phone, email, billing_address, delivery_address, ssm_no, notes, created_at`

**invoices** — order header. `status` is **plain text** (not a DB enum), default `draft`.
`id, invoice_number* (auto), customer_id*→customers, created_by*→auth user, invoice_date (def today), due_date*, status* ('draft'), subtotal*, total*, notes, patient, doctor, service_status_id→service_statuses, billing_address, delivery_address, bill_to_name, bill_to_contact, bill_to_phone, ship_to_name, ship_to_contact, voided_at, voided_by, void_reason, created_at`
- The `bill_to_*` / `ship_to_*` / `billing_address` / `delivery_address` fields are a **recipient snapshot** copied onto the invoice at creation, so editing the customer master later doesn't rewrite history.
- There is **no tax field** — `subtotal` and `total` track together.

**invoice_items** — order lines. Production state lives here.
`id, invoice_id*→invoices, product_id→products (nullable: free-text lines allowed), description*, quantity* (def 1), unit_price* (def 0), amount* (def 0), work_status* (enum, def 'received'), stage_id→work_stages, work_status_updated_at*, work_note, created_at`

**payments** — money received against an invoice.
`id, invoice_id*→invoices, amount*, payment_date (def today), reference_number, notes, created_by*, created_at`

**products** — catalog + price guard rails.
`id, name*, description, unit_price* (def 0), unit* (def 'unit'), min_unit_price, max_unit_price, active* (def true), created_at`

**invoice_item_status_history** — audit trail of every production-status change (written by a trigger).
`id, invoice_item_id*→invoice_items, status* (work_status enum), stage_id→work_stages, changed_by, changed_by_name, note, changed_at`

**service_statuses** & **work_stages** — admin-configurable taxonomies (identical shape).
`id, label*, color, sort_order* (def 0), is_active* (def true), created_at`

**profiles** — app identity, 1:1 with Supabase Auth user.
`id* (= auth.users.id), username*, full_name*, role_id→roles, active* (def true), created_at, updated_at`

**roles** — `id, name*, description, is_system* (def false), created_at, updated_at`. `is_system = true` ⇒ "Super Admin", implicitly holds every permission.

**role_permissions** — flat grant table. `(role_id*→roles, permission*)` — one row per granted permission key.

### Enums

- `work_status`: **`received → in_progress → ready → delivered`**, plus **`on_hold`** (off-flow). (`qc` was removed.)
- `invoices.status` is **text, not an enum** — the app treats it as `draft | sent | partial | paid | overdue`, but the DB does not enforce that.

### Database logic (functions & triggers) — ⚠️ NOT in the repo, only on the live DB

| Object | Type | Purpose |
|---|---|---|
| `create_invoice_with_items(jsonb, jsonb)` | RPC | Insert invoice header + all line items in **one transaction** |
| `update_invoice_with_items(uuid, jsonb, jsonb)` | RPC | Update header + insert/update/delete lines in one transaction |
| `generate_invoice_number()` | fn | Produces the sequential invoice number |
| `set_invoice_number_default()` | trigger (BEFORE INSERT on invoices) | Assigns the number server-side |
| `enforce_invoice_item_price_range()` | trigger (BEFORE INS/UPD on invoice_items) | Rejects a line price outside the product's min/max band |
| `log_invoice_item_status_change()` | trigger (AFTER INS/UPD on invoice_items, **SECURITY DEFINER**) | Writes the `invoice_item_status_history` row |
| `stamp_invoice_item_work_status_updated_at()` | trigger (BEFORE INS/UPD on invoice_items) | Stamps `work_status_updated_at` |
| `set_updated_at()` | trigger (BEFORE UPDATE on profiles) | Maintains `updated_at` |
| `is_admin()` | fn (**SECURITY DEFINER**) | Admin check helper |

**RLS:** enabled on all 11 tables. The 9 business tables share one permissive policy (`authenticated_all`, `USING true / WITH CHECK true`) → any logged-in user has full access; `anon` is denied. `roles`/`role_permissions` allow authenticated **SELECT only** (writes go via service-role).

---

## 4. Architecture layers

```
┌─ Feature pages  (src/app/(authenticated)/*)  — 'use client', talk to Supabase directly
├─ Domain helpers (src/lib/*.ts)               — pure, unit-tested business rules
├─ Auth          (src/contexts, src/lib/auth)  — the only server-enforced layer
└─ Database      (functions, triggers, RLS)    — integrity + atomic writes
```

### Request / auth lifecycle

1. `src/proxy.ts` (Next 16's renamed middleware) → `src/lib/supabase/middleware.ts` refreshes the Supabase session on every navigation. No session on a protected GET → redirect `/login`; logged-in user hitting `/login` → `/dashboard`. **Only GET is gated** so Server Action POSTs reach their own permission checks.
2. The `(authenticated)` route group layout wraps pages in `AuthProvider` (loads the current user + role) → `AppShell` (nav).
3. Pages render and call Supabase directly via the **browser singleton** `@/lib/supabase`.

### The three Supabase clients

| Client | File | Auth | Used by |
|---|---|---|---|
| Browser | `lib/supabase/client.ts` (+ singleton `lib/supabase.ts`) | anon, RLS as logged-in user | all `'use client'` pages, AuthContext |
| Server (SSR) | `lib/supabase/server.ts` | anon, cookie-bound | `require-permission.ts`, server pages |
| Admin | `lib/supabase/admin.ts` | **service-role, bypasses RLS** | employee/role/void server actions only |

---

## 5. Module deep-dives

### 5.1 Auth & session
- **Login** (`src/app/login/page.tsx`): User ID + 6-digit PIN. `usernameToEmail()` (`lib/auth/username.ts`) maps username → `<username>@chidentallab.local`; PIN is the Auth password. `signInWithPassword` → session cookie → `router.push('/dashboard')`. Errors collapse to "Invalid username or PIN".
- **AuthContext** (`src/contexts/AuthContext.tsx`): on session change, one embedded query `profiles → roles(name, is_system, role_permissions(permission))` flattens permissions into a `Set`. Exposes `username` (from `user_metadata`), `roleName`, `isSuperadmin`, `hasPermission(p)`, `signOut`. This drives **UI gating only**.

### 5.2 RBAC (roles, permissions, employees)
- **Permission catalogue** (`src/lib/permissions.ts`): fixed 12 keys — `invoices.view/edit/manage`, `customers.view/edit`, `products.view/edit`, `services.view/edit`, `reports.view`, `staff.manage`, `settings.manage`. `permissionGranted(role, p)` = `role.is_system || role.permissions.includes(p)`. Lockout guard: `wouldRemoveLastSuperadmin`.
- **Server enforcement** (`src/lib/auth/require-permission.ts`): reads role **from the DB** (not the token) per call; `requirePermission(p)` / `requireSuperadmin()`. This is the real gate for admin actions.
- **Employee management** (`src/lib/auth/employee-actions.ts`, `EmployeesManager.tsx`, `settings/employees`): create/update/resetPin/setActive/delete — all `requirePermission('staff.manage')` then service-role + Auth admin API. Guards: username/PIN regex, last-superadmin lockout, self-delete/deactivate blocks, ~100yr ban to disable a deactivated login.
- **Role management** (`src/lib/auth/role-actions.ts`, `RolesManager.tsx`, `settings/roles`): create/update/delete — `requireSuperadmin()`. System role read-only; can't delete a role still assigned to users; permission keys sanitized against the catalogue.

### 5.3 Customers
- List / detail / create / edit. `CustomerForm.tsx` = the clean RHF+Zod template; direct `insert`/`update`. Detail page parallel-loads the customer + its invoices and derives Total Billed / Outstanding via `isVoided`/`isOutstanding`. List search is client-side `useMemo`. `customers.edit` gates the buttons + a deep-link redirect guard.

### 5.4 Products
- Single page with an inline create/edit dialog. RHF+Zod with a `superRefine`: a product is **either** single-price **or** has a `min_unit_price`/`max_unit_price` band (toggled via `useWatch`). `toggleActive` flips `active`. Gated by `products.edit`. The price band is re-enforced at the DB by `enforce_invoice_item_price_range`.

### 5.5 Invoices ⭐ (the core module)
Files: `invoices/page.tsx` (list), `invoices/[id]/page.tsx` (detail, ~1290 lines), `invoices/new` + `[id]/edit` (wrap `InvoiceForm` in `<Suspense>`), `components/invoices/InvoiceForm.tsx`.

**List** — one nested select `invoices(*, customers(clinic_name), invoice_items(work_status), service_statuses(*))`. Triple `useMemo` filtering: text search, payment-status (with derived `void`/`overdue`), work-status (matches if **any** line item matches). Per-row "dominant" work status via `dominantWorkStatus`.

**InvoiceForm (create/edit)** — the most complex screen, and the one that does **not** use react-hook-form (≈20 `useState` fields + a `LineItem[]` array tracked by id):
- Reference data (customers, active products, active service statuses) loads in one effect; edit mode preloads the invoice + items.
- **Line items:** picking a product auto-fills description + unit_price; fixed-price products lock the price input, ranged products validate per row (`itemPriceErrors`) and block save. `amount = quantity × unit_price`; `subtotal = total` (no tax).
- **Recipient sync:** an effect auto-fills bill-to/deliver-to from the chosen customer, guarded by `recipientSyncRef` so loading a saved invoice doesn't clobber its snapshot; `recipientDirty` + `restoreFromCustomer` let the user reset.
- **Edit-lock:** `canEditInvoice` redirects non-editable invoices back to detail (drafts editable with `invoices.edit`; sent+ require `invoices.manage`; voided = nobody).
- **Save = atomic RPC:** create → `create_invoice_with_items`; edit → `update_invoice_with_items` (diffs items by id into insert/update/delete, one transaction). Invoice number is assigned by the DB trigger.

**Invoice detail** — `load()` does a 6-way parallel fetch (invoice+customer+service join, items, payments, active service statuses, products, work stages) then a follow-up for status history. Actions:
- **Status:** Mark Sent / Mark Paid → direct `invoices.update`.
- **Payments:** `payments.insert`, then re-read paid-sum from DB and set status via `nextStatusAfterPayment`. Payment form uses RHF + `useWatch` to warn if amount > outstanding. *(Non-atomic: two sequential writes.)*
- **Per-item work status:** `invoice_items.update` (the DB trigger logs history). *(See 5.6.)*
- **Recipient edits:** update the invoice snapshot, optionally cascading to the customer master.
- **Void:** the only business action behind a permission-gated server action (`lib/invoices/void-actions.ts`, `requirePermission('invoices.manage')`, service-role). Soft delete — sets `voided_at/by/reason`; voided invoices are terminal in the app.
- **Print/receipt:** `renderDocBody` renders both the on-screen invoice and a print/delivery doc; a print dialog shows a live preview + an editor of per-printout `PrintOverrides` (never saved); `window.print()` via a `printNonce` effect + `afterprint` reset; voided invoices get a diagonal VOID watermark.

**Invoice lifecycle / status logic** (`src/lib/invoice-status.ts`, pure + tested):
- `draft → sent → partial → paid`; `overdue` is **derived** (`isOutstanding && due_date < today`), never stored.
- `isVoided` (terminal, overrides all), `countsAsRevenue` (paid & not voided), `isOutstanding` (sent/partial/overdue & not voided).
- `nextStatusAfterPayment(current, paidSum, total)`: returns `paid` if already paid **or** `paidSum ≥ total`, else `partial` — an already-paid invoice never downgrades.

### 5.6 Work status & production ⭐ (`work/page.tsx`, `lib/work-status.ts`, `lib/work-stages.ts`)
- `work_status` enum drives the per-item production state; `LINEAR_FLOW` is `received → in_progress → ready → delivered`; `on_hold` is off-flow with no helper transition in/out.
- The `in_progress` phase is **subdivided by configurable `work_stages`** (label/color/sort_order/is_active). `encodeWork`/`decodeWork` pack a `(work_status, stage_id)` pair into a single dropdown value (`stage:<id>` for in-progress-on-a-stage, else the bare status). `workOptions` defines canonical order: Received → active stages → Ready → Delivered → On Hold. The helpers deliberately keep items sitting on **retired/inactive stages** visible.
- **Work queue page:** loads `invoice_items` with nested `invoices(... customers(clinic_name))`, drops items on voided invoices client-side, groups by encoded slot (`orderedGroupKeys`). Status changes are **optimistic** — local state moves the card immediately (no refetch), with a transient "moved to X" hint (cleared after 4s). ⚠️ No rollback if the DB write fails.
- `dominantWorkStatus` summarizes an invoice's overall production state (attention-first priority: on_hold, received, in_progress, ready, delivered). Every change is audit-logged to `invoice_item_status_history` by the `log_invoice_item_status_change` trigger; `work_status_updated_at` is stamped by another trigger.

### 5.7 Reports & Dashboard
- **Reports** (`reports/page.tsx`): date-range query `invoices(*, customers(clinic_name), invoice_items(*, products(name)))`; loading state is **derived** (`loadedKey === rangeKey`). All aggregation in-render: revenue (`countsAsRevenue`), outstanding, aging buckets, top-10 by customer/product. Tabs + recharts. Read-only.
- **Dashboard** (`dashboard/page.tsx`): parallel load of a slim invoice projection + a customer count + recent 8 invoices; month revenue/outstanding computed in-render.

### 5.8 Settings
- Hub page links gated per-permission. `service-statuses` and `work-stages` are near-identical CRUD pages: RHF+Zod (label/color with a color-preset picker + live preview), reorder via paired `sort_order` swaps, soft activate/deactivate. Gated by `services.edit` / `settings.manage`. Plus the Roles and Employees managers (5.2).

---

## 6. Cross-cutting patterns

- **Data access:** browser Supabase singleton called directly in components; nested PostgREST selects for joins, often cast `as unknown as <Type>`. No React Query/SWR — fetch in `useEffect`, store in `useState`, manual `load()` after mutations.
- **Forms:** RHF+Zod for Customer/Product/Payment/Settings; raw `useState` for InvoiceForm.
- **Loading/error:** per-page `loading` boolean + spinner; errors in local state. **No global toast or error boundary.**
- **Permission gating in UI:** `hasPermission(...)` hides controls; forms add deep-link redirect guards; invoice editability via `canEditInvoice`.
- **Domain logic centralized** in `src/lib/*` and unit-tested — pages stay thin.
- **Types:** two layers — generated `database-generated.types.ts` (verbatim from `supabase gen types`) + `database.types.ts` (named aliases + relation-augmented shapes).

---

## 7. The two authorization regimes (read this before restructuring)

| Data | Write path | Enforcement |
|---|---|---|
| roles, employees, invoice **void** | `'use server'` actions, service-role | ✅ Real: `requirePermission` / `requireSuperadmin`, DB-sourced role |
| invoices, items, payments, customers, products, services, work | **direct browser writes** | ⚠️ UI-only (`hasPermission` hides buttons); the DB gate is the permissive `authenticated_all` RLS — **any logged-in user can do anything** |

`anon` is fully blocked at the DB. So the open risk is **intra-staff** (a "viewer" could edit via the API) — low for 3 trusted staff, which is why deferring the fix to the replan is acceptable *if logins stay tightly controlled*.

---

## 8. Known issues / restructure targets

**Correctness / operability (fix before launch):**
1. **DB functions/triggers/policies are unversioned** — they live only on the live DB. Capture into migrations.
2. **Money model split:** "Mark Paid" can set `paid` with no `payments` row → payment-based reports under-count vs status-based.
3. **Non-atomic multi-writes:** payment-then-status, recipient-cascade, etc. can partially fail.
4. **Work-queue optimistic updates** never roll back and surface no error on failure.
5. **No global error/toast/error-boundary** — failures are invisible.

**Cheap security wins (minutes, even if security is deferred):**
6. Revoke `anon` EXECUTE on `is_admin` and `log_invoice_item_status_change` (REST-RPC reachable).
7. Enable leaked-password protection; confirm Auth rate-limits (PIN = 6 digits, only credential).

**Structural (the replan):**
8. Business-data authorization model (DB-enforced RLS vs server actions).
9. `tsconfig strict` + remove `as unknown as` casts.
10. InvoiceForm → react-hook-form; a data-fetching layer (React Query); pagination; `invoices.status` as a real enum/CHECK.

---

*Generated as the baseline for the module + database replan.*

---

## Module docs

Detailed references for the four core subsystems. These are the canonical homes — the sections above summarise; the pages below expand.

| Module | File | What it covers |
|---|---|---|
| Billing lifecycle | [`docs/modules/billing-lifecycle.md`](./modules/billing-lifecycle.md) | `BillingStatus` states, `TRANSITIONS` table, `overdue` derivation, `void` overlay, Mark-Paid write sequence |
| Work status | [`docs/modules/work-status.md`](./modules/work-status.md) | `WorkStatus` enum, `LINEAR_FLOW`, stage subdivision, `encodeWork`/`decodeWork`, `on_hold` round-trip, aggregation |
| Data model | [`docs/modules/data-model.md`](./modules/data-model.md) | All 11 tables with columns + FKs, `work_status` enum, DB functions/triggers, RLS summary |
| Permissions | [`docs/modules/permissions.md`](./modules/permissions.md) | The 12 permission keys, `is_system` Super Admin semantics, `permissionGranted`, server-side enforcement seam |
