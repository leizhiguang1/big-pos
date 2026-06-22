# Work-status substate view + colored dropdown — Design

**Date:** 2026-06-22
**Status:** Approved
**Scope:** Presentational only. No DB / schema / migration — `work_stages` (label, color, `sort_order`, `is_active`) already exist. New + edited React components and one pure helper.

## Problem

The per-item work-status control shows the current stage as a colored pill on the
**trigger**, but:
1. When the dropdown is **open**, options are plain text — no color, and nothing
   signals that the four stages (Custom Tray, Try-in, Finalize Mill Design,
   Finish & Polish) are sub-stages of **In Progress**.
2. There is no at-a-glance view of **how far along** an in-progress item is —
   you must open the dropdown to read its single current stage.

## Design

### A. Colored, grouped dropdown (both surfaces)
Extract a shared `WorkStatusSelect` replacing the duplicated `Select` blocks in
`WorkStatusEditor.tsx` and `WorkQueueClient.tsx`. Structure:

```
( ) Received                gray
--- In Progress ---------         (SelectGroup + SelectLabel header)
 •  Custom Tray             blue
 •  Try-in                  amber
 •  Finalize Mill Design    purple   (current → check)
 •  Finish & Polish         green
( ) Ready                   green
( ) Delivered               gray
( ) On Hold                 orange
```

- Each option: a small **saturated colored dot** + label. Trigger stays the
  colored pill it is today.
- The In-Progress stages render under a `SelectGroup`/`SelectLabel` "In Progress".
- The current value is always present even if it sits on a retired stage / bare
  in-progress (reuse `workOptionsForItem` semantics), shown inside the group.

### B. Stage stepper (invoice-detail Work Status rows only)
New `WorkStageStepper`: when an item's `work_status === 'in_progress'`, render a
compact N-dot stepper (N = active stages) under the pill — completed = filled,
current = highlighted, upcoming = hollow — with `In Progress · {n} of {N}` and
short stage labels. Other statuses (received/ready/delivered/on_hold) render no
stepper. The work queue is already column-grouped by stage, so the stepper is
**not** added there.

Edge cases: bare in-progress (no stage) or a retired stage → indeterminate
"In Progress" marker (all dots hollow), no crash.

### C. Pure helpers (unit-tested) — `src/lib/work-stages.ts`
- `stageProgress(activeStages, work_status, stage_id) → { index, total } | null`
  - `null` when not in-progress.
  - `index` = 0-based position of `stage_id` in `activeStages`, or `-1` when the
    stage is missing/retired (indeterminate). `total` = active stage count.
- `dotColorClass(pillColor) → string` — derive a saturated dot class
  (`bg-<hue>-500`) from a pale pill class (`bg-<hue>-100 …`).

## Components touched
- `src/lib/work-stages.ts` — add `stageProgress`, `dotColorClass` (+ tests in
  `work-stages.test.ts`).
- `src/components/work-status-select.tsx` — **new**, shared colored+grouped select.
- `src/components/work/WorkStageStepper.tsx` — **new**, stepper.
- `src/components/invoices/detail/WorkStatusEditor.tsx` — use shared select + add stepper.
- `src/components/work/WorkQueueClient.tsx` — use shared select.

## Out of scope
- Stage sets per product type, assignees, time-in-stage aging (separate ideas).
- Any DB / enum / migration change.
