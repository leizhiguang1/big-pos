# Three CSV Reports (Sales / Payment / Item Sales) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/reports` whole-page "Export CSV" dump with an **Export ▾** menu offering three focused CSV reports — Sales Report, Payment Report, Item Sales Report — for the selected date range.

**Architecture:** Keep the existing server-first flow. Extend the report data (add `subtotal` to invoices, a `sales` active-invoice list, and a payments-in-range query), build each CSV with a pure tested builder, and download client-side from an `Export ▾` dropdown. Remove the old `buildReportCsv` dump.

**Tech Stack:** Next.js 16 (App Router/RSC), TypeScript, React, Tailwind/shadcn, `@radix-ui/react-dropdown-menu`, Supabase, Vitest.

## Global Constraints

- Dev server is **http://localhost:6060**; do not assume 3000.
- UI copy says **"Clinic"**; code/DB/types stay `customer`.
- **CSV only** — no PDF/Excel, **no new dependencies** (`@radix-ui/react-dropdown-menu` is already in package.json).
- Each report CSV: title block (`COMPANY.name`, report name, `Range,<from> to <to>`, `Generated,<yyyy-MM-dd>`), header row, data rows, **Total** row. Money = **2-dp plain numbers** (no `RM`, no thousands separators). Dates = ISO `yyyy-MM-dd`. **RFC-4180** quoting. **CRLF** (`\r\n`) line endings. UTF-8 **BOM** added at download time.
- Status text via `paymentStatusLabel` (e.g. `sent → Issued`).
- Verification gates: **only `npm test` and `npm run build`** work; `tsc`/`lint` are unusable. Vitest is **node-env**, matches only `src/**/*.test.ts` (no `.tsx`, no DOM) — client components are build-verified, not unit-tested.
- "Active" invoice = non-voided (`isVoided` false) and non-deleted (the query already filters `deleted_at`).
- Work happens on the existing `reports-csv-reports` branch (off local `main`).

---

## File Structure

- `src/lib/reports.ts` *(modify)* — add `subtotal` to `ReportInvoice`; add `ReportPayment` type; add `sales` to `ReportSummary`; populate `sales` in `summarizeReports`.
- `src/lib/reports.test.ts` *(modify)* — `ri` factory gains `subtotal`; assert `sales` content.
- `src/data/reports.ts` *(modify)* — add `getReportPayments(from, to)`.
- `src/lib/reports-exports.ts` *(create)* — the three pure CSV builders + filename helpers + shared csv helpers.
- `src/lib/reports-exports.test.ts` *(create)* — unit tests for the three builders.
- `src/components/ui/dropdown-menu.tsx` *(create)* — minimal shadcn wrapper over the radix primitive.
- `src/app/(authenticated)/reports/page.tsx` *(modify)* — fetch payments, pass as a prop.
- `src/components/reports/ReportsClient.tsx` *(modify)* — `payments` prop; Export ▾ menu; remove `buildReportCsv`.
- `src/lib/reports-csv.ts` + `src/lib/reports-csv.test.ts` *(delete)* — superseded dump.

---

### Task 1: Report data shape — `subtotal`, `ReportPayment`, and the `sales` list

**Files:**
- Modify: `src/lib/reports.ts`
- Test: `src/lib/reports.test.ts`

**Interfaces:**
- Produces:
  - `ReportInvoice` now also `Pick`s `subtotal: number`.
  - `type ReportPayment = { amount: number; payment_date: string; reference_number: string | null; invoice_number: string | null; clinic_name: string | null }`
  - `ReportSummary` now has `sales: ReportInvoice[]` (active invoices, ascending by `invoice_date`).

- [ ] **Step 1: Update the test factory and add failing tests**

In `src/lib/reports.test.ts`, add `subtotal` to the `ri` factory defaults (find the existing factory object and add the field):

```ts
const ri = (over: Partial<ReportInvoice> = {}): ReportInvoice => ({
  id: 'i1',
  invoice_number: 'INV-1',
  status: 'sent',
  total: 100,
  subtotal: 100,
  voided_at: null,
  invoice_date: '2026-06-01',
  due_date: '2026-06-10',
  ...over,
})
```

Then add a new describe block:

```ts
describe('summarizeReports sales list', () => {
  it('returns active invoices ascending by invoice_date, excluding voided', () => {
    const r = summarizeReports(
      [
        ri({ id: 'a', invoice_date: '2026-06-10' }),
        ri({ id: 'b', invoice_date: '2026-06-02' }),
        ri({ id: 'c', invoice_date: '2026-06-05', voided_at: '2026-06-06T00:00:00Z' }),
      ],
      NOW,
    )
    expect(r.sales.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('carries subtotal through on sales rows', () => {
    const r = summarizeReports([ri({ subtotal: 80, total: 90 })], NOW)
    expect(r.sales[0].subtotal).toBe(80)
    expect(r.sales[0].total).toBe(90)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/reports.test.ts`
Expected: FAIL — `r.sales` is undefined (and `subtotal` not on the type yet).

- [ ] **Step 3: Implement the type and `sales` additions**

In `src/lib/reports.ts`, add `subtotal` to the `ReportInvoice` Pick:

```ts
export type ReportInvoice = Pick<
  Invoice,
  'id' | 'invoice_number' | 'status' | 'total' | 'subtotal' | 'voided_at' | 'due_date' | 'invoice_date'
> & {
  customers?: { clinic_name: string } | null
  invoice_items?: ReportInvoiceItem[]
}
```

Add the `ReportPayment` type next to the other report types (after `ProductAgg`):

```ts
export type ReportPayment = {
  amount: number
  payment_date: string
  reference_number: string | null
  invoice_number: string | null
  clinic_name: string | null
}
```

Add `sales` to `ReportSummary`:

```ts
export type ReportSummary = {
  totalInvoiced: number
  totalPaidInvoices: number
  totalOutstanding: number
  invoiceCount: number
  outstanding: AgingInvoice[]
  paid: ReportInvoice[]
  sales: ReportInvoice[]
  byCustomer: CustomerAgg[]
  byProduct: ProductAgg[]
}
```

In `summarizeReports`, after the `paid` line, add:

```ts
  const sales = [...active].sort((a, b) => (a.invoice_date < b.invoice_date ? -1 : 1))
```

and add `sales` to the returned object (place it after `paid,`):

```ts
    paid,
    sales,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/reports.test.ts`
Expected: PASS (existing + new). Then `npm test` to confirm the `ri`/`subtotal` change didn't break other suites that import the factory.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports.ts src/lib/reports.test.ts
git commit -m "feat(reports): add subtotal, ReportPayment type, and active sales list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Payments-in-range query

**Files:**
- Modify: `src/data/reports.ts`

**Interfaces:**
- Consumes: `ReportPayment` (Task 1).
- Produces: `getReportPayments(from: string, to: string): Promise<ReportPayment[]>`.

> No unit test: this is a Supabase I/O function (the unit gate has no DB). The normalisation is defensive and the consuming builder is unit-tested in Task 3. Verified by `npm run build` + the Task 5 browser check.

- [ ] **Step 1: Add the query**

Append to `src/data/reports.ts` (and extend the existing type import):

Change the import line to also bring in `ReportPayment`:

```ts
import type { ReportInvoice, ReportPayment } from '@/lib/reports'
```

Add the function:

```ts
// Payments actually collected in the range, joined to their invoice + clinic.
// The nested relations are to-one; supabase-js may return them as an object or
// a single-element array depending on FK detection, so normalise both.
export async function getReportPayments(from: string, to: string): Promise<ReportPayment[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('payments')
    .select('amount, payment_date, reference_number, invoices(invoice_number, customers(clinic_name))')
    .gte('payment_date', from)
    .lte('payment_date', to)
    .order('payment_date')

  const one = <T,>(rel: T | T[] | null | undefined): T | null =>
    Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null)

  return (data ?? []).map((row) => {
    const inv = one(row.invoices as unknown as { invoice_number: string; customers: unknown } | null)
    const cust = one((inv?.customers ?? null) as unknown as { clinic_name: string } | null)
    return {
      amount: Number(row.amount),
      payment_date: row.payment_date as string,
      reference_number: (row.reference_number as string | null) ?? null,
      invoice_number: inv?.invoice_number ?? null,
      clinic_name: cust?.clinic_name ?? null,
    }
  })
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully` (no type errors in `data/reports.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/data/reports.ts
git commit -m "feat(reports): query payments collected in range (joined to invoice + clinic)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The three pure CSV builders

**Files:**
- Create: `src/lib/reports-exports.ts`
- Test: `src/lib/reports-exports.test.ts`

**Interfaces:**
- Consumes: `ReportInvoice` (with `subtotal`), `ReportPayment`, `ProductAgg` from `@/lib/reports`; `paymentStatusLabel` from `@/lib/status-badge`; `COMPANY` from `@/lib/config`.
- Produces:
  - `buildSalesReportCsv(sales: ReportInvoice[], range: {from,to}, generatedOn: string): string`
  - `buildPaymentReportCsv(payments: ReportPayment[], range: {from,to}, generatedOn: string): string`
  - `buildItemSalesReportCsv(byProduct: ProductAgg[], range: {from,to}, generatedOn: string): string`
  - `salesReportFilename(range)`, `paymentReportFilename(range)`, `itemSalesReportFilename(range)`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports-exports.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  buildSalesReportCsv,
  buildPaymentReportCsv,
  buildItemSalesReportCsv,
  salesReportFilename,
  paymentReportFilename,
  itemSalesReportFilename,
} from './reports-exports'
import type { ReportInvoice, ReportPayment, ProductAgg } from './reports'

const range = { from: '2026-06-01', to: '2026-06-30' }
const GEN = '2026-06-30'

const sale = (over: Partial<ReportInvoice> = {}): ReportInvoice => ({
  id: 'i1',
  invoice_number: 'INV-2026-0015',
  status: 'sent',
  total: 1800,
  subtotal: 1800,
  voided_at: null,
  invoice_date: '2026-06-08',
  due_date: '2026-07-08',
  customers: { clinic_name: 'Dr Ray & Partners Dental Clinic' },
  ...over,
})

describe('buildSalesReportCsv', () => {
  it('writes title block, columns, a row, and a Total', () => {
    const csv = buildSalesReportCsv([sale()], range, GEN)
    expect(csv).toContain('Chi Dental Lab')
    expect(csv).toContain('Sales Report')
    expect(csv).toContain('Range,2026-06-01 to 2026-06-30')
    expect(csv).toContain('Generated,2026-06-30')
    expect(csv).toContain('Date,Invoice #,Clinic,Subtotal,Tax,Total,Status')
    expect(csv).toContain('2026-06-08,INV-2026-0015,Dr Ray & Partners Dental Clinic,1800.00,0.00,1800.00,Issued')
    expect(csv).toContain('Total,,,1800.00,0.00,1800.00,')
    expect(csv).not.toContain('RM')
  })

  it('computes Tax as total minus subtotal', () => {
    const csv = buildSalesReportCsv([sale({ subtotal: 1000, total: 1060 })], range, GEN)
    expect(csv).toContain(',1000.00,60.00,1060.00,Issued')
  })

  it('uses CRLF and handles empty input', () => {
    const csv = buildSalesReportCsv([], range, GEN)
    expect(csv).toContain('\r\n')
    expect(csv).toContain('Total,,,0.00,0.00,0.00,')
  })
})

const pay = (over: Partial<ReportPayment> = {}): ReportPayment => ({
  amount: 160,
  payment_date: '2026-06-02',
  reference_number: 'TRF-8841',
  invoice_number: 'INV-2026-0001',
  clinic_name: 'Origin Dental Clinic',
  ...over,
})

describe('buildPaymentReportCsv', () => {
  it('writes columns, a row, and a Total', () => {
    const csv = buildPaymentReportCsv([pay()], range, GEN)
    expect(csv).toContain('Payment Report')
    expect(csv).toContain('Payment Date,Invoice #,Clinic,Amount,Reference')
    expect(csv).toContain('2026-06-02,INV-2026-0001,Origin Dental Clinic,160.00,TRF-8841')
    expect(csv).toContain('Total,,,160.00,')
  })

  it('blanks a null reference and tolerates null invoice/clinic', () => {
    const csv = buildPaymentReportCsv(
      [pay({ reference_number: null, invoice_number: null, clinic_name: null })],
      range,
      GEN,
    )
    expect(csv).toContain('2026-06-02,,,160.00,')
  })
})

const prod = (over: Partial<ProductAgg> = {}): ProductAgg => ({ name: 'Zirconia Crown', total: 3000, qty: 5, ...over })

describe('buildItemSalesReportCsv', () => {
  it('writes columns, rows with % of sales, and a 100% Total', () => {
    const csv = buildItemSalesReportCsv([prod(), prod({ name: 'Bridge', total: 1000, qty: 2 })], range, GEN)
    expect(csv).toContain('Item Sales Report')
    expect(csv).toContain('Product,Qty,Total,% of Sales')
    expect(csv).toContain('Zirconia Crown,5,3000.00,75.0%')
    expect(csv).toContain('Bridge,2,1000.00,25.0%')
    expect(csv).toContain('Total,7,4000.00,100%')
  })

  it('renders 0% share when totals are zero, and quotes commas', () => {
    const csv = buildItemSalesReportCsv([prod({ name: 'A, B', total: 0, qty: 0 })], range, GEN)
    expect(csv).toContain('"A, B",0,0.00,0%')
    expect(csv).toContain('Total,0,0.00,0%')
  })
})

describe('filenames', () => {
  it('include the range', () => {
    expect(salesReportFilename(range)).toBe('sales-report_2026-06-01_2026-06-30.csv')
    expect(paymentReportFilename(range)).toBe('payment-report_2026-06-01_2026-06-30.csv')
    expect(itemSalesReportFilename(range)).toBe('item-sales-report_2026-06-01_2026-06-30.csv')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/reports-exports.test.ts`
Expected: FAIL — module `./reports-exports` does not exist.

- [ ] **Step 3: Write the builders**

Create `src/lib/reports-exports.ts`:

```ts
// Pure CSV builders for the three focused Sales Reports exports. No DOM/Blob so
// they stay unit-testable; the client island handles the download. Money is
// 2-dp plain numbers, dates ISO, RFC-4180 quoting, CRLF endings.

import type { ReportInvoice, ReportPayment, ProductAgg } from './reports'
import { paymentStatusLabel } from './status-badge'
import { COMPANY } from './config'

type Range = { from: string; to: string }

function csvField(value: string | number): string {
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function row(fields: Array<string | number>): string {
  return fields.map(csvField).join(',')
}

const money = (n: number): string => Number(n).toFixed(2)

function titleBlock(reportName: string, range: Range, generatedOn: string): string[] {
  return [
    row([COMPANY.name]),
    row([reportName]),
    row(['Range', `${range.from} to ${range.to}`]),
    row(['Generated', generatedOn]),
    '',
  ]
}

export function salesReportFilename(range: Range): string {
  return `sales-report_${range.from}_${range.to}.csv`
}
export function paymentReportFilename(range: Range): string {
  return `payment-report_${range.from}_${range.to}.csv`
}
export function itemSalesReportFilename(range: Range): string {
  return `item-sales-report_${range.from}_${range.to}.csv`
}

// 1. Sales Report — invoices issued in the period (Tax = total − subtotal).
export function buildSalesReportCsv(sales: ReportInvoice[], range: Range, generatedOn: string): string {
  const lines = titleBlock('Sales Report', range, generatedOn)
  lines.push(row(['Date', 'Invoice #', 'Clinic', 'Subtotal', 'Tax', 'Total', 'Status']))
  let sub = 0
  let tax = 0
  let tot = 0
  for (const inv of sales) {
    const s = Number(inv.subtotal)
    const t = Number(inv.total)
    sub += s
    tax += t - s
    tot += t
    lines.push(
      row([
        inv.invoice_date,
        inv.invoice_number,
        inv.customers?.clinic_name ?? '',
        money(s),
        money(t - s),
        money(t),
        paymentStatusLabel(inv.status),
      ]),
    )
  }
  lines.push(row(['Total', '', '', money(sub), money(tax), money(tot), '']))
  return lines.join('\r\n')
}

// 2. Payment Report — money collected in the period.
export function buildPaymentReportCsv(payments: ReportPayment[], range: Range, generatedOn: string): string {
  const lines = titleBlock('Payment Report', range, generatedOn)
  lines.push(row(['Payment Date', 'Invoice #', 'Clinic', 'Amount', 'Reference']))
  let total = 0
  for (const p of payments) {
    total += Number(p.amount)
    lines.push(
      row([
        p.payment_date,
        p.invoice_number ?? '',
        p.clinic_name ?? '',
        money(Number(p.amount)),
        p.reference_number ?? '',
      ]),
    )
  }
  lines.push(row(['Total', '', '', money(total), '']))
  return lines.join('\r\n')
}

// 3. Item Sales Report — products/work sold in the period, with % share.
export function buildItemSalesReportCsv(byProduct: ProductAgg[], range: Range, generatedOn: string): string {
  const lines = titleBlock('Item Sales Report', range, generatedOn)
  lines.push(row(['Product', 'Qty', 'Total', '% of Sales']))
  const grand = byProduct.reduce((s, p) => s + Number(p.total), 0)
  const pct = (n: number): string => (grand > 0 ? `${((n / grand) * 100).toFixed(1)}%` : '0%')
  let qty = 0
  for (const p of byProduct) {
    qty += Number(p.qty)
    lines.push(row([p.name, p.qty, money(Number(p.total)), pct(Number(p.total))]))
  }
  lines.push(row(['Total', qty, money(grand), grand > 0 ? '100%' : '0%']))
  return lines.join('\r\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/reports-exports.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports-exports.ts src/lib/reports-exports.test.ts
git commit -m "feat(reports): pure CSV builders for Sales / Payment / Item Sales reports

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the page + Export ▾ menu; remove the dump CSV

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx`
- Modify: `src/app/(authenticated)/reports/page.tsx`
- Modify: `src/components/reports/ReportsClient.tsx`
- Delete: `src/lib/reports-csv.ts`, `src/lib/reports-csv.test.ts`

**Interfaces:**
- Consumes: `getReportPayments` (Task 2); the three builders + filenames (Task 3); `summary.sales` / `summary.byProduct` (Task 1); `ReportPayment` type.
- Produces: `ReportsClient` now takes a `payments: ReportPayment[]` prop.

> No unit test (client `.tsx` + node-env vitest). Verified by `npm run build` + browser.

- [ ] **Step 1: Create the dropdown-menu component**

Create `src/components/ui/dropdown-menu.tsx`:

```tsx
'use client'

import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem }
```

- [ ] **Step 2: Fetch payments on the page and pass them down**

In `src/app/(authenticated)/reports/page.tsx`:

Add to the `@/data/reports` import:

```ts
import { getReportInvoices, getReportPayments } from '@/data/reports'
```

Fetch payments alongside invoices and pass the prop. Replace the body after the `to` line with:

```tsx
  const [invoices, payments] = await Promise.all([
    getReportInvoices(from, to),
    getReportPayments(from, to),
  ])
  const summary = summarizeReports(invoices, now.getTime())
  const presets = buildPresets(now)

  return <ReportsClient from={from} to={to} summary={summary} presets={presets} payments={payments} />
```

- [ ] **Step 3: Rework ReportsClient imports + signature + handlers**

In `src/components/reports/ReportsClient.tsx`:

Replace the `Download` import line and the `reports-csv` import. Change:

```ts
import { Download } from 'lucide-react'
```
to:
```ts
import { Download, ChevronDown } from 'lucide-react'
```

Replace:
```ts
import { buildReportCsv, reportCsvFilename } from '@/lib/reports-csv'
```
with:
```ts
import {
  buildSalesReportCsv,
  buildPaymentReportCsv,
  buildItemSalesReportCsv,
  salesReportFilename,
  paymentReportFilename,
  itemSalesReportFilename,
} from '@/lib/reports-exports'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import type { ReportPayment } from '@/lib/reports'
```

Change the component signature to accept `payments`:

```tsx
export function ReportsClient({ from, to, summary, presets, payments }: { from: string; to: string; summary: ReportSummary; presets: PresetMap; payments: ReportPayment[] }) {
```

Replace the entire `exportCsv` function (the `// Download the whole report ...` comment through its closing brace) with a generic downloader + three handlers:

```tsx
  // Download a CSV string as a file. The leading BOM makes Excel open the UTF-8
  // file with clinic names intact.
  const download = (csv: string, filename: string) => {
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const range = { from, to }
  const exportSales = () => download(buildSalesReportCsv(summary.sales, range, todayISODate()), salesReportFilename(range))
  const exportPayments = () => download(buildPaymentReportCsv(payments, range, todayISODate()), paymentReportFilename(range))
  const exportItems = () => download(buildItemSalesReportCsv(summary.byProduct, range, todayISODate()), itemSalesReportFilename(range))
```

- [ ] **Step 4: Replace the Export button with the Export ▾ menu**

In the JSX, replace the existing `<Button ... onClick={exportCsv} ...>` block (the "Export CSV" button) with:

```tsx
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={invoiceCount === 0} className="w-full sm:w-auto sm:ml-auto">
              <Download className="h-4 w-4 mr-2" />
              Export
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={exportSales}>Sales Report</DropdownMenuItem>
            <DropdownMenuItem onSelect={exportPayments}>Payment Report</DropdownMenuItem>
            <DropdownMenuItem onSelect={exportItems}>Item Sales Report</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
```

- [ ] **Step 5: Delete the superseded dump CSV**

```bash
git rm src/lib/reports-csv.ts src/lib/reports-csv.test.ts
```

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: `✓ Compiled successfully`, `/reports` in the route table, no type errors (no dangling `buildReportCsv` references).

- [ ] **Step 7: Browser check (dev server on 6060)**

With the app running, open `http://localhost:6060/reports`, click **Export ▾**, and confirm three items appear; download each and confirm: Sales Report has the title block + `Date,Invoice #,Clinic,Subtotal,Tax,Total,Status` + Total row; Payment Report lists payments with a Total; Item Sales Report lists products with `% of Sales` and a `100%` Total. (Use a range with data, e.g. This month / Year to date.)

- [ ] **Step 8: Commit**

```bash
git add "src/app/(authenticated)/reports/page.tsx" src/components/reports/ReportsClient.tsx src/components/ui/dropdown-menu.tsx
git commit -m "feat(reports): Export menu with Sales / Payment / Item Sales CSV reports; drop whole-page dump

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: PASS — all suites, including `reports`, `reports-exports`, and the untouched dashboard tests. (The deleted `reports-csv` suite no longer runs.)

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Mark the design implemented**

In `docs/superpowers/specs/2026-06-30-three-csv-reports-design.md`, change `Status: Approved (proceeding to plan)` to `Status: Implemented`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-30-three-csv-reports-design.md
git commit -m "docs(reports): mark three-CSV-reports design implemented

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Sales Report → Task 3 `buildSalesReportCsv` + Task 1 `sales`/`subtotal` + Task 4 wiring. ✅
- Payment Report → Task 2 `getReportPayments` + Task 3 `buildPaymentReportCsv` + Task 4. ✅
- Item Sales Report → Task 3 `buildItemSalesReportCsv` (uses `byProduct`) + Task 4. ✅
- Export ▾ menu + remove dump CSV → Task 4 (dropdown-menu component, deletion). ✅
- Title block / 2-dp money / ISO dates / RFC-4180 / CRLF / BOM → Global Constraints, enforced in Task 3 builders + Task 4 download. ✅
- CSV-only / no new deps → Global Constraints (radix dropdown already a dep). ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✅

**Type consistency:** `ReportPayment` shape matches between Task 1 (definition), Task 2 (`getReportPayments` return), Task 3 (`buildPaymentReportCsv` param + test fixture), and Task 4 (prop). `subtotal` added in Task 1 is consumed in Task 3's `buildSalesReportCsv`. `summary.sales`/`summary.byProduct` (Task 1) consumed in Task 4. Builder names + filename helpers match between Task 3 and Task 4 imports. ✅
