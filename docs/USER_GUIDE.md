# Chidental Lab — App Guide

A POS / job-tracking system for a dental lab. The lab's **customers are clinics** (the
word "customer" survives in code/routes/DB, but every label a user sees says "Clinic").

Everything follows the same pattern: a server page fetches data and checks permission →
an interactive client island → Server Actions for every write. Permission changes take
effect immediately (the server re-checks on every write — no re-login needed).

---

## 1. Signing in

- Go to **/login**. Enter your **User ID** (username) and **6-digit PIN**.
- The username is mapped internally to `username@chidental.internal`; you never type an email.
- Wrong credentials show "Invalid username or PIN". On success you land on the **Dashboard**.
- Inactive employees are blocked from signing in.

---

## 2. Roles & permissions (who can do what)

Roles are defined in **Settings → Roles & Permissions** (Super Admin only). Each role
grants a set of permission keys:

| Permission | Lets the user… |
|---|---|
| `invoices.view` | See invoices and the Work board |
| `invoices.edit` | Create invoices, edit **draft** invoices |
| `invoices.manage` | Record payments, **void**, edit **already-sent** invoices |
| `customers.view` | See the clinic directory |
| `customers.edit` | Create / edit clinics |
| `products.view` | See the product catalogue |
| `products.edit` | Create / edit products |
| `reports.view` | Open Reports |
| `staff.manage` | Manage employees (add, reset PIN, assign role, deactivate) |
| `settings.manage` | Lab setup: Work Statuses, Work Stages, Service Statuses, Units |

Dependencies are auto-enforced (e.g. ticking `invoices.edit` also ticks `invoices.view`).
**Super Admin** is a system role that implicitly holds every permission and cannot be
edited or deleted. Managing roles is gated to Super Admin only (prevents privilege escalation).

The sidebar only shows sections you have permission for, and deep-links you aren't allowed
to open redirect you to the Dashboard.

---

## 3. Clinics (customers)

**Where:** sidebar → **Clinics** (`customers.view`).

### Create / edit a clinic
1. Clinics list → **Add Clinic** (or pencil on a row). Requires `customers.edit`.
2. Fields:
   - **Clinic Name** (required), SSM No., Contact Person, Phone, Email
   - **Billing Address**, **Delivery Address**
   - Notes
3. Save. Invoice payment terms are set per invoice, not on the clinic record.

### Clinic detail / statement
Opening a clinic shows contact details, a billing summary (Total Billed, Outstanding,
Account Balance = outstanding − credits), an **A/R aging** table (Current / 1–30 / 31–60 /
61–90 / 90+ days), the list of account credits, and clickable invoice history. The
**Issue Credit** button records a clinic-level or invoice-specific credit (remake / return /
goodwill).

---

## 4. Products

**Where:** sidebar → **Products** (`products.view`).

- Each product holds: **Name** (required), Description, **Unit Price**, **Unit** (per tooth /
  arch / case … — managed in Settings → Units), and an optional **min/max price range**
  (when used, unit price = the minimum).
- **Add Product** / pencil to edit (`products.edit`). Deactivating a product (toggle) keeps
  it for history but hides it from new invoices — products are never hard-deleted.
- The list filters by Active / Inactive / All, and is searchable + sortable.

---

## 5. Invoices

**Where:** sidebar → **Invoices** (`invoices.view`).

### Create an invoice
1. Invoices → **New Invoice** (requires `invoices.edit`).
2. Pick the **clinic** — this auto-fills the Bill-To recipient. The due date starts from the
   lab-wide default payment terms and can be edited per invoice.
3. Add **line items**: search a product to add it, set quantity and unit price. Each line
   can carry an internal **work note** (not printed to the customer).
4. The invoice **total** is simply the sum of the line items — there is no discount or tax.
5. Optionally set a different **Deliver-To** recipient (toggle).
6. Save as **Draft** or **Create & Send**.

### Invoice statuses
`draft → sent → partial → paid`, plus `overdue` (past due date, unpaid) and a separate
**voided** flag. Recording payments moves `sent → partial → paid` automatically.

### Record a payment
1. Open the invoice → **Record Payment** (shown for sent / partial / overdue; requires
   `invoices.manage`).
2. The dialog pre-fills the **outstanding balance** — you don't compute it. Enter the
   payment date and optional reference / notes, confirm.
3. The `record_payment` RPC inserts the payment and atomically recomputes status: if total
   paid ≥ invoice total → **paid**, otherwise → **partial**. The Payment History table updates.

### Void an invoice
1. Open the invoice → **Void** (shown only with `invoices.manage` on a non-voided invoice).
2. Enter an optional reason and confirm. The invoice is **soft-deleted** (`voided_at`,
   `voided_by`, `void_reason` set) — it stays in the system, is locked for everyone (no
   edits, no payments), shows a **VOID watermark** when printed, and drops out of the Work
   queue and reports.
3. A voided invoice cannot be restored in the app.

> Error handling: if voiding fails on the server, the user sees a friendly message
> ("Could not void the invoice. Please try again.") while the **real** error is logged
> server-side via `logServerError` (greppable tag `voidInvoice`). Note
> void uses the **admin client**, so production needs `SUPABASE_SERVICE_ROLE_KEY` set.

### Edit an invoice
- **Draft** invoices are editable with `invoices.edit`.
- **Sent** invoices require `invoices.manage` to edit.
- Voided invoices can't be edited by anyone.
- You can also edit the printed **recipient** (Bill-To / Deliver-To) inline via the pencil
  in the document header, with an option to also save the change back to the clinic master.

### Printing (Invoice / Delivery Note)
- The **Print** menu offers **Invoice** (prices, total, bank details) and **Delivery Note**
  (items + quantities, no prices).
- The print preview lets you **add / remove / edit line items** and rename a line for that
  printout only — **nothing persists** to the saved invoice; the total recomputes live in the
  preview from the line amounts.

---

## 6. Work board (job tracking)

**Where:** sidebar → **Work** (`invoices.view`). This is the production floor view. Each
card is **one line item** (one service), not a whole invoice.

### Statuses and the "In Progress" sub-status
Items move through five statuses:

`Received → In Progress → Ready → Delivered`, plus **On Hold** (a pause on any status).

**In Progress has sub-stages** (the "substatus"). Sub-stages are configured in
**Settings → Work Stages** (e.g. Custom Tray → Try-in → Finish & Polish). When an item is
In Progress it can sit on a specific stage; the status pill shows the stage label/colour and
a stepper shows "In Progress · 2 of 4". Internally a staged item is encoded as
`stage:<id>`; a stage-less In Progress is just `in_progress`. Retired stages still label old
items correctly.

### How to change a work status
- **List view:** use the status dropdown on each item. It's grouped: Received → (In Progress
  stages…) → Ready → Delivered → On Hold, with a **Resume** option shown on held items.
- **Kanban view:** drag a card between the five columns. Dropping onto a column sets the
  top-level status and **clears the stage** (the board only models the 5 main statuses; use
  the dropdown for a specific stage).
- Both views move **optimistically** (the card moves immediately, the server confirms in the
  background and reverts on failure).

### On Hold / Resume (how the sub-state is remembered)
Putting an item **On Hold** remembers the status it came from (`resume_status`). Clicking
**Resume** sends it back to that remembered status. Re-selecting On Hold while already held
keeps the original memory; any non-hold move clears it.

Every status change is written to an **audit history** (`invoice_item_status_history`) with
who/when/old-status — so each item has a full timeline.

Work status stays per item only. The invoice does not show a single rolled-up work status.

---

## 7. Settings (lab setup)

All require `settings.manage` unless noted. Each of these is a simple add / edit / reorder /
activate-toggle list:

- **Work Statuses** — label + colour for the fixed top-level production flow
  (Received, In Progress, Ready, Delivered, On Hold). The workflow keys do not change.
- **Work Stages** — the In-Progress sub-stages (label + colour + order + active). Drives the
  work-status dropdown groups and the stepper.
- **Service Statuses** — lab-to-doctor instructions printed on delivery orders (e.g. "Try in",
  "Review case").
- **Units** — units of measure for products (tooth, arch, case…). Feeds the product form.
- **Employees** (`staff.manage`) — staff directory: add an employee (User ID + 6-digit PIN +
  name + role), reset PIN, change name/role, activate/deactivate. A guard prevents removing
  the last Super Admin.
- **Roles & Permissions** (Super Admin only) — create custom roles and tick their
  permissions; delete a role only after reassigning its employees.

---

## 8. Dashboard & Reports

- **Dashboard** (all users): four stat cards (month-to-date Revenue, Outstanding, Total
  Invoices, Clinics) plus a recent-invoices table.
- **Reports** (`reports.view`): revenue / outstanding / aging aggregates over a date range
  (defaults to the current month; range is in the URL, e.g. `?from=…&to=…`), with charts.

---

## 9. Quick "how do I…" index

| Task | Where | Permission |
|---|---|---|
| Add a clinic | Clinics → Add Clinic | `customers.edit` |
| Create an invoice | Invoices → New Invoice | `invoices.edit` |
| Record a payment | Invoice → Record Payment | `invoices.manage` |
| Void an invoice | Invoice → Void | `invoices.manage` |
| Move a job to In Progress (a stage) | Work → status dropdown | `invoices.view` |
| Put a job On Hold / Resume | Work → status dropdown | `invoices.view` |
| Add an In-Progress sub-stage | Settings → Work Stages | `settings.manage` |
| Add a product | Products → Add Product | `products.edit` |
| Add a staff member | Settings → Employees | `staff.manage` |
| Create a role | Settings → Roles & Permissions | Super Admin |
| Print an invoice / delivery order | Invoice → Print | `invoices.view` |
