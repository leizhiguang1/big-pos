# Three focused CSV reports (Sales / Payment / Item Sales) — design

- **Date:** 2026-06-30
- **Status:** Implemented
- **Area:** `/reports` page, `@/lib/reports`, `@/data/reports`, new `@/lib/reports-exports`

## Context

The `/reports` page currently has a single **Export CSV** button that dumps the
whole page (summary + outstanding + paid + by-clinic/product) into one stacked
CSV. The user wants that replaced with **insightful, purpose-built reports** —
not a page dump — modelled on the kumoDent / Aoikumo ERP
(`bigdental.aoikumo.com/reports`).

A browser study of kumoDent confirmed its model: each report is a focused,
date-ranged document (a list with totals), and its sales family includes **Sales
Summary/Detailed**, **Payment Summary/Detailed**, and **Item Sales** — exactly
the three the user asked for.

## Decisions

- **CSV only** — keep it simple, no PDF, no new charting.
- Provide **three focused CSV reports**, each for the page's selected From/To
  range, from an **Export ▾** menu (shadcn `dropdown-menu`, already a dependency):
  1. **Sales Report** — invoices issued in the period.
  2. **Payment Report** — payments actually collected in the period.
  3. **Item Sales Report** — products/work sold in the period.
- **Remove** the old whole-report dump CSV (`buildReportCsv`) and its single
  button — superseded by the three reports.

## Scope

**In scope:** the three CSV builders, a payments-in-range query, exposing the
active-invoice list to the client, and the Export ▾ menu.

**Out of scope:** the on-page date-selector / "Custom" chip cleanup; on-page
insight cards; PDF/Excel; any schema change; dashboard, invoices, permissions.

## The three reports

Every report's CSV starts with a title block — `COMPANY.name`, the report name,
`Range,<from> to <to>`, `Generated,<yyyy-MM-dd>` — then a header row, data rows,
and a **Total** row. Money is 2-dp plain numbers (no `RM`/separators); dates are
ISO `yyyy-MM-dd`; RFC-4180 quoting; CRLF endings; UTF-8 BOM at download (matches
the existing export). Filenames: `sales-report_<from>_<to>.csv`,
`payment-report_<from>_<to>.csv`, `item-sales-report_<from>_<to>.csv`.

### 1. Sales Report — invoices issued in the period

Columns: `Date, Invoice #, Clinic, Subtotal, Tax, Total, Status`.
- Rows: **active** (non-voided, non-deleted) invoices with `invoice_date` in
  range, sorted by date ascending.
- `Tax = total − subtotal` (the lab's tax rate ships at 0, so this is usually
  0.00, but the column stays correct if a rate is later set).
- `Status` via `paymentStatusLabel` (e.g. `sent → Issued`).
- Total row sums Subtotal / Tax / Total.

### 2. Payment Report — money collected in the period

Columns: `Payment Date, Invoice #, Clinic, Amount, Reference`.
- Rows: rows from the `payments` table with `payment_date` in range, joined to
  their invoice (→ `invoice_number`, clinic), sorted by payment date ascending.
- `Reference` = `payments.reference_number` (blank if null).
- Total row sums Amount. This is **real collections** — more accurate than the
  page's "Collected = paid-invoice totals".

### 3. Item Sales Report — what sold in the period

Columns: `Product, Qty, Total, % of Sales`.
- Rows: `invoice_items` across active invoices in range, aggregated by product
  name (falling back to the line description when no product is linked), sorted
  by Total descending. This is the existing full By-Product aggregation.
- `% of Sales` = item Total ÷ sum of all item Totals (1 decimal, e.g. `19.8%`);
  `0%` when the denominator is 0.
- Total row sums Qty / Total and shows `100%` (or `0%` when empty).

## Architecture

Keep the existing server-first flow; build CSVs client-side from data the page
already passes (consistent with today's export), adding only what's missing.

### Data shape changes (`src/lib/reports.ts`)
- Extend `ReportInvoice` to also `Pick` **`subtotal`** (needed for the Tax
  column). The query already selects `*`, so no query change.
- Add **`sales: ReportInvoice[]`** to `ReportSummary` = active invoices sorted by
  `invoice_date` ascending (drives the Sales Report). `summarizeReports` fills it.
- `byProduct` (already full, all rows) drives the Item Sales Report.

### New data fetch (`src/data/reports.ts`)
- `getReportPayments(from, to): Promise<ReportPayment[]>` — selects
  `amount, payment_date, reference_number, invoices(invoice_number, customers(clinic_name))`
  from `payments` where `payment_date` is in `[from, to]`. (Mirrors the existing
  dashboard payments query, plus the invoice/clinic join.)
- `type ReportPayment = { amount: number; payment_date: string; reference_number: string | null; invoice_number: string | null; clinic_name: string | null }`
  (normalised from the joined row).

### Page (`src/app/(authenticated)/reports/page.tsx`)
- Also call `getReportPayments(from, to)` and pass `payments` to `ReportsClient`
  alongside `summary`.

### Pure CSV builders (`src/lib/reports-exports.ts`, new)
- Shared `csvField` / `row` / `money` helpers (moved from the old
  `reports-csv.ts`).
- `buildSalesReportCsv(sales, range, generatedOn)`
- `buildPaymentReportCsv(payments, range, generatedOn)`
- `buildItemSalesReportCsv(byProduct, range, generatedOn)`
- `salesReportFilename/paymentReportFilename/itemSalesReportFilename(range)`
- Each pure (no DOM/Blob), unit-tested.

### Client (`src/components/reports/ReportsClient.tsx`)
- Accept a new `payments: ReportPayment[]` prop.
- Replace the single **Export CSV** button with an **Export ▾** dropdown
  (`@/components/ui/dropdown-menu`) with three items, each running the existing
  Blob-download routine (BOM + CRLF) on the matching builder's output.
- Remove the `buildReportCsv` import/usage.

### Removed
- `src/lib/reports-csv.ts` and `src/lib/reports-csv.test.ts` (whole-report dump,
  superseded). The shared csv helpers move to `reports-exports.ts`.

## Components & isolation
- `reports-exports.ts` — pure string builders; input data + range + generatedOn,
  output CSV text. Independently unit-testable.
- `getReportPayments` — the only new I/O; isolated in the data layer.
- `ReportsClient` — the only DOM piece (menu + Blob download).

## Testing
- `src/lib/reports-exports.test.ts` (new): for each builder — title block,
  columns, 2-dp money, ISO dates, Total row, `% of Sales` math (incl. divide-by-
  zero), RFC-4180 quoting, empty-data case.
- `src/lib/reports.test.ts` (extend): `summarizeReports` populates `sales`
  (active only, date-sorted) and `ReportInvoice` carries `subtotal`.
- `ReportsClient` / page: build-verified (`npm run build`) + a browser check of
  the Export ▾ menu and the three downloads. (No `.tsx` unit test — vitest is
  node-env, `*.test.ts` only.)
- Gates: `npm test` + `npm run build` (the project's only working gates).

## Risks / mitigations
- **Payments join shape** (Supabase nested select returns nested objects/arrays)
  → normalise in `getReportPayments` to the flat `ReportPayment`; unit-test the
  builder against the flat type.
- **Removing `buildReportCsv`** could leave dangling imports → the plan deletes
  the file + test and updates `ReportsClient` in the same task; `npm run build`
  catches any straggler.
