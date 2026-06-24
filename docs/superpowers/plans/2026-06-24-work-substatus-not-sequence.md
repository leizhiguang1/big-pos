# In-Progress Sub-Status (not a sequence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the in-progress work stages from a numbered linear pipeline (`Try In · 2/4`, connected stepper, stage-walking "Advance") into labeled **sub-statuses** of "In Progress" (`In Progress · Try In`, equal chips, top-level-only advance), and reflect that framing in the settings page and conventions doc.

**Architecture:** Pure helpers in `src/lib/work-stages.ts` change first (TDD), then the three presentation surfaces (shared dropdown, the chip component, and the settings page) follow. The shared `WorkStatusSelect` is the single status editor used by the board, the work queue, and the invoice-detail editor, so changing it propagates everywhere. No schema / RLS / server-action changes.

**Tech Stack:** Next.js (App Router) client components, TypeScript (`strict: false`), Tailwind, shadcn `Select`, Vitest for pure-helper unit tests. Dev server on **http://localhost:6060**.

## Global Constraints

- UI says **"Clinic"**; code/DB/routes/types/permission keys stay `customer`. (Not touched here, but never regress it.)
- Under `strict: false`, narrow Server Action results with `result.ok === false`, never `!result.ok`.
- The middle-dot separator is the literal `·` (U+00B7), matching existing labels.
- Work status is **per line item, never aggregated to the invoice.** Do not re-introduce any invoice-level work rollup.
- No schema / RLS / permission / `updateWorkStatusAction` contract changes.
- Stage labels stay: `Custom Tray`, `Try In`, `Finalize Mill Design`, `Finish & Polish`. (The `Try-in → Try In` relabel is a separate already-tracked data change; this plan only fixes the placeholder copy.)
- `npm run build` and the existing Vitest suite must stay green.

---

### Task 1: Pure helpers — sub-status label + top-level advance

Replace the sequence-oriented helpers with sub-status ones. `stageProgress` (index/total) and `workLabelWithPosition` (the `· N/total` suffix) are removed; `nextWorkStep` drops to a top-level-only signature; a new `workSubStatusLabel` produces `In Progress · <stage>`.

**Files:**
- Modify: `src/lib/work-stages.ts`
- Test: `src/lib/work-stages.test.ts`

**Interfaces:**
- Consumes: `WorkStatus`, `WorkStage`, `workLabel`, `encodeWork`, `workStatusLabel`, `WorkStatusDisplay` (all already in the module).
- Produces:
  - `workSubStatusLabel(work_status: WorkStatus, stage_id: string | null, stagesById: Map<string, WorkStage>, statusConfigs?: WorkStatusDisplay[]): string`
  - `nextWorkStep(work_status: WorkStatus): { work_status: WorkStatus; stage_id: string | null } | null`
  - **Removed:** `stageProgress`, the `StageProgress` type, and `workLabelWithPosition`.

- [ ] **Step 1: Rewrite the helper tests**

In `src/lib/work-stages.test.ts`:

First, fix the import line (line ~7) — drop `stageProgress` and `workLabelWithPosition`, add `workSubStatusLabel`:

```ts
import {
  encodeWork, decodeWork, workOptions, workOptionsForItem,
  workLabel, workColor, labelForValue, colorForValue,
  orderedGroupKeys, STAGE_DEFAULT_COLOR,
  dotColorClass, nextWorkStep, workSubStatusLabel,
  matchesWorkFilter,
} from '@/lib/work-stages'
```

Delete the entire `describe('stageProgress', …)` block. Replace the `describe('nextWorkStep', …)` and `describe('workLabelWithPosition', …)` blocks with:

```ts
describe('nextWorkStep', () => {
  it('received advances to bare in_progress (sub-status is picked explicitly)', () => {
    expect(nextWorkStep('received')).toEqual({ work_status: 'in_progress', stage_id: null })
  })
  it('in_progress advances straight to ready, regardless of stage', () => {
    expect(nextWorkStep('in_progress')).toEqual({ work_status: 'ready', stage_id: null })
  })
  it('ready advances to delivered', () => {
    expect(nextWorkStep('ready')).toEqual({ work_status: 'delivered', stage_id: null })
  })
  it('delivered has no next step', () => {
    expect(nextWorkStep('delivered')).toBeNull()
  })
  it('on_hold has no next step (Resume covers it)', () => {
    expect(nextWorkStep('on_hold')).toBeNull()
  })
})

describe('workSubStatusLabel', () => {
  it('labels a staged in-progress item as "In Progress · <stage>"', () => {
    expect(workSubStatusLabel('in_progress', 's1', byId)).toBe(`${WORK_STATUS_LABELS.in_progress} · Custom Tray`)
    expect(workSubStatusLabel('in_progress', 's2', byId)).toBe(`${WORK_STATUS_LABELS.in_progress} · Try-in`)
  })
  it('labels a bare in-progress item as the plain In Progress label', () => {
    expect(workSubStatusLabel('in_progress', null, byId)).toBe(WORK_STATUS_LABELS.in_progress)
  })
  it('falls back to the plain label for an unknown/retired stage', () => {
    expect(workSubStatusLabel('in_progress', 'gone', byId)).toBe(WORK_STATUS_LABELS.in_progress)
  })
  it('uses the plain work label for non-in-progress statuses', () => {
    expect(workSubStatusLabel('ready', null, byId)).toBe(WORK_STATUS_LABELS.ready)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/work-stages.test.ts`
Expected: FAIL — `workSubStatusLabel` is not exported; `nextWorkStep` is called with 1 arg but still typed for 3.

- [ ] **Step 3: Update `work-stages.ts`**

Remove the `StageProgress` type + `stageProgress` function (the block beginning `export type StageProgress = …` through the end of `export function stageProgress(…) { … }`).

Replace `nextWorkStep` with the top-level-only version:

```ts
// Forward "advance" target for the one-click Advance action — TOP-LEVEL only.
// Sub-stages are labeled sub-statuses, not a pipeline, so advancing never walks
// stage→stage; received lands on BARE in_progress (the user then picks a sub-status).
// Returns null when there is no next step (delivered; on_hold uses Resume instead).
export function nextWorkStep(
  work_status: WorkStatus,
): { work_status: WorkStatus; stage_id: string | null } | null {
  switch (work_status) {
    case 'received':
      return { work_status: 'in_progress', stage_id: null }
    case 'in_progress':
      return { work_status: 'ready', stage_id: null }
    case 'ready':
      return { work_status: 'delivered', stage_id: null }
    default: // delivered, on_hold
      return null
  }
}
```

Replace `workLabelWithPosition` with `workSubStatusLabel`:

```ts
// Label for the trigger pill / badge. A staged in-progress item reads as a
// sub-status of In Progress: "In Progress · Try In". Bare in-progress and every
// other status use their plain work label. (No position/count — stages are
// labeled sub-statuses, not an ordered sequence.)
export function workSubStatusLabel(
  work_status: WorkStatus,
  stage_id: string | null,
  stagesById: Map<string, WorkStage>,
  statusConfigs?: WorkStatusDisplay[],
): string {
  if (work_status === 'in_progress' && stage_id) {
    const s = stagesById.get(stage_id)
    if (s) return `${workStatusLabel('in_progress', statusConfigs)} · ${s.label}`
  }
  return workLabel(work_status, stage_id, stagesById, statusConfigs)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/work-stages.test.ts`
Expected: PASS (all describes green).

- [ ] **Step 5: Typecheck (call-site fallout is expected, fixed in later tasks)**

Run: `npx tsc --noEmit`
Expected: errors **only** in `work-status-select.tsx`, `WorkStatusEditor.tsx`, `WorkQueueClient.tsx`, `KanbanBoard.tsx`, `WorkStageStepper.tsx` (they still call the old symbols). No errors inside `work-stages.ts` itself. These are resolved in Tasks 2–4.

- [ ] **Step 6: Commit**

```bash
git add src/lib/work-stages.ts src/lib/work-stages.test.ts
git commit -m "feat(work-status): sub-status label + top-level-only advance helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `WorkStageChips` component (replaces `WorkStageStepper`)

Equal chips, only the current stage highlighted; no connector line, no done-fill, no `X of N`.

**Files:**
- Create: `src/components/work/WorkStageChips.tsx`
- Delete: `src/components/work/WorkStageStepper.tsx`

**Interfaces:**
- Consumes: `WorkStage`, `WorkStatus`, `STAGE_DEFAULT_COLOR`, `workStatusLabel` (from `work-status-config`), `cn`.
- Produces: `WorkStageChips({ activeStages, workStatus, stageId, statusConfigs? })` — same prop shape `WorkStageStepper` had, plus optional `statusConfigs` for the "In Progress" caption label. Renders `null` unless `workStatus === 'in_progress'`.

- [ ] **Step 1: Create `WorkStageChips.tsx`**

```tsx
'use client'

// Renders the active in-progress stages as a row of EQUAL chips: only the
// current sub-status is highlighted (its stage color); every other stage looks
// the same muted pill, regardless of order. There is deliberately no connector
// line, no "done" fill, and no "X of N" count — a stage is a labeled sub-status
// of In Progress, not a step in a sequence. Renders nothing unless in_progress.
// A bare in-progress item (or one on a retired stage) shows all chips muted with
// an "In Progress" caption.

import { cn } from '@/lib/utils'
import { STAGE_DEFAULT_COLOR } from '@/lib/work-stages'
import { workStatusLabel, type WorkStatusDisplay } from '@/lib/work-status-config'
import type { WorkStage, WorkStatus } from '@/lib/database.types'

export function WorkStageChips({
  activeStages,
  workStatus,
  stageId,
  statusConfigs,
}: {
  activeStages: WorkStage[]
  workStatus: WorkStatus
  stageId: string | null
  statusConfigs?: WorkStatusDisplay[]
}) {
  if (workStatus !== 'in_progress' || activeStages.length === 0) return null

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {activeStages.map(stage => {
          const current = stage.id === stageId
          return (
            <span
              key={stage.id}
              title={stage.label}
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
                current ? (stage.color ?? STAGE_DEFAULT_COLOR) : 'bg-gray-100 text-gray-500',
              )}
            >
              {stage.label}
            </span>
          )
        })}
      </div>
      <p className="mt-0.5 text-[11px] text-gray-500">{workStatusLabel('in_progress', statusConfigs)}</p>
    </div>
  )
}
```

- [ ] **Step 2: Delete the old stepper**

```bash
git rm src/components/work/WorkStageStepper.tsx
```

(Call-site imports are updated in Task 4. `tsc` will still report those broken imports until then — expected.)

- [ ] **Step 3: Commit**

```bash
git add src/components/work/WorkStageChips.tsx
git commit -m "feat(work-status): WorkStageChips — equal sub-status chips, no sequence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Shared dropdown — flat sub-status options, top-level advance, "No sub-status"

Update `WorkStatusSelect`: trigger uses `workSubStatusLabel`; In-Progress rows become flat colored pills (no numbers, no connector tree); a leading **"No sub-status"** row clears the stage; the Advance row now resolves a top-level step via `nextWorkStep(workStatus)`.

**Files:**
- Modify: `src/components/work-status-select.tsx`

**Interfaces:**
- Consumes: `nextWorkStep(work_status)` and `workSubStatusLabel(...)` from Task 1; `IN_PROGRESS_VALUE` is the existing encoded value for bare in-progress, the string `'in_progress'`.
- Produces: unchanged exports — `WorkStatusSelect` and `ADVANCE_VALUE` stay; `onValueChange` still emits `ADVANCE_VALUE`, `'in_progress'`, `stage:<id>`, or a bare `WorkStatus` (callers already decode all of these).

- [ ] **Step 1: Fix imports**

Replace the `@/lib/work-stages` import (line ~14) — drop `workLabelWithPosition`, add `workSubStatusLabel`:

```tsx
import {
  encodeWork, nextWorkStep, workColor, workLabel, workSubStatusLabel,
  STAGE_DEFAULT_COLOR, type WorkOption,
} from '@/lib/work-stages'
```

- [ ] **Step 2: Update the advance + trigger label lines**

Change lines ~86–87 from:

```tsx
  const next = nextWorkStep(activeStages, workStatus, stageId)
  const triggerLabel = workLabelWithPosition(activeStages, workStatus, stageId, stagesById, statusConfigs)
```

to:

```tsx
  const next = nextWorkStep(workStatus)
  const triggerLabel = workSubStatusLabel(workStatus, stageId, stagesById, statusConfigs)
```

The existing advance `<SelectItem value={ADVANCE_VALUE} …>` block keeps working — its label
`Advance to {workLabel(next.work_status, next.stage_id, …)}` now resolves to `Advance to In Progress` / `Advance to Ready` / `Advance to Delivered`. Leave that block as-is.

- [ ] **Step 3: Replace the numbered In-Progress group with flat pills + a "No sub-status" row**

Replace the `<SelectGroup>…</SelectGroup>` block (the one with the `In Progress` label, the `border-l` div, and the `{i + 1}` number span) with:

```tsx
        <SelectGroup>
          <SelectLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">In Progress</SelectLabel>
          {/* "No sub-status" — bare in_progress; lets a user enter In Progress
              without a stage, or clear a stage back to none. */}
          <SelectItem value="in_progress" textValue="No sub-status" className="py-2">
            <span className="flex w-full items-center gap-2">
              <span className="text-sm text-muted-foreground">No sub-status</span>
              {current === 'in_progress' && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
            </span>
          </SelectItem>
          {inProgress.map(o => (
            <SelectItem key={o.value} value={o.value} textValue={o.label} className="py-2">
              <span className="flex w-full items-center gap-2">
                <OptionRow option={o} />
                {o.value === current && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
```

Notes:
- The numbered `<span className="w-4 …">{i + 1}</span>` and the `border-l` indent wrapper are gone — rows are flat colored pills.
- `inProgress` (built earlier in the component from `activeStages` + the current value) is reused unchanged. Its existing logic that unshifts the current value when it's bare `in_progress` or a retired stage is now redundant for the bare case (the explicit "No sub-status" row covers it) but harmless — leave `inProgress` construction untouched to avoid regressions for retired stages.
- `Check` and `OptionRow` are already imported/defined in this file.

- [ ] **Step 4: Typecheck this file**

Run: `npx tsc --noEmit 2>&1 | grep work-status-select`
Expected: no output (this file is clean). Remaining errors are in the three callers (Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/components/work-status-select.tsx
git commit -m "feat(work-status): flat sub-status menu + No-sub-status + top-level advance

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Update the three call sites (editor, queue, board)

Swap `WorkStageStepper` → `WorkStageChips`, and update every `nextWorkStep(activeStages, ws, stageId)` call to `nextWorkStep(ws)`.

**Files:**
- Modify: `src/components/invoices/detail/WorkStatusEditor.tsx`
- Modify: `src/components/work/WorkQueueClient.tsx`
- Modify: `src/components/work/KanbanBoard.tsx`

**Interfaces:**
- Consumes: `WorkStageChips` (Task 2), `nextWorkStep(work_status)` (Task 1). `ADVANCE_VALUE` import is unchanged.

- [ ] **Step 1: `WorkStatusEditor.tsx`**

Change the import (line ~18) from `WorkStageStepper` to `WorkStageChips`:

```tsx
import { WorkStageChips } from '@/components/work/WorkStageChips'
```

Update the advance resolve (line ~42) — drop `activeStages` and `item.stage_id`:

```tsx
        ? (item ? nextWorkStep(item.work_status) : null)
```

Update the JSX usage (line ~97) — rename the element and pass `statusConfigs`:

```tsx
                  <WorkStageChips
                    activeStages={activeStages}
                    workStatus={item.work_status}
                    stageId={item.stage_id}
                    statusConfigs={statusConfigs}
                  />
```

(Confirm `statusConfigs` is in scope here — it's already passed to `WorkStatusSelect` two lines above, so it is.)

- [ ] **Step 2: `WorkQueueClient.tsx`**

Change the import (line ~29):

```tsx
import { WorkStageChips } from '@/components/work/WorkStageChips'
```

Update the advance resolve (line ~171):

```tsx
      const next = row ? nextWorkStep(row.work_status) : null
```

Update the row JSX (line ~408) — rename element, pass `statusConfigs` (already in scope in this component):

```tsx
                            <WorkStageChips
                              activeStages={activeStages}
                              workStatus={row.work_status}
                              stageId={row.stage_id}
                              statusConfigs={statusConfigs}
                            />
```

- [ ] **Step 3: `KanbanBoard.tsx`**

Change the import (line ~28):

```tsx
import { WorkStageChips } from '@/components/work/WorkStageChips'
```

Update the card JSX (line ~85) — rename element, pass `statusConfigs` (the `Card` already receives `stagesById`/`statusConfigs`; confirm `statusConfigs` is a prop in scope, it is used by the inner `WorkStatusSelect`):

```tsx
            <WorkStageChips activeStages={activeStages} workStatus={row.work_status} stageId={row.stage_id} statusConfigs={statusConfigs} />
```

Update the advance resolve in `onCardStatusChange` (line ~220–221):

```tsx
    const resolved = value === ADVANCE_VALUE
      ? nextWorkStep(row.work_status)
      : decodeWork(value)
```

- [ ] **Step 4: Full typecheck + tests**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

Run: `npm test -- src/lib/work-stages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/invoices/detail/WorkStatusEditor.tsx src/components/work/WorkQueueClient.tsx src/components/work/KanbanBoard.tsx
git commit -m "feat(work-status): use WorkStageChips + top-level advance at all call sites

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Settings page + conventions copy

Reframe `/settings/work-stages` from "steps/sub-steps" to "sub-statuses with a display order," and update `docs/CONVENTIONS.md` §5.

**Files:**
- Modify: `src/app/(authenticated)/settings/work-stages/page.tsx`
- Modify: `docs/CONVENTIONS.md`

**Interfaces:** none (copy-only).

- [ ] **Step 1: Subtitle copy**

In `page.tsx`, change the subtitle paragraph:

```tsx
            <p className="text-sm text-muted-foreground mt-0.5">Sub-statuses of &ldquo;In Progress&rdquo;. The order here is display order only &mdash; it does not mean a case must move through them in sequence.</p>
```

- [ ] **Step 2: "Order" column hint**

Change the order column header to carry the display-order meaning:

```tsx
                <TableHead className="w-24">Display order</TableHead>
```

- [ ] **Step 3: Dialog placeholder**

Change the label input placeholder from `e.g. Try-in` to `e.g. Try In`:

```tsx
              <Input placeholder="e.g. Try In" {...register('label')} />
```

- [ ] **Step 4: Conventions doc**

In `docs/CONVENTIONS.md` §5, replace the `**"In Progress" has sub-stages**` bullet with:

```markdown
- **"In Progress" has sub-statuses** ("Work stages", configured in Settings). They have a
  **display order only — not a required sequence**; a case may sit on any sub-status, move
  between them in any order, or sit on **none** (bare `in_progress`). A staged item is encoded
  as `stage:<id>`; a stage-less in-progress is just `in_progress`. Retired stages still label
  legacy items.
```

- [ ] **Step 5: Verify build + commit**

Run: `npm run build`
Expected: compiles clean.

```bash
git add "src/app/(authenticated)/settings/work-stages/page.tsx" docs/CONVENTIONS.md
git commit -m "docs(work-status): reframe stages as sub-statuses (display order, not sequence)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Manual verification on localhost:6060

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (serves on http://localhost:6060)

- [ ] **Step 2: Board (`/work`)**

Verify:
- An in-progress card shows the chip row: only the current stage chip is colored, the rest are muted gray, **no connector line and no "X of N"**.
- A bare in-progress card (no stage) shows the **"Set stage"** prompt (unchanged) and the chip row with no chip highlighted.
- The dropdown's "Advance" row reads `Advance to Ready` for an in-progress card (not "Advance to <next stage>"); clicking it moves the card to Ready.
- A received card's "Advance" reads `Advance to In Progress` and lands it as bare in-progress (then "Set stage" appears).

- [ ] **Step 3: Work list (`/work` list view)**

Verify:
- In-progress rows + group headers show the chip row (no count).
- Selecting the **In Progress** filter chip still reveals the sub-stage filter chips with live counts; selecting one still filters (unchanged).

- [ ] **Step 4: Invoice detail Work Status table**

Verify:
- The trigger pill reads `In Progress · Try In` (no `· 2/4`) for a staged item.
- The dropdown shows a `No sub-status` row at the top of the In Progress group, then the four flat colored stage pills with **no numbers and no connector tree**; ✓ marks the current one.
- Selecting `No sub-status` on a staged item clears it to bare `In Progress` (pill reads `In Progress`).
- Changing one line item updates only that item.
- No work-status badge appears at the invoice level anywhere (header / list / calendar).

- [ ] **Step 5: Settings (`/settings/work-stages`)**

Verify the subtitle reads "Sub-statuses of 'In Progress'… display order only", the column header reads "Display order", and the add/edit dialog placeholder reads `e.g. Try In`.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §1 labels → Task 1 + Task 3; §2 chips → Task 2 + Task 4; §3 menu/"No sub-status" → Task 3; §4 `nextWorkStep` → Task 1 + Task 4; §5 settings + conventions → Task 5; drill-down filter (unchanged) → confirmed untouched in Task 6 Step 3; invoice-level removal (unchanged) → confirmed in Task 6 Step 4.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** `workSubStatusLabel` and `nextWorkStep(work_status)` signatures defined in Task 1 match every call site updated in Tasks 3–4; `WorkStageChips` prop shape defined in Task 2 matches the three usages in Task 4.
