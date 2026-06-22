# Phase 0 Wave 1 — Status-badge consolidation + Cmd+K search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Retire the 4 remaining hand-rolled `STATUS_VARIANT` maps onto the shared `statusBadgeVariant`, and add a global Cmd+K command palette to jump to any invoice, clinic, or product.

**Architecture:** Task 1 is a mechanical helper swap. Tasks 2-3 add a `cmdk`-based palette: a server action returns a flat searchable item list from the existing data functions; a client `CommandPalette` (opened by ⌘K / Ctrl+K or a sidebar button) filters with cmdk's built-in matching and routes on select; it's mounted once in `AppShell`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict:false), Tailwind v4, Supabase, `cmdk`, vitest.

## Global Constraints

- Branch `feat/redesign-program` (never touch main).
- `cmdk` IS allowed (this is the palette task); no other new deps.
- Do NOT touch invoice detail/form files EXCEPT `ActionsBar.tsx` (Task 1 only swaps its status map; do not change its other logic). Leave `InvoiceForm.tsx`, `ProductSearchAdd.tsx`, `invoices/[id]/page.tsx`, `InvoiceDocument.tsx`, `invoice-actions.ts` alone.
- TypeScript strict:false — narrow with `=== false`, never `!`.
- Reuse `statusBadgeVariant` from `@/lib/status-badge` (payment mapping: draft→secondary, sent→info, partial→warning, paid→success, overdue→destructive, void→destructive).
- Gates: `npx tsc --noEmit`, `npm run lint`, `npm test`. Dev server port 6060 (do not start it).

---

### Task 1: Consolidate the 4 remaining STATUS_VARIANT copies

Replace each file's local `STATUS_VARIANT` constant and its usages with `statusBadgeVariant('payment', <status>)`.

**Files:**
- Modify: `src/components/reports/ReportsClient.tsx` (const at :15; usages at :110, :143)
- Modify: `src/components/invoices/detail/ActionsBar.tsx` (const at :36; usage at :163)
- Modify: `src/components/dashboard/DashboardRecentInvoices.tsx` (const at :10; usage at :45)
- Modify: `src/components/customers/CustomerInvoiceHistory.tsx` (const at :11; usage at :48)

**Interfaces:**
- Consumes: `statusBadgeVariant(kind: 'payment'|'work', value: string)` from `@/lib/status-badge`.

- [ ] **Step 1: For each of the 4 files, read it and confirm the local map matches the canonical mapping**

The 4 local maps were copied from one source; each should map `draft→secondary, sent→info, partial→warning, paid→success, overdue→destructive`. Confirm by reading. (DashboardRecentInvoices's union also lists `'outline'` but the value set is the same.) `statusBadgeVariant` is now the canonical source — if any map differs, the canonical mapping governs.

- [ ] **Step 2: In each file, add the import and delete the local const**

Add (near the other `@/lib` imports):
```tsx
import { statusBadgeVariant } from '@/lib/status-badge'
```
Delete the local `const STATUS_VARIANT: Record<…> = { … }` block.

- [ ] **Step 3: Replace each usage**

Replace every `STATUS_VARIANT[<x>.status] ?? 'secondary'` with `statusBadgeVariant('payment', <x>.status)`. Concretely:
- `ReportsClient.tsx` (2 sites): `variant={statusBadgeVariant('payment', inv.status)}`
- `ActionsBar.tsx`: `variant={statusBadgeVariant('payment', invoice.status)}`
- `DashboardRecentInvoices.tsx`: `variant={statusBadgeVariant('payment', inv.status)}`
- `CustomerInvoiceHistory.tsx`: `variant={statusBadgeVariant('payment', inv.status)}`

(`statusBadgeVariant` already returns `'secondary'` for unknown values, so the `?? 'secondary'` fallback is no longer needed.)

- [ ] **Step 4: Verify gates**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc exits 0 (remove any now-unused imports the deletion orphaned), lint clean, 134 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/reports/ReportsClient.tsx src/components/invoices/detail/ActionsBar.tsx src/components/dashboard/DashboardRecentInvoices.tsx src/components/customers/CustomerInvoiceHistory.tsx
git commit -m "refactor(ui): retire 4 duplicate STATUS_VARIANT maps onto statusBadgeVariant"
```

---

### Task 2: Search data — cmdk dependency + command items server action

**Files:**
- Modify: `package.json` (add `cmdk`)
- Create: `src/data/search-actions.ts`

**Interfaces:**
- Produces: `getCommandItems(): Promise<CommandItem[]>` where `CommandItem = { type: 'invoice'|'customer'|'product'; id: string; label: string; sublabel: string; href: string }`.
- Consumes: `getInvoices` (`@/data/invoices`), `getCustomers` (`@/data/customers`), `getProducts` (`@/data/products`).

- [ ] **Step 1: Install cmdk**

Run: `npm install cmdk`
Expected: `cmdk` added to dependencies; `npm test` still passes.

- [ ] **Step 2: Create the server action**

```tsx
// src/data/search-actions.ts
'use server'

import { getInvoices } from '@/data/invoices'
import { getCustomers } from '@/data/customers'
import { getProducts } from '@/data/products'

export interface CommandItem {
  type: 'invoice' | 'customer' | 'product'
  id: string
  label: string
  sublabel: string
  href: string
}

/** Flat, searchable list of jump targets for the command palette. Dataset is
 *  small (tens of rows); cmdk filters client-side. */
export async function getCommandItems(): Promise<CommandItem[]> {
  const [invoices, customers, products] = await Promise.all([getInvoices(), getCustomers(), getProducts()])

  return [
    ...invoices.map(i => ({
      type: 'invoice' as const,
      id: i.id,
      label: i.invoice_number,
      sublabel: [i.customers?.clinic_name, i.patient].filter(Boolean).join(' · '),
      href: `/invoices/${i.id}`,
    })),
    ...customers.map(c => ({
      type: 'customer' as const,
      id: c.id,
      label: c.clinic_name,
      sublabel: c.contact_person ?? '',
      href: `/customers/${c.id}`,
    })),
    ...products.map(p => ({
      type: 'product' as const,
      id: p.id,
      label: p.name,
      sublabel: `per ${p.unit}`,
      href: '/products',
    })),
  ]
}
```

- [ ] **Step 3: Verify gates**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc exits 0, lint clean, 134 tests pass. (If `InvoiceListRow` lacks `customers`/`patient`, read `src/data/invoices.ts` for the real field names and adjust — keep the same `CommandItem` output.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/data/search-actions.ts
git commit -m "feat(search): cmdk dep + getCommandItems server action"
```

---

### Task 3: CommandPalette component + AppShell wiring

A ⌘K/Ctrl+K palette: loads items on first open, filters via cmdk, routes on select. Also openable from a sidebar "Search" button via a window event.

**Files:**
- Create: `src/components/command-palette.tsx`
- Modify: `src/components/layout/AppShell.tsx` (mount the palette; add a sidebar search button)

**Interfaces:**
- Consumes: `getCommandItems`, `CommandItem` from `@/data/search-actions`; `cmdk`; `useRouter`.
- Produces: default-exported `CommandPalette` component (self-contained: owns open state + keyboard + data).

- [ ] **Step 1: Build the CommandPalette**

Create `src/components/command-palette.tsx` as a `'use client'` component that:
- Holds `open` (boolean) and `items` (`CommandItem[]`) state.
- On mount, registers a `keydown` listener: when `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'`, `e.preventDefault()` and toggle `open`. Also listens for a `window` `CustomEvent('command-palette:open')` to set `open` true. Clean both up on unmount.
- The first time it opens (items empty), calls `getCommandItems()` and stores the result (guard against double-fetch).
- Renders cmdk's `Command.Dialog` (open/onOpenChange wired to state) containing a `Command.Input` (placeholder "Search invoices, clinics, products…"), a `Command.List` with a `Command.Empty` ("No results."), and the items grouped by `type` into `Command.Group` ("Invoices" / "Clinics" / "Products"), each `Command.Item` showing `label` + a muted `sublabel`. `value` should include label+sublabel so cmdk matches both. `onSelect` → `router.push(item.href)` then `setOpen(false)`.
- Style it with Tailwind to match the app: a centered dialog over a `bg-black/40` overlay, `bg-card` rounded panel, `max-w-lg`, a search input with a `Search` icon (lucide), grouped list with `max-h-80 overflow-auto`, hover/selected item states using `aria-selected` (cmdk sets `data-[selected=true]`). Use `bg-primary/5` for the selected item to match the DataTable highlight.

Keep it self-contained and accessible (cmdk handles arrow/enter/escape).

- [ ] **Step 2: Mount in AppShell + add a sidebar search button**

In `src/components/layout/AppShell.tsx`:
- Import `CommandPalette` and render `<CommandPalette />` once inside the top-level wrapper (e.g. just before the closing `</div>` of the shell root, so it's present on every authenticated page).
- In `SidebarContent`, add a "Search" button at the top of the `<nav>` (above the nav links) that, on click, dispatches `window.dispatchEvent(new CustomEvent('command-palette:open'))`. Style it like a muted input affordance with a `Search` icon (lucide) and a right-aligned `⌘K` hint (`<kbd>` styled with Tailwind). It should `onNavigate()` is NOT needed; just open the palette.

- [ ] **Step 3: Verify gates**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc exits 0, lint clean, 134 tests pass.

- [ ] **Step 4: Verify in the running app (deferred/manual)**

Do NOT start a browser here. Note for manual check on :6060: ⌘K opens the palette; typing an invoice number / clinic name / product filters; Enter or click navigates and closes; the sidebar Search button also opens it.

- [ ] **Step 5: Commit**

```bash
git add src/components/command-palette.tsx src/components/layout/AppShell.tsx
git commit -m "feat(search): global Cmd+K command palette"
```

---

## Self-Review

- **Spec coverage:** 4 STATUS_VARIANT copies retired (Task 1); cmdk + search source (Task 2); palette + ⌘K + sidebar button wired app-wide (Task 3).
- **Placeholder scan:** Task 3 Step 1 is spec-prose (cmdk markup is the implementer's to render) but the data shape, triggers, behavior, and styling targets are all concrete; Tasks 1-2 have exact code.
- **Type consistency:** `CommandItem` defined in Task 2 is consumed in Task 3; `statusBadgeVariant('payment', …)` matches the Phase 0a signature across all 4 Task 1 sites.
