// Server-side READ query for the work queue.
//
// Runs inside a Server Component via the SSR client (`await createClient()`),
// which is RLS-aware through the session cookie. It mirrors, verbatim, the query
// `work/page.tsx` runs today — same `.select(...)` string + ordering — and the
// same voided-invoice exclusion (currently done client-side), so the move to
// server-first rendering is behavior-preserving.
//
// Writes live in `./invoice-actions.ts` (`updateWorkStatusAction`).

import { createClient } from '@/lib/supabase/server'
import type { InvoiceItem, WorkStage, WorkStatus, WorkStatusConfig } from '@/lib/database.types'

// One work-queue row: the invoice item fields the page reads, plus the embedded
// invoice + customer shape the select returns. Composed from the schema-driven
// aliases so it stays in lockstep with the real columns.
export type WorkQueueRow = Pick<
  InvoiceItem,
  'id' | 'description' | 'work_status' | 'stage_id' | 'resume_status' | 'work_status_updated_at'
> & {
  work_status: WorkStatus
  resume_status: WorkStatus | null
  invoices: {
    id: string
    invoice_number: string
    status: string
    voided_at: string | null
    patient: string | null
    due_date: string
    customers: { clinic_name: string } | null
  } | null
}

// The work queue: items (voided invoices excluded) + the work stages used to
// render/order the per-item status dropdowns.
//
// Mirrors `work/page.tsx`:
//   invoice_items
//     .select('id, description, work_status, stage_id, resume_status, work_status_updated_at, invoices(id, invoice_number, status, voided_at, patient, due_date, customers(clinic_name))')
//     .order('work_status_updated_at', { ascending: false })
//     .order('id', { ascending: true })
//   then filter out items whose parent invoice is voided (voided_at != null);
//   work_stages.select('*').order('sort_order').order('label') (== fetchWorkStages).
export async function getWorkQueue(): Promise<{ rows: WorkQueueRow[]; stages: WorkStage[]; statusConfigs: WorkStatusConfig[] }> {
  const supabase = await createClient()

  const [itemsRes, stagesRes, statusConfigsRes] = await Promise.all([
    supabase
      .from('invoice_items')
      .select(
        'id, description, work_status, stage_id, resume_status, work_status_updated_at, invoices(id, invoice_number, status, voided_at, patient, due_date, customers(clinic_name))',
      )
      .order('work_status_updated_at', { ascending: false })
      .order('id', { ascending: true }),
    supabase.from('work_stages').select('*').order('sort_order').order('label'),
    supabase.from('work_status_configs').select('*').order('sort_order'),
  ])

  const rows = ((itemsRes.data ?? []) as unknown as WorkQueueRow[]).filter(
    r => r.invoices != null && r.invoices.voided_at == null,
  )

  return {
    rows,
    stages: (stagesRes.data ?? []) as WorkStage[],
    statusConfigs: (statusConfigsRes.data ?? []) as WorkStatusConfig[],
  }
}
