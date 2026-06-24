# Work Status & Sub-Status UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-progress sub-stage a first-class, visible, filterable, one-click-advanceable concept across the work board, the work list, and the invoice-detail status editor — without ever showing an invoice-level work status.

**Architecture:** All status changes already flow through one shared control (`WorkStatusSelect`) and one server action (`updateWorkStatusAction`). We add two pure, unit-tested helpers (`nextWorkStep`, `workLabelWithPosition`, plus a `matchesWorkFilter` predicate) to `src/lib/work-stages.ts`, then wire them into the existing components. The Kanban board and work list gain the existing `WorkStageStepper` for visibility; the list gains a sub-stage drill-down filter; the dropdown gains numbered steps + an "Advance to next" action.

**Tech Stack:** Next.js (App Router) client components, React 19 (`useOptimistic`/`useTransition`), shadcn/ui + Radix Select, Tailwind v4, Vitest (pure-function unit tests), Supabase (Postgres) for the one stage relabel.

## Global Constraints

- **Per-work only.** Work status is per invoice line item. Do NOT (re-)introduce any invoice-level work-status badge/summary/filter. `dominantWorkStatus`/`summarizeWorkStatuses`/`src/domain/aggregation.ts` were deleted and must stay deleted.
- **Stage set (exact, in order):** `Custom Tray` → `Try In` → `Finalize Mill Design` → `Finish & Polish`. Only the DB label `Try-in` → `Try In` changes; same stage `id`. Keep the `&` in `Finish & Polish`.
- **No schema / RLS / permission / server-action contract changes.** `updateWorkStatusAction(itemId, { work_status, stage_id })` stays as-is.
- **Dev server runs on `http://localhost:6060`** (`npm run dev`). Tests: `npm run test`. Build: `npm run build`.
- **Encoding stays canonical:** `received` / `stage:<id>` / `in_progress` / `ready` / `delivered` / `on_hold` via `encodeWork`/`decodeWork`.
- Helper signatures already take an optional `statusConfigs?: WorkStatusDisplay[]` — preserve that pattern in new helpers that resolve labels/colors.

---

### Task 1: Relabel the `Try-in` work stage to `Try In`

**Files:**
- DB data only (Supabase `work_stages` table). No source files.

**Interfaces:**
- Consumes: nothing.
- Produces: a `work_stages` row with `label = 'Try In'` (same `id`, `sort_order = 20`, `is_active = true`).

- [ ] **Step 1: Inspect the current row**

Run (Supabase SQL):
```sql
select id, label, sort_order, is_active from work_stages order by sort_order;
```
Expected: four active rows — `Custom Tray (10)`, `Try-in (20)`, `Finalize Mill Design (30)`, `Finish & Polish (40)`.

- [ ] **Step 2: Apply the relabel (idempotent)**

Run (Supabase SQL):
```sql
update work_stages set label = 'Try In' where label = 'Try-in';
```
Expected: `UPDATE 1`. (Same `id`, so every in-progress item on that stage keeps its stage.)

- [ ] **Step 3: Verify**

Run (Supabase SQL):
```sql
select label from work_stages order by sort_order;
```
Expected: `Custom Tray`, `Try In`, `Finalize Mill Design`, `Finish & Polish`.

> No commit — this is a data change. The label is also editable anytime at `/settings/work-stages`.

---

### Task 2: `nextWorkStep` helper (drives one-click Advance)

**Files:**
- Modify: `src/lib/work-stages.ts` (append after `stageProgress`, around line 143)
- Test: `src/lib/work-stages.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `WorkStage[]`, `WorkStatus`, `stage_id: string | null`.
- Produces: `nextWorkStep(activeStages, work_status, stage_id): { work_status: WorkStatus; stage_id: string | null } | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/work-stages.test.ts` (the existing `active`/`tray`/`tryin` fixtures at the top are reused):
```ts
import { nextWorkStep } from '@/lib/work-stages'  // add to the existing import block

describe('nextWorkStep', () => {
  it('received -> first active stage', () => {
    expect(nextWorkStep(active, 'received', null)).toEqual({ work_status: 'in_progress', stage_id: 's1' })
  })
  it('received with no stages -> bare in_progress', () => {
    expect(nextWorkStep([], 'received', null)).toEqual({ work_status: 'in_progress', stage_id: null })
  })
  it('staged in_progress -> next stage', () => {
    expect(nextWorkStep(active, 'in_progress', 's1')).toEqual({ work_status: 'in_progress', stage_id: 's2' })
  })
  it('last stage -> ready', () => {
    expect(nextWorkStep(active, 'in_progress', 's2')).toEqual({ work_status: 'ready', stage_id: null })
  })
  it('bare in_progress -> first stage', () => {
    expect(nextWorkStep(active, 'in_progress', null)).toEqual({ work_status: 'in_progress', stage_id: 's1' })
  })
  it('in_progress with no stages configured -> ready', () => {
    expect(nextWorkStep([], 'in_progress', null)).toEqual({ work_status: 'ready', stage_id: null })
  })
  it('unknown/retired stage -> first stage', () => {
    expect(nextWorkStep(active, 'in_progress', 'gone')).toEqual({ work_status: 'in_progress', stage_id: 's1' })
  })
  it('ready -> delivered', () => {
    expect(nextWorkStep(active, 'ready', null)).toEqual({ work_status: 'delivered', stage_id: null })
  })
  it('delivered -> null', () => {
    expect(nextWorkStep(active, 'delivered', null)).toBeNull()
  })
  it('on_hold -> null (Resume handles it)', () => {
    expect(nextWorkStep(active, 'on_hold', null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- work-stages`
Expected: FAIL — `nextWorkStep is not a function` / export missing.

- [ ] **Step 3: Implement `nextWorkStep`**

Append to `src/lib/work-stages.ts`:
```ts
// Forward "advance" target for the one-click Advance action. Returns the next
// (work_status, stage_id) in the linear flow, or null when there is no next step
// (delivered, or on_hold which uses Resume instead).
export function nextWorkStep(
  activeStages: WorkStage[],
  work_status: WorkStatus,
  stage_id: string | null,
): { work_status: WorkStatus; stage_id: string | null } | null {
  switch (work_status) {
    case 'received':
      return activeStages.length > 0
        ? { work_status: 'in_progress', stage_id: activeStages[0].id }
        : { work_status: 'in_progress', stage_id: null }
    case 'in_progress': {
      if (activeStages.length === 0) return { work_status: 'ready', stage_id: null }
      const i = stage_id ? activeStages.findIndex(s => s.id === stage_id) : -1
      if (i === -1) return { work_status: 'in_progress', stage_id: activeStages[0].id }
      if (i >= activeStages.length - 1) return { work_status: 'ready', stage_id: null }
      return { work_status: 'in_progress', stage_id: activeStages[i + 1].id }
    }
    case 'ready':
      return { work_status: 'delivered', stage_id: null }
    default: // delivered, on_hold
      return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- work-stages`
Expected: PASS (all `nextWorkStep` cases green; existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-stages.ts src/lib/work-stages.test.ts
git commit -m "feat(work-status): add nextWorkStep helper for one-click advance"
```

---

### Task 3: `workLabelWithPosition` helper (trigger/badge label with stepper position)

**Files:**
- Modify: `src/lib/work-stages.ts` (append after `nextWorkStep`)
- Test: `src/lib/work-stages.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `WorkStage[]`, `WorkStatus`, `stage_id`, `stagesById: Map<string, WorkStage>`, optional `statusConfigs`.
- Produces: `workLabelWithPosition(activeStages, work_status, stage_id, stagesById, statusConfigs?): string` — e.g. `"Try-in · 2/2"` for a staged in-progress item; the plain work label otherwise.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/work-stages.test.ts` (reuses the top-of-file `active` + `byId` fixtures, whose stage `s2` label is `'Try-in'`):
```ts
import { workLabelWithPosition } from '@/lib/work-stages'  // add to the existing import block

describe('workLabelWithPosition', () => {
  it('appends the 1-based position for a staged in-progress item', () => {
    expect(workLabelWithPosition(active, 'in_progress', 's1', byId)).toBe('Custom Tray · 1/2')
    expect(workLabelWithPosition(active, 'in_progress', 's2', byId)).toBe('Try-in · 2/2')
  })
  it('shows the plain In Progress label for a bare in-progress item', () => {
    expect(workLabelWithPosition(active, 'in_progress', null, byId)).toBe(WORK_STATUS_LABELS.in_progress)
  })
  it('shows the plain label for non-in-progress statuses', () => {
    expect(workLabelWithPosition(active, 'ready', null, byId)).toBe(WORK_STATUS_LABELS.ready)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- work-stages`
Expected: FAIL — `workLabelWithPosition is not a function`.

- [ ] **Step 3: Implement `workLabelWithPosition`**

Append to `src/lib/work-stages.ts`:
```ts
// Label for the trigger pill / badge: appends the stepper position to a staged
// in-progress item (e.g. "Try In · 2/4"); the plain work label otherwise.
export function workLabelWithPosition(
  activeStages: WorkStage[],
  work_status: WorkStatus,
  stage_id: string | null,
  stagesById: Map<string, WorkStage>,
  statusConfigs?: WorkStatusDisplay[],
): string {
  const base = workLabel(work_status, stage_id, stagesById, statusConfigs)
  const p = stageProgress(activeStages, work_status, stage_id)
  if (p && p.index >= 0) return `${base} · ${p.index + 1}/${p.total}`
  return base
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- work-stages`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-stages.ts src/lib/work-stages.test.ts
git commit -m "feat(work-status): add workLabelWithPosition helper"
```

---

### Task 4: Redesign `WorkStatusSelect` (position trigger, numbered steps, current ✓, Advance row)

**Files:**
- Modify: `src/components/work-status-select.tsx` (whole component)
- Modify: `src/components/work/WorkQueueClient.tsx:163-198` (handle `ADVANCE_VALUE` in `updateStatus`)
- Modify: `src/components/invoices/detail/WorkStatusEditor.tsx:38-44` (handle `ADVANCE_VALUE` in `updateWorkStatus`)

**Interfaces:**
- Consumes: `nextWorkStep`, `workLabelWithPosition`, `workLabel` from `@/lib/work-stages`.
- Produces: exported `ADVANCE_VALUE = '__advance__'` from `work-status-select.tsx`; the select emits `ADVANCE_VALUE` via `onValueChange` when the Advance row is chosen. Parents resolve it with `nextWorkStep`.

- [ ] **Step 1: Rewrite `src/components/work-status-select.tsx`**

Replace the file body with (keeps `leadingItems`, `OptionRow`, `WorkOptionItem`, `fixed`; adds the Advance row, numbered/indented In-Progress steps, current ✓, and a position-aware trigger):
```tsx
'use client'

// Shared work-status dropdown: a colored trigger pill (with in-progress position)
// plus colored option pills. Configurable stages render as numbered, indented
// steps under an "In Progress" header; the current step is checked. A leading
// "Advance to <next>" row performs the one-click forward move. Used by the
// invoice-detail Work Status card and the work queue so all render identically.

import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  encodeWork, nextWorkStep, workColor, workLabel, workLabelWithPosition,
  STAGE_DEFAULT_COLOR, type WorkOption,
} from '@/lib/work-stages'
import { workStatusColor, workStatusLabel, type WorkStatusDisplay } from '@/lib/work-status-config'
import { Check, ArrowRight } from 'lucide-react'
import type { WorkStage, WorkStatus } from '@/lib/database.types'

// Sentinel emitted by the "Advance to next" row. Parents resolve it with
// nextWorkStep() against the item's current (work_status, stage_id).
export const ADVANCE_VALUE = '__advance__'

function OptionRow({ option }: { option: WorkOption }) {
  return (
    <span className={cn('inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-sm font-medium leading-5', option.color)}>
      <span className="truncate">{option.label}</span>
    </span>
  )
}

function WorkOptionItem({ option }: { option: WorkOption }) {
  return (
    <SelectItem value={option.value} textValue={option.label} className="py-2">
      <OptionRow option={option} />
    </SelectItem>
  )
}

const fixed = (status: WorkStatus, statusConfigs?: WorkStatusDisplay[]): WorkOption => ({
  value: status,
  label: workStatusLabel(status, statusConfigs),
  color: workStatusColor(status, statusConfigs),
})

export function WorkStatusSelect({
  value,
  onValueChange,
  activeStages,
  workStatus,
  stageId,
  stagesById,
  statusConfigs,
  triggerClassName,
  leadingItems,
}: {
  value: string
  onValueChange: (value: string) => void
  activeStages: WorkStage[]
  workStatus: WorkStatus
  stageId: string | null
  stagesById: Map<string, WorkStage>
  statusConfigs?: WorkStatusDisplay[]
  triggerClassName?: string
  leadingItems?: Array<{ value: string; label: string; color?: string; colorLabel?: string }>
}) {
  // In-Progress group: the active stages, plus the item's current value when it
  // sits on a retired stage / bare in-progress (so it stays selectable + visible).
  const inProgress: WorkOption[] = activeStages.map(s => ({
    value: `stage:${s.id}`,
    label: s.label,
    color: s.color ?? STAGE_DEFAULT_COLOR,
  }))
  const current = encodeWork(workStatus, stageId)
  const isInProgressValue = current === 'in_progress' || current.startsWith('stage:')
  if (isInProgressValue && !inProgress.some(o => o.value === current)) {
    inProgress.unshift({
      value: current,
      label: workLabel(workStatus, stageId, stagesById, statusConfigs),
      color: workColor(workStatus, stageId, stagesById, statusConfigs),
    })
  }

  const next = nextWorkStep(activeStages, workStatus, stageId)
  const triggerLabel = workLabelWithPosition(activeStages, workStatus, stageId, stagesById, statusConfigs)

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className={cn(
          'h-9 min-w-44 text-sm font-medium border-transparent',
          workColor(workStatus, stageId, stagesById, statusConfigs),
          triggerClassName,
        )}
      >
        <span className="truncate">{triggerLabel}</span>
      </SelectTrigger>
      <SelectContent>
        {next && (
          <>
            <SelectItem value={ADVANCE_VALUE} textValue="Advance" className="py-2">
              <span className="flex items-center gap-2 text-sm font-medium text-primary">
                <ArrowRight className="h-3.5 w-3.5" />
                Advance to {workLabel(next.work_status, next.stage_id, stagesById, statusConfigs)}
              </span>
            </SelectItem>
            <SelectSeparator />
          </>
        )}
        {leadingItems && leadingItems.length > 0 && (
          <>
            {leadingItems.map(o => (
              o.color ? (
                <SelectItem key={o.value} value={o.value} textValue={o.label} className="py-2">
                  <span className="flex max-w-full items-center gap-2">
                    <span className="shrink-0 text-sm">{o.label}</span>
                    <span className={cn('inline-flex min-w-0 items-center rounded-full px-2.5 py-0.5 text-sm font-medium leading-5', o.color)}>
                      <span className="truncate">{o.colorLabel ?? o.label}</span>
                    </span>
                  </span>
                </SelectItem>
              ) : (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              )
            ))}
            <SelectSeparator />
          </>
        )}
        <WorkOptionItem option={fixed('received', statusConfigs)} />
        <SelectGroup>
          <SelectLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">In Progress</SelectLabel>
          <div className="ml-3 border-l border-border pl-1">
            {inProgress.map((o, i) => (
              <SelectItem key={o.value} value={o.value} textValue={o.label} className="py-2">
                <span className="flex w-full items-center gap-2">
                  <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <OptionRow option={o} />
                  {o.value === current && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
                </span>
              </SelectItem>
            ))}
          </div>
        </SelectGroup>
        <WorkOptionItem option={fixed('ready', statusConfigs)} />
        <WorkOptionItem option={fixed('delivered', statusConfigs)} />
        <WorkOptionItem option={fixed('on_hold', statusConfigs)} />
      </SelectContent>
    </Select>
  )
}
```

> Note: the trigger renders `triggerLabel` directly from the controlled `workStatus`/`stageId` props (so it can show the `· n/m` position), replacing the bare `<SelectValue />`. The `SelectValue` import is intentionally dropped.

- [ ] **Step 2: Resolve `ADVANCE_VALUE` in the work list**

In `src/components/work/WorkQueueClient.tsx`, add `ADVANCE_VALUE` and `nextWorkStep` to imports:
```tsx
import { WorkStatusSelect, ADVANCE_VALUE } from '@/components/work-status-select'
```
```tsx
import {
  encodeWork, decodeWork, nextWorkStep,
  labelForValue, colorForValue, orderedGroupKeys,
} from '@/lib/work-stages'
```
Then change the top of `updateStatus` (currently lines 163-168) to resolve the sentinel using the row's current state:
```tsx
  const updateStatus = (id: string, value: string, resumeStatus: WorkStatus | null) => {
    const row = optimisticRows.find(r => r.id === id)
    let work_status: WorkStatus
    let stage_id: string | null
    if (value === RESUME_VALUE) {
      ({ work_status, stage_id } = { work_status: resume(resumeStatus), stage_id: null })
    } else if (value === ADVANCE_VALUE) {
      const next = row ? nextWorkStep(activeStages, row.work_status, row.stage_id) : null
      if (!next) return
      ({ work_status, stage_id } = next)
    } else {
      ({ work_status, stage_id } = decodeWork(value))
    }
    const hintValue = encodeWork(work_status, stage_id)
    // …unchanged from here (startTransition → applyOptimistic → updateWorkStatusAction)…
```
Leave the rest of `updateStatus` (the `startTransition` block) unchanged.

- [ ] **Step 3: Resolve `ADVANCE_VALUE` in the invoice-detail editor**

In `src/components/invoices/detail/WorkStatusEditor.tsx`, extend imports:
```tsx
import { encodeWork, decodeWork, nextWorkStep, workLabel, workColor } from '@/lib/work-stages'
import { WorkStatusSelect, ADVANCE_VALUE } from '@/components/work-status-select'
```
Replace `updateWorkStatus` (lines 38-44) with:
```tsx
  const updateWorkStatus = async (itemId: string, value: string) => {
    const item = items.find(i => i.id === itemId)
    const resolved =
      value === ADVANCE_VALUE
        ? (item ? nextWorkStep(activeStages, item.work_status, item.stage_id) : null)
        : decodeWork(value)
    if (!resolved) return
    const { work_status, stage_id } = resolved
    const res = await updateWorkStatusAction(itemId, { work_status, stage_id })
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
    show({ variant: 'success', title: 'Work status updated' })
    router.refresh()
  }
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run build`
Expected: compiles clean (no unused `SelectValue`, no type errors). If `npm run lint`/`typecheck` exists, run it too.

- [ ] **Step 5: Manual smoke (localhost:6060)**

Run `npm run dev`, open an invoice with line items:
- Dropdown trigger shows `Try In · 2/4` for a staged item.
- Menu shows numbered steps `1..4` under "In Progress" with a ✓ on the current step.
- "Advance to <next>" appears at the top and moves the item exactly one step (last stage → Ready; Ready → Delivered; Delivered shows no Advance row).
Expected: all true; only the changed item updates.

- [ ] **Step 6: Commit**

```bash
git add src/components/work-status-select.tsx src/components/work/WorkQueueClient.tsx src/components/invoices/detail/WorkStatusEditor.tsx
git commit -m "feat(work-status): numbered in-progress steps, position trigger, one-click advance"
```

---

### Task 5: Show sub-stage on the Kanban board + "Set stage" prompt

**Files:**
- Modify: `src/app/(authenticated)/work/page.tsx` — already passes `stages` to `WorkViewToggle` (no change needed; confirm).
- Modify: `src/components/work/WorkViewToggle.tsx:59-60` — pass `stages` to `KanbanBoard`.
- Modify: `src/components/work/KanbanBoard.tsx` — accept `stages`; render stage badge + `WorkStageStepper` on in-progress cards; render a "Set stage" `WorkStatusSelect` on stage-less in-progress cards.

**Interfaces:**
- Consumes: `WorkStageStepper`, `WorkStatusSelect` + `ADVANCE_VALUE`, `nextWorkStep`, `decodeWork`, `workLabel`, `workColor` from existing modules; `stages: WorkStage[]` prop.
- Produces: a board where each in-progress card shows its stage + stepper, and stage-less in-progress cards show a set-stage control.

- [ ] **Step 1: Pass `stages` into `KanbanBoard`**

In `src/components/work/WorkViewToggle.tsx`, change the board branch (line 59-60):
```tsx
      {view === 'board' ? (
        <KanbanBoard rows={rows} stages={stages} statusConfigs={statusConfigs} />
```

- [ ] **Step 2: Accept `stages` + add an update handler in `KanbanBoard`**

In `src/components/work/KanbanBoard.tsx`:

Extend imports:
```tsx
import { WorkStageStepper } from '@/components/work/WorkStageStepper'
import { WorkStatusSelect, ADVANCE_VALUE } from '@/components/work-status-select'
import { decodeWork, encodeWork, nextWorkStep } from '@/lib/work-stages'
import type { WorkStatus, WorkStage } from '@/lib/database.types'
```
Update the optimistic move type + reducer to carry `stage_id` (so a "Set stage" move regroups correctly):
```tsx
type OptimisticItemMove = { id: string; work_status: WorkStatus; stage_id: string | null }

function applyOptimisticMove(rows: WorkQueueRow[], move: OptimisticItemMove): WorkQueueRow[] {
  return rows.map(r =>
    r.id === move.id ? { ...r, work_status: move.work_status, stage_id: move.stage_id } : r,
  )
}
```
Change the component signature and `handleDrop`’s optimistic call, and add a shared `applyMove`:
```tsx
export function KanbanBoard({ rows, stages, statusConfigs }: { rows: WorkQueueRow[]; stages: WorkStage[]; statusConfigs: WorkStatusDisplay[] }) {
```
(Where `WorkStatusDisplay` is already imported via `work-status-config`.) Add near the other memos:
```tsx
  const stagesById = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages])
  const activeStages = useMemo(() => stages.filter(s => s.is_active), [stages])

  // Apply a (work_status, stage_id) move for one item: optimistic + server.
  const applyMove = (itemId: string, work_status: WorkStatus, stage_id: string | null) => {
    startTransition(async () => {
      applyOptimistic({ id: itemId, work_status, stage_id })
      const res = await updateWorkStatusAction(itemId, { work_status, stage_id })
      if (res.ok === false) show({ variant: 'error', title: res.error })
      router.refresh()
    })
  }

  // Set-stage dropdown change on a card (resolves Advance + Resume-less sentinels).
  const onCardStatusChange = (row: WorkQueueRow, value: string) => {
    const resolved = value === ADVANCE_VALUE
      ? nextWorkStep(activeStages, row.work_status, row.stage_id)
      : decodeWork(value)
    if (!resolved) return
    applyMove(row.id, resolved.work_status, resolved.stage_id)
  }
```
Update `handleDrop`’s optimistic call to include `stage_id: null` (the column drop still clears the substage, but now the card surfaces the Set-stage prompt):
```tsx
      applyOptimistic({ id: itemId, work_status: targetStatus, stage_id: null })
```

- [ ] **Step 3: Render stage badge + stepper + Set-stage on the card**

`ItemCard` needs the stage props + handler. Change its props and body:
```tsx
function ItemCard({
  row,
  today,
  activeStages,
  stagesById,
  statusConfigs,
  onDragStart,
  onClick,
  onStatusChange,
}: {
  row: WorkQueueRow
  today: string
  activeStages: WorkStage[]
  stagesById: Map<string, WorkStage>
  statusConfigs: WorkStatusDisplay[]
  onDragStart: (e: React.DragEvent, itemId: string) => void
  onClick: (invoiceId: string | undefined) => void
  onStatusChange: (row: WorkQueueRow, value: string) => void
}) {
  const dueDate = row.invoices?.due_date ?? null
  const isPastDue = dueDate != null && dueDate < today && row.work_status !== 'delivered'
  const isInProgress = row.work_status === 'in_progress'

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, row.id)}
      onClick={() => onClick(row.invoices?.id)}
      className={cn(
        'bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing',
        'hover:shadow-md transition-shadow select-none',
      )}
    >
      <div className="font-semibold text-foreground text-sm leading-snug">{row.description}</div>
      <div className="text-xs text-muted-foreground mt-1 truncate">
        {row.invoices?.customers?.clinic_name ?? '—'}
        {row.invoices?.patient && ` · ${row.invoices.patient}`}
      </div>

      {/* In-progress sub-stage: stepper when on a stage, Set-stage prompt when not. */}
      {isInProgress && (
        <div className="mt-2" onClick={e => e.stopPropagation()}>
          {row.stage_id ? (
            <WorkStageStepper activeStages={activeStages} workStatus={row.work_status} stageId={row.stage_id} />
          ) : (
            <WorkStatusSelect
              value={encodeWork(row.work_status, row.stage_id)}
              onValueChange={v => onStatusChange(row, v)}
              activeStages={activeStages}
              workStatus={row.work_status}
              stageId={row.stage_id}
              stagesById={stagesById}
              statusConfigs={statusConfigs}
              triggerClassName="h-8 w-full text-xs"
            />
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs font-mono text-muted-foreground">{row.invoices?.invoice_number ?? '—'}</span>
        {dueDate && (
          <span className={cn('text-xs', isPastDue ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
            Due {dueDate}{isPastDue && ' · overdue'}
          </span>
        )}
      </div>
    </div>
  )
}
```
> The `onClick={e => e.stopPropagation()}` wrapper stops a Set-stage interaction from navigating to the invoice.

- [ ] **Step 4: Thread the new props through `KanbanColumn` → `ItemCard`**

In `KanbanColumn`’s props add `activeStages`, `stagesById`, `onStatusChange` (alongside the existing `statusConfigs`), and pass them in the `<ItemCard … />` render:
```tsx
          <ItemCard
            key={r.id}
            row={r}
            today={today}
            activeStages={activeStages}
            stagesById={stagesById}
            statusConfigs={statusConfigs}
            onDragStart={onDragStart}
            onClick={onCardClick}
            onStatusChange={onStatusChange}
          />
```
And in the main `KanbanBoard` render, pass the same down to each `<KanbanColumn … />`:
```tsx
          <KanbanColumn
            key={status}
            status={status}
            rows={rowsByStatus.get(status) ?? []}
            today={today}
            activeStages={activeStages}
            stagesById={stagesById}
            statusConfigs={statusConfigs}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onCardClick={handleCardClick}
            onStatusChange={onCardStatusChange}
          />
```
Add the matching prop types to `KanbanColumn`’s signature:
```tsx
  activeStages: WorkStage[]
  stagesById: Map<string, WorkStage>
  onStatusChange: (row: WorkQueueRow, value: string) => void
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 6: Manual smoke (localhost:6060)**

On `/work` (Board):
- An in-progress card on a stage shows the mini stepper.
- Drag a card into "In Progress" → it lands and shows a "Set stage" dropdown; choosing a stage updates the card without navigating away.
Expected: true.

- [ ] **Step 7: Commit**

```bash
git add src/components/work/WorkViewToggle.tsx src/components/work/KanbanBoard.tsx
git commit -m "feat(work-board): show sub-stage stepper + Set-stage prompt on cards"
```

---

### Task 6: Show the stepper on work-list rows + group headers

**Files:**
- Modify: `src/components/work/WorkQueueClient.tsx` (row render ~lines 357-366; group header ~lines 322-326)

**Interfaces:**
- Consumes: existing `WorkStageStepper`, `activeStages`, and `decodeWork` (already imported).
- Produces: in-progress rows + in-progress group headers display the stepper/position.

- [ ] **Step 1: Import the stepper**

Add to imports in `src/components/work/WorkQueueClient.tsx`:
```tsx
import { WorkStageStepper } from '@/components/work/WorkStageStepper'
```

- [ ] **Step 2: Add the stepper under each in-progress row’s description**

In the row body, immediately after the description `<div>` (current line 358) and before the moved/updated `<div>`, add:
```tsx
                          {row.work_status === 'in_progress' && (
                            <WorkStageStepper
                              activeStages={activeStages}
                              workStatus={row.work_status}
                              stageId={row.stage_id}
                            />
                          )}
```

- [ ] **Step 3: Show position in the in-progress group header**

The group header already renders `<SlotBadge value={group.key} … />`. After it, add a compact position for stage groups. Compute once inside the `grouped.map(group => { … })` body (after `const isCollapsed = …`):
```tsx
            const decoded = decodeWork(group.key)
```
Then, next to the existing `<span>{group.items.length} item…</span>` in the header, add:
```tsx
                  {decoded.work_status === 'in_progress' && decoded.stage_id && (() => {
                    const i = activeStages.findIndex(s => s.id === decoded.stage_id)
                    return i >= 0 ? (
                      <span className="text-xs text-muted-foreground">Step {i + 1} of {activeStages.length}</span>
                    ) : null
                  })()}
```

- [ ] **Step 4: Build + manual**

Run: `npm run build` → clean.
On `/work` (List): in-progress rows show the stepper; in-progress stage groups show "Step n of m" in the header.

- [ ] **Step 5: Commit**

```bash
git add src/components/work/WorkQueueClient.tsx
git commit -m "feat(work-list): show sub-stage stepper on rows + group headers"
```

---

### Task 7: Sub-stage drill-down filter on the work list

**Files:**
- Modify: `src/lib/work-stages.ts` (+ `matchesWorkFilter` pure helper)
- Test: `src/lib/work-stages.test.ts` (+ `describe('matchesWorkFilter')`)
- Modify: `src/components/work/WorkQueueClient.tsx` (`FilterMode`, filter predicate, sub-stage chip row, counts)

**Interfaces:**
- Consumes: `WorkStatus`, `stage_id`.
- Produces: `matchesWorkFilter(filter: string, work_status: WorkStatus, stage_id: string | null): boolean`. Filter strings: `'all'`, `'active'`, a bare `WorkStatus`, or `stage:<id>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/work-stages.test.ts`:
```ts
import { matchesWorkFilter } from '@/lib/work-stages'  // add to the existing import block

describe('matchesWorkFilter', () => {
  it('all matches everything', () => {
    expect(matchesWorkFilter('all', 'delivered', null)).toBe(true)
  })
  it('active excludes delivered only', () => {
    expect(matchesWorkFilter('active', 'in_progress', 's1')).toBe(true)
    expect(matchesWorkFilter('active', 'delivered', null)).toBe(false)
  })
  it('a bare status matches that status', () => {
    expect(matchesWorkFilter('in_progress', 'in_progress', null)).toBe(true)
    expect(matchesWorkFilter('in_progress', 'ready', null)).toBe(false)
  })
  it('a stage filter matches only that in-progress stage', () => {
    expect(matchesWorkFilter('stage:s1', 'in_progress', 's1')).toBe(true)
    expect(matchesWorkFilter('stage:s1', 'in_progress', 's2')).toBe(false)
    expect(matchesWorkFilter('stage:s1', 'ready', null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- work-stages`
Expected: FAIL — `matchesWorkFilter is not a function`.

- [ ] **Step 3: Implement `matchesWorkFilter`**

Append to `src/lib/work-stages.ts`:
```ts
// Work-queue filter predicate. `filter` is 'all' | 'active' | a WorkStatus | "stage:<id>".
export function matchesWorkFilter(filter: string, work_status: WorkStatus, stage_id: string | null): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return work_status !== 'delivered'
  if (filter.startsWith('stage:')) return work_status === 'in_progress' && stage_id === filter.slice('stage:'.length)
  return work_status === filter
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- work-stages`
Expected: PASS.

- [ ] **Step 5: Wire the predicate + sub-stage chips into `WorkQueueClient`**

In `src/components/work/WorkQueueClient.tsx`:

Broaden `FilterMode` (line 33) and import the predicate:
```tsx
type FilterMode = 'active' | 'all' | WorkStatus | `stage:${string}`
```
```tsx
import {
  encodeWork, decodeWork, nextWorkStep, matchesWorkFilter,
  labelForValue, colorForValue, orderedGroupKeys,
} from '@/lib/work-stages'
```
Replace the stage-filter lines inside the `visible` useMemo (current lines 228-231) with the predicate:
```tsx
      if (!isRecentlyMoved && !matchesWorkFilter(filter, r.work_status, r.stage_id)) return false
```
Add a per-stage count memo (after the existing `counts` memo, ~line 216):
```tsx
  const stageCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of optimisticRows) {
      if (r.work_status === 'in_progress' && r.stage_id) m.set(r.stage_id, (m.get(r.stage_id) ?? 0) + 1)
    }
    return m
  }, [optimisticRows])
```
Reveal the sub-stage row when In Progress (or a stage) is selected. Right AFTER the existing chips `<div className="flex flex-wrap gap-2"> … </div>` block (closes ~line 296), insert:
```tsx
      {(filter === 'in_progress' || (typeof filter === 'string' && filter.startsWith('stage:'))) && activeStages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          <span className="text-xs text-muted-foreground">Stage:</span>
          {activeStages.map(s => {
            const key: FilterMode = `stage:${s.id}`
            const isSelected = filter === key
            return (
              <button
                key={s.id}
                onClick={() => setFilter(isSelected ? 'in_progress' : key)}
                className={cn(
                  'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  s.color ?? 'bg-gray-100 text-gray-700',
                  isSelected ? 'ring-1 ring-inset ring-current' : 'opacity-75 hover:opacity-100',
                )}
              >
                {s.label}
                <span className="inline-flex items-center justify-center min-w-[18px] h-4 rounded-full px-1 text-[10px] font-semibold bg-white/40">
                  {stageCounts.get(s.id) ?? 0}
                </span>
              </button>
            )
          })}
        </div>
      )}
```
> Selecting a stage chip sets `filter = 'stage:<id>'`; clicking it again returns to `'in_progress'` (all in-progress). Choosing any other top-level chip collapses the sub-row (the reveal condition is false).

- [ ] **Step 6: Build + manual**

Run: `npm run build` → clean (the `FilterMode` template-literal union typechecks; `setFilter` calls remain valid).
On `/work` (List): clicking **In Progress** reveals a "Stage:" row with the four stage chips + counts; clicking one filters to that stage; clicking it again returns to all in-progress; clicking another top-level chip hides the sub-row.

- [ ] **Step 7: Commit**

```bash
git add src/lib/work-stages.ts src/lib/work-stages.test.ts src/components/work/WorkQueueClient.tsx
git commit -m "feat(work-list): sub-stage drill-down filter with live counts"
```

---

### Task 8: Full verification + invoice-level regression guard

**Files:**
- No new code. Verifies the whole feature + the Global Constraint that no invoice-level work status exists.

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test`
Expected: all green, including the new `nextWorkStep`, `workLabelWithPosition`, `matchesWorkFilter` describes.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: compiles with no type errors across all touched files.

- [ ] **Step 3: Guard — no invoice-level work status reintroduced**

Run:
```bash
grep -rn "dominantWorkStatus\|summarizeWorkStatuses\|WorkSummaryBadge" src/ || echo "OK: none present"
```
Expected: `OK: none present` (the only allowed hit is the explanatory comment in `src/domain/production.ts`, if it still references the names — confirm it is a comment, not a call).

- [ ] **Step 4: Manual end-to-end (localhost:6060)**

- `/work` Board: in-progress cards show stepper; drop-into-In-Progress shows Set-stage; Advance via card dropdown advances one step.
- `/work` List: In Progress chip reveals stage chips + counts; selecting one filters; rows + group headers show position.
- Invoice detail: dropdown shows numbered steps + ✓ + Advance; changing one line item updates only that item; trigger shows `Stage · n/m`.
- Invoices list, invoice-detail header, calendar: **no** work-status badge at the invoice level.

- [ ] **Step 5: Final commit (if any stray changes)**

```bash
git add -A
git commit -m "chore(work-status): verify substatus UX redesign end-to-end" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- §"work stages (data)" → Task 1. ✅
- §1 shared control (trigger position, numbered steps, ✓, Advance) → Task 4 (+ helpers Tasks 2–3). ✅
- §2 sub-status visibility (board cards, list rows, group headers, Set-stage prompt) → Tasks 5–6. ✅
- §3 sub-stage drill-down filter → Task 7. ✅
- §4 nextWorkStep → Task 2. ✅
- §5 invoice-level removal already done; preserved + guarded → Task 8 Step 3. ✅
- Testing/verification → Task 8. ✅

**Placeholders:** none — every code step shows full code and exact commands.

**Type consistency:** `nextWorkStep` returns `{ work_status; stage_id } | null` and is consumed identically in Task 4 (both parents), Task 5 (board), and the dropdown. `ADVANCE_VALUE` is exported once (Task 4) and imported in WorkQueueClient, WorkStatusEditor, KanbanBoard. `matchesWorkFilter`/`workLabelWithPosition` signatures match their call sites. `WorkStatusDisplay` (from `work-status-config`) is the prop type used for `statusConfigs` in the board, matching the existing convention.

## Notes / risks

- The In-Progress steps are wrapped in a `<div className="ml-3 border-l …">` inside `SelectGroup`. Radix Select gathers items via context, so a wrapping element is fine, but verify keyboard nav + the ✓ render in Task 4 Step 5; if Radix mis-collects, drop the wrapper and apply the indent/connector classes per `SelectItem` instead.
- `nextWorkStep` for a retired/unknown stage advances to the first stage (treated as indeterminate). This matches `stageProgress`'s indeterminate handling; acceptable for the rare retired-stage case.
- The board's column drop still clears `stage_id` (coarse 5-column model); the new Set-stage prompt is how the user re-assigns a sub-stage. Board sub-stage swimlanes remain a deferred non-goal.
