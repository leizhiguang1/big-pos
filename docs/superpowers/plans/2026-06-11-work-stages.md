# Work Stages (In-Progress sub-steps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `qc` work status and let the lab break the "In Progress" phase into editable bench stages (Custom Tray, Try-in, Finalize Mill Design, Finish & Polish), shown per-item in the Work Queue and invoice detail.

**Architecture:** Keep `work_status` as a stable, code-defined phase backbone (`received → in_progress → ready → delivered`, + `on_hold`). Add a DB-backed, lab-editable `work_stages` lookup table (a faithful clone of `service_statuses`) whose rows are the sub-steps of the **In Progress** phase. Each `invoice_items` row gains a nullable `stage_id`. The UI flattens phase + stage into one dropdown via a new pure-function helper (`src/lib/work-stages.ts`), which is the unit-tested core. History and the "updated at" timestamp are extended (in existing DB triggers) to react to stage changes too.

**Tech Stack:** Next.js (App Router, client components) + Supabase (Postgres, RLS, triggers) + TypeScript + Tailwind + shadcn/ui. Tests: Vitest (node env, pure-function unit tests only — no DOM testing exists). Migrations apply via the `big-pos-supabase` MCP `apply_migration` tool (there is **no** local `supabase/migrations` directory).

**Spec:** `docs/superpowers/specs/2026-06-11-work-stages-design.md`

---

## Background facts the implementer needs (verified against the live DB & codebase)

- `work_status` is a **Postgres enum type** used by two columns: `invoice_items.work_status` (NOT NULL, default `'received'::work_status`) and `invoice_item_status_history.status`. There are **0 rows** with `work_status = 'qc'` (all 36 items are `received`), so dropping `qc` is value-safe.
- Two triggers on `invoice_items` both currently gate on `work_status` changing:
  - `invoice_items_status_log` → `log_invoice_item_status_change()` — **SECURITY DEFINER**, `search_path=public`; writes a row into `invoice_item_status_history`.
  - `invoice_items_stamp_status_ts` → `stamp_invoice_item_work_status_updated_at()` — **SECURITY INVOKER** (not definer), `search_path=public`; stamps `work_status_updated_at`.
  - (A third trigger, `enforce_invoice_item_price_range`, does not touch `work_status` — leave it alone.)
- History rows are written **by the DB trigger**, not by app code. App code must therefore **never** insert history manually — it only updates `invoice_items`, and the trigger logs.
- `service_statuses` columns to clone: `id uuid PK default gen_random_uuid()`, `label text NOT NULL`, `color text NULL`, `sort_order int NOT NULL default 0`, `is_active bool NOT NULL default true`, `created_at timestamptz NOT NULL default now()`. RLS **enabled**, single policy `authenticated_all` = `FOR ALL TO authenticated USING (true) WITH CHECK (true)`.
- `database.types.ts` is **hand-maintained** (not auto-generated in this repo) — edit it by hand.
- **Only two gates work in this repo: `npm run build` and `npm test`.** Specifically:
  - `npx tsc --noEmit` is NOT a gate — `next.config` sets `typescript: { ignoreBuildErrors: true }` because the hand-rolled types fail Supabase's `GenericSchema` constraint, so every `supabase.from()` op resolves to `never` and `tsc` reports ~50 baseline errors that are not real bugs.
  - `npm run lint` is BROKEN — this is Next.js 16, which removed `next lint`; there is also no ESLint config, so `npx eslint` errors too. There is **no working linter and no `noUnusedLocals`**, so unused imports are NOT auto-detected. When a task removes imports, **manually grep the changed file** to confirm every remaining imported symbol is still referenced (e.g. `grep -c '\bSymbol\b' file`), since nothing else will catch a dead import.
  - **`npm run build`** (real compile gate; type errors ignored) and **`npm test`** (vitest) are the gates to run.

## File map

- **DB migration** (via MCP, no file) — enum recreation, `work_stages` table + RLS + seed, two `stage_id` columns, two trigger rewrites.
- `src/lib/database.types.ts` — *modify*: drop `'qc'`; add `WorkStage` + `WorkStageInsert`; register `work_stages`; add `stage_id` to `InvoiceItem`/`InvoiceItemInsert` and `InvoiceItemStatusHistory`/`StatusHistoryInsert`.
- `src/lib/work-stages.ts` — *create*: fetchers + pure helpers (encode/decode/options/label/color/grouping). **The tested core.**
- `src/lib/work-stages.test.ts` — *create*: unit tests for the pure helpers.
- `src/lib/work-status.ts` — *modify*: remove `qc` everywhere.
- `src/lib/work-status.test.ts` — *create*: guard test that `qc` is gone and the linear flow is correct.
- `src/app/(authenticated)/settings/work-stages/page.tsx` — *create*: manage screen (clone of `service-statuses`).
- `src/app/(authenticated)/settings/page.tsx` — *modify*: add a "Work Stages" settings entry.
- `src/app/(authenticated)/work/page.tsx` — *modify (rewrite)*: slot-based dropdown + per-stage grouping.
- `src/app/(authenticated)/invoices/[id]/page.tsx` — *modify*: slot-based per-item dropdown, `stage_id` write, stage in history.

---

## Task 1: Database migration (apply via MCP)

**Files:**
- No repo file. Apply via the `big-pos-supabase` MCP tool `mcp__big-pos-supabase__apply_migration` (name it `work_stages`).

> This migration cannot be unit-tested with Vitest. Verification is done with MCP `execute_sql` SELECTs in Step 2.

- [ ] **Step 1: Apply the migration**

Call `mcp__big-pos-supabase__apply_migration` with `name: "work_stages"` and this SQL. (If the tool rejects explicit `BEGIN`/`COMMIT` with "cannot run inside a transaction block", remove those two lines — `apply_migration` wraps the migration in its own transaction; the enum swap is still atomic.)

```sql
BEGIN;

-- 1. Recreate work_status enum WITHOUT 'qc'.
--    Postgres cannot drop a value from an in-use enum, so build a new type,
--    repoint both dependent columns, then drop the old type and rename.
--    Value-safe: 0 rows use 'qc' (verified).
CREATE TYPE public.work_status_new AS ENUM ('received','in_progress','ready','delivered','on_hold');

ALTER TABLE public.invoice_items ALTER COLUMN work_status DROP DEFAULT;

ALTER TABLE public.invoice_items
  ALTER COLUMN work_status TYPE public.work_status_new
  USING (work_status::text::public.work_status_new);

ALTER TABLE public.invoice_item_status_history
  ALTER COLUMN status TYPE public.work_status_new
  USING (status::text::public.work_status_new);

ALTER TABLE public.invoice_items
  ALTER COLUMN work_status SET DEFAULT 'received'::public.work_status_new;

DROP TYPE public.work_status;
ALTER TYPE public.work_status_new RENAME TO work_status;

-- 2. work_stages lookup table — a faithful clone of service_statuses
--    (same columns, RLS posture, and policy) + seed the 4 stages.
CREATE TABLE public.work_stages (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label       text        NOT NULL,
  color       text,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY authenticated_all ON public.work_stages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.work_stages (label, color, sort_order) VALUES
  ('Custom Tray',          'bg-blue-100 text-blue-700',     10),
  ('Try-in',               'bg-amber-100 text-amber-700',   20),
  ('Finalize Mill Design', 'bg-purple-100 text-purple-700', 30),
  ('Finish & Polish',      'bg-green-100 text-green-700',   40);

-- 3. invoice_items.stage_id — nullable FK; clearing a stage nulls the pointer.
ALTER TABLE public.invoice_items
  ADD COLUMN stage_id uuid NULL REFERENCES public.work_stages(id) ON DELETE SET NULL;

-- 4. invoice_item_status_history.stage_id — record which stage a logged row was at.
ALTER TABLE public.invoice_item_status_history
  ADD COLUMN stage_id uuid NULL REFERENCES public.work_stages(id) ON DELETE SET NULL;

-- 5a. History logger: rebind to the renamed type AND also fire on stage_id change.
--     Preserve SECURITY DEFINER + search_path exactly.
CREATE OR REPLACE FUNCTION public.log_invoice_item_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_username text;
BEGIN
  IF (TG_OP = 'INSERT')
     OR (NEW.work_status IS DISTINCT FROM OLD.work_status)
     OR (NEW.stage_id IS DISTINCT FROM OLD.stage_id) THEN
    v_username := nullif(coalesce(
      auth.jwt() -> 'user_metadata' ->> 'username',
      auth.jwt() ->> 'email'
    ), '');
    INSERT INTO invoice_item_status_history (invoice_item_id, status, stage_id, changed_by, changed_by_name)
    VALUES (NEW.id, NEW.work_status, NEW.stage_id, auth.uid(), v_username);
  END IF;
  RETURN NULL;
END;
$function$;

-- 5b. Timestamp stamper: rebind + also fire on stage_id change.
--     Preserve SECURITY INVOKER (NO security definer) + search_path exactly.
CREATE OR REPLACE FUNCTION public.stamp_invoice_item_work_status_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (TG_OP = 'INSERT')
     OR (NEW.work_status IS DISTINCT FROM OLD.work_status)
     OR (NEW.stage_id IS DISTINCT FROM OLD.stage_id) THEN
    NEW.work_status_updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
```

- [ ] **Step 2: Verify the migration with MCP `execute_sql`**

Run this query via `mcp__big-pos-supabase__execute_sql`:

```sql
SELECT
  (SELECT array_agg(enumlabel ORDER BY enumsortorder)
     FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'work_status')                                   AS enum_values,
  (SELECT count(*) FROM public.work_stages)                            AS stage_count,
  (SELECT array_agg(label ORDER BY sort_order) FROM public.work_stages) AS stage_labels,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'invoice_items' AND column_name = 'stage_id')   AS item_stage_col,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'invoice_item_status_history' AND column_name = 'stage_id') AS hist_stage_col;
```

Expected:
- `enum_values` = `{received,in_progress,ready,delivered,on_hold}` (no `qc`)
- `stage_count` = `4`
- `stage_labels` = `{Custom Tray,Try-in,Finalize Mill Design,Finish & Polish}`
- `item_stage_col` = `1`, `hist_stage_col` = `1`

- [ ] **Step 3: Smoke-test the stage trigger** (confirms history logs on stage change)

```sql
-- Move one received item to a stage, then read its latest history row.
WITH one AS (SELECT id FROM public.invoice_items LIMIT 1),
     stg AS (SELECT id FROM public.work_stages WHERE label = 'Custom Tray')
UPDATE public.invoice_items
   SET work_status = 'in_progress', stage_id = (SELECT id FROM stg)
 WHERE id = (SELECT id FROM one);

SELECT h.status, h.stage_id, s.label
FROM public.invoice_item_status_history h
LEFT JOIN public.work_stages s ON s.id = h.stage_id
ORDER BY h.changed_at DESC
LIMIT 1;
```
Expected: one row with `status = in_progress`, a non-null `stage_id`, `label = Custom Tray`.

- [ ] **Step 4: Revert the smoke-test row** (leave data as it was)

```sql
UPDATE public.invoice_items
   SET work_status = 'received', stage_id = NULL
 WHERE id = (SELECT id FROM public.invoice_items ORDER BY work_status_updated_at DESC LIMIT 1);
```
(There is no commit for this task — DB state lives in Supabase, not git.)

---

## Task 2: Update `database.types.ts`

**Files:**
- Modify: `src/lib/database.types.ts`

- [ ] **Step 1: Remove `qc` from the `WorkStatus` union**

Find:
```typescript
export type WorkStatus = 'received' | 'in_progress' | 'qc' | 'ready' | 'delivered' | 'on_hold'
```
Replace with:
```typescript
export type WorkStatus = 'received' | 'in_progress' | 'ready' | 'delivered' | 'on_hold'
```

- [ ] **Step 2: Add the `WorkStage` interface** (immediately after the `ServiceStatus` interface block)

Find:
```typescript
export interface Role {
```
Replace with:
```typescript
export interface WorkStage {
  id: string
  label: string
  color: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface Role {
```

- [ ] **Step 3: Add `stage_id` to `InvoiceItem`**

Find:
```typescript
  work_status: WorkStatus
  work_status_updated_at: string
  work_note: string | null
  created_at: string
}
```
Replace with:
```typescript
  work_status: WorkStatus
  work_status_updated_at: string
  work_note: string | null
  stage_id: string | null
  created_at: string
}
```

- [ ] **Step 4: Add `stage_id` to `InvoiceItemStatusHistory`**

Find:
```typescript
export interface InvoiceItemStatusHistory {
  id: string
  invoice_item_id: string
  status: WorkStatus
  note: string | null
  changed_by: string | null
  changed_by_name: string | null
  changed_at: string
}
```
Replace with:
```typescript
export interface InvoiceItemStatusHistory {
  id: string
  invoice_item_id: string
  status: WorkStatus
  note: string | null
  changed_by: string | null
  changed_by_name: string | null
  stage_id: string | null
  changed_at: string
}
```

- [ ] **Step 5: Make `stage_id` optional on the two Insert types + add `WorkStageInsert`**

Find:
```typescript
type InvoiceItemInsert = Omit<InvoiceItem, 'id' | 'created_at' | 'work_status' | 'work_status_updated_at' | 'work_note'> &
  Partial<Pick<InvoiceItem, 'work_status' | 'work_note'>>
```
Replace with:
```typescript
type InvoiceItemInsert = Omit<InvoiceItem, 'id' | 'created_at' | 'work_status' | 'work_status_updated_at' | 'work_note' | 'stage_id'> &
  Partial<Pick<InvoiceItem, 'work_status' | 'work_note' | 'stage_id'>>
```

Find:
```typescript
type StatusHistoryInsert = Omit<InvoiceItemStatusHistory, 'id' | 'changed_at'>
```
Replace with:
```typescript
type StatusHistoryInsert = Omit<InvoiceItemStatusHistory, 'id' | 'changed_at' | 'stage_id'> &
  Partial<Pick<InvoiceItemStatusHistory, 'stage_id'>>
```

Find:
```typescript
type ServiceStatusInsert = Omit<ServiceStatus, 'id' | 'created_at'>
```
Replace with:
```typescript
type ServiceStatusInsert = Omit<ServiceStatus, 'id' | 'created_at'>
type WorkStageInsert = Omit<WorkStage, 'id' | 'created_at'>
```

- [ ] **Step 6: Register `work_stages` in the Tables registry** (right after the `service_statuses` entry)

Find:
```typescript
      service_statuses:             { Row: ServiceStatus;              Insert: ServiceStatusInsert;  Update: Partial<ServiceStatusInsert>;  Relationships: [] }
```
Replace with:
```typescript
      service_statuses:             { Row: ServiceStatus;              Insert: ServiceStatusInsert;  Update: Partial<ServiceStatusInsert>;  Relationships: [] }
      work_stages:                  { Row: WorkStage;                  Insert: WorkStageInsert;      Update: Partial<WorkStageInsert>;      Relationships: [] }
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). It may surface the `qc` references in `work-status.ts` / `work/page.tsx` — those are fixed in Tasks 4 and 6. If `tsc` reports errors **only** in `src/lib/work-status.ts` and `src/app/(authenticated)/work/page.tsx` about `qc`, that is expected at this point; proceed.

- [ ] **Step 8: Commit**

```bash
git add src/lib/database.types.ts
git commit -m "feat(work-stages): types for work_stages + item/history stage_id; drop qc"
```

---

## Task 3: Create the `work-stages` helper (TDD core)

**Files:**
- Test: `src/lib/work-stages.test.ts`
- Create: `src/lib/work-stages.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/work-stages.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import type { WorkStatus, WorkStage } from '@/lib/database.types'
import {
  encodeWork, decodeWork, workOptions, workOptionsForItem,
  workLabel, workColor, labelForValue, colorForValue,
  orderedGroupKeys, STAGE_DEFAULT_COLOR,
} from '@/lib/work-stages'
import { WORK_STATUS_LABELS, WORK_STATUS_COLORS } from '@/lib/work-status'

const stage = (
  id: string, label: string, sort: number,
  color: string | null = null, is_active = true,
): WorkStage => ({ id, label, color, sort_order: sort, is_active, created_at: '2026-06-11T00:00:00Z' })

const tray = stage('s1', 'Custom Tray', 10, 'bg-blue-100 text-blue-700')
const tryin = stage('s2', 'Try-in', 20, 'bg-amber-100 text-amber-700')
const active = [tray, tryin]
const byId = new Map(active.map(s => [s.id, s]))

describe('encodeWork / decodeWork', () => {
  it('round-trips every phase and stage', () => {
    const cases: Array<[WorkStatus, string | null]> = [
      ['received', null], ['in_progress', 's1'], ['in_progress', null],
      ['ready', null], ['delivered', null], ['on_hold', null],
    ]
    for (const [ws, sid] of cases) {
      expect(decodeWork(encodeWork(ws, sid))).toEqual({ work_status: ws, stage_id: sid })
    }
  })
  it('encodes a staged in_progress as "stage:<id>"', () => {
    expect(encodeWork('in_progress', 's1')).toBe('stage:s1')
  })
  it('encodes a stage-less in_progress as "in_progress"', () => {
    expect(encodeWork('in_progress', null)).toBe('in_progress')
  })
})

describe('workOptions', () => {
  it('lists Received, active stages in order, then Ready/Delivered/On Hold', () => {
    expect(workOptions(active).map(o => o.value)).toEqual([
      'received', 'stage:s1', 'stage:s2', 'ready', 'delivered', 'on_hold',
    ])
  })
  it('uses the stage color, falling back to the default', () => {
    const noColor = [stage('s3', 'Bake', 30, null)]
    expect(workOptions(noColor)[1]).toEqual({ value: 'stage:s3', label: 'Bake', color: STAGE_DEFAULT_COLOR })
  })
})

describe('workOptionsForItem', () => {
  it('returns the base options when the current value is already present', () => {
    expect(workOptionsForItem(active, 'received', null, byId)).toEqual(workOptions(active))
  })
  it('injects an inactive stage the item still sits on, right after Received', () => {
    const inactive = stage('old', 'Wax Up', 99, 'bg-pink-100 text-pink-700', false)
    const map = new Map([...byId, [inactive.id, inactive]])
    const opts = workOptionsForItem(active, 'in_progress', 'old', map)
    expect(opts.map(o => o.value)).toEqual([
      'received', 'stage:old', 'stage:s1', 'stage:s2', 'ready', 'delivered', 'on_hold',
    ])
    expect(opts[1]).toEqual({ value: 'stage:old', label: 'Wax Up', color: 'bg-pink-100 text-pink-700' })
  })
  it('injects a stage-less In Progress item', () => {
    const opts = workOptionsForItem(active, 'in_progress', null, byId)
    const inProg = opts.find(o => o.value === 'in_progress')
    expect(inProg?.label).toBe(WORK_STATUS_LABELS.in_progress)
  })
})

describe('workLabel / workColor', () => {
  it('uses the stage label+color for an active staged item', () => {
    expect(workLabel('in_progress', 's1', byId)).toBe('Custom Tray')
    expect(workColor('in_progress', 's1', byId)).toBe('bg-blue-100 text-blue-700')
  })
  it('falls back to the phase label+color for non-stage statuses', () => {
    expect(workLabel('ready', null, byId)).toBe(WORK_STATUS_LABELS.ready)
    expect(workColor('ready', null, byId)).toBe(WORK_STATUS_COLORS.ready)
  })
  it('falls back to In Progress when the stage is unknown or missing', () => {
    expect(workLabel('in_progress', 'gone', byId)).toBe(WORK_STATUS_LABELS.in_progress)
    expect(workColor('in_progress', null, byId)).toBe(WORK_STATUS_COLORS.in_progress)
  })
})

describe('labelForValue / colorForValue', () => {
  it('decodes a group-key value then resolves label + color', () => {
    expect(labelForValue('stage:s2', byId)).toBe('Try-in')
    expect(colorForValue('stage:s2', byId)).toBe('bg-amber-100 text-amber-700')
    expect(labelForValue('ready', byId)).toBe(WORK_STATUS_LABELS.ready)
  })
})

describe('orderedGroupKeys', () => {
  it('orders present groups canonically', () => {
    const present = ['ready', 'stage:s2', 'received', 'on_hold']
    expect(orderedGroupKeys(active, present)).toEqual(['received', 'stage:s2', 'ready', 'on_hold'])
  })
  it('places inactive-stage / stage-less groups at the end of the In Progress region', () => {
    const present = ['received', 'stage:old', 'in_progress', 'ready']
    expect(orderedGroupKeys(active, present)).toEqual(['received', 'stage:old', 'in_progress', 'ready'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/work-stages.test.ts`
Expected: FAIL — cannot resolve module `@/lib/work-stages` (file not created yet).

- [ ] **Step 3: Create the implementation**

Create `src/lib/work-stages.ts`:
```typescript
import { supabase } from './supabase'
import type { WorkStage, WorkStatus } from './database.types'
import { WORK_STATUS_LABELS, WORK_STATUS_COLORS } from './work-status'

// Pill color used when a stage has no color set (mirrors service-status DEFAULT_COLOR).
export const STAGE_DEFAULT_COLOR = 'bg-gray-100 text-gray-700'

// All stages (active + inactive), ordered. The dropdown only OFFERS active stages,
// but inactive ones are still needed to LABEL items left sitting on a retired stage.
export async function fetchWorkStages(): Promise<WorkStage[]> {
  const { data } = await supabase
    .from('work_stages')
    .select('*')
    .order('sort_order')
    .order('label')
  return data ?? []
}

// Active stages only — used by the manage screen and as dropdown options.
export async function fetchActiveWorkStages(): Promise<WorkStage[]> {
  const { data } = await supabase
    .from('work_stages')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
    .order('label')
  return data ?? []
}

// ---- Pure helpers (unit-tested) -------------------------------------------

export type WorkOption = { value: string; label: string; color: string }

// (work_status, stage_id) -> Select `value` string.
//   in_progress + stage  -> "stage:<id>"
//   in_progress + null    -> "in_progress"
//   any other phase       -> the bare WorkStatus
export function encodeWork(work_status: WorkStatus, stage_id: string | null): string {
  if (work_status === 'in_progress') return stage_id ? `stage:${stage_id}` : 'in_progress'
  return work_status
}

// Inverse of encodeWork.
export function decodeWork(value: string): { work_status: WorkStatus; stage_id: string | null } {
  if (value.startsWith('stage:')) return { work_status: 'in_progress', stage_id: value.slice('stage:'.length) }
  if (value === 'in_progress') return { work_status: 'in_progress', stage_id: null }
  return { work_status: value as WorkStatus, stage_id: null }
}

// Display label for a current (work_status, stage_id).
export function workLabel(work_status: WorkStatus, stage_id: string | null, stagesById: Map<string, WorkStage>): string {
  if (work_status === 'in_progress' && stage_id) {
    const s = stagesById.get(stage_id)
    if (s) return s.label
  }
  return WORK_STATUS_LABELS[work_status]
}

// Pill color classes for a current (work_status, stage_id).
export function workColor(work_status: WorkStatus, stage_id: string | null, stagesById: Map<string, WorkStage>): string {
  if (work_status === 'in_progress' && stage_id) {
    const s = stagesById.get(stage_id)
    if (s) return s.color ?? STAGE_DEFAULT_COLOR
  }
  return WORK_STATUS_COLORS[work_status]
}

// Same as workLabel/workColor but keyed by an encoded group/option value.
export function labelForValue(value: string, stagesById: Map<string, WorkStage>): string {
  const { work_status, stage_id } = decodeWork(value)
  return workLabel(work_status, stage_id, stagesById)
}
export function colorForValue(value: string, stagesById: Map<string, WorkStage>): string {
  const { work_status, stage_id } = decodeWork(value)
  return workColor(work_status, stage_id, stagesById)
}

// Canonical ordered options (also the canonical group order):
// Received, each active stage (in order), Ready, Delivered, On Hold.
export function workOptions(activeStages: WorkStage[]): WorkOption[] {
  return [
    { value: 'received', label: WORK_STATUS_LABELS.received, color: WORK_STATUS_COLORS.received },
    ...activeStages.map(s => ({ value: `stage:${s.id}`, label: s.label, color: s.color ?? STAGE_DEFAULT_COLOR })),
    { value: 'ready', label: WORK_STATUS_LABELS.ready, color: WORK_STATUS_COLORS.ready },
    { value: 'delivered', label: WORK_STATUS_LABELS.delivered, color: WORK_STATUS_COLORS.delivered },
    { value: 'on_hold', label: WORK_STATUS_LABELS.on_hold, color: WORK_STATUS_COLORS.on_hold },
  ]
}

// Options for ONE item, guaranteeing the item's current value is present even if
// it sits on a now-inactive stage or is In-Progress with no stage (so shadcn's
// SelectValue can render it). The extra is inserted at the start of the
// In-Progress region (right after "Received").
export function workOptionsForItem(
  activeStages: WorkStage[],
  work_status: WorkStatus,
  stage_id: string | null,
  stagesById: Map<string, WorkStage>,
): WorkOption[] {
  const base = workOptions(activeStages)
  const current = encodeWork(work_status, stage_id)
  if (base.some(o => o.value === current)) return base
  const extra: WorkOption = {
    value: current,
    label: workLabel(work_status, stage_id, stagesById),
    color: workColor(work_status, stage_id, stagesById),
  }
  const insertAt = base.findIndex(o => o.value === 'received') + 1
  return [...base.slice(0, insertAt), extra, ...base.slice(insertAt)]
}

// Group-key ordering for the work queue. Canonical order, with any present keys
// not in the canonical list (inactive stages / bare in_progress) placed at the
// end of the In-Progress region (just before "Ready"), in their incoming order.
export function orderedGroupKeys(activeStages: WorkStage[], present: string[]): string[] {
  const canonical = workOptions(activeStages).map(o => o.value)
  const presentSet = new Set(present)
  const extras = present.filter(k => !canonical.includes(k))
  const out: string[] = []
  for (const key of canonical) {
    if (key === 'ready') out.push(...extras)
    if (presentSet.has(key)) out.push(key)
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/work-stages.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-stages.ts src/lib/work-stages.test.ts
git commit -m "feat(work-stages): pure helpers for phase+stage flattening + tests"
```

---

## Task 4: Remove `qc` from `work-status.ts`

**Files:**
- Test: `src/lib/work-status.test.ts`
- Modify: `src/lib/work-status.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/work-status.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import {
  WORK_STATUSES, WORK_STATUS_LABELS, WORK_STATUS_COLORS,
  nextWorkStatus, dominantWorkStatus,
} from '@/lib/work-status'

describe('work statuses (qc removed)', () => {
  it('no longer lists qc', () => {
    expect(WORK_STATUSES).toEqual(['received', 'in_progress', 'ready', 'delivered', 'on_hold'])
    expect('qc' in WORK_STATUS_LABELS).toBe(false)
    expect('qc' in WORK_STATUS_COLORS).toBe(false)
  })
  it('flows in_progress straight to ready (no qc step)', () => {
    expect(nextWorkStatus('in_progress')).toBe('ready')
    expect(nextWorkStatus('received')).toBe('in_progress')
    expect(nextWorkStatus('delivered')).toBeNull()
  })
  it('still resolves a dominant status, preferring on_hold then least-progressed', () => {
    expect(dominantWorkStatus(['ready', 'on_hold', 'received'])).toBe('on_hold')
    expect(dominantWorkStatus(['ready', 'received'])).toBe('received')
    expect(dominantWorkStatus([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/work-status.test.ts`
Expected: FAIL — `WORK_STATUSES` still contains `'qc'`, so the first assertion fails.

- [ ] **Step 3: Edit `work-status.ts` to remove every `qc` reference**

Apply each edit:

Find `  'in_progress',\n  'qc',\n  'ready',` in the `WORK_STATUSES` array and remove the `'qc',` line so it reads:
```typescript
export const WORK_STATUSES: WorkStatus[] = [
  'received',
  'in_progress',
  'ready',
  'delivered',
  'on_hold',
]
```

In `WORK_STATUS_LABELS`, delete the line `  qc: 'QC',`.

In `WORK_STATUS_COLORS`, delete the line `  qc:          'bg-purple-100 text-purple-700',`.

In `WORK_STATUS_FILLED`, delete the line `  qc:          'bg-purple-600 text-white border border-purple-600',`.

In `WORK_STATUS_OUTLINED`, delete the line `  qc:          'bg-white border border-purple-500 text-purple-700',`.

In `DOMINANT_PRIORITY`, delete the `  'qc',` line so it reads:
```typescript
const DOMINANT_PRIORITY: WorkStatus[] = [
  'on_hold',
  'received',
  'in_progress',
  'ready',
  'delivered',
]
```

Change `LINEAR_FLOW`:
```typescript
const LINEAR_FLOW: WorkStatus[] = ['received', 'in_progress', 'ready', 'delivered']
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/work-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-status.ts src/lib/work-status.test.ts
git commit -m "feat(work-stages): drop qc from the work_status phase backbone"
```

---

## Task 5: Settings — Work Stages manage screen

**Files:**
- Create: `src/app/(authenticated)/settings/work-stages/page.tsx`
- Modify: `src/app/(authenticated)/settings/page.tsx`

> This is a near-verbatim clone of `settings/service-statuses/page.tsx` (table `work_stages`, type `WorkStage`, reusing the shared `COLOR_PRESETS`/`DEFAULT_COLOR`). No unit test — verified by build + manual smoke (no DOM test infra exists).

- [ ] **Step 1: Create the manage page**

Create `src/app/(authenticated)/settings/work-stages/page.tsx`:
```typescript
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeft, Plus, Pencil, ToggleLeft, ToggleRight, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkStage } from '@/lib/database.types'
import { COLOR_PRESETS, DEFAULT_COLOR } from '@/lib/service-status'

const schema = z.object({
  label: z.string().min(1, 'Label is required').max(40, 'Keep it short'),
  color: z.string().min(1),
})
type FormData = z.infer<typeof schema>

export default function WorkStagesPage() {
  const [rows, setRows] = useState<WorkStage[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<WorkStage | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { label: '', color: DEFAULT_COLOR },
  })
  const watchedColor = watch('color')
  const watchedLabel = watch('label')

  const load = () =>
    supabase
      .from('work_stages')
      .select('*')
      .order('sort_order')
      .order('label')
      .then(({ data }) => {
        setRows(data ?? [])
        setLoading(false)
      })

  useEffect(() => { load() }, [])

  const openNew = () => {
    setEditing(null)
    setError(null)
    reset({ label: '', color: DEFAULT_COLOR })
    setOpen(true)
  }

  const openEdit = (s: WorkStage) => {
    setEditing(s)
    setError(null)
    reset({ label: s.label, color: s.color ?? DEFAULT_COLOR })
    setOpen(true)
  }

  const onSubmit = async (data: FormData) => {
    setSaving(true)
    setError(null)
    if (editing) {
      const { error } = await supabase
        .from('work_stages')
        .update({ label: data.label.trim(), color: data.color })
        .eq('id', editing.id)
      if (error) setError(error.message)
    } else {
      const nextOrder = (rows.at(-1)?.sort_order ?? 0) + 10
      const { error } = await supabase.from('work_stages').insert({
        label: data.label.trim(),
        color: data.color,
        sort_order: nextOrder,
        is_active: true,
      })
      if (error) setError(error.message)
    }
    setSaving(false)
    if (!error) {
      setOpen(false)
      load()
    }
  }

  const toggleActive = async (s: WorkStage) => {
    await supabase.from('work_stages').update({ is_active: !s.is_active }).eq('id', s.id)
    load()
  }

  const move = async (index: number, dir: -1 | 1) => {
    const target = rows[index + dir]
    const current = rows[index]
    if (!target || !current) return
    await Promise.all([
      supabase.from('work_stages').update({ sort_order: target.sort_order }).eq('id', current.id),
      supabase.from('work_stages').update({ sort_order: current.sort_order }).eq('id', target.id),
    ])
    load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Work Stages</h1>
            <p className="text-sm text-gray-500 mt-0.5">Steps a job moves through while In Progress (Custom Tray, Try-in, Finish &amp; Polish…).</p>
          </div>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Add Stage</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Order</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-400">Loading…</TableCell></TableRow>}
              {!loading && rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-400">No stages yet</TableCell></TableRow>}
              {rows.map((s, i) => (
                <TableRow key={s.id} className={s.is_active ? '' : 'opacity-50'}>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', s.color ?? DEFAULT_COLOR)}>
                      {s.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">{s.is_active ? 'Active' : 'Inactive'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleActive(s)}>
                        {s.is_active ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Work Stage' : 'New Work Stage'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Label *</Label>
              <Input placeholder="e.g. Try-in" {...register('label')} />
              {errors.label && <p className="text-xs text-destructive">{errors.label.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="grid grid-cols-4 gap-2">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setValue('color', c.value, { shouldDirty: true })}
                    className={cn(
                      'rounded-md px-2 py-1.5 text-xs font-medium border-2 transition-colors',
                      c.value,
                      watchedColor === c.value ? 'border-gray-900' : 'border-transparent hover:border-gray-300',
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="pt-2">
                <p className="text-xs text-gray-500 mb-1.5">Preview</p>
                <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', watchedColor)}>
                  {watchedLabel || 'Stage'}
                </span>
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Stage'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Add the settings entry**

In `src/app/(authenticated)/settings/page.tsx`:

Find:
```typescript
import { ChevronRight, ClipboardList, UserCog, ShieldCheck } from 'lucide-react'
```
Replace with:
```typescript
import { ChevronRight, ClipboardList, ListChecks, UserCog, ShieldCheck } from 'lucide-react'
```

Find:
```typescript
const sections = [
  {
    href: '/settings/service-statuses',
    icon: ClipboardList,
    title: 'Service Statuses',
    description: 'Delivery-note instructions to the doctor (Try in, Redo, Final…).',
  },
]
```
Replace with:
```typescript
const sections = [
  {
    href: '/settings/service-statuses',
    icon: ClipboardList,
    title: 'Service Statuses',
    description: 'Delivery-note instructions to the doctor (Try in, Redo, Final…).',
  },
  {
    href: '/settings/work-stages',
    icon: ListChecks,
    title: 'Work Stages',
    description: 'Bench steps a job moves through while In Progress (Custom Tray, Try-in…).',
  },
]
```

- [ ] **Step 3: Lint + build** (NOT `tsc` — see Background facts; ~50 baseline `tsc` errors are expected and not real)

Run: `npm run lint`
Expected: no new errors in the two files you touched.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke test**

Run `npm run dev`, log in, go to **Settings → Work Stages**. Verify: the 4 seeded stages list in order; you can add a stage, edit its label/color, reorder with the arrows, and toggle active/inactive. (Stop the dev server when done.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authenticated)/settings/work-stages/page.tsx" "src/app/(authenticated)/settings/page.tsx"
git commit -m "feat(work-stages): Settings screen to manage work stages"
```

---

## Task 6: Work Queue page — slot dropdown + per-stage grouping

**Files:**
- Modify (rewrite): `src/app/(authenticated)/work/page.tsx`

> The logic is in the tested `work-stages.ts` helper; this task wires it in. State that was keyed by `WorkStatus` (`collapsed`, `recentlyMoved`, group keys) becomes keyed by the encoded slot **string**. Phase-level filter chips are unchanged (the `in_progress` chip covers all stages); grouping expands `in_progress` into one group per stage.

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `src/app/(authenticated)/work/page.tsx` with:
```typescript
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Search, ChevronRight, ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkStatus, WorkStage } from '@/lib/database.types'
import {
  WORK_STATUSES, WORK_STATUS_LABELS, WORK_STATUS_FILLED, WORK_STATUS_OUTLINED,
} from '@/lib/work-status'
import {
  fetchWorkStages, encodeWork, decodeWork, workOptionsForItem,
  labelForValue, colorForValue, orderedGroupKeys,
} from '@/lib/work-stages'

type Row = {
  id: string
  description: string
  work_status: WorkStatus
  stage_id: string | null
  work_status_updated_at: string
  invoices: {
    id: string
    invoice_number: string
    status: string
    voided_at: string | null
    customers: { clinic_name: string } | null
  } | null
}

type FilterMode = 'active' | 'all' | WorkStatus

// Outlined/filled palettes for the meta chips so they follow the same
// "color = stage" rule as the per-status chips.
const META_CHIP_OUTLINED: Record<'active' | 'all', string> = {
  active: 'bg-white border border-primary text-primary',
  all:    'bg-white border border-slate-400 text-slate-700',
}
const META_CHIP_FILLED: Record<'active' | 'all', string> = {
  active: 'bg-primary text-primary-foreground border border-primary',
  all:    'bg-slate-700 text-white border border-slate-700',
}

const MOVE_HINT_MS = 4000

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

// A small pill used for group headers and the "moved to" hint, colored by slot.
function SlotBadge({ value, stagesById, className }: {
  value: string
  stagesById: Map<string, WorkStage>
  className?: string
}) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
      colorForValue(value, stagesById),
      className,
    )}>
      {labelForValue(value, stagesById)}
    </span>
  )
}

export default function WorkPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [stages, setStages] = useState<WorkStage[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterMode>('active')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Items recently changed → shown briefly with a "moved to X" hint even if they
  // no longer match the current filter. Maps item id → new slot value. Cleared
  // after MOVE_HINT_MS.
  const [recentlyMoved, setRecentlyMoved] = useState<Map<string, string>>(new Map())

  const load = async () => {
    const [{ data }, stageRows] = await Promise.all([
      supabase
        .from('invoice_items')
        .select('id, description, work_status, stage_id, work_status_updated_at, invoices(id, invoice_number, status, voided_at, customers(clinic_name))')
        .order('work_status_updated_at', { ascending: false })
        .order('id', { ascending: true }),
      fetchWorkStages(),
    ])
    const items = ((data ?? []) as unknown as Row[]).filter(r => r.invoices && r.invoices.voided_at == null)
    setRows(items)
    setStages(stageRows)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const allStagesById = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages])
  const activeStages = useMemo(() => stages.filter(s => s.is_active), [stages])

  // Optimistic local updates — no refetch, so the row stays put visually.
  const updateStatus = async (id: string, value: string) => {
    const { work_status, stage_id } = decodeWork(value)
    setRows(prev => prev.map(r =>
      r.id === id
        ? { ...r, work_status, stage_id, work_status_updated_at: new Date().toISOString() }
        : r
    ))
    setRecentlyMoved(prev => {
      const n = new Map(prev)
      n.set(id, value)
      return n
    })
    setTimeout(() => {
      setRecentlyMoved(prev => {
        if (!prev.has(id)) return prev
        const n = new Map(prev)
        n.delete(id)
        return n
      })
    }, MOVE_HINT_MS)
    // The DB trigger logs history + stamps the timestamp; we only write the change.
    await supabase.from('invoice_items').update({ work_status, stage_id }).eq('id', id)
  }

  const toggleCollapsed = (key: string) => {
    setCollapsed(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  // counts across all rows, per phase (chips stay phase-level)
  const counts = useMemo(() => {
    const c: Record<WorkStatus, number> = {
      received: 0, in_progress: 0, ready: 0, delivered: 0, on_hold: 0,
    }
    for (const r of rows) c[r.work_status]++
    return c
  }, [rows])

  const activeCount = useMemo(
    () => rows.filter(r => r.work_status !== 'delivered').length,
    [rows]
  )

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim()
    return rows.filter(r => {
      const isRecentlyMoved = recentlyMoved.has(r.id)
      // Stage filter — recently-moved rows bypass it so the user sees confirmation
      if (!isRecentlyMoved) {
        if (filter === 'active' && r.work_status === 'delivered') return false
        if (filter !== 'active' && filter !== 'all' && r.work_status !== filter) return false
      }
      if (!q) return true
      return (
        r.description.toLowerCase().includes(q) ||
        (r.invoices?.invoice_number.toLowerCase().includes(q) ?? false) ||
        (r.invoices?.customers?.clinic_name.toLowerCase().includes(q) ?? false)
      )
    })
  }, [rows, filter, search, recentlyMoved])

  // Group items by their encoded slot (received / stage:<id> / in_progress / ready / …),
  // ordered canonically with any inactive-stage groups slotted into the In-Progress region.
  const grouped = useMemo(() => {
    const g = new Map<string, Row[]>()
    for (const r of visible) {
      const key = encodeWork(r.work_status, r.stage_id)
      if (!g.has(key)) g.set(key, [])
      g.get(key)!.push(r)
    }
    const order = orderedGroupKeys(activeStages, [...g.keys()])
    return order.map(key => ({ key, items: g.get(key)! }))
  }, [visible, activeStages])

  const chips: Array<{ key: FilterMode; label: string; count: number }> = [
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'all', label: 'All', count: rows.length },
    ...WORK_STATUSES.map(s => ({ key: s as FilterMode, label: WORK_STATUS_LABELS[s], count: counts[s] })),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Work Queue</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {activeCount} active item{activeCount === 1 ? '' : 's'} across all invoices
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {chips.map(c => {
          const stageKey = c.key !== 'active' && c.key !== 'all' ? (c.key as WorkStatus) : null
          const isSelected = filter === c.key
          const filled = stageKey ? WORK_STATUS_FILLED[stageKey] : META_CHIP_FILLED[c.key as 'active' | 'all']
          const outlined = stageKey ? WORK_STATUS_OUTLINED[stageKey] : META_CHIP_OUTLINED[c.key as 'active' | 'all']
          return (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                isSelected ? filled : cn(outlined, 'hover:bg-gray-50'),
              )}
            >
              {c.label}
              <span className={cn(
                'inline-flex items-center justify-center min-w-[18px] h-4 rounded-full px-1 text-[10px] font-semibold',
                isSelected ? 'bg-white/25' : 'bg-gray-100 text-gray-600',
              )}>
                {c.count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search item, invoice, customer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading && (
        <Card><CardContent className="py-10 text-center text-gray-400">Loading…</CardContent></Card>
      )}

      {!loading && grouped.length === 0 && (
        <Card><CardContent className="py-10 text-center text-gray-400">No items.</CardContent></Card>
      )}

      <div className="space-y-4">
        {grouped.map(group => {
          const isCollapsed = collapsed.has(group.key)
          return (
            <Card key={group.key} className="overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCollapsed(group.key)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 border-b"
              >
                <div className="flex items-center gap-3">
                  {isCollapsed ? <ChevronRight className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  <SlotBadge value={group.key} stagesById={allStagesById} />
                  <span className="text-sm text-gray-500">{group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
                </div>
              </button>
              {!isCollapsed && (
                <div className="divide-y">
                  {group.items.map(row => {
                    const movedTo = recentlyMoved.get(row.id)
                    const isMoved = movedTo !== undefined
                    const currentValue = encodeWork(row.work_status, row.stage_id)
                    const options = workOptionsForItem(activeStages, row.work_status, row.stage_id, allStagesById)
                    return (
                      <div
                        key={row.id}
                        className={cn(
                          'px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 transition-colors',
                          isMoved && 'bg-green-50/60'
                        )}
                      >
                        <div className="md:w-48 min-w-0">
                          <Link
                            href={`/invoices/${row.invoices?.id}`}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            {row.invoices?.invoice_number ?? '—'}
                          </Link>
                          <div className="text-xs text-gray-500 truncate">
                            {row.invoices?.customers?.clinic_name ?? '—'}
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-900 truncate">{row.description}</div>
                          {isMoved ? (
                            <div className="text-xs text-green-700 mt-0.5 flex items-center gap-1">
                              <Check className="h-3 w-3" /> Moved to <SlotBadge value={movedTo!} stagesById={allStagesById} className="ml-0.5" />
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400 mt-0.5">{relativeTime(row.work_status_updated_at)}</div>
                          )}
                        </div>

                        <Select value={currentValue} onValueChange={v => updateStatus(row.id, v)}>
                          <SelectTrigger
                            className={cn(
                              'h-8 w-40 text-xs font-medium border-transparent',
                              colorForValue(currentValue, allStagesById)
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map(o => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build + dead-import grep** (no working linter/`tsc` — see Background facts)

This rewrite drops the `WORK_STATUS_COLORS` and `WorkStatusBadge` imports. Since nothing auto-detects dead imports, grep to confirm every symbol still imported is used at least twice (the import line + ≥1 use):
Run: `for s in WORK_STATUSES WORK_STATUS_LABELS WORK_STATUS_FILLED WORK_STATUS_OUTLINED fetchWorkStages encodeWork decodeWork workOptionsForItem labelForValue colorForValue orderedGroupKeys; do echo "$s: $(grep -c "\b$s\b" "src/app/(authenticated)/work/page.tsx")"; done`
Expected: every count ≥ 2. Also confirm `WORK_STATUS_COLORS` and `WorkStatusBadge` are GONE: `grep -nE "WORK_STATUS_COLORS|WorkStatusBadge" "src/app/(authenticated)/work/page.tsx"` → no matches.

Run: `npm run build`
Expected: build succeeds (the `/work` route compiles).

- [ ] **Step 3: Manual smoke test**

`npm run dev` → open **Work Queue**. Verify: groups appear as Received → each stage (Custom Tray, Try-in, …) → Ready → Delivered → On Hold; the per-item dropdown lists those same options; changing an item to "Try-in" shows the green "Moved to Try-in" hint and the item lands in the Try-in group; the `in_progress` filter chip shows all staged items grouped by stage. (Stop dev server when done.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authenticated)/work/page.tsx"
git commit -m "feat(work-stages): Work Queue slot dropdown + per-stage grouping"
```

---

## Task 7: Invoice detail — per-item stage dropdown + stage in history

**Files:**
- Modify: `src/app/(authenticated)/invoices/[id]/page.tsx`

> The page already fetches history with `.select('*')`, so `stage_id` arrives automatically. We add a `stages` fetch for labels, swap the per-item control to the slot dropdown, write `stage_id`, and show the stage in the history list. Do **not** insert history manually — the DB trigger does it.

- [ ] **Step 1: Fix imports**

After this task, the page no longer references `WORK_STATUSES`, `WORK_STATUS_LABELS`, `WORK_STATUS_COLORS`, or the `WorkStatus` type directly (each was used **only** in the per-item control being replaced — verified by grep). They must be removed or `next lint` will fail on unused imports. `WorkStatusBadge` stays (non-stage history rows still use it).

Find:
```typescript
import type { Invoice, InvoiceItem, InvoiceItemStatusHistory, Payment, Customer, WorkStatus, ServiceStatus, Product } from '@/lib/database.types'
```
Replace with (drop `WorkStatus`, add `WorkStage`):
```typescript
import type { Invoice, InvoiceItem, InvoiceItemStatusHistory, Payment, Customer, WorkStage, ServiceStatus, Product } from '@/lib/database.types'
```

Find (delete this entire line — nothing on the page references these symbols after this task):
```typescript
import { WORK_STATUSES, WORK_STATUS_LABELS, WORK_STATUS_COLORS } from '@/lib/work-status'
```
Delete it, then add the work-stages helper import next to the other `@/lib` imports. Find:
```typescript
import { WorkStatusBadge } from '@/components/work-status-badge'
import { fetchActiveServiceStatuses, DEFAULT_COLOR } from '@/lib/service-status'
```
Replace with:
```typescript
import { WorkStatusBadge } from '@/components/work-status-badge'
import { fetchActiveServiceStatuses, DEFAULT_COLOR } from '@/lib/service-status'
import {
  fetchWorkStages, encodeWork, decodeWork, workOptionsForItem,
  workLabel, workColor,
} from '@/lib/work-stages'
```

- [ ] **Step 2: Add a `stages` state**

Find the existing history state declaration (search for `const [history`) and add a `stages` state right after it:
```typescript
  const [stages, setStages] = useState<WorkStage[]>([])
```
(If you cannot find `const [history`, place this line next to the other `useState` declarations near the top of the component.)

- [ ] **Step 3: Fetch stages in `load()`**

In `load()`, find the `Promise.all([...])` block that fetches the invoice/items/payments/etc., and add a stages fetch. Find:
```typescript
    const [invRes, itemsRes, paymentsRes, ssRes, prodRes] = await Promise.all([
      supabase.from('invoices').select('*, customers(*), service_statuses(*)').eq('id', id).single(),
      supabase.from('invoice_items').select('*').eq('invoice_id', id).order('created_at'),
      supabase.from('payments').select('*').eq('invoice_id', id).order('payment_date'),
      fetchActiveServiceStatuses(),
      supabase.from('products').select('*').eq('active', true).order('created_at'),
    ])
```
Replace with:
```typescript
    const [invRes, itemsRes, paymentsRes, ssRes, prodRes, stageRows] = await Promise.all([
      supabase.from('invoices').select('*, customers(*), service_statuses(*)').eq('id', id).single(),
      supabase.from('invoice_items').select('*').eq('invoice_id', id).order('created_at'),
      supabase.from('payments').select('*').eq('invoice_id', id).order('payment_date'),
      fetchActiveServiceStatuses(),
      supabase.from('products').select('*').eq('active', true).order('created_at'),
      fetchWorkStages(),
    ])
    setStages(stageRows)
```

- [ ] **Step 4: Update `updateWorkStatus` to write `stage_id`**

Find:
```typescript
  const updateWorkStatus = async (itemId: string, status: WorkStatus) => {
    await supabase.from('invoice_items').update({ work_status: status }).eq('id', itemId)
    load()
  }
```
Replace with:
```typescript
  const updateWorkStatus = async (itemId: string, value: string) => {
    const { work_status, stage_id } = decodeWork(value)
    // The DB trigger logs history + stamps the timestamp; we only write the change.
    await supabase.from('invoice_items').update({ work_status, stage_id }).eq('id', itemId)
    load()
  }
```

- [ ] **Step 5: Add a stages-by-id map** (just before the `return (` of the component)

Find the component's `return (` for the JSX (the large one rendering the page) and add this line just above it:
```typescript
  const stagesById = new Map(stages.map(s => [s.id, s]))
```

- [ ] **Step 6: Swap the per-item Work Status control to the slot dropdown**

Find:
```typescript
                    <TableCell>
                      <Select
                        value={item.work_status}
                        onValueChange={v => updateWorkStatus(item.id, v as WorkStatus)}
                      >
                        <SelectTrigger
                          className={cn(
                            'h-8 w-36 text-xs font-medium border-transparent',
                            WORK_STATUS_COLORS[item.work_status]
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WORK_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{WORK_STATUS_LABELS[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
```
Replace with:
```typescript
                    <TableCell>
                      <Select
                        value={encodeWork(item.work_status, item.stage_id)}
                        onValueChange={v => updateWorkStatus(item.id, v)}
                      >
                        <SelectTrigger
                          className={cn(
                            'h-8 w-44 text-xs font-medium border-transparent',
                            workColor(item.work_status, item.stage_id, stagesById)
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {workOptionsForItem(stages.filter(s => s.is_active), item.work_status, item.stage_id, stagesById).map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
```

- [ ] **Step 7: Show the stage in the history "Status" cell**

Find:
```typescript
                              <TableCell>
                                <WorkStatusBadge status={h.status} />
                              </TableCell>
```
Replace with:
```typescript
                              <TableCell>
                                {h.status === 'in_progress' && h.stage_id ? (
                                  <span className={cn(
                                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                                    workColor(h.status, h.stage_id, stagesById),
                                  )}>
                                    {workLabel(h.status, h.stage_id, stagesById)}
                                  </span>
                                ) : (
                                  <WorkStatusBadge status={h.status} />
                                )}
                              </TableCell>
```

- [ ] **Step 8: Build + dead-import grep** (no working linter/`tsc` — see Background facts)

Step 1 removed `WORK_STATUSES`, `WORK_STATUS_LABELS`, `WORK_STATUS_COLORS`, and the `WorkStatus` type from this file's imports. Confirm none of them remain referenced (a leftover reference means you removed an import that's still used → restore it; a leftover import with no use → delete it):
Run: `grep -nE "\b(WORK_STATUSES|WORK_STATUS_LABELS|WORK_STATUS_COLORS)\b|: WorkStatus\b|as WorkStatus\b" "src/app/(authenticated)/invoices/[id]/page.tsx"`
Expected: no matches. Then confirm the new helper imports are all used: `for s in fetchWorkStages encodeWork decodeWork workOptionsForItem workLabel workColor WorkStage; do echo "$s: $(grep -c "\b$s\b" "src/app/(authenticated)/invoices/[id]/page.tsx")"; done` → every count ≥ 2.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 9: Manual smoke test**

`npm run dev` → open an invoice with items → **Work Status** card. Verify: the per-item dropdown shows Received → stages → Ready → Delivered → On Hold; setting an item to a stage persists after reload and the trigger adds a "Work history" row showing the stage label; the trigger's "Updated" timestamp refreshes. (Stop dev server when done.)

- [ ] **Step 10: Commit**

```bash
git add "src/app/(authenticated)/invoices/[id]/page.tsx"
git commit -m "feat(work-stages): invoice detail stage dropdown + stage in work history"
```

---

## Task 8: Final verification

**Files:** none (verification + optional cleanup commit)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including `work-stages.test.ts` and `work-status.test.ts`.

- [ ] **Step 2: Test + build** (no working linter/`tsc` — see Background facts)

Run: `npm test`
Expected: all vitest tests pass (work-stages + work-status suites).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Grep for stragglers**

Run: `grep -rniE "\bqc\b|'qc'|\"qc\"" src/`
Expected: no matches (every `qc` reference is gone from the frontend).

- [ ] **Step 4: End-to-end manual checklist** (`npm run dev`)

1. Settings → Work Stages: add a stage "Bite Block", reorder it, deactivate it.
2. Work Queue: an item set to a now-inactive stage still shows that stage in its dropdown and a group for it; active items group by active stages.
3. Invoice detail: move an item Received → Custom Tray → Try-in → Ready; each move adds a history row with the right label; the Updated timestamp changes on every move (including stage→stage).
4. No "QC" appears anywhere in the UI.

- [ ] **Step 5: (If anything was tidied) commit**

```bash
git add -A
git commit -m "chore(work-stages): final verification fixes"
```
(Skip if nothing changed.)

---

## Self-review notes (spec coverage)

- **Remove `qc`** → Task 1 (enum), Task 4 (frontend), Task 8 Step 3 (grep guard). ✓
- **Editable stages under In Progress** → Task 1 (`work_stages` + seed), Task 5 (manage screen). ✓
- **Flattened phase+stage dropdown** → Task 3 helper, Tasks 6 & 7 wiring. ✓
- **Queue grouping by stage** → Task 6 (`orderedGroupKeys`). ✓
- **History + timestamp react to stage changes** → Task 1 (trigger rewrites), shown in history at Task 7. ✓
- **Inactive/missing stage still renders for an item** → Task 3 (`workOptionsForItem`, fallbacks) + tests. ✓
- **RLS so the client can read `work_stages`** → Task 1 (`authenticated_all` policy). ✓
- **No manual history writes (trigger owns it)** → Tasks 6 & 7 update only `invoice_items`. ✓
- **Future per-work-type workflows** → out of scope by design (spec "Future" section); not in this plan. ✓
