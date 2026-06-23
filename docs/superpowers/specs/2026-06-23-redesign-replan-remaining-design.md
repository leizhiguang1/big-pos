# Chidental-Lab Redesign — Remaining-Work Re-plan

**Date:** 2026-06-23
**Status:** Approved for execution (owner: "just continue to do and finish them")
**Type:** Program re-plan — supersedes the §15 phase order in
[2026-06-22-chidental-lab-redesign-design.md](2026-06-22-chidental-lab-redesign-design.md)
**Branch:** `feat/redesign-program`

---

## 1. Why a re-plan

The master spec laid out a clean polish-first roadmap (Phase 0 → 4). Execution
since then has been opportunistic: Phase 0 shipped whole, but later work jumped
ahead into Phase 4 (statements, A/R aging) while Phase 1/2 punch-list items
stayed open. The phase numbers no longer describe reality, so this doc
re-sequences only the **remaining** work.

### Audited state (2026-06-23, against the codebase)

| Phase | State | Shipped | Outstanding |
|---|---|---|---|
| 0 — UI foundation | ✅ Done | tokens, DataTable, loading/empty/error, Cmd+K, server components | — |
| 1 — Snappy data + money + naming | 🟡 ~80% | saved-view tabs, optimistic flips, Total/Paid/Outstanding, overpayment fixed (full-outstanding model), customer→clinic labels | server-side pagination/filtering; invoice-form polish (Enter-to-save, unsaved guard, searchable clinic picker) |
| 2 — Cases workspace | 🟡 ~70% | Board (DnD), List w/ filters, editors-first detail, service status as printed field | Calendar view; sortable + URL-persisted views + removable chips; surface/edit per-item `work_note`; one-click advance-status in header |
| 3 — Printing & editing | 🟡 ~70% | branded invoice, delivery note, print-temp-edit, edit flow | **work ticket** (bench doc); tax row (→ W5) |
| 4 — Money maturity | 🟡 ~50% | statements, A/R aging, account balance, WhatsApp contact | **credits/adjustments**; clinic columns (`payment_terms_days`, `discount_pct`, `tin`, whatsapp opt-in); **SST tax** |

~70–75% of the program is shipped.

## 2. Re-sequencing principle

**No-schema-first → additive-schema-last.** Ship the UI/data-layer polish that
makes the app *feel finished* before touching the database, and isolate each
additive migration into its own late wave so DB risk is contained and
type-regen happens once per wave.

All schema changes remain **additive** (new columns / sibling tables) per the
master spec §2 — never a destructive re-parenting.

## 3. Waves

### Wave 1 — Finish lists & forms *(no schema)*
- Server-side pagination/filtering via URL `searchParams` (`.order().range()` +
  `count:'estimated'`) on the list pages — replaces fetch-everything-filter-in-browser.
- List views: sortable columns, **URL-persisted** saved-view tabs, removable
  filter chips (falls out of the searchParams move).
- Invoice form polish: real Enter-to-save submit, unsaved-changes guard,
  searchable clinic picker (replace the long plain dropdown).
- Case detail header: one-click **Advance work status** action (today it's only
  reachable via the items table).

### Wave 2 — Cases workspace completion *(no schema)*
- **Calendar view** over the Cases workspace, by `due_date`.
- Surface and edit per-item **`work_note`** on the case detail (column already
  exists on `invoice_items`; currently captured but not shown/printed).

### Wave 3 — Work ticket document *(no schema)*
- Third print mode (alongside invoice + delivery note): internal **bench work
  ticket** — items, work status, work notes, patient/case ref; no prices.

### Wave 4 — Clinic metadata *(1 additive migration)*
- Migration: add to `customers` — `payment_terms_days int`, `discount_pct numeric`,
  `tin text`, `whatsapp_optin bool`.
- Expose in the clinic form; regenerate DB types.
- Wire: `payment_terms_days` → auto due-date on invoice create;
  `discount_pct` → invoice calculation; `tin` → printed on invoice + statement.

### Wave 5 — SST tax *(additive schema; default 0)*
- Tax config + per-invoice tax fields (rate + computed amount), calc, form input.
- Print row on invoice / delivery note / statement.
- Ships defaulting to **0%** until the rate is accountant-confirmed.

### Wave 6 — Credits & adjustments *(additive entity — largest)*
- New `credits` table (remake / return / goodwill).
- UI to issue a credit against a clinic/invoice.
- Feed the statement ledger (charges / payments / credits) and clinic account
  balance.
- **Scope note:** because payments are now full-outstanding-only, overpayment
  can't occur, so credits are purely remake/return/goodwill — not an overpayment
  sink.

Each wave gets its own implementation plan + atomic commits when executed.

## 4. Assumed defaults for the §16 gray-area decisions

The owner asked to proceed without stopping for these. Adopting the master
spec's documented defaults; **confirm before go-live**:

- **W4 discount model:** single per-clinic `discount_pct` (master spec §11),
  *not* per-item negotiated prices.
- **W5 SST:** build the tax line but default the rate to **0%**; do not enable a
  non-zero rate until the accountant confirms service-tax rate + threshold.
- **W6 remake policy:** credit reason codes = `remake | return | goodwill`;
  treat all as non-chargeable adjustments for now (no warranty-vs-chargeable
  branching until owner defines a policy).

## 5. Out of scope (unchanged from master §2 / "Later")

Production/case dates, FDI tooth chart/shade/material, attachments, WhatsApp
notifications, public status link, MyInvois API, payment allocations
(per-invoice vs lump-sum), credit-limit enforcement.

## 6. Success criteria

The five master-spec success criteria (§17) plus: every list paginates/filters
server-side; the Cases workspace has Board + List + Calendar; the lab can print
invoice + delivery note + work ticket; clinic-level economics (terms, discount,
tax, TIN, credits) are captured and reflected in statements.
