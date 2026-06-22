# Phase 1 Wave A — Invoice saved-view tabs + payment overpay cap (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the Invoices list's two confusing status/work Selects with clear saved-view tabs, and stop the payment dialog from accepting more than the outstanding balance (the UI half of the overpay-bug fix).

**Architecture:** Task 1 reworks `InvoiceListClient` filtering into predicate-based view tabs over the existing in-memory rows (no data change). Task 2 hardens the `ActionsBar` Record Payment dialog to block submit when the amount exceeds outstanding. Both are self-contained and touch only already-committed files.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict:false), Tailwind v4, vitest.

## Global Constraints

- Branch `feat/redesign-program` (never touch main).
- **Do NOT touch these files** (uncommitted / concurrent work): `InvoiceForm.tsx`, `ProductSearchAdd.tsx`, `InvoiceDocument.tsx`, `src/app/(authenticated)/invoices/[id]/page.tsx`, `src/data/invoice-actions.ts`.
- TypeScript strict:false — narrow with `=== false`, never `!`.
- Use brand tokens (`text-foreground`, `text-muted-foreground`, `bg-card`, `border-border`, `bg-primary`, etc.), NOT raw `text-gray-*`/`bg-white` — the app was just swept to tokens.
- Reuse `statusBadgeVariant`, `isVoided`, `isOverdue`, `dominantWorkStatus` already imported in the list.
- Gates: `npx tsc --noEmit`, `npm run lint`, `npm test`. Dev server port 6060 (do not start it).

---

### Task 1: Saved-view tabs on the Invoices list

Replace the status `Select` + work `Select` with a row of view tabs. Keep the search box.

**Files:**
- Modify: `src/components/invoices/InvoiceListClient.tsx`

**Interfaces:**
- The component already receives `invoices: InvoiceListRow[]`, has `search` state, a `today` value, and imports `isVoided`, `isOverdue`, `dominantWorkStatus`, `DataTable`, `EmptyState`, `listViewState`. Read the current file first — it was refactored onto `DataTable` and swept to tokens.

- [ ] **Step 1: Read the current file** so edits match (it now renders via `DataTable` with a `columns` array, `onRowClick`, and an `emptyState`).

- [ ] **Step 2: Define the views and replace the filter state**

Remove the `statusFilter` and `workFilter` `useState` + the two `<Select>` blocks. Add one `view` state (default `'all'`) and a module-scope view list. Each view is a predicate over a row:

```tsx
type ViewKey = 'all' | 'drafts' | 'unpaid' | 'overdue' | 'in_production' | 'ready' | 'voided'

const VIEWS: { key: ViewKey; label: string; match: (inv: InvoiceListRow, today: string) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'drafts', label: 'Drafts', match: inv => !isVoided(inv) && inv.status === 'draft' },
  { key: 'unpaid', label: 'Awaiting payment', match: inv => !isVoided(inv) && ['sent', 'partial', 'overdue'].includes(inv.status) },
  { key: 'overdue', label: 'Overdue', match: (inv, today) => isOverdue(inv, today) },
  { key: 'in_production', label: 'In production', match: inv => {
      const d = dominantWorkStatus((inv.invoice_items ?? []).map(it => it.work_status))
      return !isVoided(inv) && d != null && d !== 'ready' && d !== 'delivered'
    } },
  { key: 'ready', label: 'Ready to deliver', match: inv => dominantWorkStatus((inv.invoice_items ?? []).map(it => it.work_status)) === 'ready' },
  { key: 'voided', label: 'Voided', match: inv => isVoided(inv) },
]
```

Define it at module scope (above the component) so its identity is stable.

- [ ] **Step 3: Apply the view in the filter memo**

Rewrite `filtered` to combine the search and the active view's predicate:

```tsx
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const view = VIEWS.find(v => v.key === viewKey) ?? VIEWS[0]
    return invoices.filter(inv => {
      const matchSearch =
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.customers?.clinic_name ?? '').toLowerCase().includes(q) ||
        (inv.patient ?? '').toLowerCase().includes(q)
      return matchSearch && view.match(inv, today)
    })
  }, [search, viewKey, invoices, today])
```

(Note: this also fixes the audit finding that search didn't match the patient name.) Name the state `viewKey`/`setViewKey`.

- [ ] **Step 4: Render the view tabs**

Replace the old filter row (the two Selects) with a horizontally-scrollable tab row above the table; keep the search input. Each tab shows the view label and a count of matching rows; the active tab is filled with `bg-primary text-primary-foreground`, inactive are `text-muted-foreground hover:bg-muted`:

```tsx
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {VIEWS.map(v => {
          const count = invoices.filter(inv => v.match(inv, today)).length
          const active = v.key === viewKey
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setViewKey(v.key)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {v.label}
              <span className={cn('ml-1.5 text-xs', active ? 'text-primary-foreground/70' : 'text-muted-foreground/60')}>{count}</span>
            </button>
          )
        })}
      </div>
```

Keep the search box (in its own row). Update the `emptyState` title to reference the active view (e.g. `No invoices in “${VIEWS.find(v=>v.key===viewKey)?.label}”` when search/view yields nothing, vs `No invoices yet` when `invoices.length === 0`).

- [ ] **Step 5: Verify gates**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc exits 0 (remove now-unused `Select*`/`WORK_STATUSES`/`WORK_STATUS_LABELS` imports if orphaned), lint clean, 134 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/invoices/InvoiceListClient.tsx
git commit -m "feat(invoices): saved-view tabs replace status/work selects; search matches patient"
```

---

### Task 2: Block over-payment in the Record Payment dialog

The dialog currently only *warns* when the amount exceeds outstanding. Make it block.

**Files:**
- Modify: `src/components/invoices/detail/ActionsBar.tsx`

**Interfaces:**
- `ActionsBar` receives `outstanding: number`; the payment form uses `react-hook-form` with `watchedAmount = useWatch({ control, name: 'amount' })` and a submit button `disabled={savingPayment}`. Read the current file to confirm exact lines (it was edited by the token sweep + status consolidation).

- [ ] **Step 1: Compute an over-amount flag**

In the component body (near `watchedAmount`), add:

```tsx
  const overAmount = outstanding > 0 && Number(watchedAmount) > outstanding
```

- [ ] **Step 2: Make the existing warning a blocking error + disable submit**

- Change the amber warning paragraph (the one reading "Exceeds the outstanding balance of …") to render based on `overAmount` and style it as an error: `text-destructive` instead of `text-amber-600`.
- Change the Record Payment submit button's `disabled` to also include `overAmount`:

```tsx
<Button type="submit" disabled={savingPayment || overAmount}>{savingPayment ? 'Saving…' : 'Record Payment'}</Button>
```

(Leave the existing `min="0.01"` and the zod `paymentSchema` as-is; this is the UI guard. The authoritative DB-side cap is a separate, gated migration.)

- [ ] **Step 3: Verify gates**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc exits 0, lint clean, 134 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/invoices/detail/ActionsBar.tsx
git commit -m "fix(payments): block recording a payment above the outstanding balance (UI guard)"
```

---

## Self-Review

- **Spec coverage:** saved-view tabs replace the two Selects and add per-view counts (Task 1); patient-name search fixed in the same memo; payment dialog blocks over-amount (Task 2).
- **Placeholder scan:** none — concrete code; Task 1 Step 1 instructs reading the current file because it was refactored.
- **Type consistency:** `ViewKey`/`VIEWS` defined and consumed within Task 1; `overAmount` defined and used within Task 2; both reuse existing imports.
- **Constraint check:** neither task touches the forbidden uncommitted files; tokens used throughout.
