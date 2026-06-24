# Chidental Lab — Conventions & Design Decisions

The single source of truth for naming, terminology, and design decisions in this app.
**When in doubt, follow this file. When you make a new product/design decision, record it
here** so the next person (or the next Claude session) stays consistent.

See also: [USER_GUIDE.md](./USER_GUIDE.md) (how each module works for end users).

---

## 1. The golden rule: "Clinic" in the UI, "customer" in the code

The lab's customers are dental **clinics**. We made a deliberate split:

| Layer | Term | Why |
|---|---|---|
| **Everything a user reads on screen** | **Clinic** | The business word. Clearer for lab staff. |
| DB table & columns (`customers`, `customer_id`, `bill_to_name`…) | `customer` | Renaming a shipped schema is risky; not worth it. |
| Routes (`/customers`, `/customers/[id]`) | `customer` | Stable URLs / bookmarks. |
| TypeScript types (`Customer`, `CustomerInput`) | `Customer` | Internal identifiers. |
| Permission keys (`customers.view`, `customers.edit`) | `customers` | Stored in DB `role_permissions`; renaming breaks grants. |
| Variable names (`customerId`, `selectedCustomer`) | `customer` | Internal code. |

**Rule of thumb:** if a human sees it (JSX text, `<Label>`, placeholder, button, page title,
table header, toast, dialog title, `aria-label`), it says **Clinic**. Otherwise it stays
`customer`. Never expose the word "Customer" in the UI.

> History: a full Customer→Clinic UI refactor was done across the app. The permissions
> *settings* labels were the last code-side miss and are now also "Clinics".

---

## 2. Canonical UI label glossary

Use these exact labels. Don't invent synonyms ("Client", "Account", "Customer", "Buyer").

| Concept | Canonical label |
|---|---|
| The lab's customer | **Clinic** (plural **Clinics**) |
| The clinic's name field (incl. invoice Bill To / Deliver To) | **Clinic** (placeholder: "Clinic name") |
| The dentist / person of contact | **Contact person** (always "person" — not bare "Contact") |
| Person whose teeth the work is for | **Patient** |
| Prescribing dentist on a case | **Doctor** |
| A sellable service/product | **Product** |
| A line on an invoice | **Line item** / **Item** |
| Job-floor progress | **Work status** (the In-Progress sub-steps are **Work stages**) |
| Lab-to-doctor note on delivery | **Service status** |
| Soft-deleted invoice | **Voided** (verb: **Void**) |
| Money owed | **Outstanding** / **Balance due** |

**Recipient blocks (Bill To / Deliver To):** the entity name field is labeled **"Clinic"**
(not "Name"/"Recipient"), and the person field is **"Contact person"** (not "Contact").
The Deliver-To name is still the clinic — only the *address* differs. Decided 2026-06-24
after "Name" tested as confusing on the New Invoice screen.

---

## 3. Money & invoice rules

- **No discount or tax.** `total = subtotal` (sum of line `amount`s). Per-invoice discount and
  SST tax were removed 2026-06-24 — the columns (`discount_pct`, `discount_amount`, `tax_rate`,
  `tax_amount`) were dropped from `invoices` and the form/document show only Subtotal → Total.
- **Payment terms are not stored per clinic.** A new invoice pre-fills its due date from a
  single lab-wide default (`DEFAULT_PAYMENT_TERMS_DAYS` in `lib/config.ts`): due = invoice
  date + that many days. A per-invoice exception is made by editing the due date directly —
  there is no per-clinic terms field. The printed invoice derives the shown "N Days" from the
  invoice's own dates (due − invoice date), so it always matches the dates on the page.
- **Outstanding:** `status === 'paid' ? 0 : total − totalPaid`. The Record-Payment dialog
  pre-fills `max(0, total − totalPaid)`; the user never computes the balance.
- **Payment status transitions** are decided by the `record_payment` RPC atomically:
  `sent/partial → paid` when paid ≥ total, else `partial`.
- **Voiding is a soft-delete:** set `voided_at / voided_by / void_reason`; never hard-delete
  an invoice. Voided invoices are locked for everyone, show a VOID watermark, and drop out
  of the Work queue and Reports. Voiding is terminal and cannot be restored in the app.

---

## 4. Permissions model

Three invoice tiers — keep the boundary consistent:

- `invoices.view` — read invoices + the Work board, **and change work status** (shop-floor
  staff move jobs without billing rights).
- `invoices.edit` — create invoices + edit **draft** invoices.
- `invoices.manage` — record payments, **void**, and edit **already-sent** invoices.

Others: `customers.view/edit`, `products.view/edit`, `reports.view`, `staff.manage`,
`settings.manage`. **Role management is not a permission** — it is gated to the Super Admin
system role to prevent privilege escalation.

`requirePermission()` is the source of truth and re-checks on **every server write**, so
permission changes apply immediately with no re-login. Client `hasPermission()` is for
*hiding UI only* — never the security boundary.

---

## 5. Work status & sub-status

- Five statuses: `received → in_progress → ready → delivered`, plus `on_hold` (a pause on
  any status, which remembers where it came from via `resume_status`).
- **"In Progress" has sub-statuses** ("Work stages", configured in Settings). They have a
  **display order only — not a required sequence**; a case may sit on any sub-status, move
  between them in any order, or sit on **none** (bare `in_progress`). A staged item is encoded
  as `stage:<id>`; a stage-less in-progress is just `in_progress`. Retired stages still label
  legacy items.
- **Work status is per line item, not per invoice.** (The old invoice-level
  "advance all items" action was removed.) The Kanban board's 5 columns model only the top
  statuses — dropping a card clears the stage; use the dropdown to pick a specific stage.
- Every status change is written to `invoice_item_status_history` (who / when / old status).

---

## 6. Architecture patterns (follow for every new screen)

1. **Server-first.** A `page.tsx` Server Component fetches data (RLS-aware session client)
   and checks permission; it passes plain data to a client island. No client-side data
   fetching for first paint.
2. **Server Actions for every write.** Each action starts with `requirePermission(...)` and
   returns a discriminated `ActionResult` (`{ ok: true } | { ok: false; error }`).
   - Under `strict: false`, narrow with `result.ok === false`, **not** `!result.ok`.
3. **Friendly errors, logged internals.** Catch errors in the action, log the real one with
   `logServerError('scope', err, ctx)` (server-side only), and return a short user-facing
   message. Never leak a raw/digested server error to the user.
4. **Admin vs session client.** Use the **session** client when the acting user must be
   recorded (e.g. status-history triggers) or RLS should apply. Use the **admin** client only
   for privileged writes (void, employee management) — and remember prod needs
   `SUPABASE_SERVICE_ROLE_KEY` set for those.
5. **Soft-delete, don't destroy.** Products deactivate; invoices void; work stages retire.
   History must always survive.
6. **Navigation is data.** Add nav items in `src/domain/navigation.ts` with their permission;
   the sidebar and the deep-link guard both read from there.
7. **Optimistic moves on the Work board** revert on failure (toast + auto-revert).

---

## 7. How to record a new decision

When you change terminology, a money rule, a permission boundary, or a UI convention:

1. Make the code change.
2. Add/adjust the relevant row in this file (and the glossary if it's a label).
3. If it's a naming rule, keep the [project memory] note in sync so future sessions inherit it.

Keep entries short and prescriptive — "do X, because Y" — not a changelog.
